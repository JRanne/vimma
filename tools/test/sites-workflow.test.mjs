import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// docs/specs/site-compat.md, decision 1: the live site suite's workflow. It must never run on a
// pull request or gate a merge, must stay on a free standard runner, and holds no secret. Text
// checks, like patch-audit-workflow.test.mjs: no YAML dependency.
const text = readFileSync(new URL("../../.github/workflows/sites.yml", import.meta.url), "utf8");
const on = text.slice(text.indexOf("\non:\n"), text.indexOf("\npermissions:"));

describe("site-compat workflow (sites.yml)", () => {
  it("runs nightly and by hand, never on a pull request or a push", () => {
    expect(on).toMatch(/^ {2}schedule:\n {4}- cron: "\d+ \d+ \* \* \*"/m);
    expect(on).toMatch(/^ {2}workflow_dispatch:/m);
    expect(text).not.toMatch(
      /^\s*(pull_request\w*|push|issue_comment|workflow_run|workflow_call):/m,
    );
  });

  it("uses a standard GitHub-hosted runner, never a self-hosted or larger one", () => {
    const runsOn = [...text.matchAll(/runs-on: (.+)/g)].map((m) => m[1]?.trim());
    expect(runsOn).toEqual(["ubuntu-24.04"]);
  });

  it("has a read-only token and no secrets", () => {
    expect(text).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(text).not.toMatch(/: write/);
    expect(text).not.toContain("secrets.");
    expect(text).toContain("persist-credentials: false");
  });

  it("checks the Firefox tarball against Mozilla's SHA512SUMS before building", () => {
    // firefox-source.sh verifies the tarball before Surfer unpacks it (firefox-source.test.mjs).
    expect(text).toContain("tools/upstream/firefox-source.sh");
    expect(text.indexOf("firefox-source.sh")).toBeLessThan(text.indexOf("artifact-build.mjs"));
  });

  it("runs the suite on the artifact build and uploads the report even when it fails", () => {
    expect(text).toMatch(/npm run sites -- --artifact/);
    const upload = text.slice(text.indexOf("actions/upload-artifact"));
    expect(text.slice(0, text.indexOf("actions/upload-artifact"))).toMatch(
      /if: always\(\)\n\s*uses: $/,
    );
    expect(upload).toContain("path: site-compat-output/");
  });

  it("every action it uses is pinned by a full commit SHA", () => {
    const uses = [...text.matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map((m) => m[1] ?? "");
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });
});
