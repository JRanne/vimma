// Reads which runner each job of a GitHub Actions workflow targets, for
// self-hosted-runner.test.mjs (docs/specs/build-supply-chain.md, decision 7). Text parsing in the
// style of the other workflow tests: the repository has no YAML dependency, and the workflows
// keep the shapes this reads (two-space indents, `on:` and `jobs:` at the top level).

/**
 * Triggers that let someone without write access start a run, or that run on behalf of such a
 * run. `workflow_call` is included because a called workflow runs with its caller's trigger.
 */
export const OUTSIDER_TRIGGERS = new Set([
  "pull_request",
  "pull_request_target",
  "pull_request_review",
  "pull_request_review_comment",
  "issue_comment",
  "issues",
  "discussion",
  "discussion_comment",
  "workflow_run",
  "workflow_call",
]);

/**
 * Standard GitHub-hosted runner images. Larger runners (`-large`, `-xlarge`, custom names) and
 * every other label are excluded: only a self-hosted or a paid larger runner can serve them.
 */
const HOSTED_IMAGE =
  /^(?:ubuntu-(?:latest|\d\d\.\d\d)(?:-arm)?|windows-(?:latest|\d{4}|11-arm)|macos-(?:latest|\d+)(?:-intel)?)$/;

/** @param {string} label */
export const isHostedImage = (label) => HOSTED_IMAGE.test(label);

/** @param {string} line */
const stripComment = (line) => line.replace(/\s+#.*$/, "").trim();

/** @param {string} value */
const unquote = (value) => value.replace(/^(["'])(.*)\1$/, "$2");

/**
 * @param {string} value a YAML flow sequence (`[a, "b"]`) or a scalar
 * @returns {string[]}
 */
function flowList(value) {
  const v = value.trim();
  if (!v.startsWith("[")) return [unquote(v)];
  return v
    .slice(1, -1)
    .split(",")
    .map((s) => unquote(s.trim()))
    .filter(Boolean);
}

/**
 * @param {string} text a workflow file
 * @returns {string[]} the events under its top-level `on:`
 */
export function triggers(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^["']?on["']?:/.test(l));
  if (start < 0) return [];
  const inline = stripComment((lines[start] ?? "").replace(/^["']?on["']?:/, ""));
  if (inline) return flowList(inline);
  /** @type {string[]} */
  const events = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && !line.startsWith("#")) break;
    const m = /^ {2}([a-z_]+):/.exec(line);
    if (m?.[1]) events.push(m[1]);
  }
  return events;
}

/**
 * @param {string} text a workflow file
 * @returns {Map<string, string>} job id to its YAML block
 */
export function jobs(text) {
  const at = text.search(/^jobs:\s*$/m);
  /** @type {Map<string, string>} */
  const out = new Map();
  if (at < 0) return out;
  const body = text.slice(at).replace(/^jobs:\s*\n/, "");
  // The next top-level key ends the jobs; a comment in column 0 does not.
  const end = body.search(/^[^\s#]/m);
  const parts = (end < 0 ? body : body.slice(0, end)).split(
    /^ {2}([A-Za-z_][\w-]*):[^\S\n]*(?:#.*)?$/m,
  );
  for (let i = 1; i < parts.length; i += 2) out.set(parts[i] ?? "", parts[i + 1] ?? "");
  return out;
}

/**
 * @typedef {{ kind: "labels", labels: string[] }
 *   | { kind: "expression", expression: string }
 *   | { kind: "object" }
 *   | { kind: "reusable" }
 *   | { kind: "missing" }} RunsOn
 */

/**
 * @param {string} block a job's YAML block from `jobs()`
 * @returns {RunsOn}
 */
export function runsOn(block) {
  const lines = block.split("\n");
  const i = lines.findIndex((l) => /^ {4}runs-on:/.test(l));
  if (i < 0) return /^ {4}uses:/m.test(block) ? { kind: "reusable" } : { kind: "missing" };
  const value = stripComment((lines[i] ?? "").replace(/^ {4}runs-on:/, ""));
  if (value.includes("${{")) return { kind: "expression", expression: value };
  if (value) return { kind: "labels", labels: flowList(value) };
  /** @type {string[]} */
  const labels = [];
  for (const line of lines.slice(i + 1)) {
    if (!/^ {6}/.test(line)) break;
    const item = /^ {6}- (.+)$/.exec(line);
    // `group:` / `labels:`: a runner group, which only self-hosted and larger runners have.
    if (!item?.[1]) return { kind: "object" };
    labels.push(unquote(stripComment(item[1])));
  }
  return { kind: "labels", labels };
}

/**
 * Resolves `${{ matrix.<key> }}` against a literal list in the job's own matrix. Anything else
 * (inputs, vars, event fields, conditionals) is unresolved: its value is not known from the file.
 * @param {string} expression
 * @param {string} block the job's YAML block
 * @returns {string[] | null} every value it can take, or null when it cannot be resolved
 */
export function resolveExpression(expression, block) {
  const m = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/.exec(expression);
  if (!m) return null;
  const entry = new RegExp(`^\\s+${m[1]}:\\s*(\\[.*\\])\\s*(?:#.*)?$`, "m").exec(block);
  if (!entry?.[1]) return null;
  // A matrix `include:` can add values that the list does not show.
  if (/^\s+include:/m.test(block)) return null;
  return flowList(entry[1]);
}

/**
 * @param {string} block a job's YAML block
 * @returns {string | null} why the job may not run on a standard GitHub-hosted runner, or null
 */
export function runnerProblem(block) {
  const r = runsOn(block);
  if (r.kind === "reusable") return null;
  if (r.kind === "missing") return "no runs-on";
  if (r.kind === "object") return "a runner group";
  if (r.kind === "expression") {
    const values = resolveExpression(r.expression, block);
    if (!values) return `an expression that cannot be resolved: ${r.expression}`;
    const bad = values.filter((v) => !isHostedImage(v));
    return bad.length ? `${r.expression} can be ${bad.join(", ")}` : null;
  }
  if (r.labels.length !== 1) return `several labels: ${r.labels.join(", ")}`;
  const [label = ""] = r.labels;
  return isHostedImage(label) ? null : `not a GitHub-hosted image: ${label}`;
}

/**
 * @param {string} text a workflow file
 * @returns {string[]} one line per job that may not run on a standard GitHub-hosted runner
 */
export function workflowRunnerProblems(text) {
  /** @type {string[]} */
  const out = [];
  for (const [id, block] of jobs(text)) {
    const problem = runnerProblem(block);
    if (problem) out.push(`${id}: ${problem}`);
  }
  return out;
}
