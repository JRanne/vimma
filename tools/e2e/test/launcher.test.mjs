import { afterEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROFILE_PREFS,
  browserArgs,
  browserEnv,
  createProfile,
  findBuild,
  launch,
  userJs,
  waitForDiscovery,
} from "../launcher.mjs";
import { startFakeServer } from "./fake-server.mjs";

const FAKE_BROWSER = fileURLToPath(new URL("./fixtures/fake-browser.mjs", import.meta.url));

/** @type {string[]} */
const dirs = [];
/** @type {Array<() => Promise<void>>} */
const cleanups = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "vimma-e2e-test-"));
  dirs.push(d);
  return d;
};

/** @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("findBuild", () => {
  const engine = "/repo/engine/";
  const full = "/repo/engine/obj-x86_64-pc-linux-gnu/dist/bin/vimma";
  const art = "/repo/engine/obj-artifact/dist/bin/vimma";
  const artIni = "/repo/engine/obj-artifact/dist/bin/browser/application.ini";
  /** @param {string[]} present */
  const exists = (present) => (/** @type {string} */ p) => present.includes(p);

  it("prefers an explicit --build binary, or the vimma inside a dist/bin directory", () => {
    expect(findBuild({ build: "/x/vimma", engine, exists: exists(["/x/vimma"]) })).toEqual({
      binary: "/x/vimma",
      env: {},
    });
    expect(findBuild({ build: "/x/bin", engine, exists: exists(["/x/bin/vimma"]) })).toEqual({
      binary: "/x/bin/vimma",
      env: {},
    });
  });

  it("uses the artifact objdir with XUL_APP_FILE, as tools/mochitest.mjs does", () => {
    expect(findBuild({ artifact: true, engine, exists: exists([art, artIni]) })).toEqual({
      binary: art,
      env: { XUL_APP_FILE: artIni },
    });
  });

  it("falls back to VIMMA_E2E_BUILD, then the full objdir, then the artifact objdir", () => {
    expect(
      findBuild({ engine, env: { VIMMA_E2E_BUILD: "/e/vimma" }, exists: exists(["/e/vimma"]) }),
    ).toEqual({ binary: "/e/vimma", env: {} });
    expect(findBuild({ engine, exists: exists([full, art, artIni]) }).binary).toBe(full);
    expect(findBuild({ engine, exists: exists([art, artIni]) })).toEqual({
      binary: art,
      env: { XUL_APP_FILE: artIni },
    });
  });

  it("names every path it tried when there is no build", () => {
    expect(() => findBuild({ engine, exists: exists([]) })).toThrow(
      new RegExp(`no Vimma build found[^]*${full}[^]*${art}`),
    );
    expect(() => findBuild({ build: "/nope", engine, exists: exists([]) })).toThrow(/\/nope/);
  });
});

describe("profile", () => {
  it("turns the control socket on and first run, telemetry and updates off", () => {
    const prefs = Object.fromEntries(PROFILE_PREFS);
    expect(prefs["vimma.control.enabled"]).toBe(true);
    expect(prefs["browser.shell.checkDefaultBrowser"]).toBe(false);
    expect(prefs["browser.startup.homepage_override.mstone"]).toBe("ignore");
    expect(prefs["datareporting.policy.dataSubmissionEnabled"]).toBe(false);
    expect(prefs["toolkit.telemetry.enabled"]).toBe(false);
    expect(prefs["app.update.disabledForTesting"]).toBe(true);
    expect(prefs["browser.sessionstore.resume_from_crash"]).toBe(false);
  });

  it("writes user.js lines that Firefox's pref parser reads", () => {
    expect(
      userJs([
        ["a.b", true],
        ["c", 3],
        ["d", 'say "hi"\\'],
      ]),
    ).toBe('user_pref("a.b", true);\nuser_pref("c", 3);\nuser_pref("d", "say \\"hi\\"\\\\");\n');
  });

  it("creates a private temp profile holding user.js", () => {
    const dir = createProfile(tempDir());
    expect(readFileSync(join(dir, "user.js"), "utf8")).toContain(
      'user_pref("vimma.control.enabled", true);',
    );
  });
});

