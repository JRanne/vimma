// Declarative e2e scenarios (spec m0-e2e-harness, "Scenario format"): one JSON file per
// scenario in tests/e2e/scenarios/, steps open / keys / wait-for-state / assert-state /
// screenshot / restart, and optional `prefs` overriding the harness profile's. For the agent
// question line (docs/specs/vimma-mcp.md, sub-PR 2b): `hold` keeps one full connection for the
// rest of the scenario (opened while MCP is off, so later keys never ask), `agent` sends an
// agent request without waiting and `agent-result` checks its answer, `ctl` runs vimma-ctl
// without waiting (a new full connection, which asks while MCP is on) and `ctl-result` checks
// how it ended, and `sleep` waits for a time-based rule (the 1.5 s quiet, the 1 s arming). For
// `vimma-ctl mcp` (sub-PR 3): `mcp` sends one JSON-RPC message to it over stdio (a request when
// it names its answer with `as`, else a notification) and `mcp-result` checks the response.
// Names carry the milestone (m<N>-…) or, for regression tests, the issue (issue-<N>-…).
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * @typedef {{
 *   open?: string, keys?: string, "wait-for-state"?: Record<string, unknown>,
 *   "assert-state"?: Record<string, unknown>, screenshot?: string, restart?: "quit" | "kill",
 *   timeoutSeconds?: number, hold?: true, sleep?: number, agent?: AgentSend,
 *   "agent-result"?: { of: string, expect: unknown }, ctl?: { run: string[], as: string },
 *   "ctl-result"?: { of: string, expect: unknown }, mcp?: McpSend,
 *   "mcp-result"?: { of: string, expect: unknown },
 * }} Step
 * @typedef {{ method: string, params?: Record<string, unknown>, as?: string }} McpSend
 * @typedef {{ send: string, args?: Record<string, unknown>, as: string, client?: string }}
 *   AgentSend
 * @typedef {{
 *   hold: () => Promise<void>,
 *   held: { state: () => Promise<any>, sendKeys: (keys: string) => Promise<void>,
 *     open: (url: string) => Promise<string> },
 *   agentSend: (spec: AgentSend) => void,
 *   agentResult: (name: string) => Promise<unknown>,
 *   ctlSpawn: (args: string[], as: string) => void,
 *   ctlResult: (name: string) => Promise<{ exitCode: number | null, stderr: string }>,
 *   mcpSend: (spec: McpSend) => void,
 *   mcpResult: (name: string) => Promise<unknown>,
 * }} Control
 * @typedef {{
 *   name: string, description: string, issue?: number, pending?: string,
 *   timeoutSeconds?: number, prefs?: Record<string, boolean | number | string | null>,
 *   steps: Step[],
 * }} Scenario
 * @typedef {{
 *   ctl: { state: () => Promise<any>, sendKeys: (keys: string) => Promise<void>,
 *     open: (url: string) => Promise<string> },
 *   screenshot: (name: string) => Promise<void>,
 *   restart?: (how: "quit" | "kill") => Promise<void>,
 *   control?: Control,
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
  "restart",
  "hold",
  "sleep",
  "agent",
  "agent-result",
  "ctl",
  "ctl-result",
  "mcp",
  "mcp-result",
]);
/** The agent commands an `agent` step may send (control protocol 2). */
const AGENT_SENDS = ["agent-tabs", "agent-read", "agent-open", "agent-close", "agent-ping"];
const AGENT_FIELDS = new Set(["send", "args", "as", "client"]);
const MCP_FIELDS = new Set(["method", "params", "as"]);
const RESULT_NAME = /^[a-z0-9]+$/;
/** The longest `sleep`, seconds: a wait for a rule's time, not a flake's. */
const MAX_SLEEP_SECONDS = 30;
const FIELDS = new Set([
  "name",
  "description",
  "issue",
  "pending",
  "timeoutSeconds",
  "prefs",
  "steps",
]);
const PREF_NAME = /^[\w.-]+$/;
/**
 * How `restart` restarts: `quit` is ctrl+q, then a launch on the same profile; `kill` waits for
 * SessionStore's recovery file to settle, SIGKILLs the browser process (a crash: no quit
 * observers, no final session write), then launches on the same profile.
 */
