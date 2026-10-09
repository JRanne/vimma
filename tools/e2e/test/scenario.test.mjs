import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadScenarios, matchState, runSteps, validateScenario } from "../scenario.mjs";

const SCENARIOS = fileURLToPath(new URL("../../../tests/e2e/scenarios/", import.meta.url));

/** @param {object} over */
const scenario = (over) => ({
  name: "m0-sample",
  description: "a sample",
  steps: [{ "assert-state": { mode: "insert" } }],
  ...over,
});

describe("validateScenario", () => {
  it("accepts a milestone happy path and a regression test with its issue number", () => {
    expect(validateScenario(scenario({}), "m0-sample.json")).toEqual([]);
    expect(
      validateScenario(scenario({ name: "issue-42-esc-closes-help", issue: 42 }), undefined),
    ).toEqual([]);
  });

  it.each([
    [{ name: "happy" }, /name must be m<N>-<slug> or issue-<N>-<slug>/],
    [{ name: "issue-42-x" }, /"issue": 42/],
    [{ name: "issue-42-x", issue: 43 }, /"issue": 42/],
    [{ description: "" }, /description/],
    [{ steps: [] }, /at least one step/],
    [{ steps: [{ keys: "esc", open: "about:blank" }] }, /step 1: exactly one of/],
    [{ steps: [{ click: "x" }] }, /step 1: exactly one of/],
    [{ steps: [{ keys: "" }] }, /step 1: keys/],
    [{ steps: [{ open: 3 }] }, /step 1: open/],
    [{ steps: [{ "wait-for-state": "help" }] }, /step 1: wait-for-state/],
    [{ steps: [{ screenshot: "Bad Name" }] }, /step 1: screenshot/],
    [{ steps: [{ keys: "esc", timeoutSeconds: 3 }] }, /timeoutSeconds/],
    [{ pending: "" }, /pending/],
    [{ timeoutSeconds: 0 }, /timeoutSeconds/],
    [{ extra: 1 }, /unknown field "extra"/],
  ])("rejects %o", (over, message) => {
    expect(validateScenario(scenario(over), undefined).join("\n")).toMatch(message);
  });

  it("wants the file named after the scenario", () => {
    expect(validateScenario(scenario({}), "m0-other.json").join("\n")).toMatch(/file name/);
  });
});

