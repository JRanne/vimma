import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUDGET_US,
  CASE_THRESHOLD,
  FALLBACK_MARGIN,
  THRESHOLD,
  baselineEntry,
  combine,
  compare,
  githubAnnotations,
  median,
  minOfMedians,
  withBaselineEntry,
} from "../compare.mjs";

const script = fileURLToPath(new URL("../compare.mjs", import.meta.url));
const MACHINE = "AMD EPYC 7763 64-Core Processor | x64 | node 22.23.3";

/**
 * A bench result as bench.mjs writes it.
 * @param {Record<string, { us: number, ratio: number }>} cases
 * @param {string} [machine]
 */
const result = (cases, machine = MACHINE) => ({ machine, referenceUs: 0.5, cases });

/** @param {Record<string, { us: number, ratio: number }>} cases */
const baseline = (cases, machine = MACHINE) => ({
  machines: { [machine]: { recorded: "2026-10-09", notes: "test", cases } },
});

describe("median and minOfMedians", () => {
  it("takes the middle sample of an odd count and the mean of the middle two of an even one", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("does not reorder the samples it is given", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });

  it("refuses an empty sample", () => {
    expect(() => median([])).toThrow(/empty/);
  });

  it("keeps the quietest round: the smallest of the per-round medians", () => {
    expect(
      minOfMedians([
        [9, 10, 11],
        [4, 5, 60],
        [7, 7, 7],
      ]),
    ).toBe(5);
  });
});

describe("combine", () => {
  it("keeps, per case, the lowest µs and the median ratio over the processes", () => {
    const combined = combine([
      { ...result({ a: { us: 2, ratio: 1.2 }, b: { us: 5, ratio: 3 } }), referenceUs: 0.5 },
      { ...result({ a: { us: 1, ratio: 1.4 }, b: { us: 6, ratio: 2.5 } }), referenceUs: 0.52 },
      { ...result({ a: { us: 3, ratio: 1.3 }, b: { us: 7, ratio: 2.8 } }), referenceUs: 0.51 },
    ]);
    expect(combined).toEqual({
      machine: MACHINE,
      referenceUs: 0.5,
      referenceSpread: expect.closeTo(0.04, 9),
      processes: 3,
      cases: { a: { us: 1, ratio: 1.3 }, b: { us: 5, ratio: 2.8 } },
    });
  });

  it("does not let one process with a slow reference set the ratios (issue #125)", () => {
    // A slower reference in one process lowers every ratio of that process. The lowest ratio
    // would pick exactly that process, and the next run, without one, would read as a regression.
    const steady = { a: { us: 1, ratio: 2 }, b: { us: 10, ratio: 20 } };
    const slowRef = { a: { us: 1, ratio: 1.6 }, b: { us: 10, ratio: 16 } };
    const runs = [steady, steady, slowRef, steady, steady].map((cases) => result(cases));
    expect(combine(runs).cases).toEqual(steady);
  });

  it("refuses results from different machines or with different cases", () => {
    expect(() => combine([result({ a: { us: 1, ratio: 1 } }), result({}, "other")])).toThrow(
      /machine/,
    );
    expect(() => combine([result({ a: { us: 1, ratio: 1 } }), result({})])).toThrow(/cases/);
    expect(() => combine([])).toThrow(/no results/);
  });
});

