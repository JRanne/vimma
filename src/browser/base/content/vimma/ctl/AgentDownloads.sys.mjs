/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Downloads from the agent workspace, asked and quarantined (docs/specs/vimma-mcp.md decision
// 31; docs/security.md M11-M13): an agent may download, and only what it downloads safely. All
// through Firefox's own hooks, no upstream patch:
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
  clamArguments,
  clamVerdict,
  dangerousContent,
  dangerousName,
  dangerousType,
  displayDir,
  downloadRefusedNotice,
  downloadSavedNotice,
  quarantineProblem,
  resolveDownloadDir,
  zipEntryList,
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
  nsUnknownContentTypeDialog: "resource://gre/modules/HelperAppDlg.sys.mjs",
});

const DEFAULT_DIR = /** @type {string} */ (DEFAULT_CONFIG.mcp?.download_dir);
const DEFAULT_MAX_MB = /** @type {number} */ (DEFAULT_CONFIG.mcp?.download_max_mb);
/** How often a part file is measured while its question waits (the cap, decision 31 f). */
const WATCH_MS = 250;
/** The longest ClamAV may take on one file before it counts as an error. */
const CLAM_TIMEOUT_MS = 5 * 60 * 1000;
/** Test-only: ClamAV's time limit in ms. */
const CLAM_TIMEOUT_PREF = "vimma.mcp.clamTimeoutMs";
/**
 * The only clamscan Vimma runs (security.md C2's one exception, M13): the
 * system's, never one found on PATH, and only when the user cannot write it or its folder.
 */
const CLAM_PATHS = Object.freeze(["/usr/bin/clamscan", "/usr/local/bin/clamscan"]);
/** How long after agent-open a download counts as that open's (security.md M11). */
const OPENER_MS = 60_000;

/**
 * @typedef {{ conn: string | number | null, name: string, what: Record<string, any>,
 *   allowedKind: string | null, scan: "none" | "clean" | "partial" | "error",
 *   refused: boolean }} Tracked
 */

/** The agent downloads let through the question, until they are done. @type {WeakMap<any, Tracked>} */
const tracked = new WeakMap();
/**
 * The load an agent connection started in a tab (agent-open): a download is that connection's
 * only when it is that load (its URL, before redirects), soon after; once, and never after the
 * tab showed a page (security.md M11).
 * @type {WeakMap<Element, { conn: string | number, url: string, at: number }>}
 */
const openers = new WeakMap();
/** Content-Length by quarantine path, from the helper-app launcher (it knows it first). */
/** @type {Map<string, number>} */
const lengths = new Map();
let initialised = false;
/**
 * The quarantine folder's check (decision 31 b; security.md M12): made,
 * mode 0700 after a chmod (which fails on a folder that is not the user's), or why not.
 * @type {{ dir: string, problem: string | null } | null}
 */
let folder = null;

const services = /** @type {any} */ (Services);

/** @param {number | null | undefined} userContextId */
function isAgentContainer(userContextId) {
  const agent = WorkspaceStore.agent?.userContextId;
  return typeof agent === "number" && agent > 0 && userContextId === agent;
}

const home = () => services.dirsvc.get("Home", Ci.nsIFile).path;

/** The quarantine folder (decision 31 b): `[mcp] download_dir`, expanded. */
function quarantineDir() {
  return resolveDownloadDir(McpHost.config?.downloadDir ?? DEFAULT_DIR, home());
}

/** Where an agent tab's bytes go while the quarantine folder is not usable: the profile's. */
const refusedDir = () => PathUtils.join(PathUtils.profileDir, "vimma-agent-refused");

/** Why `dir` is not a quarantine, from its place alone (no disk), or null. @param {string} dir */
function placeProblem(dir) {
  const fixed = quarantineProblem(dir, home());
  if (fixed) return fixed;
  /** @type {string[]} */
  const downloads = [];
  try {
    downloads.push(services.dirsvc.get("DfltDwnld", Ci.nsIFile).path);
  } catch {
    // No default downloads folder on this system.
  }
  const pref = Services.prefs.getStringPref("browser.download.dir", "");
  if (pref) downloads.push(pref);
  return downloads.includes(dir) ? "must not be the Downloads folder itself" : null;
}

/**
 * The folder an agent tab downloads into (its `downloadFolderOverride`): the quarantine, or the
 * profile's refusal folder while the quarantine is not usable (its downloads are then refused).
 */
function overrideDir() {
  const dir = quarantineDir();
  if (placeProblem(dir)) return refusedDir();
  if (folder?.dir === dir && folder.problem) return refusedDir();
  return dir;
}

/**
 * Check the quarantine folder now: why it is not usable, or null. It is made if missing, then
 * chmod 0700: a folder of another user fails the chmod, and the mode is read back. It fails
 * closed: any error is a problem.
 * @returns {Promise<string | null>}
 */