describe("browser command line and environment", () => {
  it("passes the profile, no-remote and a fixed window at the origin", () => {
    expect(browserArgs("/p", { width: 1280, height: 800 })).toEqual([
      "-no-remote",
      "-profile",
      "/p",
      "-width",
      "1280",
      "-height",
      "800",
      "-left",
      "0",
      "-top",
      "0",
      "about:blank",
    ]);
  });

  it("points the browser at our Xvfb and away from Wayland", () => {
    const env = browserEnv(
      { PATH: "/bin", WAYLAND_DISPLAY: "wayland-1", DISPLAY: ":0" },
      { display: ":99", extra: { XUL_APP_FILE: "/a.ini" } },
    );
    expect(env).toMatchObject({
      PATH: "/bin",
      DISPLAY: ":99",
      GDK_BACKEND: "x11",
      MOZ_ENABLE_WAYLAND: "0",
      XUL_APP_FILE: "/a.ini",
      MOZ_CRASHREPORTER_DISABLE: "1",
    });
    expect(env.WAYLAND_DISPLAY).toBeUndefined();
  });

  it("keeps the caller's display when it does not start Xvfb", () => {
    const env = browserEnv({ DISPLAY: ":0", WAYLAND_DISPLAY: "w" }, {});
    expect(env.DISPLAY).toBe(":0");
    expect(env.WAYLAND_DISPLAY).toBe("w");
  });
});

