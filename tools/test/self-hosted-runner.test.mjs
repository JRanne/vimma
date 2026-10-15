import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  OUTSIDER_TRIGGERS,
  jobs,
  runsOn,
  triggers,
  workflowRunnerProblems,
} from "./workflow-runners.mjs";

// docs/specs/build-supply-chain.md, decision 7; docs/security.md, B5. On a public repository a
// self-hosted runner that pull request code can reach is a machine anyone can run code on, and
// Vimma registers no self-hosted runner at all, so no workflow may target one.
const dir = new URL("../../.github/workflows/", import.meta.url);
const workflows = readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((name) => ({ name, text: readFileSync(new URL(name, dir), "utf8") }));

/** @param {string} name */
const workflow = (name) => workflows.find((w) => w.name === name)?.text ?? "";

/**
 * @param {string} on the `on:` block
 * @param {string} runner the `runs-on:` value
 * @param {string} [extra] more lines of the job
 */
const synthetic = (on, runner, extra = "") =>
  `name: t\non:\n${on}\npermissions: {}\njobs:\n  a:\n    runs-on: ${runner}\n${extra}` +
  "    steps:\n      - run: true\n";

describe("self-hosted runners", () => {
  it("the parser sees every workflow's triggers and jobs", () => {
    expect(workflows.length).toBeGreaterThan(10);
    for (const { name, text } of workflows) {
      expect(triggers(text).length, name).toBeGreaterThan(0);
      expect(jobs(text).size, name).toBeGreaterThan(0);
    }
    expect(triggers(workflow("ci.yml"))).toContain("pull_request");
    expect(triggers(workflow("e2e.yml"))).toContain("workflow_call");
    expect(runsOn(jobs(workflow("upstream.yml")).get("test") ?? "")).toEqual({ kind: "reusable" });
  });

  it("no workflow an outsider can trigger runs a job on a self-hosted runner", () => {
    const exposed = workflows.filter(({ text }) =>
      triggers(text).some((t) => OUTSIDER_TRIGGERS.has(t)),
    );
    expect(exposed.map((w) => w.name)).toEqual(
      expect.arrayContaining(["ci.yml", "e2e.yml", "claude.yml", "dependabot-automerge.yml"]),
    );
    for (const { name, text } of exposed) expect(workflowRunnerProblems(text), name).toEqual([]);

    for (const runner of [
      "self-hosted",
      "[self-hosted, linux, x64]",
      "vimma-build",
      "ubuntu-24.04-16core",
      "[ubuntu-24.04, gpu]",
    ]) {
      const text = synthetic("  pull_request:", runner);
      expect(workflowRunnerProblems(text), runner).toHaveLength(1);
    }
    const group = synthetic("  issue_comment:", "", "      group: builders\n");
    expect(workflowRunnerProblems(group)).toEqual(["a: a runner group"]);
    const list = synthetic("  workflow_run:", "", "      - self-hosted\n      - linux\n");
    expect(workflowRunnerProblems(list)).toHaveLength(1);
    expect(workflowRunnerProblems(synthetic("  pull_request:", "ubuntu-24.04"))).toEqual([]);
  });

  it("a runs-on expression in such a workflow fails unless it resolves to a hosted image", () => {
    const matrix = (/** @type {string} */ list) =>
      `    strategy:\n      matrix:\n        os: ${list}\n`;
    const hosted = synthetic(
      "  pull_request:",
      "${{ matrix.os }}",
      matrix("[ubuntu-24.04, macos-15]"),
    );
    expect(workflowRunnerProblems(hosted)).toEqual([]);
    const mixed = synthetic(
      "  pull_request:",
      "${{ matrix.os }}",
      matrix("[ubuntu-24.04, self-hosted]"),
    );
    expect(workflowRunnerProblems(mixed)).toHaveLength(1);
    for (const expression of [
      "${{ inputs.runner }}",
      "${{ vars.RUNNER }}",
      "${{ github.event_name == 'push' && 'ubuntu-24.04' || 'vimma-build' }}",
      "${{ matrix.os }}", // no matrix to resolve it against
    ]) {
      const text = synthetic("  pull_request_target:", expression);
      expect(workflowRunnerProblems(text), expression).toHaveLength(1);
    }
    const included = synthetic(
      "  pull_request:",
      "${{ matrix.os }}",
      matrix("[ubuntu-24.04]") + "        include:\n          - os: self-hosted\n",
    );
    expect(workflowRunnerProblems(included)).toHaveLength(1);
  });

  it("no workflow names a self-hosted runner, and both build jobs run on ubuntu-24.04", () => {
    for (const { name, text } of workflows) {
      expect(workflowRunnerProblems(text), name).toEqual([]);
      expect(text, name).not.toMatch(/runs-on:.*self-hosted/);
    }
    for (const name of ["nightly.yml", "release.yml"]) {
      expect(runsOn(jobs(workflow(name)).get("build") ?? ""), name).toEqual({
        kind: "labels",
        labels: ["ubuntu-24.04"],
      });
    }
    // A label declared to actionlint would let a workflow name it without a lint error.
    const actionlint = readFileSync(
      new URL("../../.github/actionlint.yaml", import.meta.url),
      "utf8",
    );
    expect(actionlint).toMatch(/^self-hosted-runner:\n {2}labels: \[\]$/m);
  });

  it("each build job runs only from main or for a release", () => {
    const nightly = jobs(workflow("nightly.yml")).get("build") ?? "";
    expect(nightly).toMatch(
      /if: >-\n\s+\(github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'\) \|\|\n\s+\(github\.event_name == 'schedule' && vars\.NIGHTLY_ENABLED == 'true'\)\n/,
    );
    expect(triggers(workflow("nightly.yml")).sort()).toEqual(["schedule", "workflow_dispatch"]);
    const release = jobs(workflow("release.yml")).get("build") ?? "";
    expect(release).toMatch(
      /if: >-\n\s+vars\.RELEASE_ENABLED == 'true' && github\.repository == 'vimma-browser\/vimma' &&\n\s+\(github\.event_name == 'release' \|\| github\.ref == 'refs\/heads\/main'\)\n/,
    );
    expect(triggers(workflow("release.yml")).sort()).toEqual(["release", "workflow_dispatch"]);
  });
});