async function checkFolder() {
  const dir = quarantineDir();
  let problem = placeProblem(dir);
  if (!problem) {
    try {
      await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
      try {
        await IOUtils.setPermissions(dir, 0o700, false);
      } catch {
        problem = "it is not yours";
      }
      if (!problem && ((await IOUtils.stat(dir)).permissions & 0o777) !== 0o700) {
        problem = "it is not private (mode 0700)";
      }
    } catch (e) {
      problem = `it cannot be made (${/** @type {Error} */ (e).message})`;
    }
  }
  folder = { dir, problem };
  if (problem) {
    console.error(`vimma: the agent downloads' quarantine ${dir} is not usable: ${problem}`);
    await IOUtils.makeDirectory(refusedDir(), {
      createAncestors: true,
      ignoreExisting: true,
      permissions: 0o700,
    }).catch(() => {});
  }
  return problem;
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

/** Whether a path is in the quarantine folder or the refusal folder. @param {string} [path] */
const inOurFolders = (path) =>
  !!path && [quarantineDir(), refusedDir()].includes(PathUtils.parent(path) ?? "");

/**
 * Whether a download is an agent download (security.md M11): its container,
 * its tab's container, or being written to the quarantine (or refusal) folder.
 * @param {any} download
 */
function isAgentDownload(download) {
  if (isAgentContainer(download?.source?.userContextId)) return true;
  try {
    const bc = BrowsingContext.get(download?.source?.browsingContextId);
    if (isAgentContainer(bc?.top?.originAttributes?.userContextId)) return true;
  } catch {
    // No such browsing context any more.
  }
  return inOurFolders(download?.target?.path) || inOurFolders(download?.target?.partFilePath);
}

/** @param {any} download  the download's name, as saved */
const nameOf = (download) => PathUtils.filename(download.target.path);

/**
 * The agent connection a download belongs to: the one whose agent-open started this very load
 * (its URL before redirects, within OPENER_MS), if still connected. Used once.
 * @param {any} download
 */
function connOf(download) {
  try {
    const bc = BrowsingContext.get(download.source.browsingContextId);
    const browser = bc?.top?.embedderElement;
    const opened = browser ? openers.get(browser) : undefined;
    if (!browser || !opened) return null;
    openers.delete(browser);
    const urls = [download.source.url, download.source.originalUrl];
    if (Date.now() - opened.at > OPENER_MS || !urls.includes(opened.url)) return null;
    return AgentGate.isConnected(opened.conn) ? opened.conn : null;
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

/** Whether `path` is an empty file, as Firefox's own placeholder test. @param {string} path */
const isEmpty = (path) =>
  IOUtils.stat(path).then(
    (st) => st.size === 0,
    () => false,
  );

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
  for (const path of [download.target.partFilePath, download.target.path]) {
    if (inOurFolders(path)) {
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
  const problem = await checkFolder();
  if (problem) return refuse({ kind: "folder", text: problem });
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
    allowedKind: danger?.kind ?? null,
    scan: "none",
    refused: false,
  });
  return false;
}

/**
 * Block a finished agent download, for _checkReputationAndMove: its `.part` and the empty
 * placeholder Firefox made at its name are deleted before the verdict returns, so nothing of it
 * is left once the download has stopped. Firefox itself keeps the placeholder (its
 * shouldKeepBlockedData is true for Firefox's app ID and takes no download to answer per file).
 * @param {any} download @param {Refusal} why
 */
async function block(download, why) {
  const t = tracked.get(download);
  if (t) t.refused = true;
  const { partFilePath, path } = download.target;
  await IOUtils.remove(partFilePath ?? path, { ignoreAbsent: true }).catch(() => {});
  if (partFilePath && inOurFolders(path) && (await isEmpty(path))) {
    await IOUtils.remove(path, { ignoreAbsent: true }).catch(() => {});
  }
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
  const entries = zipEntryList(cd, at.entries);
  if (!entries) return { kind: "archive", text: "a zip Vimma cannot list" };
  return zipVerdict(entries, { isExecutable });
}

/** Whether a file is owned by someone else: a no-op chmod fails on another's. @param {string} path */
async function ownedByAnother(path) {
  try {
    const { permissions } = await IOUtils.stat(path);
    await IOUtils.setPermissions(path, permissions, false);
    return false;
  } catch {
    return true;
  }
}

/**
 * The system's clamscan (decision 31 g; C2's one exception): the first of CLAM_PATHS that is a
 * regular executable file another user (root) owns, that the user cannot write, in a folder the
 * user cannot write. Never one found on PATH. Null when there is none.
 * @returns {Promise<string | null>}
 */
async function findClam() {
  const hook = AgentDownloads._clamForTests;
  for (const path of hook?.paths ?? CLAM_PATHS) {
    try {
      const file = new lazy.FileUtils.File(path);
      if (!file.exists() || !file.isFile() || file.isSymlink() || !file.isExecutable()) continue;
      if (hook?.trusted) return path;
      if (file.isWritable() || file.parent?.isWritable()) continue;
      if (!(await ownedByAnother(path))) continue;
      return path;
    } catch {
      // Not usable: the next.
    }
  }
  return null;
}

/**
 * @typedef {{ kind: "clean" } | { kind: "infected", signature: string }
 *   | { kind: "partial", reason: string } | { kind: "error", why: string }} ClamAnswer
 */

/**
 * Run clamscan on `path`, its output read to the end (stdout kept, stderr drained), within the
 * time limit: its answer, or an error.
 * @param {string} clam  from findClam @param {string} path
 * @returns {Promise<ClamAnswer>}
 */
async function runClam(clam, path) {
  /** @type {any} */
  let proc;
  /** @type {any} */
  let timer;
  try {
    proc = await lazy.Subprocess.call({
      command: clam,
      arguments: clamArguments(path),
      stderr: "pipe",
    });
    const ms = Services.prefs.getIntPref(CLAM_TIMEOUT_PREF, 0) || CLAM_TIMEOUT_MS;
    proc.stdin.close().catch(() => {});
    const run = (async () => {
      const drain = (async () => {
        while (await proc.stderr.readString()) {
          // Read and dropped, so a full pipe never stops clamscan.
        }
      })().catch(() => {});
      let stdout = "";
      for (let s; (s = await proc.stdout.readString());) {
        if (stdout.length < 65536) stdout += s;
      }
      await drain;
      const { exitCode } = await proc.wait();
      return clamVerdict({ exitCode, stdout });
    })();
    // Past the limit it is killed and not waited for: a child it left may hold the pipes open.
    const late = new Promise((resolve) => {
      timer = lazy.setTimeout(() => resolve(null), ms);
    });
    const verdict = await Promise.race([run, late]);
    if (!verdict) {
      run.catch(() => {});
      proc.kill();
      return { kind: "error", why: "ClamAV took too long" };
    }
    return verdict.kind === "error" ? { kind: "error", why: "ClamAV failed" } : verdict;
  } catch (e) {
    console.error("vimma: clamscan failed", e);
    return { kind: "error", why: "ClamAV failed" };
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
  if (before?.shouldBlock) return before;
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
  /** Ask again, as the same agent (or the page), always: no grant covers it. @param {object} more */
  const askAgain = (more) => {
    const what = { ...t.what, size, ...more };
    const options = { always: true };
    return AgentGate.isConnected(t.conn)
      ? AgentGate.request(/** @type {string | number} */ (t.conn), DOWNLOAD_TOOL, what, options)
      : AgentGate.askPage(DOWNLOAD_TOOL, what, options);
  };
  // A `!` for one kind of danger is not one for another (security.md M13).
  if (danger && danger.kind !== t.allowedKind) {
    const outcome = await askAgain({ danger: danger.text });
    if (!outcome.allow) return block(download, { kind: "danger", text: danger.text });
  }
  const clam = await findClam();
  if (clam) {
    const verdict = await runClam(clam, path);
    if (verdict.kind === "infected") {
      return block(download, { kind: "infected", signature: verdict.signature });
    }
    if (verdict.kind === "partial" || verdict.kind === "error") {
      // What ClamAV could not do is the user's call, default no (security.md M13).
      const unscanned =
        verdict.kind === "partial" ? `not fully scanned (${verdict.reason})` : verdict.why;
      const outcome = await askAgain({ unscanned });
      if (!outcome.allow) {
        return block(download, { kind: "danger", text: `${unscanned}; you said no` });
      }
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
    if (isAgentDownload(download)) {
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
  try {
    // Not usable: into the refusal folder, where the question refuses it.
    const dir = (await checkFolder()) ? refusedDir() : quarantineDir();
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

/**
 * Wraps Firefox's download dialog, constructing upstream's class
 * (toolkit/mozapps/downloads/components.conf) directly: Firefox 158 removed
 * nsIComponentManager.getClassObject, and script cannot create an instance by CID once the
 * contract points at our factory.
 */
function wrapDialog() {
  const registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
  const factory = {
    QueryInterface: ChromeUtils.generateQI(["nsIFactory"]),
    /** @param {any} iid */
    createInstance(iid) {
      const inner = new lazy.nsUnknownContentTypeDialog();
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
  /**
   * Test-only: the clamscan candidates in place of CLAM_PATHS; `trusted` skips the ownership
   * and write checks (a test's fake is the user's own).
   * @type {{ paths: string[], trusted?: boolean } | null}
   */
  _clamForTests: null,

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

  /** The folder agent tabs download into (AgentPages sets it on each tab). */
  overrideDir,

  /** Check (and make) the quarantine folder now: at startup and when `[mcp]` changes. */
  ensureQuarantine() {
    return checkFolder().catch((e) => console.error("vimma: quarantine", e));
  },

  /**
   * An agent connection started loading `url` in this tab (agent-open): a download of that load,
   * soon after, is that connection's, and a grant of its vimma_download covers it.
   * @param {Element} browser @param {string | number} conn @param {string} url
   */
  openedBy(browser, conn, url) {
    openers.set(browser, { conn, url, at: Date.now() });
  },

  /**
   * The tab showed a page: what it downloads from now on is the page's (security.md M11).
   * @param {Element} browser
   */
  committed(browser) {
    openers.delete(browser);
  },
};
