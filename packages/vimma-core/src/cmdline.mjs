/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The `:` command line: parsing, completion and history. See docs/specs/m1-core-logic.md
 * § Command line.
 */
import { ACTIONS, closest, resolveActionName } from "./actions.mjs";

/** @import { Action } from "./dispatcher.mjs" */

/**
 * @typedef {object} CommandDef
 * @property {string} name
 * @property {readonly string[]} aliases
 * @property {"none" | "optional" | "required"} argument
 * @property {string} action       the action id, run without text (or with it, absent textAction)
 * @property {string} [textAction] the action id when text is given, if it differs
 * @property {string} description
 */
/** @typedef {{ code: string, message: string, suggestions: readonly string[], column?: number }} CommandError */
/**
 * @typedef {{ kind: "run", command: string, action: Action, text?: string }
 *   | { kind: "empty" }
 *   | { kind: "error", error: CommandError }} CommandResult
 */
/** @typedef {{ value: string, kind: "command" | "action", description: string }} Candidate */
/**
 * @typedef {object} History
 * @property {readonly string[]} entries oldest first
 * @property {number} limit
 * @property {number | null} index      the recalled entry, null when not browsing
 * @property {string} draft             the line as typed before the first Up
 */

/**
 * @param {string} name
 * @param {CommandDef["argument"]} argument
 * @param {string} action
 * @param {string} description
 * @param {{ aliases?: string[], textAction?: string }} [extra]
 * @returns {CommandDef}
 */
const cmd = (name, argument, action, description, { aliases = [], textAction } = {}) =>
  Object.freeze({
    name,
    aliases: Object.freeze(aliases),
    argument,
    action,
    ...(textAction ? { textAction } : {}),
    description,
  });

/** The commands of plan §2 (Neovim column). Any action name is a command too. */
/** @type {readonly CommandDef[]} */
export const COMMANDS = Object.freeze([
  cmd("open", "required", "page.open", "Open a URL in this tab"),
  cmd("tabnew", "optional", "tab.new", "New tab, optionally opening a URL"),
  cmd("tabrename", "optional", "tab.rename", "Rename tab (without a name: prompt)"),
  cmd("q", "none", "pane.close", "Close pane (the last one closes the tab)", {
    aliases: ["quit"],
  }),
  cmd("vsplit", "none", "pane.split_vertical", "Split right", { aliases: ["vs"] }),
  cmd("split", "none", "pane.split_horizontal", "Split down", { aliases: ["sp"] }),
  cmd("wsnext", "none", "workspace.next", "Next workspace"),
  cmd("wsprev", "none", "workspace.previous", "Previous workspace"),
  cmd("workspace", "optional", "workspace.picker", "Switch workspace (without a name: picker)", {
    textAction: "workspace.switch",
  }),
  cmd("ls", "none", "goto.picker", "Goto picker: every tab in every workspace"),
  cmd("sidebar", "none", "sidebar.toggle", "Open / close the side panel"),
  cmd("map", "none", "help.show", "Show all bindings"),
  cmd("source", "none", "config.reload", "Reload config"),
]);

/**
 * Action ids the commands use that actions.mjs does not define yet. The host spec adds them
 * (with `npm run gen-docs`) and empties this list.
 */
export const PENDING_ACTIONS = Object.freeze(["page.open", "workspace.switch"]);

/** @type {Map<string, CommandDef>} */
const byWord = new Map();
for (const c of COMMANDS) for (const w of [c.name, ...c.aliases]) byWord.set(w, c);

/** Config names of actions, once each (aliases are left out of completion). */
const ACTION_NAMES = [...new Set(ACTIONS.map((a) => a.name))];

/**
 * Split arguments on whitespace. `"…"` groups, with `\"` and `\\` escapes; `'…'` groups
 * literally; quoted and bare text next to each other join.
 * @param {string} text
 * @returns {{ ok: true, tokens: string[], starts: number[] } | { ok: false, column: number }}
 */
