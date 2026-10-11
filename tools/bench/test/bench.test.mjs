import { describe, expect, it, vi } from "vitest";

// Issue #125: the gate must still catch a real regression. The dispatcher is wrapped so a flag can
// make every dispatch() do extra work, as a slower dispatcher would; the bench cases build their
// dispatcher through this module, so the injected cost lands in the measured hot path.
const slow = vi.hoisted(() => ({ iterations: 0, sink: 0 }));
vi.mock("../../../packages/vimma-core/src/dispatcher.mjs", async (importOriginal) => {
  /** @type {typeof import("../../../packages/vimma-core/src/dispatcher.mjs")} */
  const real = await importOriginal();
  return {
    ...real,
    /** @type {typeof real.createDispatcher} */
    createDispatcher: (...args) => {
      const d = real.createDispatcher(...args);
      const dispatch = d.dispatch;
      d.dispatch = (mode, chord) => {
        let x = slow.sink;
        for (let i = 0; i < slow.iterations; i++) x = (x * 31 + i) | 0;
        slow.sink = x;
        return dispatch(mode, chord);
      };
      return d;
    },
  };
});

const { CASES, reference } = await import("../../../packages/vimma-core/bench/cases.mjs");
const { childArgs, measure, PROCESSES } = await import("../bench.mjs");
const { baselineEntry, compare } = await import("../compare.mjs");

const MACHINE = "test machine | x64 | node 22.0.0";
/** @param {ReturnType<typeof measure>} m */
const asResult = (m) => ({
  machine: MACHINE,
  referenceUs: m.referenceUs,
  cases: Object.fromEntries(m.cases),
});
const KEY_CASE = "single key: j → scroll.down";

describe("bench processes", () => {
  it("run each child with its own fixed hash seed, the same set on every run (issue #125)", () => {
    const args = Array.from({ length: PROCESSES }, (_, p) => childArgs(p));
    const seeds = args.map((a) => a.find((x) => x.startsWith("--hash-seed=")));
    expect(seeds.every(Boolean)).toBe(true);
    expect(new Set(seeds).size).toBe(PROCESSES);
    expect(Array.from({ length: PROCESSES }, (_, p) => childArgs(p))).toEqual(args);
    for (const a of args) expect(a).toContain("--child");
  });
});

describe("the gate on a real measurement", () => {
  it("fails a dispatcher made 20 % slower and passes the unchanged code", () => {
    slow.iterations = 0;
    const before = asResult(measure(CASES, reference));
    const baseline = {
      machines: {
        [MACHINE]: baselineEntry(before, { date: "-", notes: "-", source: "this test" }),
      },
    };

    // Size the injected work to make a single key's dispatch at least 17 % slower, measured here.
    // The search only grows the work: a noisy measurement can then cost an extra doubling, but can
    // never shrink the work back to nothing, which a rescale up and down could (issue #125's test
    // once ended at 1.0002x after overshooting).
    const keyRatio = (/** @type {typeof before} */ r) => r.cases[KEY_CASE]?.ratio ?? NaN;
    let slower = before;
    for (slow.iterations = 4; slow.iterations <= 1 << 20; slow.iterations *= 2) {
      slower = asResult(measure(CASES, reference));
      if (keyRatio(slower) / keyRatio(before) - 1 >= 0.17) break;
    }
    slow.iterations = 0;
    const again = asResult(measure(CASES, reference));

    expect(keyRatio(slower) / keyRatio(before)).toBeGreaterThanOrEqual(1.15);
    const regressed = compare(slower, baseline);
    expect(regressed.ok, regressed.failures.join("\n")).toBe(false);
    expect(regressed.failures.join("\n")).toMatch(/^suite: \+/);
    const unchanged = compare(again, baseline);
    expect(unchanged.ok, unchanged.failures.join("\n")).toBe(true);
  }, 60_000);
});
