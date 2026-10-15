import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "../../test/temp-dir.mjs";

// tools/upstream/firefox-source.sh: the only way a build gets its Firefox source (spec
// build-supply-chain, decisions 3 to 5, rules B1 and B2). The archive is a file:// directory laid
// out as archive.mozilla.org's; Surfer is a stub in the checkout's node_modules/.bin that extracts
// the tarball as Surfer does, records each call, and fails if asked to download. No network.
const SCRIPT = fileURLToPath(new URL("../firefox-source.sh", import.meta.url));
const VERSION = "158.0";
const NAME = `source/firefox-${VERSION}.source.tar.xz`;
const CACHED = `.surfer/engine/firefox-${VERSION}.source.tar.xz`;

const SURFER_STUB = `#!/usr/bin/env bash
set -euo pipefail
echo "$* CI_SKIP_INIT=\${CI_SKIP_INIT:-}" >> surfer-calls.log
[ "$1" = download ] || exit 3
tarball=".surfer/engine/firefox-${VERSION}.source.tar.xz"
[ -f "$tarball" ] || { echo "stub surfer: would download $tarball" >&2; exit 4; }
mkdir -p engine
tar --strip-components=1 -xJf "$tarball" -C engine
`;

/**
 * A tarball of `files` with Firefox's top-level directory.
 * @param {string} path
 * @param {Record<string, string>} files
 */
function makeTarball(path, files) {
  const src = tempDir("firefox-source-tree-");
  const top = join(src, `firefox-${VERSION}`);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(top, file, ".."), { recursive: true });
    writeFileSync(join(top, file), text);
  }
  mkdirSync(join(path, ".."), { recursive: true });
  const tar = spawnSync("tar", ["-cJf", path, "-C", src, `firefox-${VERSION}`], {
    encoding: "utf8",
  });
  if (tar.status !== 0) throw new Error(tar.stderr);
}

/** @param {string} path */
const sha512 = (path) => createHash("sha512").update(readFileSync(path)).digest("hex");

/**
 * An archive whose SHA512SUMS lists the genuine tarball, and a checkout to run the script in.
 * @param {{ served?: "genuine" | "tampered" | "none" }} [opts]
 */
function setup(opts = {}) {
  const root = tempDir("firefox-source-");
  const releases = join(root, "releases");
  const dir = join(releases, VERSION);
  const genuine = join(root, "genuine.tar.xz");
  makeTarball(genuine, { "config/milestone.txt": `${VERSION}\n`, "README.txt": "genuine\n" });
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SHA512SUMS"),
    `${"0".repeat(128)}  other\n${sha512(genuine)}  ${NAME}\n`,
  );
  const served = opts.served ?? "genuine";
  if (served !== "none") {
    const target = join(dir, NAME);
    if (served === "genuine") {
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, readFileSync(genuine));
    } else {
      makeTarball(target, { "config/milestone.txt": `${VERSION}\n`, "README.txt": "evil\n" });
    }
  }
  const work = join(root, "checkout");
  mkdirSync(join(work, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(work, "package.json"), '{ "name": "checkout", "private": true }\n');
  writeFileSync(
    join(work, "surfer.json"),
    JSON.stringify({ version: { product: "firefox", version: VERSION } }),
  );
  const stub = join(work, "node_modules", ".bin", "surfer");
  writeFileSync(stub, SURFER_STUB);
  chmodSync(stub, 0o755);
  return { base: `file://${releases}`, work, genuine };
}

/** @param {{ base: string, work: string }} where */
function run({ base, work }) {
  const env = { ...process.env, MOZILLA_RELEASES: base };
  delete env.CI_SKIP_INIT;
  return spawnSync("bash", [SCRIPT], { cwd: work, env, encoding: "utf8" });
}

/** @param {string} work */
const surferCalls = (work) =>
  existsSync(join(work, "surfer-calls.log"))
    ? readFileSync(join(work, "surfer-calls.log"), "utf8").trim().split("\n")
    : [];

