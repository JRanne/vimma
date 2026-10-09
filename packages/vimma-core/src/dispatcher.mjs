/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The dispatcher: one keydown in, one answer out. Stateful only in its pending buffer.
 * See docs/specs/m0-core-dispatcher.md § Dispatcher contract.
 */
import { formatKey } from "./keys.mjs";
import { COUNT_MODES, isMode } from "./modes.mjs";

/** @import { Chord } from "./keys.mjs" */
/** @import { Mode } from "./modes.mjs" */
/** @import { Keymap } from "./keymap.mjs" */
/** @import { TrieNode } from "./keymap.mjs" */
/** @import { ActionDef } from "./actions.mjs" */

/** @typedef {{ id: string, count?: number, arg?: number }} Action */
/**
 * @typedef {{ kind: "action", action: Action, replay?: true }
 *   | { kind: "pending" }
 *   | { kind: "cancel" }
 *   | { kind: "pass" }} DispatchResult
 */

const PENDING = Object.freeze({ kind: /** @type {const} */ ("pending") });
const CANCEL = Object.freeze({ kind: /** @type {const} */ ("cancel") });
const PASS = Object.freeze({ kind: /** @type {const} */ ("pass") });

/** @param {Chord} c */
const isBareDigit = (c) => /^[0-9]$/.test(c.key) && !c.ctrl && !c.alt && !c.meta;

/**
 * @param {Keymap} keymap
 */
export function createDispatcher(keymap) {
  /** @type {Mode | null} */
  let mode = null;
  /** @type {TrieNode | null} */
  let node = null; // non-null while a sequence is pending
  /** @type {string[]} */
  let labels = [];
  let count = "";

  function reset() {
    node = null;
    labels = [];
    count = "";
  }

  /**
   * @param {ActionDef} def
   * @returns {{ kind: "action", action: Action }}
   */
  function emit(def) {
    /** @type {Action} */
    const action = { id: def.id };
    if (def.arg !== undefined) action.arg = def.arg;
    if (count) action.count = Number(count);
    reset();
    return { kind: "action", action };
  }

  /**
   * @param {Mode} m
   * @param {Chord} chord
   * @returns {DispatchResult}
   */
  function dispatch(m, chord) {
    if (!isMode(m)) throw new Error(`unknown mode "${m}"`);
    if (m !== mode) {
      reset();
      mode = m;
    }
    const busy = node !== null || count !== "";
    const isEsc = chord.key === "esc" && !chord.ctrl && !chord.alt && !chord.meta && !chord.shift;
    if (busy && isEsc) {
      reset();
      return CANCEL;
    }
    const root = keymap.trie(m);
    const key = formatKey(chord);

    if (
      node === null &&
      COUNT_MODES.has(m) &&
      isBareDigit(chord) &&
      (chord.key !== "0" || count !== "") &&
      !root.children.has(key)
    ) {
      count += chord.key;
      return PENDING;
    }

    const from = node ?? root;
    const next = from.children.get(key);
    if (!next) {
      if (node === null) {
        if (count === "") return PASS;
        reset();
        return CANCEL;
      }
      if (node.action) return { ...emit(node.action), replay: true };
      reset();
      return CANCEL;
    }
    if (next.children.size > 0) {
      node = next;
      labels.push(next.label);
      return PENDING;
    }
    // A leaf always carries an action: compileKeymap only creates nodes along bound sequences.
    return emit(/** @type {ActionDef} */ (next.action));
  }

  /**
   * Resolve a pending sequence after timeout_ms.
   * @returns {DispatchResult | null}
   */
  function flush() {
    if (node === null && count === "") return null;
    if (node?.action) return emit(node.action);
    reset();
    return CANCEL;
  }

  return {
    dispatch,
    flush,
    reset,
    /**
     * True when the pending buffer is itself a complete binding, i.e. flush() would resolve it to
     * an action. Only then should the host arm the timeout_ms timer; a bare prefix waits for
     * the next key or Esc.
     */
    ambiguous: () => !!node?.action,
    /** Pending keys for the status bar, e.g. ["prefix"] or ["2", "g"]. */
    pending: () => [...count, ...labels],
    timeoutMs: keymap.timeoutMs,
  };
}
