// Starts a real Vimma build for an e2e scenario (spec m0-e2e-harness): finds the build, writes a
// throwaway profile with the control socket on, starts Xvfb when there is no display (or when
// asked), spawns the browser in its own process group, waits for <profile>/vimma-control.json,
// and tears it all down again: the whole process tree, Xvfb, the profile unless kept.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { validateMessage } from "../../packages/vimma-core/src/control.mjs";

const ENGINE = fileURLToPath(new URL("../../engine/", import.meta.url));
export const FULL_OBJDIR = "obj-x86_64-pc-linux-gnu";
export const ARTIFACT_OBJDIR = "obj-artifact";
export const WINDOW = Object.freeze({ width: 1280, height: 800 });
export const DISCOVERY_FILE = "vimma-control.json";
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 30_000;

/**
 * Prefs for the throwaway profile. The control socket on; everything that would pop up a first
 * run page, a dialog or reach the network off. Mostly the engine's
 * remote/shared/RecommendedPreferences.sys.mjs (what Marionette applies), plus telemetry and
 * stable-pixel settings for screenshots.
 * @type {ReadonlyArray<readonly [string, boolean | number | string]>}
 */
export const PROFILE_PREFS = Object.freeze([
  ["vimma.control.enabled", true],
  // first run, default browser, welcome and what's-new pages
  ["browser.shell.checkDefaultBrowser", false],
  ["browser.startup.homepage_override.mstone", "ignore"],
  ["browser.startup.page", 0],
  ["startup.homepage_welcome_url", "about:blank"],
  ["startup.homepage_welcome_url.additional", ""],
  ["browser.aboutwelcome.enabled", false],
  ["browser.preonboarding.enabled", false],
  ["termsofuse.bypassNotification", true],
  ["browser.startup.couldRestoreSession.count", -1],
  ["browser.sessionstore.resume_from_crash", false],
  ["toolkit.startup.max_resumed_crashes", -1],
  ["browser.tabs.warnOnClose", false],
  ["browser.warnOnQuit", false],
  ["browser.newtabpage.enabled", false],
  ["browser.uitour.enabled", false],
  // telemetry and data reporting
  ["datareporting.policy.dataSubmissionEnabled", false],
  ["datareporting.policy.dataSubmissionPolicyBypassNotification", true],
  ["datareporting.healthreport.uploadEnabled", false],
  ["datareporting.usage.uploadEnabled", false],
  ["toolkit.telemetry.enabled", false],
  ["toolkit.telemetry.unified", false],
  ["toolkit.telemetry.archive.enabled", false],
  ["toolkit.telemetry.server", "data:,"],
  ["telemetry.fog.test.localhost_port", -1],
  ["app.normandy.enabled", false],
  ["app.normandy.api_url", ""],
  ["app.shield.optoutstudies.enabled", false],
  // updates and background network
  ["app.update.disabledForTesting", true],
  ["extensions.update.enabled", false],
  ["extensions.getAddons.cache.enabled", false],
  ["extensions.systemAddon.update.enabled", false],
  ["browser.search.update", false],
  ["browser.region.network.url", ""],
  ["browser.safebrowsing.malware.enabled", false],
  ["browser.safebrowsing.phishing.enabled", false],
  ["browser.safebrowsing.downloads.enabled", false],
  ["browser.safebrowsing.blockedURIs.enabled", false],
  ["browser.safebrowsing.update.enabled", false],
  ["services.settings.server", "data:,#remote-settings-dummy/v1"],
  ["network.captive-portal-service.enabled", false],
  ["network.connectivity-service.enabled", false],
  ["browser.urlbar.suggest.searches", false],
  ["browser.topsites.contile.enabled", false],
  ["browser.translations.enable", false],
  ["browser.ml.enable", false],
  ["dom.push.connection.enabled", false],
  ["geo.provider.network.url", ""],
  ["signon.rememberSignons", false],
  // stable pixels for screenshots
  ["ui.prefersReducedMotion", 1],
  ["gfx.webrender.software", true],
  ["browser.toolbars.bookmarks.visibility", "never"],
  ["focusmanager.testmode", true],
]);

/**
 * @param {ReadonlyArray<readonly [string, boolean | number | string]>} prefs
 * @returns {string} user.js
 */
