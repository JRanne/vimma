import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// Spec m7-upstream-autopilot, docs/security.md §10: the upstream autopilot's workflow shape.
// Text checks, like safebrowsing-workflows.test.mjs: no YAML dependency.
const dir = new URL("../../.github/workflows/", import.meta.url);
/** @param {string} name */
const workflow = (name) => readFileSync(new URL(name, dir), "utf8");
const upstream = workflow("upstream.yml");
const e2e = workflow("e2e.yml");
const source = readFileSync(new URL("../upstream/source-check.sh", import.meta.url), "utf8");

/**
 * @param {string} text a workflow
 * @param {string} id a job id
 * @returns {string} that job's YAML block
 */
function job(text, id) {
  const body = text.slice(text.indexOf("\njobs:\n") + 7);
  const parts = body.split(/^ {2}([a-z][a-z0-9-]*):\n/m).slice(1);
  for (let i = 0; i < parts.length; i += 2) if (parts[i] === id) return parts[i + 1] ?? "";
  throw new Error(`no job ${id}`);
}

/** @param {string} block @returns {string[]} the job's `permissions:` lines, comments dropped */
function permissions(block) {
  const m = /^ {4}permissions:\n((?: {6}[a-z-]+: [a-z]+.*\n)+)/m.exec(block);
  if (!m?.[1]) return [];
  return m[1]
    .trim()
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim());
}

describe("upstream autopilot workflow", () => {
  it("detects every 4 hours, so a release has a PR within 6 hours", () => {
    expect(upstream).toContain('- cron: "17 */4 * * *"');
  });

  it("grants nothing by default and each job only what it needs", () => {
    expect(upstream).toMatch(/^permissions: \{\}$/m);
    expect(permissions(job(upstream, "detect"))).toEqual(["contents: read", "issues: read"]);
    expect(permissions(job(upstream, "track"))).toEqual(["contents: read", "issues: write"]);
    expect(permissions(job(upstream, "patch-check"))).toEqual(["contents: read"]);
    expect(permissions(job(upstream, "test"))).toEqual(["contents: read"]);
    expect(permissions(job(upstream, "drift"))).toEqual(["contents: read", "issues: write"]);
    expect(permissions(job(upstream, "publish"))).toEqual([
      "contents: write",
      "pull-requests: write",
      "issues: write",
    ]);
  });

  it("no secret reaches detection, the patch check or the suites", () => {
    for (const id of ["detect", "track", "patch-check", "test", "drift"]) {
      expect(job(upstream, id), id).not.toContain("secrets.");
    }
    expect(job(upstream, "test")).not.toContain("secrets: inherit");
    expect(upstream).not.toMatch(/secrets\.SAFEBROWSING/);
  });

  it("no workflow runs on pull_request_target", () => {
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
      expect(workflow(name), name).not.toMatch(/^\s*pull_request_target\s*:/m);
    }
  });

  it("every action it uses is pinned by a full commit SHA", () => {
    for (const [name, text] of [
      ["upstream.yml", upstream],
      ["e2e.yml", e2e],
    ]) {
      const uses = [...(text ?? "").matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map((m) => m[1] ?? "");
      expect(uses.length, name).toBeGreaterThan(0);
      for (const u of uses) {
        if (u.startsWith("./")) continue;
        expect(u, `${name}: ${u}`).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it("the suites run through e2e.yml on the new version, read-only", () => {
    const block = job(upstream, "test");
    expect(block).toContain("uses: ./.github/workflows/e2e.yml");
    expect(block).toContain("firefox-version: ${{ needs.detect.outputs.version }}");
    expect(e2e).toMatch(/workflow_call:\n\s+inputs:\n\s+firefox-version:/);
    expect(e2e).toContain('python3 tools/upstream/bump-surfer-json.py "$VERSION"');
  });

  it("nothing is built from a tarball whose SHA-512 Mozilla did not publish", () => {
    const download = e2e.indexOf("npx surfer download");
    const verify = e2e.indexOf("python3 tools/upstream/verify-sha512.py");
    const imp = e2e.indexOf("run: npm run import");
    expect(download).toBeGreaterThan(0);
    expect(verify).toBeGreaterThan(download);
    expect(imp).toBeGreaterThan(verify);
    expect(source).toContain('python3 "$here/verify-sha512.py"');
    expect(job(upstream, "patch-check")).toContain("tools/upstream/source-check.sh");
  });

  it("upstream.yml checks the source through source-check.sh", () => {
    // One script for the release autopilot and the Beta canary, so their checks cannot drift.
    const block = job(upstream, "patch-check");
    expect(block).toContain('run: tools/upstream/source-check.sh "$VERSION"');
    expect(block).not.toContain("curl ");
    expect(block).toContain("result: ${{ steps.check.outputs.result }}");
    expect(block).toContain("artifacts: ${{ steps.check.outputs.artifacts }}");
    expect(source).toContain(`patch-check.py" --tarball - --drain`);
    expect(source).toContain("patch-audit.py");
    expect(source).toContain(`artifact-preflight.mjs" patch-check.json`);
  });

  it("falls back to a compare link when Actions may not open PRs", () => {
    const block = job(upstream, "publish");
    expect(block).toContain('grep -qi "not permitted to create or approve pull requests"');
    expect(block).toContain("autopilot-body.mjs");
    expect(block).toContain("body fallback");
  });

  it("the drift job fails the run", () => {
    const block = job(upstream, "drift");
    expect(block).toContain("if: needs.detect.outputs.drift == 'overdue'");
    expect(block).toMatch(/exit 1\n?$/);
  });
});
