import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// release.yml's gates (spec m6-packaging). A workflow_dispatch run executes the release.yml of
// the branch it was started on, so every job must refuse anything but a published release or a
// run from main: otherwise any pushed branch could sign and upload what it likes.
const text = readFileSync(
  new URL("../../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

/** @returns {Map<string, string>} job id -> its YAML block */
function jobs() {
  const body = text.slice(text.indexOf("\njobs:\n") + 7);
  const parts = body.split(/^ {2}([a-z][a-z0-9-]*):\n/m).slice(1);
  /** @type {Map<string, string>} */
  const map = new Map();
  for (let i = 0; i < parts.length; i += 2) map.set(parts[i] ?? "", parts[i + 1] ?? "");
  return map;
}

/** @param {string} block */
function condition(block) {
  const match = /^ {4}if: (>-\n(?: {6}.*\n)+|.*\n)/m.exec(block);
  return (match?.[1] ?? "").replace(/^>-\n/, "").replace(/\s+/g, " ").trim();
}

describe("release.yml", () => {
  const all = jobs();

  it("has the jobs the spec lists", () => {
    expect([...all.keys()]).toEqual(["build", "package", "sign", "publish", "aur", "failure"]);
  });

  it.each([...jobs().keys()])(
    "job %s runs only when enabled, here, from a release or main",
    (id) => {
      const cond = condition(all.get(id) ?? "");
      expect(cond).toContain("vars.RELEASE_ENABLED == 'true'");
      expect(cond).toContain("github.repository == 'JRanne/vimma'");
      expect(cond).toContain("(github.event_name == 'release' || github.ref == 'refs/heads/main')");
    },
  );

  it("only sign mints an OIDC token, only publish writes contents", () => {
    for (const [id, block] of all) {
      expect(block.includes("id-token: write"), id).toBe(id === "sign");
      expect(block.includes("contents: write"), id).toBe(id === "publish");
    }
    expect(text).toMatch(/^permissions: \{\}$/m);
  });

  it("has no pull_request, pull_request_target or push trigger", () => {
    const on = text.slice(text.indexOf("\non:\n"), text.indexOf("\npermissions:"));
    expect(on).not.toMatch(/pull_request|push:/);
  });

  // A draft release fires no `published` (spec release-versioning): only that type may start it.
  it("runs on a published release only, so a draft starts nothing", () => {
    const on = text.slice(text.indexOf("\non:\n"), text.indexOf("\npermissions:"));
    expect(on).toMatch(/^ {2}release:\n {4}types: \[published\]\n/m);
  });
});

// release-please's bumps and the release gate (spec release-versioning).
describe("release-please-config.json", () => {
  /** @param {string} path */
  const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const config = json("../../../release-please-config.json");
  const manifest = json("../../../.release-please-manifest.json");
  const surfer = json("../../../surfer.json");

  // The user's decision (2026-10-12): every release bumps the patch, breaking changes too; the
  // move to 0.2.0 or 1.0.0 is theirs, by a Release-As footer (runbook "Releases").
  it("bumps only the patch, whatever the commits say", () => {
    expect(config.versioning).toBe("always-bump-patch");
    expect(config.packages["."].versioning).toBeUndefined();
  });

  it("has no pre-1.0 bump rules that always-bump-patch would silently override", () => {
    expect(config["bump-minor-pre-major"]).toBeUndefined();
    expect(config["bump-patch-for-minor-pre-major"]).toBeUndefined();
  });

  it("pins no version for every release", () => {
    expect(config["release-as"]).toBeUndefined();
    expect(config.packages["."]["release-as"]).toBeUndefined();
  });

  it("creates draft releases, with their tag, until the release gate opens", () => {
    expect(config.draft).toBe(true);
    expect(config["force-tag-creation"]).toBe(true);
    expect(config.prerelease).toBeUndefined();
  });

  it("keeps the manifest at surfer.json's displayVersion", () => {
    expect(manifest["."]).toBe(surfer.brands.vimma.release.displayVersion);
  });
});

// `vimma --version` prints `Vimma <vimma> · Firefox <firefox>` (spec firefox-versions): every smoke
// check takes the expected line from tools/release/version-line.mjs, never its own copy of it.
describe("--version smoke checks", () => {
  /** @param {string} name */
  const workflow = (name) =>
    readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), "utf8");
  /**
   * The `run:` block of the step called `name`.
   * @param {string} file
   * @param {string} name
   */
  const step = (file, name) => {
    const start = file.indexOf(`- name: ${name}\n`);
    expect(start, name).toBeGreaterThan(-1);
    const rest = file.slice(start + 1);
    const end = rest.search(/\n {6}- (?:name|uses):/);
    return end === -1 ? rest : rest.slice(0, end);
  };

  it("nightly and release smoke checks compare --version with versionLine", () => {
    const nightly = workflow("nightly.yml");
    const release = workflow("release.yml");
    const checks = [
      step(nightly, "Smoke check"),
      step(release, "Smoke check"),
      step(release, "Smoke test the .deb and the AppImage"),
    ];
    for (const check of checks) {
      expect(check).toContain("node tools/release/version-line.mjs");
      expect(check).toMatch(/--version/);
    }
    // the .deb and the AppImage are each compared with the line
    expect(checks[2]?.match(/= "\$line" \]/g)).toHaveLength(2);
    for (const file of [nightly, release]) expect(file).not.toContain("Vimma Vimma");
  });

  it("the release smoke check also ties the line to the tag", () => {
    expect(step(workflow("release.yml"), "Smoke check")).toContain('"Vimma ${TAG#v} · Firefox "');
  });
});
