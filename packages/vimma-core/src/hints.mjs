/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Link hints: label generation, target ordering and the hint-mode key handling.
 * See docs/specs/m1-core-logic.md § Hints.
 */

/** @import { Chord } from "./keys.mjs" */

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */
/** @typedef {{ rect: Rect }} Target */
/** @typedef {"hint.follow" | "hint.follow_new_tab"} HintAction */
/**
 * @template {Target} [T=Target]
 * @typedef {{ label: string, target: T }} Hint
 */
/**
 * @template {Target} [T=Target]
 * @typedef {{ action: HintAction, chars: string, typed: string, hints: readonly Hint<T>[] }} HintState
 */
/**
 * @template {Target} [T=Target]
 * @typedef {{ kind: "cancel" }
 *   | { kind: "ignored" }
 *   | { kind: "narrow", visible: number }
 *   | { kind: "select", action: HintAction, target: T, label: string }} HintResult
 */

export class HintError extends Error {
  /**
   * @param {"bad-charset" | "bad-count" | "bad-action" | "no-targets"} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "HintError";
    this.code = code;
  }
}

/** The home row. No `;`: Nordic and German layouts put other letters there. */
export const DEFAULT_HINT_CHARS = "asdfghjkl";

/** @type {readonly HintAction[]} */
export const HINT_ACTIONS = Object.freeze(["hint.follow", "hint.follow_new_tab"]);

/** @param {string} chars */
function checkChars(chars) {
  const list = [...chars];
  const ok =
    list.length >= 2 &&
    new Set(list).size === list.length &&
    list.every((c) => !/\s/.test(c) && c === c.toLowerCase());
  if (!ok) {
    throw new HintError(
      "bad-charset",
      `hint characters must be at least 2 distinct lowercase characters, got ${JSON.stringify(chars)}`,
    );
  }
  return list;
}

/**
 * The `n` shortest prefix-free labels over `chars`, shortest first, in charset order.
 * @param {number} n
 * @param {string} [chars]
 * @returns {string[]}
 */
export function hintLabels(n, chars = DEFAULT_HINT_CHARS) {
  const list = checkChars(chars);
  if (!Number.isInteger(n) || n < 0) {
    throw new HintError("bad-count", `hint count must be a non-negative integer, got ${n}`);
  }
  const k = list.length;
  if (n <= k) return list.slice(0, n);
  // base: every string of length L - 1, where k^(L-1) < n <= k^L
  let base = [""];
  while (base.length * k < n) base = base.flatMap((p) => list.map((c) => p + c));
  // Extending one base string loses it and gains k labels: extend the fewest, from the end.
  const s = Math.ceil((n - base.length) / (k - 1));
  const kept = base.slice(0, base.length - s);
  const extended = base.slice(base.length - s).flatMap((p) => list.map((c) => p + c));
  return [...kept, ...extended].slice(0, n);
}

/**
 * @param {Target} a
 * @param {Target} b
 */
const byPosition = (a, b) =>
  a.rect.y - b.rect.y ||
  a.rect.x - b.rect.x ||
  a.rect.height - b.rect.height ||
  a.rect.width - b.rect.width;

/**
 * Reading order: rows top to bottom, each left to right. A target joins the current row while
 * its top is above the vertical centre of the row's first target.
 * @template {Target} T
 * @param {readonly T[]} targets
 * @returns {T[]}
 */
export function orderTargets(targets) {
  const sorted = [...targets].sort(byPosition);
  /** @type {T[][]} */
  const rows = [];
  let limit = -Infinity;
  for (const t of sorted) {
    const row = rows[rows.length - 1];
    if (row && t.rect.y < limit) {
      row.push(t);
    } else {
      rows.push([t]);
      limit = t.rect.y + t.rect.height / 2;
    }
  }
  return rows.flatMap((row) => row.sort((a, b) => a.rect.x - b.rect.x || byPosition(a, b)));
}

/**
 * @template {Target} T
 * @param {readonly T[]} targets
 * @param {{ action: string, chars?: string }} options
 * @returns {HintState<T>}
 */
export function startHints(targets, { action, chars = DEFAULT_HINT_CHARS }) {
  if (!(/** @type {readonly string[]} */ (HINT_ACTIONS).includes(action))) {
    throw new HintError("bad-action", `not a hint action: "${action}"`);
  }
  const labels = hintLabels(targets.length, chars);
  if (targets.length === 0) throw new HintError("no-targets", "no hint targets");
  const hints = orderTargets(targets).map((target, i) =>
    Object.freeze({ label: /** @type {string} */ (labels[i]), target }),
  );
  return Object.freeze({
    action: /** @type {HintAction} */ (action),
    chars,
    typed: "",
    hints: Object.freeze(hints),
  });
}

/**
 * The hints still on screen: those whose label starts with what was typed.
 * @template {Target} T
 * @param {HintState<T>} state
 * @returns {Hint<T>[]}
 */
export function visibleHints(state) {
  return state.hints.filter((h) => h.label.startsWith(state.typed));
}

const IGNORED = Object.freeze({ kind: /** @type {const} */ ("ignored") });
const CANCEL = Object.freeze({ kind: /** @type {const} */ ("cancel") });

/**
 * One key in hint mode.
 * @template {Target} T
 * @param {HintState<T>} state
 * @param {Chord} chord
 * @returns {{ state: HintState<T>, result: HintResult<T> }}
 */
export function hintKey(state, chord) {
  if (chord.ctrl || chord.alt || chord.meta) return { state, result: IGNORED };
  if (chord.key === "esc") return { state, result: chord.shift ? IGNORED : CANCEL };
  if (chord.key === "backspace") {
    if (state.typed === "") return { state, result: IGNORED };
    const next = Object.freeze({ ...state, typed: [...state.typed].slice(0, -1).join("") });
    return { state: next, result: narrow(next) };
  }
  // A letter arrives lowercase with shift set (caps lock too); other characters carry shift.
  if ([...chord.key].length !== 1 || !state.chars.includes(chord.key)) {
    return { state, result: IGNORED };
  }
  const next = Object.freeze({ ...state, typed: state.typed + chord.key });
  const visible = visibleHints(next);
  if (visible.length === 0) return { state, result: IGNORED };
  if (visible.length === 1) {
    const hit = /** @type {Hint<T>} */ (visible[0]);
    return {
      state: next,
      result: Object.freeze({
        kind: /** @type {const} */ ("select"),
        action: state.action,
        target: hit.target,
        label: hit.label,
      }),
    };
  }
  return { state: next, result: narrow(next) };
}

/**
 * @param {HintState<any>} state
 * @returns {{ kind: "narrow", visible: number }}
 */
const narrow = (state) => Object.freeze({ kind: "narrow", visible: visibleHints(state).length });