/** A stale engine/ from an earlier run, which the script must never build from. @param {string} work */
function staleEngine(work) {
  mkdirSync(join(work, "engine", "browser"), { recursive: true });
  writeFileSync(join(work, "engine", "browser", "stale.txt"), "left by an earlier build\n");
  writeFileSync(join(work, "engine", ".vimma-firefox-version"), `${VERSION}\n`);
}

describe("firefox-source.sh", () => {
  it("a missing tarball is downloaded by the script, never by Surfer", () => {
    const where = setup();
    const r = run(where);
    expect(r.status, r.stderr).toBe(0);
    expect(sha512(join(where.work, CACHED))).toBe(sha512(where.genuine));
    expect(readFileSync(join(where.work, "engine", "README.txt"), "utf8")).toBe("genuine\n");
    // Surfer only extracts: once, with its own switch that skips the 4.7 GB git commit.
    expect(surferCalls(where.work)).toEqual(["download CI_SKIP_INIT=1"]);
    // An empty repository, so `surfer import` applies patches inside engine/.
    expect(existsSync(join(where.work, "engine", ".git"))).toBe(true);
    const ls = spawnSync("git", ["-C", join(where.work, "engine"), "ls-files"], {
      encoding: "utf8",
    });
    expect(ls.stdout).toBe("");
  }, 60_000);

  it("a tampered tarball fails before engine/ is touched", () => {
    const where = setup({ served: "tampered" });
    staleEngine(where.work);
    const r = run(where);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/SHA-512/);
    expect(readFileSync(join(where.work, "engine", "browser", "stale.txt"), "utf8")).toContain(
      "earlier",
    );
    expect(surferCalls(where.work)).toEqual([]);
  }, 60_000);

  it("a tarball already on disk is verified again and engine/ is extracted from it afresh", () => {
    // The archive no longer serves the tarball: the script must use the one on disk.
    const where = setup({ served: "none" });
    mkdirSync(join(where.work, ".surfer", "engine"), { recursive: true });
    writeFileSync(join(where.work, CACHED), readFileSync(where.genuine));
    staleEngine(where.work);
    const r = run(where);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(where.work, "engine", "browser", "stale.txt"))).toBe(false);
    expect(existsSync(join(where.work, "engine", ".vimma-firefox-version"))).toBe(false);
    expect(readFileSync(join(where.work, "engine", "README.txt"), "utf8")).toBe("genuine\n");
    expect(surferCalls(where.work)).toEqual(["download CI_SKIP_INIT=1"]);
  }, 60_000);

  it("a tampered tarball already on disk fails like a downloaded one", () => {
    const where = setup({ served: "genuine" });
    makeTarball(join(where.work, CACHED), {
      "config/milestone.txt": `${VERSION}\n`,
      "README.txt": "evil\n",
    });
    staleEngine(where.work);
    const r = run(where);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/SHA-512/);
    expect(existsSync(join(where.work, "engine", "browser", "stale.txt"))).toBe(true);
    expect(surferCalls(where.work)).toEqual([]);
  }, 60_000);

  it("fails when the archive has no SHA512SUMS, before engine/ is touched", () => {
    const where = setup();
    rmSync(join(where.base.replace("file://", ""), VERSION, "SHA512SUMS"));
    staleEngine(where.work);
    const r = run(where);
    expect(r.status).not.toBe(0);
    expect(existsSync(join(where.work, "engine", "browser", "stale.txt"))).toBe(true);
    expect(surferCalls(where.work)).toEqual([]);
  }, 60_000);

  it.each(["", "158", "158.0;id", "../158.0", "159.0a1"])(
    "refuses surfer.json version %j before it reaches a URL",
    (version) => {
      const where = setup();
      writeFileSync(
        join(where.work, "surfer.json"),
        JSON.stringify({ version: { product: "firefox", version } }),
      );
      const r = run(where);
      expect(r.status).toBe(2);
      expect(existsSync(join(where.work, ".surfer"))).toBe(false);
      expect(surferCalls(where.work)).toEqual([]);
    },
    60_000,
  );
});
