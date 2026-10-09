import { describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertLane,
  copyEngine,
  copyEntries,
  foreignLinks,
  laneLinks,
  mainWorktree,
  parseBtrfsDu,
  removeForeignLinks,
  resetEngine,
  teardownTarget,
} from "../lanes.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * A main checkout with an imported engine, and a worktree under its .claude/worktrees/, the
 * layout the lanes run in.
 */
function fakeCheckouts() {
  const base = mkdtempSync(join(tmpdir(), "vimma-lanes-"));
  const main = join(base, "main");
  const lane = join(main, ".claude", "worktrees", "agent-x");
  const engine = join(main, "engine");
  mkdirSync(join(main, "src", "browser"), { recursive: true });
  mkdirSync(join(main, "tests", "browser"), { recursive: true });
  writeFileSync(join(main, "src", "browser", "ours.js"), "ours\n");
  writeFileSync(join(main, "tests", "browser", "browser_x.js"), "test\n");
  mkdirSync(lane, { recursive: true });
  for (const dir of [".git", "browser/base", "browser/base/zen-components/tests/browser"]) {
    mkdirSync(join(engine, dir), { recursive: true });
  }
  writeFileSync(join(engine, ".git", "HEAD"), "ref: refs/heads/vimma\n");
  writeFileSync(join(engine, "mach"), "#!/bin/sh\n");
  chmodSync(join(engine, "mach"), 0o755);
  writeFileSync(join(engine, "browser", "base", "upstream.js"), "upstream\n");
  // Surfer's import: absolute symlinks into the checkout it ran from.
  symlinkSync(join(main, "src", "browser", "ours.js"), join(engine, "browser", "base", "ours.js"));
  symlinkSync(
    join(main, "tests", "browser", "browser_x.js"),
    join(engine, "browser/base/zen-components/tests/browser/browser_x.js"),
  );
  // An upstream relative symlink, which stays.
  symlinkSync("upstream.js", join(engine, "browser", "base", "alias.js"));
  for (const obj of ["obj-x86_64-pc-linux-gnu", "obj-artifact"]) {
    mkdirSync(join(engine, obj, "dist"), { recursive: true });
    writeFileSync(join(engine, obj, "dist", "libxul.so"), "big\n");
  }
  return { base, main, lane, engine };
}

/** cp that runs nothing and remembers its arguments; fails `--reflink=always` when asked. */
function fakeCp(reflink = true) {
  /** @type {string[][]} */
  const calls = [];
  /** @param {string[]} args */
  const cp = async (args) => {
    calls.push(args);
    if (!reflink && args.includes("--reflink=always")) {
      return { code: 1, stderr: "cp: failed to clone 'x': Operation not supported" };
    }
    return { code: 0, stderr: "" };
  };
  return { cp, calls };
}

describe("mainWorktree", () => {
  it("is the first worktree of `git worktree list --porcelain`", () => {
    const out = [
      "worktree /home/u/VimHerdr",
      "HEAD 10b3551",
      "branch refs/heads/main",
      "",
      "worktree /home/u/VimHerdr/.claude/worktrees/agent-x",
      "HEAD 28128bb",
      "detached",
      "",
    ].join("\n");
    expect(mainWorktree(out)).toBe("/home/u/VimHerdr");
  });

  it("throws on output without a worktree", () => {
    expect(() => mainWorktree("")).toThrow(/git worktree list/);
  });
});

describe("assertLane", () => {
  it("refuses the main checkout", () => {
    const { main } = fakeCheckouts();
    expect(() => assertLane(main, main)).toThrow(/main checkout/);
  });

  it("refuses the main checkout through a symlinked path", () => {
    const { base, main } = fakeCheckouts();
    symlinkSync(main, join(base, "alias"));
    expect(() => assertLane(join(base, "alias"), main)).toThrow(/main checkout/);
  });

  it("accepts a worktree", () => {
    const { main, lane } = fakeCheckouts();
    expect(() => assertLane(lane, main)).not.toThrow();
  });
});

describe("copyEntries", () => {
  it("excludes every obj-* dir and keeps .git", () => {
    expect(
      copyEntries([".git", "browser", "obj-x86_64-pc-linux-gnu", "obj-artifact", "obj-x", "mach"]),
    ).toEqual([".git", "browser", "mach"]);
  });
});

