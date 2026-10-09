#!/usr/bin/env node
/**
 * Key-to-action bench for vimma-core (spec ci-quality-gates, plan §5 "Performance", issue #17).
 * Measures each case in packages/vimma-core/bench/cases.mjs and a fixed reference workload, then
 * optionally gates the result against baseline.json (tools/bench/compare.mjs).
 *
 * Measurement, chosen so one CI run gives a stable number without retries:
 *   - warm-up: each case runs for WARMUP_MS first, so the JIT has optimised it;
 *   - a sample times a batch of runs lasting at least SAMPLE_NS (timer resolution is irrelevant),
 *     then a batch of the fixed reference workload, and records ns per run and their ratio; the
 *     ratio cancels the runner's speed, including frequency changes during the run;
 *   - a round takes SAMPLES samples of every case, in an order that rotates per round, and keeps
 *     their medians; noise from GC or a neighbour on the runner lands in some rounds, not all;
 *   - per case: µs is the minimum of the round medians (noise only adds time), checked against
 *     the 50 µs budget; the ratio is the median of the round medians, gated against baseline.json.
 *
 * Usage: node tools/bench/bench.mjs [--json out.json] [--check [baseline.json]]
 *                                   [--record "machine notes" [baseline.json]]
 *   --check  exit 1 on a regression over 10 % or a case over 50 µs (compare.mjs)
 *   --record write this machine's numbers into the baseline (deliberate; see docs/runbook.md)
 */
import { spawnSync } from "node:child_process";
import { cpus } from "node:os";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CASES, reference } from "../../packages/vimma-core/bench/cases.mjs";
import {
  DEFAULT_BASELINE,
  baselineEntry,
  combine,
  compare,
  formatTable,
  githubAnnotations,
  median,
  minOfMedians,
  withBaselineEntry,
} from "./compare.mjs";

const WARMUP_MS = 200;
const SAMPLE_NS = 100_000;
const SAMPLES = 51;
const ROUNDS = 5;
// Fresh processes per run; the result keeps the lowest of each (compare.mjs, combine()).
const PROCESSES = 15;

/** @type {unknown} */
let sink;

/**
 * One key per runner class: CPU model, arch and the exact Node version (pinned in .nvmrc), since
 * a V8 update can move these numbers. A Node bump finds no entry, falls back to the same Node
 * major's (compare.mjs) with a warning, and its PR records the new key.
 */
export function machineKey() {
  const model = (cpus()[0]?.model ?? "unknown cpu").replace(/\s+/g, " ").trim();
  return `${model} | ${process.arch} | node ${process.versions.node}`;
}

/**
 * A timing loop of its own per case: one shared loop would see every case's `run` at the same
 * call site, go megamorphic, and make each case's number depend on which cases ran before it.
 * @param {() => unknown} run
 * @returns {(n: number) => number} ns for n runs
 */
function timer(run) {
  const loop = new Function(
    "run",
    "hrtime",
    "keep",
    `return function time(n) {
      let last;
      const t0 = hrtime();
      for (let i = 0; i < n; i++) last = run();
      const t1 = hrtime();
      keep(last);
      return Number(t1 - t0);
    };`,
  );
  return loop(run, process.hrtime.bigint, (/** @type {unknown} */ v) => {
    sink = v;
  });
}

/** @param {(n: number) => number} time */
function calibrate(time) {
  const until = performance.now() + WARMUP_MS;
  while (performance.now() < until) time(100);
  let batch = 1;
  while (time(batch) < SAMPLE_NS) batch *= 2;
  return batch;
}

/**
 * Each sample times a batch of the case and, right after it, a batch of the reference workload;
 * their quotient is that sample's ratio. The two batches run within a fraction of a millisecond,
 * so a change in CPU frequency or a busy neighbour hits both and cancels out of the ratio.
 * @param {{ name: string, run: () => unknown }[]} cases
 * @param {() => unknown} ref
 * @returns {{ referenceUs: number, cases: Map<string, import("./compare.mjs").CaseResult> }}
 */
