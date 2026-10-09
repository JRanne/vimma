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
});