describe("waitForDiscovery", () => {
  it("returns the discovery file once the server writes it", async () => {
    const profile = tempDir();
    /** @type {import("./fake-server.mjs").FakeServer | undefined} */
    let fake;
    setTimeout(async () => {
      fake = await startFakeServer(profile);
    }, 300);
    const discovery = await waitForDiscovery(profile, { timeoutMs: 5000 });
    expect(discovery.port).toBe(fake?.port);
    expect(discovery.token).toBe(fake?.token);
    await fake?.close();
  });

  it("times out naming the pref, the file and the browser's stderr", async () => {
    const profile = tempDir();
    const started = Date.now();
    await expect(
      waitForDiscovery(profile, { timeoutMs: 400, stderrTail: () => "GLib warning: foo" }),
    ).rejects.toThrow(/400 ms[^]*vimma\.control\.enabled[^]*vimma-control\.json[^]*GLib warning/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("does not accept a discovery file others can read until it is 0600", async () => {
    const profile = tempDir();
    const fake = await startFakeServer(profile, { discoveryMode: 0o644 });
    cleanups.push(() => fake.close());
    chmodSync(fake.discoveryPath, 0o644);
    await expect(waitForDiscovery(profile, { timeoutMs: 400 })).rejects.toThrow(/mode 644/);
    setTimeout(() => chmodSync(fake.discoveryPath, 0o600), 200);
    await expect(waitForDiscovery(profile, { timeoutMs: 3000 })).resolves.toMatchObject({
      port: fake.port,
    });
  });

  it("reports an invalid discovery file instead of a bare timeout", async () => {
    const profile = tempDir();
    writeFileSync(join(profile, "vimma-control.json"), '{"protocol":1}', { mode: 0o600 });
    await expect(waitForDiscovery(profile, { timeoutMs: 300 })).rejects.toThrow(/port/);
  });

  it("fails at once when the browser exits before the socket is up", async () => {
    const profile = tempDir();
    const started = Date.now();
    await expect(
      waitForDiscovery(profile, {
        timeoutMs: 10_000,
        exited: () => ({ code: 7, signal: null }),
        stderrTail: () => "crashed on purpose",
      }),
    ).rejects.toThrow(/exited with code 7[^]*crashed on purpose/);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("launch and teardown (fake browser)", () => {
  /** @param {Record<string, string>} env @param {object} [opts] */
  const start = (env, opts = {}) =>
    launch({
      build: { binary: FAKE_BROWSER, env: {} },
      xvfb: false,
      tmpRoot: tempDir(),
      discoveryTimeoutMs: 5000,
      graceMs: 500,
      baseEnv: { ...process.env, ...env },
      ...opts,
    });

  it("starts the browser with the profile and waits for its control socket", async () => {
    const session = await start({ FAKE_BROWSER_DELAY_MS: "200" });
    cleanups.push(() => session.teardown());
    expect(session.discovery.pid).toBeGreaterThan(0);
    const seen = JSON.parse(readFileSync(join(session.profile, "fake-browser.json"), "utf8"));
    expect(seen.argv).toContain(session.profile);
    expect(seen.argv).toContain("-no-remote");
  });

  it("kills the whole process tree and removes the profile on teardown", async () => {
    const session = await start({ FAKE_BROWSER_CHILD: "1" });
    const grandchild = Number(readFileSync(join(session.profile, "grandchild.pid"), "utf8"));
    const pid = /** @type {number} */ (session.child.pid);
    expect(alive(pid) && alive(grandchild)).toBe(true);
    await session.teardown();
    expect(alive(pid)).toBe(false);
    expect(alive(grandchild)).toBe(false);
    expect(existsSync(session.profile)).toBe(false);
  });

  it("escalates to SIGKILL when the browser ignores SIGTERM", async () => {
    const session = await start({ FAKE_BROWSER_IGNORE_TERM: "1" });
    const pid = /** @type {number} */ (session.child.pid);
    await session.teardown();
    expect(alive(pid)).toBe(false);
  });

  it("keeps the profile with keep", async () => {
    const session = await start({}, { keep: true });
    await session.teardown();
    expect(existsSync(join(session.profile, "user.js"))).toBe(true);
    dirs.push(session.profile);
  });

  it("cleans up when the launch fails: browser exits early", async () => {
    const tmpRoot = tempDir();
    await expect(
      launch({
        build: { binary: FAKE_BROWSER, env: {} },
        xvfb: false,
        tmpRoot,
        discoveryTimeoutMs: 5000,
        baseEnv: { ...process.env, FAKE_BROWSER: "exit" },
      }),
    ).rejects.toThrow(/exited with code 7[^]*crashed on purpose/);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("hands out teardown before waiting, so a signal mid-launch cleans up (manual check bug)", async () => {
    const tmpRoot = tempDir();
    /** @type {Array<() => Promise<void>>} */
    const registered = [];
    /** @type {number[]} */
    const pids = [];
    const launching = launch({
      build: { binary: FAKE_BROWSER, env: {} },
      xvfb: false,
      tmpRoot,
      discoveryTimeoutMs: 20_000,
      graceMs: 300,
      baseEnv: { ...process.env, FAKE_BROWSER: "never" },
      onTeardown: (/** @type {() => Promise<void>} */ t) => registered.push(t),
      onSpawn: (/** @type {import("node:child_process").ChildProcess} */ child) =>
        pids.push(/** @type {number} */ (child.pid)),
    });
    const outcome = launching.catch((e) => e);
    await new Promise((r) => setTimeout(r, 300));
    expect(registered).toHaveLength(1);
    const started = Date.now();
    await Promise.all([registered[0]?.(), registered[0]?.()]); // idempotent
    expect(await outcome).toBeInstanceOf(Error);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(alive(/** @type {number} */ (pids[0]))).toBe(false);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("cleans up when the launch fails: no control socket, process tree killed", async () => {
    const tmpRoot = tempDir();
    /** @type {number[]} */
    const pids = [];
    await expect(
      launch({
        build: { binary: FAKE_BROWSER, env: {} },
        xvfb: false,
        tmpRoot,
        discoveryTimeoutMs: 500,
        graceMs: 300,
        baseEnv: { ...process.env, FAKE_BROWSER: "never", FAKE_BROWSER_CHILD: "1" },
        onSpawn: (/** @type {import("node:child_process").ChildProcess} */ child) =>
          pids.push(/** @type {number} */ (child.pid)),
      }),
    ).rejects.toThrow(/vimma\.control\.enabled/);
    expect(readdirSync(tmpRoot)).toEqual([]);
    expect(pids).toHaveLength(1);
    expect(alive(/** @type {number} */ (pids[0]))).toBe(false);
  });
});
