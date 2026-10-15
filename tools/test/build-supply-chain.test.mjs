import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobs } from "./workflow-runners.mjs";

// docs/specs/build-supply-chain.md, decisions 12, 14, 16 and 17; docs/security.md, B3 and B4.
// Surfer drives the Firefox build: it is pinned exactly, never merges without a person, installs
// without install scripts, and runs only from node_modules.
const root = new URL("../../", import.meta.url);
/** @param {string} path */
const read = (path) => readFileSync(new URL(path, root), "utf8");
/** @param {string} name */
const workflow = (name) => read(`.github/workflows/${name}`);
/**
 * @param {string} name
 * @returns {string} the build job without its step names and comments: only what it runs
 */
const buildJob = (name) =>
  (jobs(workflow(name)).get("build") ?? "")
    .split("\n")
    .filter((l) => !/^\s*(?:- name:|#)/.test(l))
    .join("\n");

const SURFER = "@zen-browser/surfer";

/**
 * Runs dependabot-automerge.yml's "Decide" step as GitHub would, with the given metadata.
 * @param {{ title: string, update: string, ecosystem?: string, deps: string }} pr
 * @returns {string} the decision it writes to GITHUB_OUTPUT
 */
function decide(pr) {
  const text = workflow("dependabot-automerge.yml");
  const step = text.slice(text.indexOf("- name: Decide"));
  const m = /\n {8}run: \|\n((?: {10}.*\n|\n)+)/.exec(step);
  const script = (m?.[1] ?? "").replace(/^ {10}/gm, "");
  expect(script).toContain("decision=");
  const dir = mkdtempSync(join(tmpdir(), "vimma-automerge-"));
  try {
    const out = join(dir, "output");
    writeFileSync(out, "");
    execFileSync("bash", ["-eo", "pipefail", "-c", script], {
      env: {
        PATH: process.env.PATH,
        GITHUB_OUTPUT: out,
        TITLE: pr.title,
        UPDATE_TYPE: pr.update,
        ECOSYSTEM: pr.ecosystem ?? "npm_and_yarn",
        DEPENDENCIES: pr.deps,
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    return /^decision=(\w+)$/m.exec(readFileSync(out, "utf8"))?.[1] ?? "";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("build supply chain: npm", () => {
  it("package.json pins Surfer to an exact version, locked by integrity", () => {
    const pkg = JSON.parse(read("package.json"));
    const version = pkg.devDependencies[SURFER];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const lock = JSON.parse(read("package-lock.json"));
    expect(lock.packages[""].devDependencies[SURFER]).toBe(version);
    const entry = lock.packages[`node_modules/${SURFER}`];
    expect(entry.version).toBe(version);
    expect(entry.resolved).toBe(`https://registry.npmjs.org/${SURFER}/-/surfer-${version}.tgz`);
    expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/);
  });

  it(".npmrc turns install scripts off for every install", () => {
    expect(read(".npmrc")).toMatch(/^ignore-scripts=true$/m);
    // What npm itself resolves in this repository, so a stray user or env setting shows up too.
    const value = execFileSync("npm", ["config", "get", "ignore-scripts"], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    }).trim();
    expect(value).toBe("true");
  });

  it("release and nightly install with npm ci --ignore-scripts and run Surfer with npx --no", () => {
    for (const name of ["release.yml", "nightly.yml"]) {
      const block = buildJob(name);
      const installs = [...block.matchAll(/\bnpm (?:ci|install|i)\b[^\n]*/g)].map((m) => m[0]);
      expect(installs, name).not.toEqual([]);
      for (const line of installs) expect(line, name).toMatch(/^npm ci --ignore-scripts\b/);
      const npx = [...block.matchAll(/\bnpx\b[^\n]*/g)].map((m) => m[0]);
      expect(npx, name).not.toEqual([]);
      for (const line of npx) expect(line, name).toMatch(/^npx --no surfer /);
    }
  });

  it("surfer.json lists no add-ons", () => {
    // Surfer downloads add-ons from addons.mozilla.org or GitHub with no hash check (spec, R3).
    expect(JSON.parse(read("surfer.json")).addons).toEqual({});
  });
});

describe("build supply chain: Dependabot", () => {
  it("the release-path group comes before the minor and patch group", () => {
    const text = read(".github/dependabot.yml");
    const npm = text.slice(
      text.indexOf("package-ecosystem: npm"),
      text.indexOf("- package-ecosystem: cargo"),
    );
    const group = /^ {6}release-path:\n {8}patterns:\n((?: {10}- .+\n)+)/m.exec(npm);
    expect(group?.[1]?.trim().split(/\n\s*/)).toEqual([`- "${SURFER}"`, `- "ajv"`]);
    expect(npm.indexOf("release-path:")).toBeLessThan(npm.indexOf("npm-minor-patch:"));
  });

  it("a Surfer update is never auto-merged, security updates included", () => {
    for (const update of [
      "version-update:semver-patch",
      "version-update:semver-minor",
      "version-update:semver-major",
    ]) {
      for (const title of [
        `build(deps-dev): bump ${SURFER} from 1.14.9 to 1.15.0`,
        `build(deps-dev): bump ${SURFER} from 1.14.9 to 1.15.0 [security]`,
      ]) {
        expect(decide({ title, update, deps: SURFER }), `${title} ${update}`).toBe("review");
        expect(decide({ title, update, deps: `ajv, ${SURFER}` }), title).toBe("review");
      }
    }
  });

  it("security, patch and minor updates of other packages still auto-merge", () => {
    expect(
      decide({ title: "build(deps-dev): bump vitest [security]", update: "", deps: "vitest" }),
    ).toBe("merge");
    expect(
      decide({ title: "bump prettier", update: "version-update:semver-patch", deps: "prettier" }),
    ).toBe("merge");
    expect(
      decide({ title: "bump eslint", update: "version-update:semver-major", deps: "eslint" }),
    ).toBe("review");
    expect(
      decide({
        title: "ci: bump actions/checkout [security]",
        update: "version-update:semver-patch",
        ecosystem: "github_actions",
        deps: "actions/checkout",
      }),
    ).toBe("review");
  });
});
