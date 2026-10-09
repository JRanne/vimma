// Declarative e2e scenarios (spec m0-e2e-harness, "Scenario format"): one JSON file per
// scenario in tests/e2e/scenarios/, steps open / keys / wait-for-state / assert-state /
// screenshot. Names carry the milestone (m<N>-…) or, for regression tests, the issue (issue-<N>-…).
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * @typedef {{
 *   open?: string, keys?: string, "wait-for-state"?: Record<string, unknown>,
 *   "assert-state"?: Record<string, unknown>, screenshot?: string, timeoutSeconds?: number,
 * }} Step
 * @typedef {{
 *   name: string, description: string, issue?: number, pending?: string,
 *   timeoutSeconds?: number, steps: Step[],
 * }} Scenario
 * @typedef {{
 *   ctl: { state: () => Promise<any>, sendKeys: (keys: string) => Promise<void>,
 *     open: (url: string) => Promise<string> },
 *   screenshot: (name: string) => Promise<void>,
 *   pollMs?: number,
 *   signal?: AbortSignal,
 * }} StepContext
 */

export const STEP_KINDS = Object.freeze([
  "open",
  "keys",
  "wait-for-state",
  "assert-state",
  "screenshot",
]);
const FIELDS = new Set(["name", "description", "issue", "pending", "timeoutSeconds", "steps"]);
const MILESTONE_NAME = /^m\d+-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISSUE_NAME = /^issue-(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHOT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Default wait for `wait-for-state`, seconds. */
export const DEFAULT_WAIT_SECONDS = 10;

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** @param {unknown} v */
const positive = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * @param {unknown} s
 * @param {string | undefined} fileName checked against `name` when given
 * @returns {string[]} problems, empty when valid
 */
export function validateScenario(s, fileName) {
  /** @type {string[]} */
  const errors = [];
  if (!isObject(s)) return ["a scenario must be a JSON object"];
  for (const key of Object.keys(s)) {
    if (!FIELDS.has(key)) errors.push(`unknown field "${key}"`);
  }
  const name = s.name;
  if (typeof name !== "string" || !(MILESTONE_NAME.test(name) || ISSUE_NAME.test(name))) {
    errors.push(
      "name must be m<N>-<slug> or issue-<N>-<slug> (milestone happy path, regression test)",
    );
  } else {
    const issue = ISSUE_NAME.exec(name)?.[1];
    if (issue !== undefined && s.issue !== Number(issue)) {
      errors.push(`a regression test named ${name} must have "issue": ${issue}`);
    }
    if (fileName !== undefined && basename(fileName, ".json") !== name) {
      errors.push(`file name ${basename(fileName)} must be ${name}.json`);
    }
  }
  if (typeof s.description !== "string" || s.description.trim() === "") {
    errors.push("description must be a non-empty string");
  }
  if ("pending" in s && (typeof s.pending !== "string" || s.pending.trim() === "")) {
    errors.push("pending must be a non-empty string saying why the scenario cannot run yet");
  }
  if ("timeoutSeconds" in s && !positive(s.timeoutSeconds)) {
    errors.push("timeoutSeconds must be a positive number");
  }
  if (!Array.isArray(s.steps) || s.steps.length === 0) {
    errors.push("steps must be an array with at least one step");
    return errors;
  }
  s.steps.forEach((step, i) => {
    const at = `step ${i + 1}`;
    if (!isObject(step)) return void errors.push(`${at}: must be an object`);
    const kinds = Object.keys(step).filter((k) => k !== "timeoutSeconds");
    const kind = kinds[0];
    if (kinds.length !== 1 || kind === undefined || !STEP_KINDS.includes(kind)) {
      return void errors.push(`${at}: exactly one of ${STEP_KINDS.join(", ")}`);
    }
    const value = step[kind];
    if (kind === "open" && (typeof value !== "string" || value === "")) {
      errors.push(`${at}: open needs a URL string`);
    }
    if (kind === "keys" && (typeof value !== "string" || value.trim() === "")) {
      errors.push(`${at}: keys needs Herdr chords, e.g. "ctrl+b ?"`);
    }
    if ((kind === "wait-for-state" || kind === "assert-state") && !isObject(value)) {
      errors.push(`${at}: ${kind} needs an object to match against state`);
    }
    if (kind === "screenshot" && (typeof value !== "string" || !SHOT_NAME.test(value))) {
      errors.push(`${at}: screenshot needs a baseline name of [a-z0-9-]`);
    }
    if ("timeoutSeconds" in step && (kind !== "wait-for-state" || !positive(step.timeoutSeconds))) {
      errors.push(`${at}: timeoutSeconds is a positive number, on wait-for-state only`);
    }
  });
  return errors;
}

/**
 * Load every scenario in `dir` (sorted by name), optionally those whose name contains `filter`.
 * Any invalid file throws: a broken scenario must not silently drop out of the suite.
 * @param {string} dir
 * @param {{ filter?: string }} [options]
 * @returns {Scenario[]}
 */
export function loadScenarios(dir, { filter } = {}) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  /** @type {Scenario[]} */
  const all = [];
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      throw new Error(`${file}: ${/** @type {Error} */ (e).message}`, { cause: e });
    }
    const errors = validateScenario(parsed, file);
    if (errors.length) throw new Error(`${file}: ${errors.join("; ")}`);
    all.push(parsed);
  }
  const selected = filter ? all.filter((s) => s.name.includes(filter)) : all;
  if (filter && selected.length === 0) throw new Error(`no scenario matches "${filter}"`);
  return selected;
}

