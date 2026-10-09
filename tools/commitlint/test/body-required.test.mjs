import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bodyRequiredForTypes } from "../body-required.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * Runs the repo's commitlint CLI (and so commitlint.config.mjs) on a message.
 * @param {string} message
 */
function commitlint(message) {
  const run = spawnSync("npx", ["--no-install", "commitlint"], {
    cwd: root,
    input: message,
    encoding: "utf8",
  });
  return { status: run.status, output: run.stdout + run.stderr };
}

describe("body-required-for-types rule", () => {
  const types = ["feat", "fix"];

  it("fails a feat commit without a body", () => {
    const [ok, why] = bodyRequiredForTypes({ type: "feat", body: null }, "always", types);
    expect(ok).toBe(false);
    expect(why).toMatch(/feat/);
  });

  it("fails a fix commit whose body is only whitespace", () => {
    const [ok] = bodyRequiredForTypes({ type: "fix", body: "  \n " }, "always", types);
    expect(ok).toBe(false);
  });

  it("passes a feat commit with a body", () => {
    const [ok] = bodyRequiredForTypes({ type: "feat", body: "Adds x." }, "always", types);
    expect(ok).toBe(true);
  });

  it("ignores types outside the list", () => {
    const [ok] = bodyRequiredForTypes({ type: "docs", body: null }, "always", types);
    expect(ok).toBe(true);
  });

  it("is a no-op when the rule is set to never", () => {
    const [ok] = bodyRequiredForTypes({ type: "feat", body: null }, "never", types);
    expect(ok).toBe(true);
  });
});

describe("repo commitlint config (CLI)", () => {
  it("rejects `feat: x` without a body", () => {
    const run = commitlint("feat: x\n");
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/body-required-for-types/);
  });

  it("rejects `fix(host): y` without a body", () => {
    const run = commitlint("fix(host): y\n");
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/body-required-for-types/);
  });

  it("accepts `feat: x` with a body", () => {
    const run = commitlint("feat: x\n\nAdds x to the status bar.\n");
    expect(run.output).toBe("");
    expect(run.status).toBe(0);
  });

  it("accepts `docs: x` without a body", () => {
    expect(commitlint("docs: x\n").status).toBe(0);
  });
});
