// Runs e2e scenarios one after another, each in a fresh session, with a per-scenario timeout
// and a total budget (plan §5: suite < 5 min). Pending scenarios are reported, never passed.
import { runSteps } from "./scenario.mjs";

/** @typedef {import("./scenario.mjs").Scenario} Scenario */
/** @typedef {"pass" | "fail" | "timeout" | "pending" | "skipped"} Status */
/** @typedef {{ name: string, status: Status, ms: number, error?: string }} Result */
/**
 * @typedef {{
 *   ctl: import("./scenario.mjs").StepContext["ctl"],
 *   screenshot: (name: string) => Promise<void>,
 *   teardown: () => Promise<void>,
 * }} Session
 */

/** Plan §5: the whole suite stays under 5 minutes. */
export const DEFAULT_BUDGET_MS = 5 * 60 * 1000;
export const DEFAULT_SCENARIO_SECONDS = 60;

/**
 * @param {Scenario[]} scenarios
 * @param {{
 *   startSession: (scenario: Scenario) => Promise<Session>,
 *   budgetMs?: number,
 *   runPending?: boolean,
 *   pollMs?: number,
 *   now?: () => number,
 *   log?: (line: string) => void,
 * }} options
 * @returns {Promise<Result[]>}
 */
export async function runScenarios(
  scenarios,
  {
    startSession,
    budgetMs = DEFAULT_BUDGET_MS,
    runPending = false,
    pollMs,
    now = Date.now,
    log = () => {},
  },
) {
  const budgetEnd = now() + budgetMs;
  /** @type {Result[]} */
  const results = [];
  for (const scenario of scenarios) {
    if (scenario.pending && !runPending) {
      results.push({ name: scenario.name, status: "pending", ms: 0, error: scenario.pending });
      continue;
    }
    const left = budgetEnd - now();
    if (left <= 0) {
      results.push({
        name: scenario.name,
        status: "skipped",
        ms: 0,
        error: `not started: the ${budgetMs / 1000} s budget is spent`,
      });
      continue;
    }
    const timeoutMs = Math.min((scenario.timeoutSeconds ?? DEFAULT_SCENARIO_SECONDS) * 1000, left);
    log(`RUN     ${scenario.name}`);
    results.push(await runOne(scenario, { startSession, timeoutMs, pollMs }));
  }
  return results;
}

/**
 * @param {Scenario} scenario
 * @param {{ startSession: (s: Scenario) => Promise<Session>, timeoutMs: number, pollMs?: number }} o
 * @returns {Promise<Result>}
 */
async function runOne(scenario, { startSession, timeoutMs, pollMs }) {
  const started = Date.now();
  const controller = new AbortController();
  /** @type {Session | null} */
  let session = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });
  const work = (async () => {
    try {
      session = await startSession(scenario);
    } catch (e) {
      throw new Error(`launch: ${/** @type {Error} */ (e).message}`, { cause: e });
    }
    if (controller.signal.aborted) return;
    await runSteps(scenario, {
      ctl: session.ctl,
      screenshot: session.screenshot,
      pollMs,
      signal: controller.signal,
    });
  })();
  /** @type {Result} */
  let result;
  try {
    const outcome = await Promise.race([work.then(() => "done"), timedOut]);
    result =
      outcome === "timeout"
        ? {
            name: scenario.name,
            status: "timeout",
            ms: Date.now() - started,
            error: `did not finish within ${timeoutMs / 1000} s`,
          }
        : { name: scenario.name, status: "pass", ms: Date.now() - started };
  } catch (e) {
    result = {
      name: scenario.name,
      status: "fail",
      ms: Date.now() - started,
      error: /** @type {Error} */ (e).message,
    };
  } finally {
    clearTimeout(timer);
  }
  // After a timeout the steps stop at their next abort check; wait for that (or the launch) so
  // teardown never races a running step, then tear down whatever was started.
  await work.catch(() => {});
  const s = /** @type {Session | null} */ (session);
  if (s) {
    try {
      await s.teardown();
    } catch (e) {
      if (result.status === "pass") {
        result = {
          ...result,
          status: "fail",
          error: `teardown: ${/** @type {Error} */ (e).message}`,
        };
      }
    }
  }
  return result;
}

/** @param {Result[]} results */
export function exitCode(results) {
  if (results.length === 0) return 1;
  return results.some(
    (r) => r.status === "fail" || r.status === "timeout" || r.status === "skipped",
  )
    ? 1
    : 0;
}

/** @param {Result[]} results */
export function formatReport(results) {
  const lines = results.map((r) => {
    const label = r.status === "pass" ? "PASS" : r.status.toUpperCase();
    const time =
      r.status === "pending" || r.status === "skipped" ? "" : `  ${(r.ms / 1000).toFixed(1)} s`;
    const why = r.error ? `\n          ${r.error}` : "";
    return `${label.padEnd(8)}${r.name}${time}${why}`;
  });
  /** @param {Status[]} s */
  const count = (...s) => results.filter((r) => s.includes(r.status)).length;
  lines.push(
    "",
    `${count("pass")} passed, ${count("fail", "timeout", "skipped")} failed, ${count("pending")} pending`,
  );
  return lines.join("\n");
}

/**
 * GitHub Actions workflow commands: an error per failure, a notice per pending scenario.
 * @param {Result[]} results
 */
export function githubAnnotations(results) {
  const clean = (/** @type {string} */ s) => s.replace(/\r?\n/g, " ");
  return results.flatMap((r) => {
    if (r.status === "pending") {
      return [
        `::notice title=e2e pending::${r.name} is pending, not run and not passed: ${clean(r.error ?? "")}`,
      ];
    }
    if (r.status === "pass") return [];
    return [`::error title=e2e ${r.name}::${clean(r.error ?? r.status)}`];
  });
}