const RESTARTS = ["quit", "kill"];
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
  if ("prefs" in s) {
    if (!isObject(s.prefs)) {
      errors.push("prefs must be an object of pref name to value (null: the build's default)");
    } else {
      for (const [name, value] of Object.entries(s.prefs)) {
        const ok = value === null || ["boolean", "number", "string"].includes(typeof value);
        if (!PREF_NAME.test(name) || !ok) {
          errors.push(
            `prefs: "${name}" must be a pref name with a boolean, number, string or null`,
          );
        }
      }
    }
  }
  if (!Array.isArray(s.steps) || s.steps.length === 0) {
    errors.push("steps must be an array with at least one step");
    return errors;
  }
  /** @type {Set<string>} */
  const agentNames = new Set();
  /** @type {Set<string>} */
  const ctlNames = new Set();
  /** @type {Set<string>} */
  const mcpNames = new Set();
  /** Agent and mcp answers share one namespace for `$name.path`. @param {string} n */
  const answerTaken = (n) => agentNames.has(n) || mcpNames.has(n);
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
    if (kind === "restart" && !RESTARTS.includes(/** @type {string} */ (value))) {
      errors.push(`${at}: restart is one of ${RESTARTS.join(", ")}`);
    }
    if (kind === "hold" && value !== true) errors.push(`${at}: hold is true`);
    if (
      kind === "sleep" &&
      (!positive(value) || /** @type {number} */ (value) > MAX_SLEEP_SECONDS)
    ) {
      errors.push(
        `${at}: sleep is a number of seconds, more than 0 and at most ${MAX_SLEEP_SECONDS}`,
      );
    }
    if (kind === "agent") {
      if (!isObject(value)) {
        errors.push(`${at}: agent needs { send, args?, as }`);
      } else {
        const extra = Object.keys(value).filter((k) => !AGENT_FIELDS.has(k));
        if (extra.length) errors.push(`${at}: agent: unknown field(s) ${extra.join(", ")}`);
        if (!AGENT_SENDS.includes(/** @type {string} */ (value.send))) {
          errors.push(`${at}: agent: send is an agent command (${AGENT_SENDS.join(", ")})`);
        }
        if ("args" in value && !isObject(value.args))
          errors.push(`${at}: agent: args is an object`);
        if (typeof value.as !== "string" || !RESULT_NAME.test(value.as)) {
          errors.push(`${at}: agent: as names the answer ([a-z0-9]+)`);
        } else if (answerTaken(value.as)) {
          errors.push(`${at}: agent: "${value.as}" is taken`);
        } else {
          agentNames.add(value.as);
        }
      }
    }
    if (kind === "mcp") {
      if (!isObject(value)) {
        errors.push(`${at}: mcp needs { method, params?, as? }`);
      } else {
        const extra = Object.keys(value).filter((k) => !MCP_FIELDS.has(k));
        if (extra.length) errors.push(`${at}: mcp: unknown field(s) ${extra.join(", ")}`);
        if (typeof value.method !== "string" || value.method === "") {
          errors.push(`${at}: mcp: method is a string`);
        }
        if ("params" in value && !isObject(value.params)) {
          errors.push(`${at}: mcp: params is an object`);
        }
        if ("as" in value) {
          if (typeof value.as !== "string" || !RESULT_NAME.test(value.as)) {
            errors.push(`${at}: mcp: as names the answer ([a-z0-9]+)`);
          } else if (answerTaken(value.as)) {
            errors.push(`${at}: mcp: "${value.as}" is taken`);
          } else {
            mcpNames.add(value.as);
          }
        }
      }
    }
    if (kind === "ctl") {
      const ok =
        isObject(value) &&
        Array.isArray(value.run) &&
        value.run.length > 0 &&
        value.run.every((a) => typeof a === "string");
      if (!ok) errors.push(`${at}: ctl: run is vimma-ctl's arguments, as a non-empty array`);
      else if (typeof value.as !== "string" || !RESULT_NAME.test(value.as)) {
        errors.push(`${at}: ctl: as names the run ([a-z0-9]+)`);
      } else if (ctlNames.has(value.as)) {
        errors.push(`${at}: ctl: "${value.as}" is taken`);
      } else {
        ctlNames.add(value.as);
      }
    }
    for (const [k, names, what] of /** @type {const} */ ([
      ["agent-result", agentNames, "agent"],
      ["ctl-result", ctlNames, "ctl"],
      ["mcp-result", mcpNames, "mcp"],
    ])) {
      if (kind !== k) continue;
      if (!isObject(value) || typeof value.of !== "string" || !("expect" in value)) {
        errors.push(`${at}: ${k} needs { of, expect }`);
      } else if (!names.has(value.of)) {
        errors.push(`${at}: ${k}: no ${what} step before it is named "${value.of}"`);
      }
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
export async function runSteps(
  scenario,
  { ctl: own, screenshot, restart, control, pollMs = 100, signal },
) {
  /** Agent answers so far, for `$name.path` in later args. @type {Record<string, unknown>} */
  const answers = {};
  let ctl = own;
  /** @param {string} what */
  const needControl = (what) => {
    if (!control) throw new Error(`this session cannot run ${what} steps`);
    return control;
  };
  for (const [i, step] of scenario.steps.entries()) {
    const kind = /** @type {string} */ (Object.keys(step).find((k) => k !== "timeoutSeconds"));
    const at = `step ${i + 1} (${kind})`;
    checkAborted(signal);
    try {
      if (step.hold !== undefined) {
        const c = needControl("hold");
        await c.hold();
        ctl = c.held;
      } else if (step.sleep !== undefined) {
        await sleep(step.sleep * 1000, undefined, signal ? { signal } : undefined);
      } else if (step.agent !== undefined) {
        const args = substitute(step.agent.args ?? {}, answers);
        needControl("agent").agentSend({ ...step.agent, args });
      } else if (step["agent-result"] !== undefined) {
        const { of, expect } = step["agent-result"];
        const answer = await needControl("agent-result").agentResult(of);
        answers[of] = answer;
        const mismatches = matchState(expect, answer, of);
        if (mismatches.length) throw new Error(mismatches.join("; "));
      } else if (step.mcp !== undefined) {
        const params = step.mcp.params && substitute(step.mcp.params, answers);
        needControl("mcp").mcpSend({ ...step.mcp, ...(params ? { params } : {}) });
      } else if (step["mcp-result"] !== undefined) {
        const { of, expect } = step["mcp-result"];
        const answer = await needControl("mcp-result").mcpResult(of);
        answers[of] = answer;
        const mismatches = matchState(expect, answer, of);
        if (mismatches.length) throw new Error(mismatches.join("; "));
      } else if (step.ctl !== undefined) {
        needControl("ctl").ctlSpawn(step.ctl.run, step.ctl.as);
      } else if (step["ctl-result"] !== undefined) {
        const { of, expect } = step["ctl-result"];
        const ended = await needControl("ctl-result").ctlResult(of);
        const mismatches = matchState(expect, ended, of);
        if (mismatches.length) throw new Error(mismatches.join("; "));
      } else if (step.open !== undefined) await ctl.open(step.open);
      else if (step.keys !== undefined) await ctl.sendKeys(step.keys);
      else if (step.screenshot !== undefined) await screenshot(step.screenshot);
      else if (step.restart !== undefined) {
        if (!restart) throw new Error("this session cannot restart");
        await restart(step.restart);
      } else if (step["assert-state"] !== undefined) {
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

/**
 * `args` with each string `$name.a.b`, at any depth, replaced by that path in the answer `name`
 * (an `agent-result` or `mcp-result` before it): `{ tab: "$open1.result.tab" }`.
 * @param {Record<string, unknown>} args @param {Record<string, unknown>} answers
 * @returns {Record<string, unknown>}
 */
function substitute(args, answers) {
  /** @param {unknown} v @returns {unknown} */
  const one = (v) => {
    if (Array.isArray(v)) return v.map(one);
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, one(x)]));
    if (typeof v !== "string" || !v.startsWith("$")) return v;
    const [name, ...path] = v.slice(1).split(".");
    /** @type {any} */
    let value = answers[/** @type {string} */ (name)];
    if (value === undefined)
      throw new Error(`${v}: no agent-result or mcp-result named ${name} yet`);
    for (const p of path) value = value?.[p];
    if (value === undefined) throw new Error(`${v}: not in the answer`);
    return value;
  };
  return /** @type {Record<string, unknown>} */ (one(args));
}