describe("copyEngine", () => {
  it("copies everything but the objdirs, with .git, permissions and symlinks as they are", async () => {
    const { main, lane, engine } = fakeCheckouts();
    const dest = join(lane, "engine");
    // tmpfs has no reflinks: this exercises the --allow-copy path with the real cp.
    await copyEngine(engine, dest, { allowCopy: true });
    expect(existsSync(join(dest, ".git", "HEAD"))).toBe(true);
    expect(statSync(join(dest, "mach")).mode & 0o777).toBe(0o755);
    expect(existsSync(join(dest, "obj-x86_64-pc-linux-gnu"))).toBe(false);
    expect(existsSync(join(dest, "obj-artifact"))).toBe(false);
    const link = join(dest, "browser", "base", "ours.js");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join(main, "src", "browser", "ours.js"));
  });

  it("asks cp for reflinks of every entry but the objdirs", async () => {
    const { lane, engine } = fakeCheckouts();
    const { cp, calls } = fakeCp(true);
    await copyEngine(engine, join(lane, "engine"), { cp });
    const copies = calls.filter((c) => c.includes("-a"));
    expect(copies.every((c) => c.includes("--reflink=always"))).toBe(true);
    const sources = copies.map((c) => c.at(-2));
    expect(sources).toContain(join(engine, ".git"));
    expect(sources.some((s) => s?.includes("obj-"))).toBe(false);
  });

  it("fails with a clear message when reflinks are unsupported, before copying anything", async () => {
    const { lane, engine } = fakeCheckouts();
    const { cp, calls } = fakeCp(false);
    await expect(copyEngine(engine, join(lane, "engine"), { cp })).rejects.toThrow(
      /reflink.*--allow-copy/s,
    );
    expect(calls.filter((c) => c.includes("-a"))).toEqual([]);
  });

  it("falls back to a plain copy with allowCopy", async () => {
    const { lane, engine } = fakeCheckouts();
    const { cp, calls } = fakeCp(false);
    await copyEngine(engine, join(lane, "engine"), { cp, allowCopy: true });
    const copies = calls.filter((c) => c.includes("-a"));
    expect(copies.length).toBeGreaterThan(0);
    expect(copies.every((c) => c.includes("--reflink=auto"))).toBe(true);
  });

  it("refuses an existing destination", async () => {
    const { lane, engine } = fakeCheckouts();
    mkdirSync(join(lane, "engine"));
    await expect(copyEngine(engine, join(lane, "engine"), fakeCp())).rejects.toThrow(
      /already exists/,
    );
  });
});

describe("foreignLinks / removeForeignLinks", () => {
  it("finds the symlinks into the source checkout, not upstream or lane ones", async () => {
    const { main, lane, engine } = fakeCheckouts();
    const dest = join(lane, "engine");
    await copyEngine(engine, dest, { allowCopy: true });
    // A link into the lane itself (the lane lives under the main checkout's path).
    mkdirSync(join(lane, "src"), { recursive: true });
    writeFileSync(join(lane, "src", "mine.js"), "mine\n");
    symlinkSync(join(lane, "src", "mine.js"), join(dest, "browser", "base", "mine.js"));
    const found = foreignLinks(dest, main, lane);
    expect(found.sort()).toEqual(
      [
        join(dest, "browser/base/ours.js"),
        join(dest, "browser/base/zen-components/tests/browser/browser_x.js"),
      ].sort(),
    );
    expect(laneLinks(dest, lane)).toEqual([join(dest, "browser/base/mine.js")]);
  });

  it("removes them without touching their targets", async () => {
    const { main, lane, engine } = fakeCheckouts();
    const dest = join(lane, "engine");
    await copyEngine(engine, dest, { allowCopy: true });
    const removed = removeForeignLinks(dest, main, lane);
    expect(removed).toHaveLength(2);
    expect(foreignLinks(dest, main, lane)).toEqual([]);
    expect(existsSync(join(main, "src", "browser", "ours.js"))).toBe(true);
    expect(lstatSync(join(dest, "browser/base/alias.js")).isSymbolicLink()).toBe(true);
    // The source checkout's own engine is untouched.
    expect(lstatSync(join(engine, "browser/base/ours.js")).isSymbolicLink()).toBe(true);
  });

  it("refuses to scan the source checkout's own engine", () => {
    const { main, engine } = fakeCheckouts();
    expect(() => removeForeignLinks(engine, main, main)).toThrow(/main checkout/);
  });
});