describe("compare", () => {
  it("passes when every case is within 10 % of its baseline and under 50 µs", () => {
    const r = compare(
      result({ a: { us: 1.05, ratio: 2.1 }, b: { us: 3, ratio: 6 } }),
      baseline({ a: { us: 1, ratio: 2 }, b: { us: 3, ratio: 6 } }),
    );
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("fails when the suite (geometric mean of the cases' changes) regresses by more than 10 %", () => {
    const r = compare(
      result({ a: { us: 1, ratio: 2.22 }, b: { us: 1, ratio: 4.4 } }),
      baseline({ a: { us: 1, ratio: 2 }, b: { us: 1, ratio: 4 } }),
    );
    expect(r.ok).toBe(false);
    expect(r.suiteChange).toBeCloseTo(Math.sqrt(1.11 * 1.1) - 1);
    expect(r.failures).toEqual([expect.stringMatching(/^suite: \+10\.5 % .*10\.0 % limit/)]);
  });

  it("passes a suite regression of exactly 10 %, the limit itself", () => {
    expect(THRESHOLD).toBe(0.1);
    const r = compare(result({ a: { us: 1, ratio: 2.2 } }), baseline({ a: { us: 1, ratio: 2 } }));
    expect(r.ok).toBe(true);
  });

  it("passes one case 15 % slower when the suite stays within 10 %, and notes it", () => {
    const r = compare(
      result({ a: { us: 1, ratio: 2.3 }, b: { us: 1, ratio: 4 }, c: { us: 1, ratio: 1 } }),
      baseline({ a: { us: 1, ratio: 2 }, b: { us: 1, ratio: 4 }, c: { us: 1, ratio: 1 } }),
    );
    expect(r.ok).toBe(true);
    expect(r.notes).toEqual([expect.stringMatching(/^a: \+15\.0 %/)]);
  });

  it("fails any single case more than 25 % slower, whatever the suite does", () => {
    expect(CASE_THRESHOLD).toBe(0.25);
    const r = compare(
      result({ a: { us: 1, ratio: 2.6 }, b: { us: 1, ratio: 3 }, c: { us: 1, ratio: 3 } }),
      baseline({ a: { us: 1, ratio: 2 }, b: { us: 1, ratio: 4 }, c: { us: 1, ratio: 4 } }),
    );
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual([expect.stringMatching(/^a: \+30\.0 % .*25\.0 % limit/)]);
  });

  it("compares the ratio to the reference workload, not raw µs, so a slower runner passes", () => {
    const r = compare(result({ a: { us: 1.5, ratio: 2 } }), baseline({ a: { us: 1, ratio: 2 } }));
    expect(r.ok).toBe(true);
  });

  it("fails any case over the 50 µs budget, even with no baseline for the machine", () => {
    expect(BUDGET_US).toBe(50);
    const r = compare(result({ slow: { us: 50.1, ratio: 100 } }, "other cpu"), baseline({}));
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual([expect.stringMatching(/^slow: 50\.10 µs .*50 µs budget/)]);
  });

  it("fails a case of exactly 50.0 µs: the plan's budget is under 50 µs", () => {
    const r = compare(
      result({ edge: { us: 50, ratio: 2 } }),
      baseline({ edge: { us: 50, ratio: 2 } }),
    );
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual([expect.stringMatching(/^edge: 50\.00 µs .*50 µs budget/)]);
    expect(compare(result({ edge: { us: 49.99, ratio: 2 } }), baseline({})).ok).toBe(true);
  });

  it("passes one case exactly 25 % slower, the per-case limit itself", () => {
    const r = compare(
      result({ a: { us: 1, ratio: 2.5 }, b: { us: 1, ratio: 3 }, c: { us: 1, ratio: 3 } }),
      baseline({ a: { us: 1, ratio: 2 }, b: { us: 1, ratio: 3.3 }, c: { us: 1, ratio: 3.3 } }),
    );
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("warns, never silently, on a machine with no comparable baseline, and keeps the budget", () => {
    const r = compare(
      result({ a: { us: 1, ratio: 9 } }, "other cpu"),
      baseline({ a: { us: 1, ratio: 2 } }),
    );
    expect(r.ok).toBe(true);
    expect(r.fallback).toBeNull();
    expect(r.warnings).toEqual([expect.stringMatching(/no baseline for machine "other cpu"/)]);
  });
});

describe("compare on an unrecorded runner of a recorded architecture and Node major", () => {
  const INTEL = "INTEL(R) XEON(R) PLATINUM 8573C | x64 | node 22.23.3";
  const AMD = "AMD EPYC 9V74 80-Core Processor | x64 | node 22.23.3";
  const two = {
    machines: {
      [INTEL]: {
        recorded: "x",
        notes: "",
        cases: { a: { us: 1, ratio: 2.1 }, b: { us: 1, ratio: 4.2 } },
      },
      [AMD]: {
        recorded: "x",
        notes: "",
        cases: { a: { us: 1, ratio: 2 }, b: { us: 1, ratio: 4 } },
      },
      "Some ARM core | arm64 | node 22.23.3": {
        recorded: "x",
        notes: "",
        cases: { a: { us: 1, ratio: 1 }, b: { us: 1, ratio: 1 } },
      },
      "Old box | x64 | node 20.1.0": {
        recorded: "x",
        notes: "",
        cases: { a: { us: 1, ratio: 1 }, b: { us: 1, ratio: 1 } },
      },
    },
  };
  const NEW = "AMD EPYC 7763 64-Core Processor | x64 | node 22.24.0";

  it("falls back to the most demanding entry of the same arch and Node major, and says so", () => {
    expect(FALLBACK_MARGIN).toBe(0.4);
    // CI run 37966135702: unchanged code on an EPYC 7763 measured +19 % on the suite, cases up
    // to +30 %, against the EPYC 9V74 entry. A fallback must pass that.
    const r = compare(result({ a: { us: 1, ratio: 2.6 }, b: { us: 1, ratio: 4.76 } }, NEW), two);
    expect(r.fallback).toBe(AMD);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([
      expect.stringMatching(
        new RegExp(`^no baseline for machine "${NEW}".*compared with "${AMD}"`),
      ),
    ]);
  });

  it("still fails a fallback comparison once the suite is more than 10 % plus the margin slower", () => {
    const r = compare(result({ a: { us: 1, ratio: 3.02 }, b: { us: 1, ratio: 6.04 } }, NEW), two);
    expect(r.fallback).toBe(AMD);
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual([expect.stringMatching(/^suite: \+51\.0 % .*50\.0 % limit/)]);
  });

  it("does not fail a fallback comparison for a baseline case the run lacks", () => {
    const r = compare(result({ a: { us: 1, ratio: 2 } }, NEW), two);
    expect(r.ok).toBe(true);
  });

  it("does not fall back across an architecture or a Node major", () => {
    expect(
      compare(result({ a: { us: 1, ratio: 9 } }, "X | riscv64 | node 22.23.3"), two).fallback,
    ).toBeNull();
    expect(
      compare(result({ a: { us: 1, ratio: 9 } }, "X | x64 | node 24.0.0"), two).fallback,
    ).toBeNull();
  });
});

describe("githubAnnotations", () => {
  it("turns each warning into a ::warning:: line and a step-summary line", () => {
    const { log, summary } = githubAnnotations(['no baseline for machine "m"; compared with "e"']);
    expect(log).toEqual([
      '::warning title=bench baseline::no baseline for machine "m"; compared with "e"',
    ]);
    expect(summary).toBe('- ⚠️ bench: no baseline for machine "m"; compared with "e"\n');
  });

  it("writes nothing when there is nothing to warn about", () => {
    expect(githubAnnotations([])).toEqual({ log: [], summary: "" });
  });
});

describe("compare, continued", () => {
  it("notes, without failing, a case the baseline does not have yet", () => {
    const r = compare(result({ fresh: { us: 1, ratio: 2 } }), baseline({}));
    expect(r.ok).toBe(true);
    expect(r.notes).toEqual([expect.stringMatching(/^fresh: no baseline/)]);
  });

  it("fails when a baseline case is missing from the run, so a case cannot vanish silently", () => {
    const r = compare(result({}), baseline({ gone: { us: 1, ratio: 2 } }));
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual([expect.stringMatching(/^gone: in the baseline but not measured/)]);
  });

  it("lists one row per measured case with its change against the baseline", () => {
    const r = compare(result({ a: { us: 1, ratio: 1.8 } }), baseline({ a: { us: 1, ratio: 2 } }));
    expect(r.rows).toEqual([{ name: "a", us: 1, ratio: 1.8, base: 2, change: expect.any(Number) }]);
    expect(r.rows[0]?.change).toBeCloseTo(-0.1);
  });
});

describe("baselineEntry and withBaselineEntry", () => {
  it("records µs and ratio per case, the date, the notes and the run as its one sample", () => {
    const entry = baselineEntry(result({ a: { us: 1.234567, ratio: 2.345678 } }), {
      date: "2026-10-09",
      notes: "ubuntu-24.04 hosted runner",
      source: "ci.yml run 1",
    });
    expect(entry).toEqual({
      recorded: "2026-10-09",
      notes: "ubuntu-24.04 hosted runner",
      cases: { a: { us: 1.235, ratio: 2.346 } },
      samples: [{ source: "ci.yml run 1", cases: { a: { us: 1.235, ratio: 2.346 } } }],
    });
  });

  it("adds a run to an existing entry and gates on the per-case median of its samples", () => {
    const meta = { date: "2026-10-10", notes: "n", source: "run 2" };
    const one = baselineEntry(result({ a: { us: 1, ratio: 2 } }), { ...meta, source: "run 1" });
    const two = baselineEntry(result({ a: { us: 3, ratio: 2.2 } }), meta, one);
    expect(two.samples.map((s) => s.source)).toEqual(["run 1", "run 2"]);
    expect(two.cases).toEqual({ a: { us: 2, ratio: 2.1 } });
    expect(two.recorded).toBe("2026-10-10");
  });

  it("replaces only the current machine's entry and keeps the others", () => {
    const before = {
      $comment: "keep",
      machines: { other: { recorded: "x", notes: "", cases: {} } },
    };
    const after = withBaselineEntry(before, MACHINE, {
      recorded: "2026-10-09",
      notes: "",
      cases: {},
    });
    expect(Object.keys(after.machines).sort()).toEqual([MACHINE, "other"].sort());
    expect(after.$comment).toBe("keep");
    expect(before.machines).not.toHaveProperty(MACHINE);
  });
});

describe("compare.mjs on the command line", () => {
  /** @param {object} r @param {object} b */
  const run = (r, b) => {
    const dir = mkdtempSync(join(tmpdir(), "bench-compare-"));
    writeFileSync(join(dir, "result.json"), JSON.stringify(r));
    writeFileSync(join(dir, "baseline.json"), JSON.stringify(b));
    return spawnSync(process.execPath, [
      script,
      join(dir, "result.json"),
      join(dir, "baseline.json"),
    ]);
  };

  it("exits 0 and prints the table when the run is within the gate", () => {
    const p = run(result({ a: { us: 1, ratio: 2 } }), baseline({ a: { us: 1, ratio: 2 } }));
    expect(p.status).toBe(0);
    expect(p.stdout.toString()).toMatch(/a\s.*1\.00 µs/);
  });

  it("exits 1 and names the case when the run regresses", () => {
    const p = run(result({ a: { us: 1, ratio: 3 } }), baseline({ a: { us: 1, ratio: 2 } }));
    expect(p.status).toBe(1);
    expect(p.stderr.toString()).toMatch(/^a: /m);
  });

  it("exits 2 on unreadable input", () => {
    const p = spawnSync(process.execPath, [script, "/nonexistent.json", "/nonexistent.json"]);
    expect(p.status).toBe(2);
  });
});
