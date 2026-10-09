#!/usr/bin/env node
/**
 * Bench regression gate (spec ci-quality-gates, plan §5 "Performance", issue #17). Compares a run
 * of tools/bench/bench.mjs with packages/vimma-core/bench/baseline.json. It fails when
 *   - any case takes BUDGET_US or more (plan: key-to-action in core < 50 µs), on any machine;
 *   - on a machine the baseline has recorded: the geometric mean of the cases' changes is more
 *     than THRESHOLD (10 %) above the baseline, or one case is more than CASE_THRESHOLD (25 %)
 *     above it, or a baseline case was not measured. A change is the case's ratio (its time over
 *     the reference workload's, sampled in pairs) against the baseline's ratio.
 * A machine with no entry of its own is compared with the most demanding entry of the same arch
 * and Node major, with FALLBACK_MARGIN added to both limits, and gets a warning naming that entry.
 * With no such entry only the budget applies, also with a warning. Never silently: see
 * docs/runbook.md "Bench baseline" for why and how to record a machine. Usage:
 *   node tools/bench/compare.mjs result.json [baseline.json]
 * Exit 0 within the gate, 1 on a regression or budget breach, 2 on bad input.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const BUDGET_US = 50;
/** Plan §5: a regression over 10 % fails, measured on the suite (geometric mean of the cases). */
export const THRESHOLD = 0.1;
/**
 * One case alone fails only past 25 %: a single sub-microsecond case moves up to ~15 % between
 * fresh runs on a quiet machine, the suite's mean about a third of that (docs/runbook.md).
 */
export const CASE_THRESHOLD = 0.25;
/**
 * Added to both limits when comparing with another CPU model's entry: the two recorded hosted
 * runner CPUs (Intel Xeon 8573C, AMD EPYC 9V74) differ by up to 5.5 % per case in their ratios.
 */
export const FALLBACK_MARGIN = 0.06;
/** Floating-point slack, so a change of exactly the limit passes. */
const EPSILON = 1e-9;
export const DEFAULT_BASELINE = fileURLToPath(
  new URL("../../packages/vimma-core/bench/baseline.json", import.meta.url),
);

/**
 * @typedef {{ us: number, ratio: number }} CaseResult µs per key-to-action, and that over the
 *   reference workload's µs (min of per-round medians, both)
 * @typedef {{ machine: string, referenceUs: number, cases: Record<string, CaseResult> }} Result
 * @typedef {{ source: string, cases: Record<string, CaseResult> }} Sample one recording run
 * @typedef {{ recorded: string, notes: string, cases: Record<string, CaseResult>,
 *   samples?: Sample[] }} MachineEntry
 * @typedef {{ $comment?: string, machines: Record<string, MachineEntry> }} Baseline
 * @typedef {{ name: string, us: number, ratio: number, base: number | null,
 *   change: number | null }} Row
 */

/** @param {number[]} xs */
export function median(xs) {
  if (xs.length === 0) throw new RangeError("median of an empty sample");
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? /** @type {number} */ (s[mid]) : (Number(s[mid - 1]) + Number(s[mid])) / 2;
}

/**
 * Noise on a shared machine only ever adds time, so the quietest round is the best estimate.
 * @param {number[][]} rounds samples per round
 */
export function minOfMedians(rounds) {
  return Math.min(...rounds.map(median));
}

/**
 * One result from several bench processes. A sub-microsecond case lands in one of a few JIT
 * "modes" per process (inlining, code layout), 20-30 % apart; the lowest over several fresh
 * processes is the fast mode, which a fresh run finds again.
 * @param {Result[]} results
 * @returns {Result & { processes: number }}
 */