function scan(text) {
  /** @type {string[]} */
  const tokens = [];
  /** @type {number[]} */
  const starts = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(/** @type {string} */ (text[i]))) i++;
    if (i >= text.length) break;
    starts.push(i);
    let token = "";
    while (i < text.length && !/\s/.test(/** @type {string} */ (text[i]))) {
      const ch = /** @type {string} */ (text[i]);
      if (ch === '"' || ch === "'") {
        const open = i++;
        for (;;) {
          if (i >= text.length) return { ok: false, column: open };
          const c = /** @type {string} */ (text[i]);
          if (c === ch) break;
          if (ch === '"' && c === "\\" && (text[i + 1] === '"' || text[i + 1] === "\\")) {
            token += text[i + 1];
            i += 2;
          } else {
            token += c;
            i++;
          }
        }
        i++; // closing quote
      } else {
        token += ch;
        i++;
      }
    }
    tokens.push(token);
  }
  return { ok: true, tokens, starts };
}

/**
 * @param {string} text
 * @returns {{ ok: true, tokens: string[] } | { ok: false, column: number }}
 */
export function tokenize(text) {
  const r = scan(text);
  return r.ok ? { ok: true, tokens: r.tokens } : r;
}

/**
 * @param {string} code
 * @param {string} message
 * @param {string[]} [suggestions]
 * @param {number} [column]
 * @returns {CommandResult}
 */
const fail = (code, message, suggestions = [], column) =>
  Object.freeze({
    kind: "error",
    error: Object.freeze({
      code,
      message,
      suggestions: Object.freeze(suggestions),
      ...(column !== undefined ? { column } : {}),
    }),
  });

/**
 * @param {string} command
 * @param {Action} action
 * @param {string} [text]
 * @returns {CommandResult}
 */
const runResult = (command, action, text) =>
  Object.freeze({
    kind: "run",
    command,
    action: Object.freeze(action),
    ...(text ? { text } : {}),
  });

/** Every word a user can type, for suggestions. */
const ALL_WORDS = [...byWord.keys(), ...ACTION_NAMES];

/**
 * Commands whose name or alias starts with `word`, once each.
 * @param {string} word
 */
const commandsWithPrefix = (word) => [
  ...new Set([...byWord].filter(([w]) => w.startsWith(word)).map(([, c]) => c)),
];

/**
 * Parse one command line (with or without its leading `:`).
 * @param {string} line
 * @returns {CommandResult}
 */
export function parseCommandLine(line) {
  const head = /^\s*:?/.exec(line);
  const offset = head ? head[0].length : 0;
  const scanned = scan(line.slice(offset));
  if (!scanned.ok) {
    return fail("unterminated-quote", "unterminated quote", [], offset + scanned.column);
  }
  const [first, ...args] = scanned.tokens;
  if (first === undefined) return Object.freeze({ kind: "empty" });
  const word = first.toLowerCase();
  const text = args.join(" ");

  let command = byWord.get(word);
  if (!command) {
    const def = resolveActionName(word);
    if (def) {
      if (args.length) return unexpected(word);
      /** @type {Action} */
      const action = { id: def.id };
      if (def.arg !== undefined) action.arg = def.arg;
      return runResult(word, action);
    }
    const candidates = commandsWithPrefix(word);
    if (candidates.length > 1) {
      const names = candidates.map((c) => c.name);
      return fail("ambiguous-command", `ambiguous command "${word}": ${names.join(", ")}`, names);
    }
    command = candidates[0];
  }
  if (!command) {
    const prefixed = ALL_WORDS.filter((w) => w.startsWith(word)).slice(0, 3);
    const near = closest(word, ALL_WORDS);
    const suggestions = prefixed.length ? prefixed : near ? [near] : [];
    return fail("unknown-command", `not a command: "${word}"`, suggestions);
  }

  if (command.argument === "none" && args.length) {
    return unexpected(
      command.name,
      command.name === "map" ? "; bindings are set in config.toml" : "",
    );
  }
  if (command.argument === "required" && !text) {
    return fail("missing-argument", `:${command.name} needs an argument`);
  }
  const id = text && command.textAction ? command.textAction : command.action;
  return runResult(command.name, { id }, text);
}

/**
 * @param {string} name
 * @param {string} [hint]
 */
const unexpected = (name, hint = "") =>
  fail("unexpected-argument", `:${name} takes no argument${hint}`);

/**
 * Subsequence match: the span of `text` the letters of `word` cover, or -1.
 * @param {string} word
 * @param {string} text
 * @returns {{ span: number, start: number } | null}
 */
