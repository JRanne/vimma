import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Spec m0-safebrowsing-key: builds that ship get the Google Safe Browsing key from a temp file
// that is deleted afterwards; PR builds never see it.
/** @param {string} name */
const workflow = (name) =>
  readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8");

/**
 * @param {string} text a workflow
 * @param {string} id a job id
 * @returns {string} that job's YAML block
 */
function job(text, id) {
  const body = text.slice(text.indexOf("\njobs:\n") + 7);
  const parts = body.split(/^ {2}([a-z][a-z0-9-]*):\n/m).slice(1);
  for (let i = 0; i < parts.length; i += 2) if (parts[i] === id) return parts[i + 1] ?? "";
  return "";
}

/** @param {string} block */
function checkKeyFileSteps(block) {
  // Written by a shell builtin into a mode-600 file, never echoed, deleted whatever happens.
  expect(block).toContain("SAFEBROWSING_API_KEY: ${{ secrets.SAFEBROWSING_API_KEY }}");
  expect(block).toContain(`(umask 077 && printf '%s' "$SAFEBROWSING_API_KEY" > "$keyfile")`);
  expect(block).toContain('echo "VIMMA_SAFEBROWSING_KEYFILE=$keyfile" >> "$GITHUB_ENV"');
  expect(block).not.toMatch(/echo[^\n]*\$\{?SAFEBROWSING_API_KEY/);
  expect(block).toMatch(
    /- name: Delete the Safe Browsing key file\n\s+if: always\(\)\n\s+run: rm -f "\$RUNNER_TEMP\/vimma-safebrowsing.key"/,
  );
}

describe("Safe Browsing key in CI", () => {
  it("the nightly build compiles the key in", () => {
    const block = job(workflow("nightly.yml"), "build");
    checkKeyFileSteps(block);
    // browser_vimma_safebrowsing.js then fails a nightly that lost its key.
    expect(block).toContain('VIMMA_EXPECT_SAFEBROWSING_KEY: "1"');
  });

  it("the release build compiles the key in, and no other release job sees it", () => {
    const text = workflow("release.yml");
    const block = job(text, "build");
    checkKeyFileSteps(block);
    // No mochitests here: the smoke check fails a release built without the key.
    expect(block).toContain(
      `grep -q '"no-google-safebrowsing-api-key"' "$MOZ_OBJDIR/dist/bin/modules/AppConstants.sys.mjs"`,
    );
    for (const id of ["package", "sign", "publish", "aur", "failure"]) {
      expect(job(text, id), id).not.toContain("SAFEBROWSING");
    }
  });

  it("PR builds never get it", () => {
    expect(workflow("e2e.yml")).not.toContain("secrets.SAFEBROWSING_API_KEY");
  });
});
