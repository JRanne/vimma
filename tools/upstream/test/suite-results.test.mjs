import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mochitestFailures, suiteResults } from "../suite-results.mjs";

// tools/upstream/suite-results.mjs: e2e.yml's Beta mode writes suite-results.json from each
// step's outcome, the mochitest log and the e2e harness's --report-json (spec
// upstream-beta-canary, decision 4). The log lines are mozlog's TBPL formatter's, as mach prints
// them (a timestamp first) and as tbplformatter.py:105 writes them.
const SCRIPT = fileURLToPath(new URL("../suite-results.mjs", import.meta.url));

const LOG = [
  " 0:01.20 INFO Checking for orphan ssltunnel processes...",
  " 4:12.05 TEST-PASS | browser/base/content/test/vimma/browser_vimma_keys.js | keys work",
  " 4:13.11 TEST-UNEXPECTED-FAIL | browser/base/content/test/vimma/browser_vimma_sidebar_theme.js | search field colour - Got rgb(0, 0, 0), expected rgb(1, 2, 3)",
  " 4:13.12 \u001b[31mTEST-UNEXPECTED-TIMEOUT\u001b[0m | browser/base/content/test/vimma/browser_vimma_x.js | Test timed out - ",
  " 4:20.00 TEST-UNEXPECTED-FAIL | Shutdown | leaked 1 window(s) until shutdown",
  "Unexpected results:",
  " 4:13.11 TEST-UNEXPECTED-FAIL | browser/base/content/test/vimma/browser_vimma_sidebar_theme.js | search field colour - Got rgb(0, 0, 0), expected rgb(1, 2, 3)",
  " 4:21.00 TEST-KNOWN-FAIL | browser/x.js | expected to fail",
].join("\n");

const OK = { outcome: "success", conclusion: "success", outputs: {} };
const FAILED = { outcome: "failure", conclusion: "success", outputs: {} };

describe("mochitestFailures", () => {
  it("takes the TEST-UNEXPECTED-* | test | message lines, once each", () => {
    expect(mochitestFailures(LOG)).toEqual([
      {
        status: "TEST-UNEXPECTED-FAIL",
        test: "browser/base/content/test/vimma/browser_vimma_sidebar_theme.js",
        message: "search field colour - Got rgb(0, 0, 0), expected rgb(1, 2, 3)",
      },
      {
        status: "TEST-UNEXPECTED-TIMEOUT",
        test: "browser/base/content/test/vimma/browser_vimma_x.js",
        message: "Test timed out -",
      },
      {
        status: "TEST-UNEXPECTED-FAIL",
        test: "Shutdown",
        message: "leaked 1 window(s) until shutdown",
      },
    ]);
  });

  it("finds nothing in a clean log", () => {
    expect(mochitestFailures(" 0:01.00 TEST-PASS | a.js | ok\n")).toEqual([]);
  });
});

describe("suiteResults", () => {
  const e2eReport = {
    passed: 9,
    failed: [{ name: "m3-crash-restore", status: "timeout", error: "did not finish within 60 s" }],
    pending: [],
  };

  it("records every step's outcome and every failure, and is not ok when one failed", () => {
    const r = suiteResults({
      version: "159.0b1",
      steps: {
        import: OK,
        branding: OK,
        "upstream-prefs": FAILED,
        "artifact-build": OK,
        mochitest: FAILED,
        e2e: FAILED,
      },
      mochitestLog: LOG,
      e2eReport,
    });
    expect(r.version).toBe("159.0b1");
    expect(r.ok).toBe(false);
    expect(r.steps).toEqual({
      import: "success",
      branding: "success",
      "upstream-prefs": "failure",
      "artifact-build": "success",
      mochitest: "failure",
      e2e: "failure",
    });
    expect(r.mochitest.failures).toHaveLength(3);
    expect(r.e2e).toEqual(e2eReport);
  });

  it("a step that never ran is skipped, and the run is not ok", () => {
    const r = suiteResults({
      version: "159.0b1",
      steps: { import: FAILED },
      mochitestLog: null,
      e2eReport: null,
    });
    expect(r.ok).toBe(false);
    expect(r.steps.mochitest).toBe("skipped");
    expect(r.steps.e2e).toBe("skipped");
    expect(r.mochitest).toEqual({ log: false, failures: [] });
    expect(r.e2e).toBeNull();
  });

  it("is ok only when every step succeeded", () => {
    const steps = Object.fromEntries(
      ["import", "branding", "upstream-prefs", "artifact-build", "mochitest", "e2e"].map((s) => [
        s,
        OK,
      ]),
    );
    const r = suiteResults({
      version: "159.0b2",
      steps,
      mochitestLog: "",
      e2eReport: { passed: 10, failed: [], pending: [] },
    });
    expect(r.ok).toBe(true);
  });
});

describe("node tools/upstream/suite-results.mjs", () => {
  it("writes suite-results.json from the steps context and exits 1 when a suite failed", () => {
    const dir = mkdtempSync(join(tmpdir(), "suite-results-"));
    writeFileSync(join(dir, "mochitest.log"), LOG);
    writeFileSync(
      join(dir, "e2e-report.json"),
      JSON.stringify({ passed: 1, failed: [], pending: [] }),
    );
    const out = join(dir, "suite-results.json");
    const steps = {
      import: OK,
      branding: OK,
      "upstream-prefs": OK,
      "artifact-build": OK,
      mochitest: FAILED,
      e2e: OK,
    };
    const r = spawnSync(
      process.execPath,
      [
        SCRIPT,
        ...["--version", "159.0b1", "--out", out],
        ...[
          "--mochitest-log",
          join(dir, "mochitest.log"),
          "--e2e-report",
          join(dir, "e2e-report.json"),
        ],
      ],
      { encoding: "utf8", env: { ...process.env, STEPS: JSON.stringify(steps) } },
    );
    expect(r.status, r.stderr).toBe(1);
    const written = JSON.parse(readFileSync(out, "utf8"));
    expect(written.ok).toBe(false);
    expect(written.steps.mochitest).toBe("failure");
    expect(written.mochitest.failures[0].test).toMatch(/browser_vimma_sidebar_theme\.js$/);
    expect(r.stdout).toMatch(/mochitest: failure, 3 unexpected/);
  });

  it("missing log and report files are recorded, not an error", () => {
    const dir = mkdtempSync(join(tmpdir(), "suite-results-"));
    const out = join(dir, "suite-results.json");
    const r = spawnSync(
      process.execPath,
      [
        SCRIPT,
        ...["--version", "159.0b1", "--out", out],
        ...["--mochitest-log", join(dir, "none.log"), "--e2e-report", join(dir, "none.json")],
      ],
      { encoding: "utf8", env: { ...process.env, STEPS: JSON.stringify({ import: FAILED }) } },
    );
    expect(r.status, r.stderr).toBe(1);
    const written = JSON.parse(readFileSync(out, "utf8"));
    expect(written.e2e).toBeNull();
    expect(written.mochitest.log).toBe(false);
  });
});
