import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { jobs, parseWorkflow } from "./workflow-runners.mjs";

// Spec build-supply-chain, decision 23: the nightly publishes no release until the release gate
// lifts. Its build job keeps the package as a short-lived workflow artifact and holds no write
// token; reporting a failure is a job of its own, the only one that can write (issues).
// Parsed as YAML (js-yaml), like self-hosted-runner.test.mjs.
const TEXT = readFileSync(new URL("../../.github/workflows/nightly.yml", import.meta.url), "utf8");
const JOBS = jobs(TEXT);
const PINNED = /^actions\/(upload|download)-artifact@[0-9a-f]{40}$/;

/**
 * @param {string} id
 * @returns {Record<string, unknown>}
 */
function job(id) {
  const found = JOBS.get(id);
  if (!found) throw new Error(`no job ${id}`);
  return found;
}

/**
 * @param {string} id
 * @returns {Record<string, any>[]}
 */
const steps = (id) => /** @type {Record<string, any>[]} */ (job(id).steps ?? []);

/**
 * The one step of job `id` that uses `action` (an `owner/name` without the ref).
 * @param {string} id
 * @param {string} action
 */
function uses(id, action) {
  const found = steps(id).filter((s) => String(s.uses ?? "").startsWith(`${action}@`));
  expect(found, `${id}: ${action}`).toHaveLength(1);
  const step = found[0] ?? {};
  expect(step.uses).toMatch(PINNED);
  return step;
}

describe("nightly.yml: a workflow artifact, never a release", () => {
  it("the workflow and its build job can only read the repository", () => {
    expect(parseWorkflow(TEXT).permissions).toEqual({ contents: "read" });
    expect(job("build").permissions).toEqual({ contents: "read" });
    // No token that can write reaches npm, Surfer, mach or the mochitests.
    const build = JSON.stringify(job("build"));
    expect(build).not.toContain("GH_TOKEN");
    expect(build).not.toContain("github.token");
    expect(build).not.toMatch(/gh (release|issue|label)/);
  });

  it("the build job keeps the package as a workflow artifact for 7 days", () => {
    const names = steps("build").map((s) => s.name ?? s.uses);
    const upload = steps("build").find((s) => s.with?.name === "vimma-nightly");
    expect(upload, "upload step").toBeDefined();
    expect(upload?.uses).toMatch(PINNED);
    expect(upload?.uses).toMatch(/^actions\/upload-artifact@/);
    expect(upload?.with).toMatchObject({
      path: "dist/",
      "retention-days": 7,
      "if-no-files-found": "error",
    });
    expect(names.indexOf(upload?.name)).toBeGreaterThan(names.indexOf("Package"));
  });

  it("no job creates, edits or deletes a release, and none can write contents", () => {
    for (const [id, j] of JOBS) {
      const perms = /** @type {Record<string, string>} */ (j.permissions ?? {});
      expect(perms.contents ?? "read", id).toBe("read");
      expect(JSON.stringify(j), id).not.toMatch(/gh release|releases/);
    }
    expect(TEXT).not.toMatch(/gh release|PUBLISH_NIGHTLY_RELEASE|contents: write/);
  });

  it("a failure is reported by its own job, from the redacted log artifact", () => {
    const report = job("report");
    expect(report.needs).toBe("build");
    expect(report.if).toBe("failure()");
    expect(report.permissions).toEqual({ issues: "write" });
    const download = uses("report", "actions/download-artifact");
    expect(download.with).toMatchObject({ name: "nightly-log" });
    const text = JSON.stringify(report);
    expect(text).not.toContain("secrets.");
    expect(text).not.toContain("actions/checkout");
    expect(text).toContain("gh issue create");
    // The build job uploads the log only after scrubbing the key from it.
    const names = steps("build").map((s) => s.name);
    const redact = names.indexOf("Redact the Safe Browsing key from the log");
    expect(redact).toBeGreaterThan(-1);
    expect(names.indexOf("Upload log")).toBeGreaterThan(redact);
    // A build stopped at timeout-minutes is cancelled, not failed: it still leaves its log.
    expect(steps("build")[names.indexOf("Upload log")]?.if).toBe("failure() || cancelled()");
    const issue = steps("report").find((s) => s.name === "Open or update the failure issue");
    expect(issue?.run).toContain("tail -n 150 nightly-log/nightly.log");
    // A log line holding a code fence must not end the issue's fence and render as Markdown.
    const tick = "`";
    expect(issue?.run).toContain(`sed 's/${tick}/\\\\${tick}/g'`);
  });

  it("the report job names the repository, since it checks nothing out", () => {
    const step = steps("report").find((s) => s.name === "Open or update the failure issue");
    expect(step?.env).toMatchObject({
      GH_TOKEN: "${{ github.token }}",
      GH_REPO: "${{ github.repository }}",
    });
    expect([...JOBS.keys()]).toEqual(["build", "report"]);
  });
});
