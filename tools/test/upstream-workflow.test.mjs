import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/**
 * @param {string} text a workflow
 * @param {string} id a step's `id:`
 * @returns {string} that step's YAML, from its `- name:` line to the next step
 */
function step(text, id) {
  const steps = text.split(/^(?= {6}- )/m);
  const found = steps.find((s) => new RegExp(`^ {8}id: ${id}$`, "m").test(s));
  if (!found) throw new Error(`no step with id ${id}`);
  return found.replace(/\n{2,}[^]*$/, "\n");
}

/** @param {string} block a step @returns {string} its `run: |` script, unindented */
function script(block) {
  const m = /^ {8}run: \|\n((?: {10}.*\n|\n)+)/m.exec(block);
  if (!m?.[1]) throw new Error("no run block");
  return m[1].replace(/^ {10}/gm, "");
}

// Spec upstream-beta-canary, decision 4. A Firefox Beta (`159.0b1`) turns on Beta mode: every
// check and suite runs and is reported in suite-results.json. Anything else, PR CI and the
// release autopilot included, fails on the first failure exactly as before.
describe("e2e.yml Beta mode", () => {
  /** @param {string} version @returns {string} the mode step's `beta` output */
  const mode = (version) => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-mode-"));
    const out = join(dir, "out");
    writeFileSync(out, "");
    const r = spawnSync("bash", ["-e", "-c", script(step(e2e, "mode"))], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, VERSION: version, GITHUB_OUTPUT: out },
    });
    expect(r.status, r.stderr).toBe(0);
    return readFileSync(out, "utf8");
  };

  it("is on only for a version matching ^\\d+\\.0b\\d+$", () => {
    for (const v of ["159.0b1", "159.0b12", "160.0b3"]) expect(mode(v), v).toBe("beta=true\n");
    for (const v of [
      "",
      "158.0",
      "158.0.1",
      "160.0a1",
      "159.1b1",
      "159.0b",
      "159.0b1 ",
      "x159.0b1",
      "159.0b1\n158.0",
    ]) {
      expect(mode(v), JSON.stringify(v)).toBe("beta=false\n");
    }
  });

  it("can be started by hand on a version, as well as by upstream.yml", () => {
    expect(e2e).toMatch(/workflow_dispatch:\n\s+inputs:\n\s+firefox-version:/);
    expect(e2e).toMatch(/^ {2}pull_request:\n/m);
  });

  it("passes --allow-beta to bump-surfer-json.py only in beta mode", () => {
    const block = step(e2e, "bump");
    expect(block).toContain("BETA: ${{ steps.mode.outputs.beta }}");
    const run = script(block);
    expect(run).toMatch(
      /if \[ "\$BETA" = true \]; then\n\s+python3 tools\/upstream\/bump-surfer-json.py --allow-beta "\$VERSION"\nelse\n\s+python3 tools\/upstream\/bump-surfer-json.py "\$VERSION"\nfi/,
    );
    expect(e2e.match(/bump-surfer-json.py --allow-beta/g)).toHaveLength(1);
    expect(e2e.indexOf("id: mode")).toBeLessThan(e2e.indexOf("id: bump"));
  });

  it("e2e.yml continues after a failed suite only in beta mode", () => {
    const lines = [...e2e.matchAll(/^\s*continue-on-error:.*$/gm)].map((m) => m[0].trim());
    expect(lines).toEqual(
      Array(4).fill("continue-on-error: ${{ steps.mode.outputs.beta == 'true' }}"),
    );
    for (const id of ["branding", "upstream-prefs", "mochitest", "e2e"]) {
      expect(step(e2e, id), id).toContain(
        "continue-on-error: ${{ steps.mode.outputs.beta == 'true' }}",
      );
    }
    // the build steps still stop the job: there is nothing to test without them
    for (const id of ["import", "artifact-build"]) {
      expect(step(e2e, id), id).not.toContain("continue-on-error");
    }
  });

  // `npm run mochitest` prints mach's own log format, not TBPL: Beta mode asks mozlog for a TBPL
  // log file as well. A fake npm records the command each step runs.
  /** @param {string} id @param {string} beta @returns {{ status: number | null, argv: string }} */
  const runStep = (id, beta) => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-step-"));
    const record = join(dir, "argv");
    writeFileSync(join(dir, "npm"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${record}"\nexit 3\n`, {
      mode: 0o755,
    });
    const r = spawnSync("bash", ["-e", "-c", script(step(e2e, id))], {
      encoding: "utf8",
      env: { PATH: `${dir}:${process.env.PATH}`, BETA: beta, RUNNER_TEMP: "/t" },
    });
    return { status: r.status, argv: readFileSync(record, "utf8").trim().split("\n").join(" ") };
  };

  it("a release run's suite commands are exactly as before, and fail their step", () => {
    expect(runStep("mochitest", "false")).toEqual({
      status: 3,
      argv: "run mochitest -- --artifact --setenv=VIMMA_REQUIRE_CTL=1 tests/browser/",
    });
    expect(runStep("e2e", "false")).toEqual({ status: 3, argv: "run e2e -- --artifact" });
  });

  it("a beta run also writes the mochitests' TBPL log and the e2e report, and fails its step", () => {
    expect(runStep("mochitest", "true")).toEqual({
      status: 3,
      argv:
        "run mochitest -- --artifact --setenv=VIMMA_REQUIRE_CTL=1 " +
        "--log-tbpl=/t/mochitest.tbpl.log tests/browser/",
    });
    expect(runStep("e2e", "true")).toEqual({
      status: 3,
      argv: "run e2e -- --artifact --report-json /t/e2e-report.json",
    });
    for (const id of ["mochitest", "e2e"]) {
      expect(step(e2e, id), id).toContain("BETA: ${{ steps.mode.outputs.beta }}");
    }
    expect(step(e2e, "suite-results")).toContain(
      '--mochitest-log "$RUNNER_TEMP/mochitest.tbpl.log"',
    );
  });

  it("writes and uploads suite-results.json only in beta mode, even after a failed step, never on a cancelled run", () => {
    const write = step(e2e, "suite-results");
    expect(write).toContain(`if: "!cancelled() && steps.mode.outputs.beta == 'true'"`);
    expect(write).toContain("STEPS: ${{ toJSON(steps) }}");
    expect(write).toContain("node tools/upstream/suite-results.mjs");
    const upload = e2e.slice(e2e.indexOf("id: suite-results"));
    expect(upload).toMatch(
      /- name: Upload suite-results\.json[^]*?if: "!cancelled\(\) && steps\.mode\.outputs\.beta == 'true'"[^]*?name: suite-results\n/,
    );
  });

  it("a release run uploads failed screenshots as before; a beta run when the e2e step failed", () => {
    expect(e2e).toContain(
      "if: failure() || (steps.mode.outputs.beta == 'true' && steps.e2e.outcome == 'failure')",
    );
  });
});

describe("e2e.yml concurrency", () => {
  it("a run cancels only an older run of the same ref and version", () => {
    // A manual Beta run on a branch must not cancel the canary's run of that Beta on main, nor
    // the autopilot's run on main a manual run without a version; a new push to a PR still
    // cancels that PR's older run.
    expect(e2e).toContain("group: e2e-${{ github.ref }}-${{ inputs.firefox-version }}");
    expect(e2e).toContain("cancel-in-progress: true");
  });
});