export function userJs(prefs) {
  return prefs
    .map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`)
    .join("");
}

/**
 * A new private profile directory under `tmpRoot` with our user.js.
 * @param {string} [tmpRoot]
 */
export function createProfile(tmpRoot = tmpdir()) {
  const dir = mkdtempSync(join(tmpRoot, "vimma-e2e-profile-"));
  writeFileSync(join(dir, "user.js"), userJs(PROFILE_PREFS));
  return dir;
}

/** @typedef {{ binary: string, env: Record<string, string> }} Build */

/**
 * Which build to run; see the spec's Launcher section for the order.
 * @param {{ build?: string, artifact?: boolean, engine?: string,
 *   env?: Record<string, string | undefined>, exists?: (path: string) => boolean }} options
 * @returns {Build}
 */
export function findBuild({
  build,
  artifact = false,
  engine = ENGINE,
  env = {},
  exists = existsSync,
}) {
  const artifactBin = join(engine, ARTIFACT_OBJDIR, "dist/bin/vimma");
  const artifactBuild = {
    binary: artifactBin,
    env: { XUL_APP_FILE: join(engine, ARTIFACT_OBJDIR, "dist/bin/browser/application.ini") },
  };
  /** @param {string} p */
  const explicit = (p) => {
    if (exists(join(p, "vimma"))) return { binary: join(p, "vimma"), env: {} }; // dist/bin
    if (exists(p)) return { binary: p, env: {} };
    throw new Error(`no Vimma binary at ${p} (pass the binary or its dist/bin directory)`);
  };
  if (build) return explicit(build);
  if (artifact) {
    if (!exists(artifactBin)) {
      throw new Error(
        `no artifact build at ${artifactBin}: run node tools/artifact-build/artifact-build.mjs`,
      );
    }
    return artifactBuild;
  }
  if (env.VIMMA_E2E_BUILD) return explicit(env.VIMMA_E2E_BUILD);
  const full = join(engine, FULL_OBJDIR, "dist/bin/vimma");
  if (exists(full)) return { binary: full, env: {} };
  if (exists(artifactBin)) return artifactBuild;
  throw new Error(
    `no Vimma build found; tried ${full} and ${artifactBin}. Build one, or pass --build, ` +
      "--artifact or --tarball (or set VIMMA_E2E_BUILD)",
  );
}

/**
 * Unpack a `./mach package` tarball (vimma-*.tar.xz) into `dir`; returns the build in it.
 * @param {string} tarball
 * @param {string} dir
 * @returns {Build}
 */
export function unpackTarball(tarball, dir) {
  execFileSync("tar", ["-xJf", tarball, "-C", dir]);
  const binary = join(dir, "vimma", "vimma");
  if (!existsSync(binary))
    throw new Error(`${tarball} has no vimma/vimma: not a ./mach package tarball?`);
  return { binary, env: {} };
}

/**
 * @param {string} profile
 * @param {{ width: number, height: number }} window
 */
export function browserArgs(profile, { width, height }) {
  return [
    "-no-remote",
    "-profile",
    profile,
    // BrowserContentHandler getFeatures: the first window's size and position
    "-width",
    String(width),
    "-height",
    String(height),
    "-left",
    "0",
    "-top",
    "0",
    "about:blank",
  ];
}

/**
 * The browser's environment: with our Xvfb, X11 only, so a Wayland session cannot take it.
 * @param {Record<string, string | undefined>} base
 * @param {{ display?: string, extra?: Record<string, string> }} options
 * @returns {Record<string, string>}
 */
export function browserEnv(base, { display, extra = {} }) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v;
  env.MOZ_CRASHREPORTER_DISABLE = "1";
  if (display) {
    env.DISPLAY = display;
    env.GDK_BACKEND = "x11";
    env.MOZ_ENABLE_WAYLAND = "0";
    delete env.WAYLAND_DISPLAY;
  }
  return { ...env, ...extra };
}

/** @param {string} [pathEnv] @returns {string | null} the Xvfb binary on PATH */
export function findXvfb(pathEnv = process.env.PATH ?? "") {
  for (const dir of pathEnv.split(delimiter)) {
    if (dir && existsSync(join(dir, "Xvfb"))) return join(dir, "Xvfb");
  }
  return null;
}

const XVFB_PACKAGES =
  "install Xvfb: package xvfb (Ubuntu/Debian), xorg-server-xvfb (Arch), xorg-x11-server-Xvfb (Fedora)";

/**
 * @typedef {{ display: string, fbFile: string, stop: () => Promise<void> }} Display
 */

/**
 * Start Xvfb on a free display (-displayfd), screen `width`×`height`×24, black root, its
 * framebuffer kept as an XWD file in a temp dir (-fbdir), the capture path for screenshots.
 * @param {{ width: number, height: number, bin?: string | null, timeoutMs?: number }} options
 * @returns {Promise<Display>}
 */
export async function startXvfb({ width, height, bin = findXvfb(), timeoutMs = 10_000 }) {
  if (!bin || !existsSync(bin))
    throw new Error(`Xvfb not found (${bin ?? "not on PATH"}); ${XVFB_PACKAGES}`);
  const fbdir = mkdtempSync(join(tmpdir(), "vimma-e2e-xvfb-"));
  const child = spawn(
    bin,
    [
      "-displayfd",
      "3",
      "-screen",
      "0",
      `${width}x${height}x24`,
      "-fbdir",
      fbdir,
      "-br",
      "-nolisten",
      "tcp",
      "-noreset",
    ],
    { stdio: ["ignore", "ignore", "pipe", "pipe"], detached: true },
  );
  let stderr = "";
  child.stderr?.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
  const fd3 = /** @type {import("node:stream").Readable} */ (child.stdio[3]);
  const stop = async () => {
    await killTree(child, { graceMs: 2000 });
    rmSync(fbdir, { recursive: true, force: true });
  };
  try {
    const display = await new Promise((resolve, reject) => {
      let out = "";
      const timer = setTimeout(
        () => reject(new Error(`Xvfb did not start in ${timeoutMs} ms: ${stderr}`)),
        timeoutMs,
      );
      fd3.on("data", (d) => {
        out += d;
        const m = /^(\d+)\n/.exec(out);
        if (m) {
          clearTimeout(timer);
          resolve(`:${m[1]}`);
        }
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`cannot start Xvfb: ${e.message}; ${XVFB_PACKAGES}`));
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Xvfb exited with code ${code}: ${stderr.trim()}`));
      });
    });
    return { display, fbFile: join(fbdir, "Xvfb_screen0"), stop };
  } catch (e) {
    await stop();
    throw e;
  }
}

