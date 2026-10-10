// npm start (tools/start.mjs): argument parsing, build selection, user.js merging, profile
// preparation and the already-running check. Nothing here launches a browser.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  READ_PATH_PREF,
  browserCommand,
  devPrefs,
  mergeUserJs,
  parseStartArgs,
  prepareProfile,
  profileInUse,
  selectBuild,
} from "../start.mjs";

/** @type {string[]} */
const dirs = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "vimma-start-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("parseStartArgs", () => {
  it("defaults to the persistent dev profile, no import, not fresh", () => {
    expect(parseStartArgs([], "/home/u")).toEqual({
      profile: "/home/u/.cache/vimma-dev-profile",
      fresh: false,
      import: false,
      help: false,
      browserArgs: [],
    });
  });

  it("takes --profile, --fresh, --import, and passes what follows -- to the browser", () => {
    expect(
      parseStartArgs(["--profile", "p", "--import", "--", "--jsconsole", "about:blank"], "/h"),
    ).toMatchObject({
      profile: join(process.cwd(), "p"),
      import: true,
      fresh: false,
      browserArgs: ["--jsconsole", "about:blank"],
    });
    expect(parseStartArgs(["--fresh"], "/h").fresh).toBe(true);
  });

  it("refuses --fresh with --profile, and unknown flags", () => {
    expect(() => parseStartArgs(["--fresh", "--profile", "p"], "/h")).toThrow(/either/);
    expect(() => parseStartArgs(["--bogus"], "/h")).toThrow();
  });
});

describe("selectBuild", () => {
  const engine = "/repo/engine";
  /** @param {string[]} present */
  const exists = (present) => (/** @type {string} */ p) => present.includes(p);
  const full = "/repo/engine/obj-x86_64-pc-linux-gnu/dist/bin/vimma";
  const artifact = "/repo/engine/obj-artifact/dist/bin/vimma";

  it("prefers the full build, which needs no XUL_APP_FILE", () => {
    expect(selectBuild({ engine, exists: exists([full, artifact]) })).toEqual({
      kind: "full",
      binary: full,
      env: {},
    });
  });

  it("falls back to the artifact build with XUL_APP_FILE, as tools/mochitest.mjs runs it", () => {
    expect(selectBuild({ engine, exists: exists([artifact]) })).toEqual({
      kind: "artifact",
      binary: artifact,
      env: { XUL_APP_FILE: "/repo/engine/obj-artifact/dist/bin/browser/application.ini" },
    });
  });

  it("says how to build one when there is none", () => {
    expect(() => selectBuild({ engine, exists: exists([]) })).toThrow(/surfer build[^]*artifact/);
  });
});

describe("browserCommand", () => {
  it("runs with the profile, then the extra arguments, and keeps remoting on", () => {
    // Firefox 157 ignores --no-remote (nsAppRunner strips it); without it the dev instance
    // still answers the Omarchy hook's -vimma-reload-theme (spec m5-omarchy-theme).
    expect(browserCommand({ binary: "/b/vimma" }, "/p", ["about:blank"])).toEqual([
      "/b/vimma",
      ["--profile", "/p", "about:blank"],
    ]);
  });
});

describe("devPrefs", () => {
  it("lets content processes read the repo's src/ (absolute, trailing slash)", () => {
    const root = tempDir();
    expect(devPrefs(root)).toEqual([[READ_PATH_PREF, `${root}/src/`]]);
    expect(READ_PATH_PREF).toBe("security.sandbox.content.read_path_whitelist");
  });

  it("resolves a symlinked checkout, since the objdir's links resolve to the real path", () => {
    const real = tempDir();
    const link = join(tempDir(), "link");
    symlinkSync(real, link);
    expect(devPrefs(link)[0]?.[1]).toBe(`${real}/src/`);
  });
});

