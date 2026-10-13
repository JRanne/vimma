/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Downloads from the agent workspace, asked and quarantined (docs/specs/vimma-mcp.md decision
// 31, sub-PR 2c; user: "agent should be able to download etc. As long as we can have way to
// ensure it downloads safe things"). All through Firefox's own hooks, no upstream patch:
// - Where the bytes go: every agent tab's top browsing context has `downloadFolderOverride` set
//   to the quarantine folder (AgentPages), which nsExternalAppHandler reads for its `.part` file
//   (uriloader/exthandler/nsExternalHelperAppService.cpp, GetInitialDownloadDirectory), and the
//   helper-app dialog (`@mozilla.org/helperapplauncherdialog;1`) is wrapped so an agent tab's
//   download is never shown Firefox's "open with" dialog and its final name is in the
//   quarantine too, as WebDriver BiDi's own handler does (remote/webdriver-bidi/
//   HelperAppDialogHandler.sys.mjs).
// - Integration.downloads (toolkit/components/downloads/DownloadCore.sys.mjs, Download.start
//   and _checkReputationAndMove): `shouldBlockForParentalControls` is the question (before the
//   saver runs: https only, in the quarantine, the size cap, the name and type checks);
//   `shouldBlockForReputationCheck` runs on the finished `.part` before it gets its name (the
//   first bytes, a zip's names, ClamAV); `downloadDone` sets mode 0600; `launchDownload` refuses
//   to open an agent download, ever.
// A download is the agent's when the tab it came from was opened by an agent connection that is
// still open; otherwise it asks as "a page in the agent workspace", with no grant.

import {
  DOWNLOAD_TOOL,
  HEAD_BYTES,
  ZIP_TAIL_BYTES,
  clamVerdict,
  dangerousContent,
  dangerousName,
  dangerousType,
  displayDir,
  downloadRefusedNotice,
  downloadSavedNotice,
  resolveDownloadDir,
  zipEntryNames,
  zipLocate,
  zipVerdict,
} from "../core/agent-downloads.mjs";
import { DEFAULT_CONFIG } from "../core/defaults.mjs";
import { McpHost } from "../host/mcp-ops.mjs";
import { WorkspaceStore } from "../workspaces/WorkspaceStore.sys.mjs";
import { AgentGate } from "./AgentGate.sys.mjs";

/** @import { Refusal, Danger } from "../core/agent-downloads.mjs" */

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  DownloadPaths: "resource://gre/modules/DownloadPaths.sys.mjs",
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
  Integration: "resource://gre/modules/Integration.sys.mjs",
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
  clearInterval: "resource://gre/modules/Timer.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setInterval: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

const DEFAULT_DIR = /** @type {string} */ (DEFAULT_CONFIG.mcp?.download_dir);
const DEFAULT_MAX_MB = /** @type {number} */ (DEFAULT_CONFIG.mcp?.download_max_mb);
/** How often a part file is measured while its question waits (the cap, decision 31 f). */
const WATCH_MS = 250;
/** The longest ClamAV may take on one file before it counts as an error. */
const CLAM_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * @typedef {{ conn: string | number | null, name: string, what: Record<string, any>,
 *   allowedDanger: boolean, scan: "none" | "clean" | "error", refused: boolean }} Tracked
 */

/** The agent downloads let through the question, until they are done. @type {WeakMap<any, Tracked>} */
const tracked = new WeakMap();
/** Browsers whose tab an agent connection opened or loaded (agent-open). */
/** @type {WeakMap<Element, string | number>} */
const openers = new WeakMap();
/** Content-Length by quarantine path, from the helper-app launcher (it knows it first). */
/** @type {Map<string, number>} */
const lengths = new Map();
/** Blocked agent downloads whose data must not be kept (shouldKeepBlockedData). */
let drops = 0;
let initialised = false;

const services = /** @type {any} */ (Services);

/** @param {number | null | undefined} userContextId */
function isAgentContainer(userContextId) {
  const agent = WorkspaceStore.agent?.userContextId;
  return typeof agent === "number" && agent > 0 && userContextId === agent;
}

const home = () => services.dirsvc.get("Home", Ci.nsIFile).path;

/**
 * The quarantine folder (decision 31 b): `[mcp] download_dir`, expanded. Never the folder
 * Firefox downloads to: then the default quarantine is used instead.
 */
function quarantineDir() {
  const raw = McpHost.config?.downloadDir ?? DEFAULT_DIR;
  const dir = resolveDownloadDir(raw, home());
  /** @type {string[]} */
  const theirs = [];
  try {
    theirs.push(services.dirsvc.get("DfltDwnld", Ci.nsIFile).path);
  } catch {
    // No default downloads folder on this system.
  }
  const pref = Services.prefs.getStringPref("browser.download.dir", "");
  if (pref) theirs.push(pref);
  if (dir === home() || theirs.includes(dir)) {
    console.error(`vimma: [mcp] download_dir ${dir} is not a quarantine folder; using the default`);
    return resolveDownloadDir(DEFAULT_DIR, home());
  }
  return dir;
}

/** The quarantine folder, made if missing, mode 0700. @param {string} dir */
async function ensureDir(dir) {
  await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
  await IOUtils.setPermissions(dir, 0o700);
}

/** The cap in bytes (decision 31 f). */
const capMb = () => McpHost.config?.downloadMaxMb ?? DEFAULT_MAX_MB;
const capBytes = () => capMb() * 1_000_000;

/** Firefox's own executable list (nsIApplicationReputationService.isExecutable). */
function isExecutable(/** @type {string} */ name) {
  try {
    return Cc["@mozilla.org/reputationservice/application-reputation-service;1"]
      .getService(Ci.nsIApplicationReputationService)
      .isExecutable(name);
  } catch {
    return false;
  }
}

/** @param {any} download */
const isAgentDownload = (download) => isAgentContainer(download?.source?.userContextId);

/** @param {any} download  the download's name, as saved */
const nameOf = (download) => PathUtils.filename(download.target.path);

/**
 * The agent connection a download belongs to: the one that opened its tab, if still open.
 * @param {any} download
 */
function connOf(download) {
  try {
    const bc = BrowsingContext.get(download.source.browsingContextId);
    const browser = bc?.top?.embedderElement;
    const conn = browser ? openers.get(browser) : undefined;
    return AgentGate.isConnected(conn) ? /** @type {string | number} */ (conn) : null;
  } catch {
    return null;
  }
}

/**
 * What is known of a download's size before its body: -1 when unknown.
 * @param {any} download @param {boolean} [take]  forget the launcher's length once read
 */
function knownSize(download, take = true) {
  const saver = download.saver ?? {};
  const fromLauncher = lengths.get(download.target.path);
  if (take) lengths.delete(download.target.path);
  for (const n of [
    fromLauncher,
    download.totalBytes,
    saver.totalBytes,
    saver.request?.contentLength,
  ]) {
    if (typeof n === "number" && n > 0) return n;
  }
  return -1;
}

/** The part file's size now, or 0. @param {any} download */
async function partSize(download) {
  const path = download.target.partFilePath ?? download.target.path;
  try {
    return (await IOUtils.stat(path)).size ?? 0;
  } catch {
    return 0;
  }
}

/** Never launch, never "open with", never shown in Firefox's viewer (decision 31 c). */
function neutralise(/** @type {any} */ download) {
  download.launchWhenSucceeded = false;
  download.launcherPath = null;
  download.launcherId = null;
  download.handleInternally = false;
}

/** @param {string} text */
const notice = (text) => AgentGate.notify(text);

/**
 * A refused download: its channel stopped, its part and placeholder deleted, and taken off the
 * downloads list (the notice says why, not Firefox's "blocked by parental controls").
 * @param {any} download
 */
async function discard(download) {
  for (let i = 0; i < 400 && !download.stopped; i++) {
    await new Promise((r) => lazy.setTimeout(r, 25));
  }
  // A helper-app download refused before its saver ran still has its channel open: cancel it,
  // and wait for the channel to stop before the part file is removed (it writes until then).
  const executed = download.saver?.deferExecuted?.promise;
  executed?.catch(() => {});
  try {
    download.saver?.cancel?.();
  } catch {
    // Already stopped.
  }
  if (executed) {
    await Promise.race([executed.catch(() => {}), new Promise((r) => lazy.setTimeout(r, 5000))]);
  }
  await download.finalize(true).catch(() => {});
  const dir = quarantineDir();
  for (const path of [download.target.partFilePath, download.target.path]) {
    if (path && PathUtils.parent(path) === dir) {
      await IOUtils.remove(path, { ignoreAbsent: true }).catch(() => {});
    }
  }
  const list = await lazy.Downloads.getList(lazy.Downloads.ALL);
  await list.remove(download).catch(() => {});
}

/**
 * The question, before the saver runs (DownloadCore's Download.start awaits this hook):
 * true refuses the download.
 * @param {any} download
 * @returns {Promise<boolean>}
 */
async function admit(download) {
  neutralise(download);
  const name = nameOf(download);
  /** @param {Refusal} why */
  const refuse = (why) => {
    notice(downloadRefusedNotice(name, why));
    discard(download);
    return true;
  };
  /** @type {URL | null} */
  let url = null;
  try {
    url = new URL(download.source.url);
  } catch {
    // Not a URL: refused below.
  }
  if (url?.protocol !== "https:") return refuse({ kind: "http" });
  const dir = quarantineDir();
  const part = download.target.partFilePath;
  if (PathUtils.parent(download.target.path) !== dir || (part && PathUtils.parent(part) !== dir)) {
    return refuse({ kind: "place" });
  }
  // A legacy (helper-app) download learns its channel just after it starts: wait for it, so the
  // question has the size the server gave.
  for (
    let i = 0;
    i < 40 && download.saver?.request === null && knownSize(download, false) < 0;
    i++
  ) {
    await new Promise((r) => lazy.setTimeout(r, 25));
  }
  const size = knownSize(download);
  if (size > capBytes()) return refuse({ kind: "cap", mb: capMb() });
  const ext = (/\.([^./]{1,16})$/.exec(name)?.[1] ?? "").toLowerCase();
  const danger = dangerousName(name, { isExecutable }) ?? dangerousType(download.contentType);
  const what = {
    name,
    size,
    type: download.contentType ?? "",
    ext,
    host: url.host,
    ...(danger ? { danger: danger.text } : {}),
  };
  const conn = connOf(download);
  // The cap while the question waits (decision 31 f): the bytes keep coming meanwhile.
  /** @type {(() => void) | null} */
  let withdraw = null;
  let capped = false;
  const watch = lazy.setInterval(async () => {
    if ((await partSize(download)) > capBytes() && withdraw) {
      capped = true;
      withdraw();
    }
  }, WATCH_MS);
  const options = { always: !!danger, onCancel: (/** @type {() => void} */ c) => (withdraw = c) };
  let outcome;
  try {
    outcome =
      conn === null
        ? await AgentGate.askPage(DOWNLOAD_TOOL, what, options)
        : await AgentGate.request(conn, DOWNLOAD_TOOL, what, options);
  } finally {
    lazy.clearInterval(watch);
  }
  if (capped || (await partSize(download)) > capBytes())
    return refuse({ kind: "cap", mb: capMb() });
  if (!outcome.allow) {
    // The gate's own notice says no, timeout or mute; busy and muted are said here.
    if (outcome.reason === "busy" || outcome.reason === "muted") {
      notice(`refused download "${name}": agent requests ${outcome.reason}`);
    }
    discard(download);
    return true;
  }
  tracked.set(download, {
    conn,
    name,
    what,
    allowedDanger: !!danger,
    scan: "none",
    refused: false,
  });
  return false;
}

/**
 * Block a finished agent download (its `.part` deleted), for _checkReputationAndMove.
 * @param {any} download @param {Refusal} why
 */
async function block(download, why) {
  const t = tracked.get(download);
  if (t) t.refused = true;
  const part = download.target.partFilePath ?? download.target.path;
  await IOUtils.remove(part, { ignoreAbsent: true }).catch(() => {});
  drops++;
  notice(downloadRefusedNotice(nameOf(download), why));
  // Off the list once it has failed.
  download.whenSucceeded().catch(() => {});
  lazy.setTimeout(() => discard(download), 0);
  return {
    shouldBlock: true,
    verdict: Ci.nsIApplicationReputationService.VERDICT_DANGEROUS,
  };
}

/**
 * What the finished file is (decision 31 d): its first bytes, and a zip's names.
 * @param {string} path @returns {Promise<Danger | null>}
 */
async function contentDanger(path) {
  const size = (await IOUtils.stat(path)).size ?? 0;
  const head = await IOUtils.read(path, { maxBytes: Math.min(size, HEAD_BYTES) });
  const byBytes = dangerousContent(head);
  if (byBytes) return byBytes;
  const start = Math.max(0, size - ZIP_TAIL_BYTES);
  const tail = size ? await IOUtils.read(path, { offset: start, maxBytes: size - start }) : head;
  const at = zipLocate(tail, size);
  if (at.kind === "none") return null;
  if (at.kind === "unlistable") return { kind: "archive", text: "a zip Vimma cannot list" };
  const cd = at.length
    ? await IOUtils.read(path, { offset: at.offset, maxBytes: at.length })
    : new Uint8Array(0);
  const names = zipEntryNames(cd, at.entries);
  if (!names) return { kind: "archive", text: "a zip Vimma cannot list" };
  return zipVerdict(names, { isExecutable });
}

/** The clamscan on PATH, or null (decision 31 g). */
async function findClam() {
  try {
    return await lazy.Subprocess.pathSearch("clamscan");
  } catch {
    return null;
  }
}

/**
 * `clamscan --no-summary --stdout <path>`: its answer.
 * @param {string} command @param {string} path
 */
async function runClam(command, path) {
  /** @type {any} */
  let proc;
  /** @type {any} */
  let timer;
  try {
    proc = await lazy.Subprocess.call({
      command,
      arguments: ["--no-summary", "--stdout", path],
      stderr: "pipe",
    });
    timer = lazy.setTimeout(() => proc.kill(), CLAM_TIMEOUT_MS);
    proc.stdin.close().catch(() => {});
    proc.stderr.readString().catch(() => {});
    let stdout = "";
    for (let s; (s = await proc.stdout.readString());) {
      if (stdout.length < 65536) stdout += s;
    }
    const { exitCode } = await proc.wait();
    return clamVerdict({ exitCode, stdout });
  } catch (e) {
    console.error("vimma: clamscan failed", e);
    return /** @type {const} */ ({ kind: "error" });
  } finally {
    lazy.clearTimeout(timer);
  }
}

/**
 * The finished `.part`, before it gets its name (_checkReputationAndMove): the bytes, a second
 * question if they are dangerous and the first was not a `!`, then ClamAV.
 * @param {any} download @param {any} base
 */
async function check(download, base) {
  const t = /** @type {Tracked} */ (tracked.get(download));
  const before = await base.shouldBlockForReputationCheck(download);
  if (before?.shouldBlock) {
    drops++;
    return before;
  }
  const path = download.target.partFilePath ?? download.target.path;
  const size = await IOUtils.stat(path).then(
    (st) => st.size ?? 0,
    () => null,
  );
  if (size === null) return block(download, { kind: "place" });
  if (size > capBytes()) return block(download, { kind: "cap", mb: capMb() });
  const danger = await contentDanger(path).catch((e) => {
    console.error("vimma: agent download check failed", e);
    return { kind: /** @type {const} */ ("archive"), text: "a file Vimma could not read" };
  });
  if (danger && !t.allowedDanger) {
    const what = { ...t.what, size, danger: danger.text };
    const options = { always: true };
    const outcome = AgentGate.isConnected(t.conn)
      ? await AgentGate.request(
          /** @type {string | number} */ (t.conn),
          DOWNLOAD_TOOL,
          what,
          options,
        )
      : await AgentGate.askPage(DOWNLOAD_TOOL, what, options);
    if (!outcome.allow) return block(download, { kind: "danger", text: danger.text });
  }
  const clam = await findClam();
  if (clam) {
    const verdict = await runClam(clam, path);
    if (verdict.kind === "infected") {
      return block(download, { kind: "infected", signature: verdict.signature });
    }
    t.scan = verdict.kind;
  }
  return before ?? { shouldBlock: false, verdict: "" };
}

/** Over the cap while it streams (decision 31 f): cancelled, its part removed. */
const capView = {
  /** @param {any} download */
  onDownloadChanged(download) {
    const t = tracked.get(download);
    if (!t || t.refused || download.stopped) return;
    if (download.currentBytes > capBytes() || download.totalBytes > capBytes()) {
      t.refused = true;
      notice(downloadRefusedNotice(t.name, { kind: "cap", mb: capMb() }));
      discard(download);
    }
  },
};

/** @param {any} base  DownloadIntegration */
const downloadOverride = (base) => ({
  __proto__: base,
  /** @param {any} download */
  shouldBlockForParentalControls(download) {
    if (!isAgentDownload(download)) return base.shouldBlockForParentalControls(download);
    return admit(download).catch((e) => {
      console.error("vimma: agent download refused", e);
      discard(download);
      return true;
    });
  },
  /** @param {any} download */
  shouldBlockForReputationCheck(download) {
    if (!tracked.has(download)) return base.shouldBlockForReputationCheck(download);
    return check(download, base).catch((e) => {
      console.error("vimma: agent download check failed", e);
      return block(download, { kind: "danger", text: "a file Vimma could not check" });
    });
  },
  shouldKeepBlockedData() {
    if (drops > 0) {
      drops--;
      return false;
    }
    return base.shouldKeepBlockedData();
  },
  /** @param {any} download */
  async downloadDone(download) {
    if (!isAgentDownload(download)) return base.downloadDone(download);
    // No exec bit, no one else (decision 31 c); and no desktop "recent files" entry.
    await IOUtils.setPermissions(download.target.path, 0o600);
    const t = tracked.get(download);
    tracked.delete(download);
    notice(
      downloadSavedNotice({
        name: nameOf(download),
        dir: displayDir(PathUtils.parent(download.target.path) ?? "", home()),
        scan: t?.scan ?? "none",
      }),
    );
    return undefined;
  },
  /** @param {any} download @param {any} options */
  launchDownload(download, options) {
    const dir = quarantineDir();
    if (isAgentDownload(download) || PathUtils.parent(download?.target?.path ?? "") === dir) {
      notice(`agent downloads are never opened by Vimma: they are in ${displayDir(dir, home())}`);
      return Promise.reject(new Error("vimma: agent downloads are never opened"));
    }
    return base.launchDownload(download, options);
  },
});

/** Firefox's helper-app dialog (toolkit/mozapps/downloads/HelperAppDlg.sys.mjs). */
const DIALOG_CONTRACT = "@mozilla.org/helperapplauncherdialog;1";
const DIALOG_CID = Components.ID("{6b1a3f3c-6c1e-4d73-9a4f-5f5a1e2b9c41}");

/** Whether a helper-app launcher's download comes from an agent tab. @param {any} launcher */
function fromAgentTab(launcher) {
  try {
    const bc = BrowsingContext.get(launcher.browsingContextId);
    return isAgentContainer(bc?.top?.originAttributes?.userContextId);
  } catch {
    return false;
  }
}

/**
 * An agent tab's download is saved into the quarantine under its suggested name, without a
 * dialog (no "open with").
 * @param {any} launcher @param {string} name @param {string} ext
 */
async function saveToQuarantine(launcher, name, ext) {
  const dir = quarantineDir();
  try {
    await ensureDir(dir);
    const leaf =
      lazy.DownloadPaths.sanitize(name || `download${ext || ""}`, { compressWhitespaces: true }) ||
      "download";
    const file = new lazy.FileUtils.File(PathUtils.join(dir, leaf));
    const target = lazy.DownloadPaths.createNiceUniqueFile(file);
    if (lengths.size > 64) lengths.clear();
    lengths.set(target.path, Number(launcher.contentLength));
    launcher.saveDestinationAvailable(target);
  } catch (e) {
    console.error("vimma: agent download has no place", e);
    launcher.saveDestinationAvailable(null);
  }
}

function wrapDialog() {
  const registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
  const original = registrar.contractIDToCID(DIALOG_CONTRACT);
  const factory = {
    QueryInterface: ChromeUtils.generateQI(["nsIFactory"]),
    /** @param {any} iid */
    createInstance(iid) {
      const inner = Components.manager
        .getClassObject(original, Ci.nsIFactory)
        .createInstance(Ci.nsIHelperAppLauncherDialog);
      const dialog = {
        QueryInterface: ChromeUtils.generateQI(["nsIHelperAppLauncherDialog"]),
        /** @param {any} launcher @param {any} context @param {number} reason */
        show(launcher, context, reason) {
          if (!fromAgentTab(launcher)) return inner.show(launcher, context, reason);
          return launcher.promptForSaveDestination();
        },
        /** @param {any} launcher @param {any} context @param {string} name @param {string} ext
         *  @param {boolean} force */
        promptForSaveToFileAsync(launcher, context, name, ext, force) {
          if (!fromAgentTab(launcher)) {
            return inner.promptForSaveToFileAsync(launcher, context, name, ext, force);
          }
          saveToQuarantine(launcher, name, ext);
          return undefined;
        },
      };
      return dialog.QueryInterface(iid);
    },
  };
  registrar.registerFactory(DIALOG_CID, "Vimma: agent downloads", DIALOG_CONTRACT, factory);
}

export const AgentDownloads = {
  /** Once per app (AgentPages.init): the hooks stay for the session. */
  init() {
    if (initialised) return;
    initialised = true;
    lazy.Integration.downloads.register(downloadOverride);
    try {
      wrapDialog();
    } catch (e) {
      console.error("vimma agent downloads: the download dialog is not wrapped", e);
    }
    lazy.Downloads.getList(lazy.Downloads.ALL)
      .then((/** @type {any} */ list) => list.addView(capView))
      .catch(console.error);
  },

  /** The quarantine folder agent tabs download into (AgentPages sets it on each tab). */
  quarantineDir,

  /** Made, mode 0700, before an agent tab may write to it. */
  ensureQuarantine() {
    return ensureDir(quarantineDir()).catch((e) => console.error("vimma: quarantine", e));
  },

  /**
   * An agent connection opened or loaded this tab (agent-open): its downloads are that
   * connection's, and a grant of its vimma_download covers them.
   * @param {Element} browser @param {string | number} conn
   */
  openedBy(browser, conn) {
    openers.set(browser, conn);
  },
};