/**
 * Wait for the control server's discovery file: present, valid protocol v1, mode 0600.
 * @param {string} profile
 * @param {{ timeoutMs?: number, intervalMs?: number,
 *   exited?: () => { code: number | null, signal: string | null } | null,
 *   stderrTail?: () => string }} [options]
 * @returns {Promise<{ protocol: number, port: number, token: string, pid: number }>}
 */
export async function waitForDiscovery(
  profile,
  {
    timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
    intervalMs = 50,
    exited = () => null,
    stderrTail = () => "",
  } = {},
) {
  const path = join(profile, DISCOVERY_FILE);
  const deadline = Date.now() + timeoutMs;
  const tail = () => {
    const t = stderrTail().trim();
    return t ? `\nbrowser stderr (last lines):\n${t}` : "";
  };
  let problem = "it does not exist";
  for (;;) {
    const exit = exited();
    if (exit) {
      const how = exit.signal ? `signal ${exit.signal}` : `code ${exit.code}`;
      throw new Error(`the browser exited with ${how} before its control socket came up${tail()}`);
    }
    if (existsSync(path)) {
      try {
        const mode = statSync(path).mode & 0o777;
        const body = JSON.parse(readFileSync(path, "utf8"));
        const { valid, errors } = validateMessage(body, { kind: "discovery" });
        if (mode & 0o077) problem = `it has mode ${mode.toString(8)}, not 600`;
        else if (!valid) problem = `it is invalid: ${errors.join("; ")}`;
        else return body;
      } catch (e) {
        problem = `it cannot be read yet: ${/** @type {Error} */ (e).message}`; // mid-rename
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `no usable control socket within ${timeoutMs} ms (is vimma.control.enabled on, and ` +
          `does the build have the control server?): ${path}: ${problem}${tail()}`,
      );
    }
    await sleep(intervalMs);
  }
}