describe("mergeUserJs", () => {
  const prefs = /** @type {const} */ ([[READ_PATH_PREF, "/repo/src/"]]);

  it("writes the pref into an empty user.js", () => {
    expect(mergeUserJs("", prefs)).toBe(`user_pref("${READ_PATH_PREF}", "/repo/src/");\n`);
  });

  it("keeps every other line, comments included", () => {
    const existing = '// mine\nuser_pref("a.b", true);\n\nuser_pref("c", "d");\n';
    const merged = mergeUserJs(existing, prefs);
    expect(merged.startsWith(existing)).toBe(true);
    expect(merged).toContain(`user_pref("${READ_PATH_PREF}", "/repo/src/");`);
  });

  it("is idempotent", () => {
    const once = mergeUserJs('user_pref("a", 1);\n', prefs);
    expect(mergeUserJs(once, prefs)).toBe(once);
  });

  it("adds the path to an existing whitelist instead of replacing it", () => {
    const existing = `user_pref("${READ_PATH_PREF}", "/opt/fonts/");\nuser_pref("z", 2);\n`;
    expect(mergeUserJs(existing, prefs)).toBe(
      `user_pref("${READ_PATH_PREF}", "/opt/fonts/,/repo/src/");\nuser_pref("z", 2);\n`,
    );
  });

  it("never drops a path that is already there", () => {
    const existing = `user_pref("${READ_PATH_PREF}", "/old/src/,/repo/src/");\n`;
    expect(mergeUserJs(existing, prefs)).toBe(existing);
  });

  it("adds a newline before appending to a file without one", () => {
    expect(mergeUserJs('user_pref("a", 1);', prefs)).toBe(
      `user_pref("a", 1);\nuser_pref("${READ_PATH_PREF}", "/repo/src/");\n`,
    );
  });
});

describe("prepareProfile", () => {
  it("creates the profile directory and its user.js", () => {
    const profile = join(tempDir(), "deep", "profile");
    prepareProfile(profile, [[READ_PATH_PREF, "/repo/src/"]]);
    expect(readFileSync(join(profile, "user.js"), "utf8")).toContain("/repo/src/");
  });

  it("merges into an existing user.js without clobbering it", () => {
    const profile = tempDir();
    writeFileSync(join(profile, "user.js"), 'user_pref("browser.startup.page", 3);\n');
    prepareProfile(profile, [[READ_PATH_PREF, "/repo/src/"]]);
    const js = readFileSync(join(profile, "user.js"), "utf8");
    expect(js).toContain('user_pref("browser.startup.page", 3);');
    expect(js).toContain(`user_pref("${READ_PATH_PREF}", "/repo/src/");`);
  });
});

describe("profileInUse", () => {
  it("is null for a profile without a lock", () => {
    expect(profileInUse(tempDir())).toBeNull();
  });

  it("names the pid of a live lock (Firefox's lock symlink, ip:+pid)", () => {
    const profile = tempDir();
    symlinkSync(`127.0.0.1:+${process.pid}`, join(profile, "lock"));
    expect(profileInUse(profile)).toEqual({ pid: process.pid });
  });

  it("ignores a stale lock left by a crash or a clean quit (its pid is gone)", () => {
    const profile = tempDir();
    symlinkSync("127.0.0.1:+12345", join(profile, "lock"));
    expect(profileInUse(profile, { alive: () => false })).toBeNull();
  });

  it("names the pid holding a POSIX lock on .parentlock (/proc/locks), even without lock", () => {
    const profile = tempDir();
    writeFileSync(join(profile, ".parentlock"), "");
    const ino = statSync(join(profile, ".parentlock")).ino;
    const procLocks = () =>
      `1: POSIX  ADVISORY  WRITE 4242 00:2a:${ino} 0 EOF\n2: FLOCK  ADVISORY  WRITE 7 00:2a:1 0 EOF\n`;
    expect(profileInUse(profile, { procLocks })).toEqual({ pid: 4242 });
    expect(profileInUse(profile, { procLocks: () => "" })).toBeNull();
  });

  it("treats an unreadable lock as in use (better a clear refusal than a second instance)", () => {
    const profile = tempDir();
    symlinkSync("garbage", join(profile, "lock"));
    expect(profileInUse(profile)).toEqual({ pid: null });
  });
});