export function combine(results) {
  const [first] = results;
  if (!first) throw new RangeError("combine: no results");
  const names = Object.keys(first.cases).sort().join("\n");
  /** @type {Record<string, CaseResult>} */
  const cases = {};
  for (const r of results) {
    if (r.machine !== first.machine) throw new Error("combine: results from another machine");
    if (Object.keys(r.cases).sort().join("\n") !== names) {
      throw new Error("combine: results with different cases");
    }
    for (const [name, c] of Object.entries(r.cases)) {
      const best = cases[name];
      cases[name] = best
        ? { us: Math.min(best.us, c.us), ratio: Math.min(best.ratio, c.ratio) }
        : { ...c };
    }
  }
  return {
    machine: first.machine,
    referenceUs: Math.min(...results.map((r) => r.referenceUs)),
    processes: results.length,
    cases,
  };
}

/** @param {number} x */
const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} %`;

/**
 * @param {Result} result
 * @param {Baseline} baseline
 * @param {{ threshold?: number, caseThreshold?: number, budgetUs?: number }} [opts]
 */
export function compare(
  result,
  baseline,
  { threshold = THRESHOLD, caseThreshold = CASE_THRESHOLD, budgetUs = BUDGET_US } = {},
) {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {Row[]} */
  const rows = [];
  const own = baseline.machines[result.machine];
  const fallback = own ? null : nearestEntry(baseline, result.machine);
  const entry = own ?? (fallback ? baseline.machines[fallback] : undefined);
  if (fallback) {
    threshold += FALLBACK_MARGIN;
    caseThreshold += FALLBACK_MARGIN;
    warnings.push(
      `no baseline for machine "${result.machine}"; compared with "${fallback}" (same arch and ` +
        `Node major) with limits widened to ${pct(threshold)} suite, ${pct(caseThreshold)} per ` +
        `case. Record this machine: docs/runbook.md, "Bench baseline"`,
    );
  } else if (!own) {
    warnings.push(
      `no baseline for machine "${result.machine}" nor for its arch and Node major: only the ` +
        `${budgetUs} µs budget applies. Record this machine: docs/runbook.md, "Bench baseline"`,
    );
  }
  let logSum = 0;
  let compared = 0;
  for (const [name, { us, ratio }] of Object.entries(result.cases)) {
    if (us >= budgetUs) {
      failures.push(`${name}: ${us.toFixed(2)} µs is not under the ${budgetUs} µs budget`);
    }
    const base = entry?.cases[name]?.ratio ?? null;
    const change = base === null ? null : ratio / base - 1;
    rows.push({ name, us, ratio, base, change });
    if (!entry) continue;
    if (change === null) {
      notes.push(`${name}: no baseline for this case yet`);
      continue;
    }
    logSum += Math.log1p(change);
    compared++;
    const vs = `against the baseline (ratio ${ratio.toFixed(3)} vs ${Number(base).toFixed(3)})`;
    if (change > caseThreshold + EPSILON) {
      failures.push(`${name}: ${pct(change)} ${vs}, over the ${pct(caseThreshold)} limit`);
    } else if (change > threshold + EPSILON) {
      notes.push(`${name}: ${pct(change)} ${vs}; the suite gate decides`);
    }
  }
  const suiteChange = compared ? Math.expm1(logSum / compared) : null;
  if (suiteChange !== null && suiteChange > threshold + EPSILON) {
    failures.unshift(
      `suite: ${pct(suiteChange)} against the baseline (geometric mean over ${compared} cases), ` +
        `over the ${pct(threshold)} limit`,
    );
  }
  for (const name of Object.keys(own?.cases ?? {})) {
    if (!(name in result.cases)) {
      failures.push(`${name}: in the baseline but not measured; remove it from the baseline`);
    }
  }
  return { ok: failures.length === 0, failures, notes, warnings, rows, suiteChange, fallback };
}

/** @param {string} machine `CPU model | arch | node X.Y.Z` */
function archAndNodeMajor(machine) {
  const [, arch, node] = machine.split(" | ");
  const major = /^node (\d+)/.exec(node ?? "")?.[1];
  return arch && major ? `${arch} | ${major}` : null;
}

/**
 * The entry to compare an unrecorded machine with: same arch and Node major, and of those the
 * most demanding one (lowest geometric mean of its ratios), so a fallback never hides a
 * regression behind a slower CPU's numbers.
 * @param {Baseline} baseline
 * @param {string} machine
 */
function nearestEntry(baseline, machine) {
  const want = archAndNodeMajor(machine);
  if (!want) return null;
  /** @type {string | null} */
  let best = null;
  let bestScore = Infinity;
  for (const [key, entry] of Object.entries(baseline.machines).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const ratios = Object.values(entry.cases).map((c) => c.ratio);
    if (archAndNodeMajor(key) !== want || !ratios.length) continue;
    const score = ratios.reduce((s, r) => s + Math.log(r), 0) / ratios.length;
    if (score < bestScore) [best, bestScore] = [key, score];
  }
  return best;
}

/**
 * GitHub Actions output for the warnings: `::warning::` lines for the log and annotations, and
 * lines for the job's step summary, so a fallback or an unchecked run is never silent.
 * @param {string[]} warnings
 */
export function githubAnnotations(warnings) {
  return {
    log: warnings.map((w) => `::warning title=bench baseline::${w}`),
    summary: warnings.map((w) => `- ⚠️ bench: ${w}\n`).join(""),
  };
}

/** @param {number} x */
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * A baseline entry from one run, or `previous` with this run added as another sample. The gated
 * numbers (`cases`) are each case's median over the samples, so one unlucky recording run does
 * not set the bar.
 * @param {Result} result
 * @param {{ date: string, notes: string, source: string }} meta
 * @param {MachineEntry} [previous]
 * @returns {MachineEntry & { samples: Sample[] }}
 */
export function baselineEntry(result, { date, notes, source }, previous) {
  /** @type {Record<string, CaseResult>} */
  const measured = {};
  for (const [name, c] of Object.entries(result.cases)) {
    measured[name] = { us: round3(c.us), ratio: round3(c.ratio) };
  }
  const samples = [...(previous?.samples ?? []), { source, cases: measured }];
  /** @type {Record<string, CaseResult>} */
  const cases = {};
  for (const name of Object.keys(measured)) {
    const of = samples.map((s) => s.cases[name]).filter((c) => c !== undefined);
    cases[name] = {
      us: round3(median(of.map((c) => c.us))),
      ratio: round3(median(of.map((c) => c.ratio))),
    };
  }
  return { recorded: date, notes, cases, samples };
}

/**
 * @param {Baseline} baseline
 * @param {string} machine
 * @param {MachineEntry} entry
 * @returns {Baseline}
 */
export function withBaselineEntry(baseline, machine, entry) {
  return { ...baseline, machines: { ...baseline.machines, [machine]: entry } };
}

/** @param {ReturnType<typeof compare>} r */
export function formatTable(r) {
  const width = Math.max(4, ...r.rows.map((row) => row.name.length));
  const lines = [`${"case".padEnd(width)}  ${"µs".padStart(8)}  ratio  baseline  change`];
  for (const { name, us, ratio, base, change } of r.rows) {
    lines.push(
      `${name.padEnd(width)}  ${`${us.toFixed(2)} µs`.padStart(8)}  ${ratio.toFixed(3)}  ` +
        `${base === null ? "—".padStart(8) : base.toFixed(3).padStart(8)}  ` +
        `${change === null ? "—" : pct(change)}`,
    );
  }
  if (r.suiteChange !== null) {
    lines.push(`suite (geometric mean of the changes): ${pct(r.suiteChange)}`);
  }
  return lines.join("\n");
}

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [resultPath, baselinePath = DEFAULT_BASELINE] = process.argv.slice(2);
  let result, baseline;
  try {
    if (!resultPath) throw new Error("usage: compare.mjs result.json [baseline.json]");
    result = readJson(resultPath);
    baseline = readJson(baselinePath);
  } catch (e) {
    console.error(`bench compare: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  const r = compare(result, baseline);
  console.log(`machine: ${result.machine}\n${formatTable(r)}`);
  for (const note of r.notes) console.log(`note: ${note}`);
  for (const warning of r.warnings) console.log(`warning: ${warning}`);
  for (const failure of r.failures) console.error(failure);
  process.exit(r.ok ? 0 : 1);
}
