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
      expect(cond).toContain("github.repository == 'vimma-browser/vimma'");
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

  // Arch users install from the release with only the PKGBUILD (spec m6-packaging, "Arch Linux
  // without the AUR"): it is an asset like the others, so SHA256SUMS and a cosign bundle cover it.
  it("signs and uploads the PKGBUILD and SRCINFO with the other assets", () => {
    const sign = all.get("sign") ?? "";
    const publish = all.get("publish") ?? "";
    expect(sign).toMatch(
      /for f in dist\/vimma\* dist\/PKGBUILD dist\/SRCINFO dist\/SHA256SUMS; do/,
    );
    expect(publish).toMatch(
      /gh release upload "\$TAG" dist\/vimma\* dist\/PKGBUILD\* dist\/SRCINFO\* dist\/SHA256SUMS\* /,
    );
  });

  it("builds and installs the release PKGBUILD on Arch Linux before anything is signed", () => {
    const pkg = all.get("package") ?? "";
    expect(pkg).toContain("tools/package/arch-smoke.sh");
  });

  it("pushes only the PKGBUILD and .SRCINFO to the AUR, removing the old source files", () => {
    const aur = all.get("aur") ?? "";
    expect(aur).toContain("cp dist/aur/PKGBUILD dist/aur/.SRCINFO aur/");
    expect(aur).toContain(
      "git rm -q --ignore-unmatch vimma.desktop vimma-vimma.desktop vimma-open",
    );
    expect(aur).toContain("git add PKGBUILD .SRCINFO\n");
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

  // Every release bumps the patch, breaking changes too; the move to 0.2.0 or 1.0.0 is the
  // maintainer's, by a Release-As footer (runbook "Releases").
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

// release-please.yml's post-steps (spec firefox-versions, decisions 7 and 8): the release PR's
// CHANGELOG.md heading and the GitHub Release's title name the Firefox version. They hold write
// tokens on every push to main, so their scopes and inputs are pinned here.
describe("release-please.yml", () => {
  const file = readFileSync(
    new URL("../../../.github/workflows/release-please.yml", import.meta.url),
    "utf8",
  );
  const all = new Map();
  {
    const body = file.slice(file.indexOf("\njobs:\n") + 7);
    const parts = body.split(/^ {2}([a-z][a-z0-9-]*):\n/m).slice(1);
    for (let i = 0; i < parts.length; i += 2) all.set(parts[i] ?? "", parts[i + 1] ?? "");
  }
  /** @param {string} id */
  const job = (id) => /** @type {string} */ (all.get(id) ?? "");
  /** @param {string} id job id -> its `permissions:` entries, comments dropped */
  const permissions = (id) => {
    const match = /^ {4}permissions:\n((?: {6}.*\n)+)/m.exec(job(id));
    return (match?.[1] ?? "")
      .split("\n")
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean);
  };

  it("has the release-please job and the two Firefox post-steps", () => {
    expect([...all.keys()]).toEqual(["release-please", "firefox-notes", "release-title"]);
    expect(job("firefox-notes")).toMatch(/^ {4}needs: release-please$/m);
    expect(job("release-title")).toMatch(/^ {4}needs: release-please$/m);
  });

  it("release-please.yml grants nothing by default and each job only what it needs", () => {
    expect(file).toMatch(/^permissions: \{\}$/m);
    expect(permissions("release-please")).toEqual([
      "contents: write",
      "pull-requests: write",
      "issues: write",
    ]);
    expect(permissions("firefox-notes")).toEqual(["contents: read", "pull-requests: read"]);
    expect(permissions("release-title")).toEqual(["contents: write"]);
  });

  it("only release-title holds contents: write from GITHUB_TOKEN besides release-please", () => {
    for (const [id, block] of all) {
      expect(block.includes("contents: write"), id).toBe(
        id === "release-please" || id === "release-title",
      );
    }
  });

  it("no job runs on pull_request or pull_request_target", () => {
    const on = file.slice(file.indexOf("\non:\n"), file.indexOf("\npermissions:"));
    expect(on).not.toMatch(/pull_request/);
    expect(on).toMatch(/^ {2}push:\n {4}branches: \[main\]\n/m);
  });

  it("every action is pinned by a full commit SHA", () => {
    const uses = [...file.matchAll(/^\s+(?:- )?uses: (\S+)/gm)].map((m) => m[1] ?? "");
    expect(uses.length).toBeGreaterThan(3);
    for (const u of uses) expect(u, u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("no checkout keeps a token in .git/config", () => {
    for (const id of ["firefox-notes", "release-title"]) {
      const checkouts = job(id).split("uses: actions/checkout@").slice(1);
      expect(checkouts, id).toHaveLength(1);
      expect(checkouts[0], id).toMatch(
        /^\S+ # v[\d.]+\n {8}with:\n(?: {10}.*\n)*? {10}persist-credentials: false\n/,
      );
    }
  });

  it("RELEASE_PLEASE_TOKEN reaches only release-please and the changelog push", () => {
    expect(job("release-title")).not.toContain("RELEASE_PLEASE_TOKEN");
    const notes = job("firefox-notes");
    expect(notes.match(/secrets\.RELEASE_PLEASE_TOKEN/g)).toHaveLength(1);
    // as an env var of the step, never in a `with:` or the checkout
    expect(notes).toMatch(/^ {10}PUSH_TOKEN: \$\{\{ secrets\.RELEASE_PLEASE_TOKEN \}\}$/m);
    expect(notes).toMatch(/GH_TOKEN="\$PUSH_TOKEN" gh api --method PUT /);
  });

  it("firefox-notes reads the release branch as data and does nothing without the token", () => {
    const notes = job("firefox-notes");
    // main's code runs; the release branch's files come through the contents API only
    expect(notes).not.toMatch(/^ {10}ref:/m);
    expect(notes).toContain("BRANCH: release-please--branches--main");
    expect(notes).toContain("node tools/release/firefox-notes.mjs");
    expect(notes).toMatch(/if \[ -z "\$PUSH_TOKEN" \]; then\n\s+echo "::notice::/);
    expect(notes).toContain("chore(release): firefox $firefox in the changelog heading");
    // the push names the blob it replaces, so a force-push by release-please in between fails it
    expect(notes).toContain("sha: $sha");
  });

  it("release-title runs only when a release was created and titles it with versionLine", () => {
    const title = job("release-title");
    expect(condition(title)).toBe("needs.release-please.outputs.release_created == 'true'");
    expect(title).toContain("ref: refs/tags/${{ needs.release-please.outputs.tag_name }}");
    expect(title).toContain("node tools/release/version-line.mjs");
    expect(title).toContain("node tools/release/firefox-notes.mjs");
    expect(title).toContain('"Vimma ${TAG#v} · Firefox "');
    expect(title).toMatch(
      /gh api --method PATCH "repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID"/,
    );
    // edits only the name and the body; the draft flag and the tag stay as release-please set them
    expect(title).toContain("{name: $name, body: $body}");
    expect(title).not.toMatch(
      /\bdraft\s*:\s*(?:true|false|\$)|tag_name:|make_latest|gh release (?:create|delete|upload|edit)/,
    );
    expect(job("release-please")).toMatch(
      /^ {6}release_created: \$\{\{ steps\.release\.outputs\.release_created \}\}$/m,
    );
  });
});