describe("loadScenarios", () => {
  it("loads the repo's scenarios, all valid", () => {
    const all = loadScenarios(SCENARIOS);
    expect(all.map((s) => s.name)).toContain("m0-happy-path");
  });

  it("filters by substring and fails loudly on an invalid file", () => {
    const dir = mkdtempSync(join(tmpdir(), "vimma-e2e-scn-"));
    writeFileSync(join(dir, "m0-a.json"), JSON.stringify(scenario({ name: "m0-a" })));
    writeFileSync(join(dir, "m1-b.json"), JSON.stringify(scenario({ name: "m1-b" })));
    expect(loadScenarios(dir, { filter: "m1" }).map((s) => s.name)).toEqual(["m1-b"]);
    expect(() => loadScenarios(dir, { filter: "zzz" })).toThrow(/no scenario matches "zzz"/);
    writeFileSync(join(dir, "m2-c.json"), "{");
    expect(() => loadScenarios(dir)).toThrow(/m2-c\.json/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the m0-happy-path scenario", () => {
  const happy = loadScenarios(SCENARIOS, { filter: "m0-happy-path" })[0];
  it("runs (is not pending) now that the control server exists (PR #38)", () => {
    expect(happy).toBeDefined();
    expect(happy?.pending).toBeUndefined();
  });
  it("opens about:blank, sends ctrl+b ? and expects help mode and a screenshot", () => {
    const steps = JSON.stringify(happy?.steps);
    expect(steps).toContain('"open":"about:blank"');
    expect(steps).toContain('"keys":"ctrl+b ?"');
    expect(steps).toContain('"mode":"help"');
    expect(steps).toContain('"screenshot"');
  });
});

describe("the m0-content-actor scenario (VimmaChild loads in the default content sandbox)", () => {
  const actor = loadScenarios(SCENARIOS, { filter: "m0-content-actor" })[0];
  it("runs, opens an http fixture page and waits for normal, then insert", () => {
    expect(actor?.pending).toBeUndefined();
    const steps = JSON.stringify(actor?.steps);
    expect(steps).toContain('"open":"fixture:focus-later.html"');
    expect(steps.indexOf('"mode":"normal"')).toBeGreaterThan(steps.indexOf('"open"'));
    expect(steps.lastIndexOf('"mode":"insert"')).toBeGreaterThan(steps.indexOf('"mode":"normal"'));
  });
});

describe("matchState", () => {
  const state = {
    mode: "help",
    pending: null,
    workspace: null,
    tabs: [
      { id: "1", url: "about:blank", title: "", selected: false },
      { id: "2", url: "about:blank", title: "", selected: true },
    ],
    panes: null,
    future: { field: 1 },
  };
  it("matches a subset and ignores fields it does not name", () => {
    expect(matchState({ mode: "help" }, state)).toEqual([]);
    expect(matchState({ pending: null, tabs: [{}, { selected: true }] }, state)).toEqual([]);
  });
  it("names each mismatch with its path", () => {
    expect(matchState({ mode: "insert", pending: "ctrl+b" }, state)).toEqual([
      'state.mode: expected "insert", got "help"',
      'state.pending: expected "ctrl+b", got null',
    ]);
    expect(matchState({ tabs: [{}] }, state)).toEqual(["state.tabs: expected 1 item(s), got 2"]);
    expect(matchState({ tabs: [{}, { url: "x" }] }, state)).toEqual([
      'state.tabs[1].url: expected "x", got "about:blank"',
    ]);
    expect(matchState({ nope: 1 }, state)).toEqual(["state.nope: expected 1, got undefined"]);
    expect(matchState({ panes: { a: 1 } }, state)).toEqual([
      'state.panes: expected {"a":1}, got null',
    ]);
  });
});

describe("runSteps", () => {
  /** @param {Array<object>} states */
  const fakeCtl = (states) => {
    /** @type {string[]} */
    const calls = [];
    let i = 0;
    return {
      calls,
      ctl: {
        state: async () => {
          calls.push("state");
          return states[Math.min(i++, states.length - 1)];
        },
        sendKeys: async (/** @type {string} */ k) => void calls.push(`keys ${k}`),
        open: async (/** @type {string} */ u) => (calls.push(`open ${u}`), "2"),
      },
    };
  };

  it("runs each step in order", async () => {
    const { ctl, calls } = fakeCtl([{ mode: "insert" }, { mode: "insert" }, { mode: "help" }]);
    /** @type {string[]} */
    const shots = [];
    await runSteps(
      scenario({
        steps: [
          { open: "about:blank" },
          { keys: "ctrl+b ?" },
          { "wait-for-state": { mode: "help" } },
          { screenshot: "m0-sample-help" },
        ],
      }),
      { ctl, screenshot: async (/** @type {string} */ n) => void shots.push(n), pollMs: 1 },
    );
    expect(calls).toEqual(["open about:blank", "keys ctrl+b ?", "state", "state", "state"]);
    expect(shots).toEqual(["m0-sample-help"]);
  });

  it("assert-state checks once and fails with the step and the mismatch", async () => {
    const { ctl, calls } = fakeCtl([{ mode: "insert" }, { mode: "help" }]);
    await expect(
      runSteps(scenario({ steps: [{ "assert-state": { mode: "help" } }] }), {
        ctl,
        screenshot: async () => {},
      }),
    ).rejects.toThrow(/step 1 \(assert-state\): state\.mode: expected "help", got "insert"/);
    expect(calls).toEqual(["state"]);
  });

  it("wait-for-state times out with the last mismatch", async () => {
    const { ctl } = fakeCtl([{ mode: "insert" }]);
    await expect(
      runSteps(
        scenario({
          steps: [{ keys: "esc" }, { "wait-for-state": { mode: "help" }, timeoutSeconds: 0.2 }],
        }),
        { ctl, screenshot: async () => {}, pollMs: 20 },
      ),
    ).rejects.toThrow(
      /step 2 \(wait-for-state\): not reached in 0\.2 s: state\.mode: expected "help", got "insert"/,
    );
  });

  it("stops when the signal aborts (scenario timeout)", async () => {
    const { ctl } = fakeCtl([{ mode: "insert" }]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await expect(
      runSteps(scenario({ steps: [{ "wait-for-state": { mode: "help" }, timeoutSeconds: 30 }] }), {
        ctl,
        screenshot: async () => {},
        pollMs: 10,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/);
  });
});