export function measure(cases, ref) {
  const refTime = timer(ref);
  const refBatch = calibrate(refTime);
  const timers = cases.map((c) => timer(c.run));
  const batches = timers.map(calibrate);
  /** @type {number[][][]} */
  const us = cases.map(() => []);
  /** @type {number[][][]} */
  const ratios = cases.map(() => []);
  /** @type {number[][]} */
  const refUs = [];
  for (let r = 0; r < ROUNDS; r++) {
    /** @type {number[]} */
    const refRound = [];
    for (let k = 0; k < cases.length; k++) {
      const i = (k + r) % cases.length;
      const time = /** @type {(n: number) => number} */ (timers[i]);
      const batch = /** @type {number} */ (batches[i]);
      /** @type {number[]} */
      const t = [];
      /** @type {number[]} */
      const q = [];
      for (let s = 0; s < SAMPLES; s++) {
        const caseNs = time(batch) / batch;
        const refNs = refTime(refBatch) / refBatch;
        t.push(caseNs / 1000);
        q.push(caseNs / refNs);
        refRound.push(refNs / 1000);
      }
      us[i]?.push(t);
      ratios[i]?.push(q);
    }
    refUs.push(refRound);
  }
  return {
    referenceUs: minOfMedians(refUs),
    cases: new Map(
      cases.map((c, i) => [
        c.name,
        {
          // the budget: the quietest round, since noise only adds time
          us: minOfMedians(us[i] ?? []),
          // the regression gate: the typical round, since noise can move a ratio either way
          ratio: median((ratios[i] ?? []).map(median)),
        },
      ]),
    ),
  };
}

/** @returns {import("./compare.mjs").Result} */
export function run() {
  const { referenceUs, cases } = measure(CASES, reference);
  return { machine: machineKey(), referenceUs, cases: Object.fromEntries(cases) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  /** @param {string} flag */
  const valueOf = (flag) => {
    const i = args.indexOf(flag);
    const v = i < 0 ? undefined : args[i + 1];
    return v && !v.startsWith("--") ? v : undefined;
  };
  for (const c of CASES) {
    if (JSON.stringify(c.run()) !== JSON.stringify(c.expected)) {
      console.error(`bench: "${c.name}" does not produce ${JSON.stringify(c.expected)}`);
      process.exit(2);
    }
  }
  if (args.includes("--child")) {
    const result = run();
    if (sink === undefined) process.exit(2); // keeps `sink` observable: no run is optimised away
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  }
  /** @type {import("./compare.mjs").Result[]} */
  const results = [];
  for (let p = 0; p < PROCESSES; p++) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child"], {
      encoding: "utf8",
    });
    if (child.status !== 0) {
      console.error(`bench: process ${p + 1} failed\n${child.stderr}`);
      process.exit(2);
    }
    results.push(JSON.parse(child.stdout));
  }
  const result = combine(results);
  const date = new Date().toISOString().slice(0, 10);
  const source = process.env.GITHUB_RUN_ID
    ? `ci.yml run ${process.env.GITHUB_RUN_ID}`
    : `local, ${date}`;
  const json = valueOf("--json");
  if (json) writeFileSync(json, `${JSON.stringify(result, null, 2)}\n`);

  if (args.includes("--record")) {
    const notes = valueOf("--record");
    if (!notes) {
      console.error('bench: --record needs machine notes, e.g. --record "ubuntu-24.04 runner"');
      process.exit(2);
    }
    const path = args[args.indexOf("--record") + 2] ?? DEFAULT_BASELINE;
    const before = JSON.parse(readFileSync(path, "utf8"));
    const entry = baselineEntry(result, { date, notes, source }, before.machines[result.machine]);
    writeFileSync(
      path,
      `${JSON.stringify(withBaselineEntry(before, result.machine, entry), null, 2)}\n`,
    );
    console.log(`bench: recorded "${result.machine}" in ${path} (${entry.samples.length} samples)`);
  }

  const baselinePath = valueOf("--check") ?? DEFAULT_BASELINE;
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const r = compare(result, baseline);
  console.log(`machine: ${result.machine} (reference ${result.referenceUs.toFixed(3)} µs)`);
  console.log(formatTable(r));
  for (const note of r.notes) console.log(`note: ${note}`);
  for (const warning of r.warnings) console.log(`warning: ${warning}`);
  if (process.env.GITHUB_ACTIONS === "true") {
    const { log, summary } = githubAnnotations(r.warnings);
    for (const line of log) console.log(line);
    if (summary && process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    }
  }
  // What `--record` would write, for a runner where recording in place is not possible (CI):
  // a new entry, or this run as one more sample of the existing one (docs/runbook.md).
  const own = baseline.machines[result.machine];
  const notes = own?.notes ?? "<runner, image, why recorded>";
  const entry = baselineEntry(result, { date, notes, source }, own);
  console.log(`baseline entry:\n${JSON.stringify({ [result.machine]: entry }, null, 2)}`);
  if (args.includes("--check")) {
    for (const failure of r.failures) console.error(failure);
    process.exit(r.ok ? 0 : 1);
  }
}