function fuzzy(word, text) {
  let start = -1;
  let i = 0;
  for (const ch of word) {
    const at = text.indexOf(ch, i);
    if (at < 0) return null;
    if (start < 0) start = at;
    i = at + 1;
  }
  return { span: i - start, start };
}

/** @type {Candidate[]} */
const CANDIDATES = [
  ...COMMANDS.flatMap((c) => [
    { value: c.name, kind: /** @type {const} */ ("command"), description: c.description },
    ...c.aliases.map((a) => ({
      value: a,
      kind: /** @type {const} */ ("command"),
      description: `${c.description} (short for :${c.name})`,
    })),
  ]),
  ...ACTION_NAMES.map((name) => ({
    value: name,
    kind: /** @type {const} */ ("action"),
    description: /** @type {import("./actions.mjs").ActionDef} */ (
      ACTIONS.find((a) => a.name === name)
    ).description,
  })),
].map((c) => Object.freeze(c));

/**
 * Completion candidates for the command word.
 * @param {string} line
 * @param {{ limit?: number }} [options]
 * @returns {{ word: string, candidates: Candidate[] }}
 */
export function completeCommandLine(line, { limit = 20 } = {}) {
  const rest = line.replace(/^\s*:?\s*/, "");
  const m = /^(\S*)(\s?)/.exec(rest);
  const word = (m?.[1] ?? "").toLowerCase();
  if (m?.[2]) return { word, candidates: [] };
  /** @type {Candidate[]} */
  const exact = [];
  /** @type {Candidate[]} */
  const prefix = [];
  /** @type {Array<{ c: Candidate, span: number, start: number, i: number }>} */
  const loose = [];
  CANDIDATES.forEach((c, i) => {
    if (c.value === word) exact.push(c);
    else if (c.value.startsWith(word)) prefix.push(c);
    else {
      const f = fuzzy(word, c.value);
      if (f) loose.push({ c, ...f, i });
    }
  });
  loose.sort((a, b) => a.span - b.span || a.start - b.start || a.i - b.i);
  return { word, candidates: [...exact, ...prefix, ...loose.map((l) => l.c)].slice(0, limit) };
}

/**
 * @param {{ limit?: number }} [options]
 * @returns {History}
 */
export function createHistory({ limit = 100 } = {}) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`history limit must be a positive integer, got ${limit}`);
  }
  return Object.freeze({ entries: Object.freeze([]), limit, index: null, draft: "" });
}

/**
 * Store an executed line: trimmed, once (the newest copy), at most `limit` lines.
 * @param {History} h
 * @param {string} line
 * @returns {History}
 */
export function pushHistory(h, line) {
  const l = line.trim();
  const entries = l ? [...h.entries.filter((e) => e !== l), l].slice(-h.limit) : h.entries;
  return Object.freeze({ ...h, entries: Object.freeze(entries), index: null, draft: "" });
}

/**
 * Up: the next older entry starting with the draft (the line as it was before the first Up).
 * @param {History} h
 * @param {string} current
 * @returns {{ history: History, text: string }}
 */
export function historyPrevious(h, current) {
  const draft = h.index === null ? current : h.draft;
  const from = h.index === null ? h.entries.length - 1 : h.index - 1;
  for (let i = from; i >= 0; i--) {
    const e = /** @type {string} */ (h.entries[i]);
    if (e.startsWith(draft)) return { history: Object.freeze({ ...h, index: i, draft }), text: e };
  }
  return { history: h, text: current };
}

/**
 * Down: the next newer matching entry, or past the newest the draft.
 * @param {History} h
 * @param {string} current
 * @returns {{ history: History, text: string }}
 */
export function historyNext(h, current) {
  if (h.index === null) return { history: h, text: current };
  for (let i = h.index + 1; i < h.entries.length; i++) {
    const e = /** @type {string} */ (h.entries[i]);
    if (e.startsWith(h.draft)) return { history: Object.freeze({ ...h, index: i }), text: e };
  }
  return { history: resetHistoryCursor(h), text: h.draft };
}

/**
 * After Enter or Esc: stop browsing.
 * @param {History} h
 * @returns {History}
 */
export function resetHistoryCursor(h) {
  return Object.freeze({ ...h, index: null, draft: "" });
}