/** @param {number} pgid */
function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a process started with `detached: true` and everything in its process group (Firefox's
 * content processes): SIGTERM, then SIGKILL after `graceMs`, then wait until the group is gone.
 * @param {import("node:child_process").ChildProcess} child
 * @param {{ graceMs?: number }} [options]
 */
export async function killTree(child, { graceMs = 5000 } = {}) {
  const pid = child.pid;
  if (!pid) return;
  const exited = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve(undefined);
    else child.once("exit", () => resolve(undefined));
  });
  /** @param {NodeJS.Signals} signal */
  const signal = (signal) => {
    try {
      process.kill(-pid, signal);
    } catch {
      // already gone
    }
  };
  signal("SIGTERM");
  const deadline = Date.now() + graceMs;
  while (groupAlive(pid) && Date.now() < deadline) await sleep(25);
  if (groupAlive(pid)) signal("SIGKILL");
  await exited;
  const reapDeadline = Date.now() + 5000;
  while (groupAlive(pid) && Date.now() < reapDeadline) await sleep(25);
}

/**
 * @typedef {{
 *   profile: string,
 *   child: import("node:child_process").ChildProcess,
 *   display: Display | null,
 *   discovery: { protocol: number, port: number, token: string, pid: number },
 *   stderrTail: () => string,
 *   teardown: () => Promise<void>,
 * }} Session
 */

/**
 * Launch a build and wait for its control socket. On any failure everything started so far is
 * torn down before the error is thrown.
 * @param {{
 *   build: Build,
 *   xvfb?: boolean,
 *   window?: { width: number, height: number },
 *   tmpRoot?: string,
 *   keep?: boolean,
 *   discoveryTimeoutMs?: number,
 *   graceMs?: number,
 *   baseEnv?: Record<string, string | undefined>,
 *   onSpawn?: (child: import("node:child_process").ChildProcess) => void,
 *   onTeardown?: (teardown: () => Promise<void>) => void,
 *   log?: (line: string) => void,
 * }} options
 * @returns {Promise<Session>}
 */
export async function launch({
  build,
  xvfb = !process.env.DISPLAY,
  window = WINDOW,
  tmpRoot = tmpdir(),
  keep = false,
  discoveryTimeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
  graceMs = 5000,
  baseEnv = process.env,
  onSpawn = () => {},
  onTeardown = () => {},
  log = () => {},
}) {
  /** @type {Display | null} */
  let display = null;
  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  const profile = createProfile(tmpRoot);
  let stderr = "";
  /** @type {Promise<void> | null} */
  let tearingDown = null;
  // Idempotent, and handed out before anything slow starts, so a signal handler can clean up
  // a launch that is still waiting for the control socket.
  const teardown = () =>
    (tearingDown ??= (async () => {
      if (child) await killTree(child, { graceMs });
      if (display) await display.stop();
      if (keep) log(`kept profile ${profile}`);
      else rmSync(profile, { recursive: true, force: true });
    })());
  onTeardown(teardown);
  try {
    if (xvfb) display = await startXvfb(window);
    if (tearingDown) throw new Error("launch cancelled");
    const env = browserEnv(baseEnv, { display: display?.display, extra: build.env });
    const spawned = spawn(build.binary, browserArgs(profile, window), {
      env,
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    child = spawned;
    onSpawn(spawned);
    /** @type {{ code: number | null, signal: string | null } | null} */
    let exit = null;
    /** @type {Error | null} */
    let spawnError = null;
    spawned.on("exit", (code, signal) => (exit = { code, signal }));
    spawned.on("error", (e) => (spawnError = e));
    spawned.stderr?.on("data", (d) => (stderr = (stderr + d).slice(-8000)));
    const stderrTail = () => stderr.split("\n").slice(-15).join("\n");
    const discovery = await waitForDiscovery(profile, {
      timeoutMs: discoveryTimeoutMs,
      exited: () => {
        if (spawnError)
          throw new Error(
            `cannot start ${build.binary}: ${/** @type {Error} */ (spawnError).message}`,
          );
        return exit;
      },
      stderrTail,
    });
    return { profile, child: spawned, display, discovery, stderrTail, teardown };
  } catch (e) {
    await teardown();
    throw e;
  }
}
