#!/usr/bin/env node
/**
 * Adds the samples of CI bench runs to the baseline (docs/runbook.md, "Bench baseline"). Every
 * bench step prints a `baseline entry:` whose last sample is that run; this reads them from
 * `gh run view --log` output, one per job, and adds each to its machine's entry, whose gated
 * `cases` are then the per-case median of all its samples.
 *
 * Usage: gh run view <id> --log | node tools/bench/collect.mjs [--replace] [--notes "<notes>"]
 *                                                              [baseline.json]
 *   --replace  drop the earlier samples of each machine the log has samples for (re-recording)
 *   --notes    the entry's notes (default: the entry's own, or a placeholder for a new machine)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_BASELINE, baselineEntry } from "./compare.mjs";

/** @typedef {import("./compare.mjs").Sample} Sample */
/** @typedef {import("./compare.mjs").Baseline} Baseline */
/** @typedef {{ machine: string, sample: Sample }} Found */

/** A `gh run view --log` line: job, step, then a timestamp and the line itself. */
const LOG_LINE = /^([^\t]*)\t[^\t]*\t\S+Z (.*)$/;

/**
 * The newest sample of each `baseline entry:` in a run's log. Its source gets the job's name, as
 * one run can have several bench jobs.
 * @param {string} log
 * @returns {Found[]}
 */
export function entriesFromLog(log) {
  /** @type {Map<string, string[]>} */
  const byJob = new Map();
  for (const raw of log.split("\n")) {
    const m = LOG_LINE.exec(raw);
    if (!m) continue;
    const [, job = "", line = ""] = m;
    byJob.set(job, [...(byJob.get(job) ?? []), line]);
  }
  /** @type {Found[]} */
  const found = [];
  for (const [job, lines] of byJob) {
    let start = lines.indexOf("baseline entry:");
    while (start >= 0) {
      let text = "";
      for (let i = start + 1; i < lines.length; i++) {
        text += `${lines[i]}\n`;
        if (lines[i] !== "}") continue;
        /** @type {Record<string, { samples: Sample[] }>} */
        const entry = JSON.parse(text);
        for (const [machine, { samples }] of Object.entries(entry)) {
          const last = samples[samples.length - 1];
          if (last) found.push({ machine, sample: { ...last, source: `${last.source}, ${job}` } });
        }
        break;
      }
      start = lines.indexOf("baseline entry:", start + 1);
    }
  }
  return found;
}

/**
 * The baseline with the found samples added (or, with `replace`, instead of the machine's earlier
 * ones). A sample whose source the entry already has is skipped.
 * @param {Baseline} baseline
 * @param {Found[]} found
 * @param {{ date: string, replace?: boolean, notes?: string }} opts
 * @returns {Baseline}
 */
export function collect(baseline, found, { date, replace = false, notes }) {
  const machines = { ...baseline.machines };
  const fresh = new Set();
  for (const { machine, sample } of found) {
    const before = machines[machine];
    const previous = replace && !fresh.has(machine) && before ? { ...before, samples: [] } : before;
    fresh.add(machine);
    if (previous?.samples?.some((s) => s.source === sample.source)) continue;
    machines[machine] = baselineEntry(
      { machine, referenceUs: 0, cases: sample.cases },
      {
        date,
        notes: notes ?? previous?.notes ?? "<runner, image, why recorded>",
        source: sample.source,
      },
      previous,
    );
  }
  return { ...baseline, machines };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const notesAt = args.indexOf("--notes");
  const notes = notesAt >= 0 ? args[notesAt + 1] : undefined;
  const positional = args.filter(
    (a, i) => !a.startsWith("--") && (notesAt < 0 || i !== notesAt + 1),
  );
  const path = positional[0] ?? DEFAULT_BASELINE;
  const found = entriesFromLog(readFileSync(0, "utf8"));
  if (found.length === 0) {
    console.error("bench collect: no `baseline entry:` in the log on stdin");
    process.exit(2);
  }
  const before = JSON.parse(readFileSync(path, "utf8"));
  const date = new Date().toISOString().slice(0, 10);
  const after = collect(before, found, { date, replace: args.includes("--replace"), notes });
  writeFileSync(path, `${JSON.stringify(after, null, 2)}\n`);
  for (const { machine, sample } of found)
    console.log(`bench collect: ${machine} ← ${sample.source}`);
}