describe("resetEngine", () => {
  /** An engine git repo as `surfer download` makes it, then imported. */
  function importedEngine() {
    const { main, lane } = fakeCheckouts();
    const engine = join(lane, "engine");
    mkdirSync(join(engine, "browser"), { recursive: true });
    const git = (/** @type {string[]} */ ...args) =>
      execFileSync("git", ["-C", engine, ...args], { encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(engine, ".gitignore"), "/mozconfig*\n/obj-*\n*.pyc\n");
    writeFileSync(join(engine, "browser", "moz.build"), "upstream\n");
    git("add", "-f", ".");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "Firefox");
    // What the import did: patch a tracked file, add files and dirs, extend .gitignore.
    writeFileSync(join(engine, "browser", "moz.build"), "patched\n");
    writeFileSync(join(engine, ".gitignore"), "/mozconfig*\n/obj-*\n*.pyc\nbrowser/x.js\n");
    mkdirSync(join(engine, "browser", "branding", "vimma"), { recursive: true });
    writeFileSync(join(engine, "browser", "branding", "vimma", "a.txt"), "gen\n");
    mkdirSync(join(engine, "browser", "config", "vimma"), { recursive: true });
    writeFileSync(join(engine, "browser", "config", "vimma", "v.txt"), "0.1.0\n");
    writeFileSync(join(engine, "mozconfig"), "ours\n");
    writeFileSync(join(engine, "mozconfig.artifact"), "ours\n");
    git("add", "browser/moz.build");
    // Upstream-ignored local state, which is not ours to delete.
    writeFileSync(join(engine, "cache.pyc"), "\n");
    mkdirSync(join(engine, "obj-artifact"));
    writeFileSync(join(engine, "obj-artifact", "x"), "\n");
    return { main, lane, engine };
  }

  it("restores tracked files and removes what the import added", () => {
    const { engine } = importedEngine();
    resetEngine(engine);
    expect(readFileSync(join(engine, "browser", "moz.build"), "utf8")).toBe("upstream\n");
    expect(readFileSync(join(engine, ".gitignore"), "utf8")).not.toContain("browser/x.js");
    expect(existsSync(join(engine, "browser", "branding", "vimma"))).toBe(false);
    expect(existsSync(join(engine, "browser", "config"))).toBe(false);
    expect(existsSync(join(engine, "mozconfig"))).toBe(false);
    expect(existsSync(join(engine, "mozconfig.artifact"))).toBe(false);
    const status = execFileSync("git", ["-C", engine, "status", "--porcelain"], {
      encoding: "utf8",
    });
    expect(status).toBe("");
  });

  it("keeps files upstream's .gitignore ignores", () => {
    const { engine } = importedEngine();
    resetEngine(engine);
    expect(existsSync(join(engine, "cache.pyc"))).toBe(true);
    expect(existsSync(join(engine, "obj-artifact", "x"))).toBe(true);
  });
});

describe("teardownTarget", () => {
  it("is the worktree's engine/", () => {
    const { main, lane } = fakeCheckouts();
    mkdirSync(join(lane, "engine"));
    expect(teardownTarget(lane, main)).toBe(join(lane, "engine"));
  });

  it("refuses the main checkout's engine", () => {
    const { main } = fakeCheckouts();
    expect(() => teardownTarget(main, main)).toThrow(/main checkout/);
  });

  it("refuses an engine/ that is a symlink (to the main checkout's, say)", () => {
    const { main, lane, engine } = fakeCheckouts();
    symlinkSync(engine, join(lane, "engine"));
    expect(() => teardownTarget(lane, main)).toThrow(/symlink/);
  });

  it("refuses when there is no engine/", () => {
    const { main, lane } = fakeCheckouts();
    expect(() => teardownTarget(lane, main)).toThrow(/no engine/);
  });
});

describe("parseBtrfsDu", () => {
  it("reads total and exclusive bytes from `btrfs filesystem du -s --raw`", () => {
    const out = [
      "     Total   Exclusive  Set shared  Filename",
      "6227123456   812345678  5414777778  engine",
    ].join("\n");
    expect(parseBtrfsDu(out)).toEqual({ total: 6227123456, exclusive: 812345678 });
  });

  it("throws on anything else", () => {
    expect(() => parseBtrfsDu("ERROR: not a btrfs filesystem")).toThrow(/btrfs/);
  });
});