/**
 * Subset match of `expected` against `actual`: objects match when every expected key matches
 * (extra actual keys are ignored, as protocol v1 lets the server add fields); arrays need the
 * same length and element-wise matches; anything else must be equal.
 * @param {unknown} expected
 * @param {unknown} actual
 * @param {string} [path]
 * @returns {string[]} mismatches, empty when it matches
 */
export function matchState(expected, actual, path = "state") {
  const show = (/** @type {unknown} */ v) => (v === undefined ? "undefined" : JSON.stringify(v));
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected an array, got ${show(actual)}`];
    if (actual.length !== expected.length) {
      return [`${path}: expected ${expected.length} item(s), got ${actual.length}`];
    }
    return expected.flatMap((e, i) => matchState(e, actual[i], `${path}[${i}]`));
  }
  if (isObject(expected)) {
    if (!isObject(actual)) return [`${path}: expected ${show(expected)}, got ${show(actual)}`];
    return Object.entries(expected).flatMap(([k, v]) => matchState(v, actual[k], `${path}.${k}`));
  }
  return Object.is(expected, actual)
    ? []
    : [`${path}: expected ${show(expected)}, got ${show(actual)}`];
}

/** @param {AbortSignal | undefined} signal */
function checkAborted(signal) {
  if (signal?.aborted) throw new Error("aborted (scenario timeout)");
}

/**
 * Run a scenario's steps against a session. Throws on the first failing step, naming it.
 * @param {Scenario} scenario
 * @param {StepContext} context
 */
export async function runSteps(scenario, { ctl, screenshot, pollMs = 100, signal }) {
  for (const [i, step] of scenario.steps.entries()) {
    const kind = /** @type {string} */ (Object.keys(step).find((k) => k !== "timeoutSeconds"));
    const at = `step ${i + 1} (${kind})`;
    checkAborted(signal);
    try {
      if (step.open !== undefined) await ctl.open(step.open);
      else if (step.keys !== undefined) await ctl.sendKeys(step.keys);
      else if (step.screenshot !== undefined) await screenshot(step.screenshot);
      else if (step["assert-state"] !== undefined) {
        const mismatches = matchState(step["assert-state"], await ctl.state());
        if (mismatches.length) throw new Error(mismatches.join("; "));
      } else if (step["wait-for-state"] !== undefined) {
        const seconds = step.timeoutSeconds ?? DEFAULT_WAIT_SECONDS;
        const deadline = Date.now() + seconds * 1000;
        for (;;) {
          const mismatches = matchState(step["wait-for-state"], await ctl.state());
          if (mismatches.length === 0) break;
          if (Date.now() >= deadline) {
            throw new Error(`not reached in ${seconds} s: ${mismatches.join("; ")}`);
          }
          await sleep(pollMs);
          checkAborted(signal);
        }
      }
    } catch (e) {
      throw new Error(`${at}: ${/** @type {Error} */ (e).message}`, { cause: e });
    }
  }
}
