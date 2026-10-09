import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bodyRequiredForTypes, ignoreCommit } from "../body-required.mjs";

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

  it('treats a git-style `Revert "..."` header as type revert', () => {
    const parsed = { type: null, header: 'Revert "feat: x"', body: null };
    expect(bodyRequiredForTypes(parsed, "always", ["revert"])[0]).toBe(false);
    expect(bodyRequiredForTypes(parsed, "always", ["feat"])[0]).toBe(true);
  });

  it("is a no-op when the rule is set to never", () => {
    const [ok] = bodyRequiredForTypes({ type: "feat", body: null }, "never", types);
    expect(ok).toBe(true);
  });
});

describe("ignoreCommit (replaces commitlint's default ignores)", () => {
  it.each([
    "Merge pull request #1 from JRanne/x",
    "Merge branch 'main' into x",
    "fixup! feat: x",
    'Revert "feat: x"\n\nThis reverts commit abc1234.',
  ])("ignores %j", (message) => {
    expect(ignoreCommit(message)).toBe(true);
  });

  it.each([
    'Revert "feat: x"',
    'Revert "feat: x"\n\nCloses #3',
    'Reapply "fix: y"\n',
    "feat: x",
    "revert: feat: x",
  ])("lints %j", (message) => {
    expect(ignoreCommit(message)).toBe(false);
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

  it.each([
    ["only a `Closes` footer", "feat: x\n\nCloses #3\n"],
    ["only a BREAKING CHANGE footer", "feat: x\n\nBREAKING CHANGE: y\n"],
    ["only trailers", "fix: x\n\nCo-Authored-By: A <a@b.c>\n"],
  ])("rejects feat/fix with %s (footers are not a body)", (_, message) => {
    const run = commitlint(message);
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/body-required-for-types/);
  });

  it("rejects `revert: feat: x` without a body", () => {
    const run = commitlint("revert: feat: x\n");
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/body-required-for-types/);
  });

  it("accepts `revert: feat: x` with a body", () => {
    expect(commitlint("revert: feat: x\n\nThe status bar flickered.\n").status).toBe(0);
  });

  it('rejects a git-style `Revert "feat: x"` without a body', () => {
    const run = commitlint('Revert "feat: x"\n');
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/body-required-for-types/);
  });

  it('accepts a git-style `Revert "feat: x"` with a body', () => {
    expect(commitlint('Revert "feat: x"\n\nThis reverts commit abc1234.\n').status).toBe(0);
  });

  it("accepts `docs: x` without a body", () => {
    expect(commitlint("docs: x\n").status).toBe(0);
  });
});
