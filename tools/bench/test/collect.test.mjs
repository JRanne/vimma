import { describe, expect, it } from "vitest";
import { collect, entriesFromLog } from "../collect.mjs";

const A = "AMD EPYC 7763 64-Core Processor | x64 | node 22.23.3";
const B = "AMD EPYC 9V74 80-Core Processor | x64 | node 22.23.3";

/**
 * What `gh run view --log` prints for one bench step: job, step and a timestamp before each line.
 * @param {string} job @param {string} machine @param {number} ratio @param {string} source
 */
const stepLog = (job, machine, ratio, source) => {
  const entry = {
    [machine]: {
      recorded: "2026-10-11",
      notes: "<runner, image, why recorded>",
      cases: { a: { us: 1, ratio } },
      samples: [{ source, cases: { a: { us: 1, ratio } } }],
    },
  };
  return ["machine: ...", "baseline entry:", ...JSON.stringify(entry, null, 2).split("\n")]
    .map((line) => `${job}\tRun npm run bench\t2026-10-11T06:00:00.0000000Z ${line}`)
    .join("\n");
};

describe("entriesFromLog", () => {
  it("finds the sample of every bench step in a run's log, one per job", () => {
    const log = [
      stepLog("sample (1)", A, 2, "bench-sample.yml run 9"),
      "sample (1)\tPost\t2026-10-11T06:00:01.0000000Z done",
      stepLog("sample (2)", B, 3, "bench-sample.yml run 9"),
    ].join("\n");
    expect(entriesFromLog(log)).toEqual([
      {
        machine: A,
        sample: { source: "bench-sample.yml run 9, sample (1)", cases: { a: { us: 1, ratio: 2 } } },
      },
      {
        machine: B,
        sample: { source: "bench-sample.yml run 9, sample (2)", cases: { a: { us: 1, ratio: 3 } } },
      },
    ]);
  });

  it("reads a log with no bench step as no samples", () => {
    expect(entriesFromLog("job\tstep\t2026-10-11T06:00:00.0000000Z hello")).toEqual([]);
  });
});

describe("collect", () => {
  const old = {
    machines: {
      [A]: {
        recorded: "2026-10-09",
        notes: "hosted runner",
        cases: { a: { us: 1, ratio: 9 } },
        samples: [{ source: "ci.yml run 1", cases: { a: { us: 1, ratio: 9 } } }],
      },
    },
  };
  const found = [
    { machine: A, sample: { source: "s1", cases: { a: { us: 1, ratio: 2 } } } },
    { machine: A, sample: { source: "s2", cases: { a: { us: 1.2, ratio: 2.4 } } } },
    { machine: A, sample: { source: "s3", cases: { a: { us: 1.1, ratio: 2.2 } } } },
  ];

  it("adds the samples to the machine's entry and gates on the median", () => {
    const b = collect(old, found, { date: "2026-10-11" });
    expect(b.machines[A]?.samples?.map((s) => s.source)).toEqual([
      "ci.yml run 1",
      "s1",
      "s2",
      "s3",
    ]);
    expect(b.machines[A]?.cases).toEqual({ a: { us: 1.05, ratio: 2.3 } });
    expect(b.machines[A]?.notes).toBe("hosted runner");
  });

  it("with replace, drops the earlier samples of the machines it has new ones for", () => {
    const b = collect(old, found, { date: "2026-10-11", replace: true, notes: "re-recorded" });
    expect(b.machines[A]?.samples?.map((s) => s.source)).toEqual(["s1", "s2", "s3"]);
    expect(b.machines[A]?.cases).toEqual({ a: { us: 1.1, ratio: 2.2 } });
    expect(b.machines[A]?.notes).toBe("re-recorded");
    expect(b.machines[A]?.recorded).toBe("2026-10-11");
  });

  it("does not add a sample twice", () => {
    const once = collect(old, found, { date: "2026-10-11" });
    expect(collect(once, found, { date: "2026-10-11" })).toEqual(once);
  });

  it("creates an entry for a new machine and leaves the others alone", () => {
    const b = collect(
      old,
      [{ machine: B, sample: { source: "s", cases: { a: { us: 2, ratio: 4 } } } }],
      {
        date: "2026-10-11",
        notes: "new runner",
      },
    );
    expect(b.machines[A]).toEqual(old.machines[A]);
    expect(b.machines[B]?.cases).toEqual({ a: { us: 2, ratio: 4 } });
    expect(b.machines[B]?.notes).toBe("new runner");
  });
});
