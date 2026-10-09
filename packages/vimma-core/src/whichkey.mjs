/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The which-key strip shown while a key sequence is pending (spec m2-core-logic): the next keys
 * from the same compiled keymap the dispatcher walks, with labels, grouped like `prefix+?`.
 */
import { ACTIONS, isRunnable } from "./actions.mjs";
import { NAMED_KEYS, parseKey } from "./keys.mjs";
import { COUNT_MODES } from "./modes.mjs";

/** @import { Keymap } from "./keymap.mjs" */
/** @import { TrieNode } from "./keymap.mjs" */
/** @import { ActionDef } from "./actions.mjs" */
/** @import { Mode } from "./modes.mjs" */
/** @import { Chord } from "./keys.mjs" */

/**
 * @typedef {object} WhichKeyEntry
 * @property {string} key            formatKey of the next chord
 * @property {"action" | "group"} kind
 * @property {string} [name]         action config name (action entries)
 * @property {string} [id]           action id (action entries)
 * @property {string} description
 * @property {number} more           actions reachable below this key
 * @property {boolean} runnable
 */
/** @typedef {{ group: string, entries: WhichKeyEntry[] }} WhichKeySection */
/** @typedef {{ pending: string[], sections: WhichKeySection[] }} WhichKey */

const MORE = "More";
const GROUP_ORDER = [...new Set(ACTIONS.map((a) => a.group))];

/** @type {Record<string, string>} */
const SYMBOL_NAMES = { minus: "-", plus: "+" };
const MOD_BITS = /** @type {const} */ ([
  ["shift", 1],
  ["ctrl", 2],
  ["alt", 4],
  ["meta", 8],
]);

/**
 * @param {string} key
 * @returns {[number, number, number]} class, order within the class, modifier rank
 */
function rank(key) {
  /** @type {Chord} */
  let c;
  try {
    c = parseKey(key);
  } catch {
    return [4, 0, 0];
  }
  const base = SYMBOL_NAMES[c.key] ?? c.key;
  // fewer modifiers first; for the same count, shift (the capital letter), ctrl, alt, meta
  let bits = 0;
  let count = 0;
  for (const [m, bit] of MOD_BITS) {
    if (c[m]) {
      bits |= bit;
      count++;
    }
  }
  const mods = count * 16 + bits;
  if (/^[0-9]$/.test(base)) return [0, Number(base), mods];
  if (/^[a-z]$/.test(base)) return [1, base.charCodeAt(0), mods];
  const named = NAMED_KEYS.indexOf(base);
  if (named >= 0) return [3, named, mods];
  return [2, /** @type {number} */ (base.codePointAt(0)), mods];
}

/**
 * Which-key order: digits numerically, letters a–z (unshifted first), other printable characters
 * by code point, named keys in NAMED_KEYS order; then fewer modifiers first.
 * @param {string} a formatKey text
 * @param {string} b
 * @returns {number}
 */
export function compareKeys(a, b) {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < 3; i++) {
    const d = /** @type {number} */ (ra[i]) - /** @type {number} */ (rb[i]);
    if (d) return d;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * @param {TrieNode} node
 * @param {ActionDef[]} out
 */
function actionsBelow(node, out = []) {
  for (const child of node.children.values()) {
    if (child.action) out.push(child.action);
    actionsBelow(child, out);
  }
  return out;
}

/**
 * Walks `pending` (dispatcher.pending() labels) from the mode's root, skipping a leading count.
 * @param {TrieNode} root
 * @param {Mode} mode
 * @param {readonly string[]} pending
 * @returns {TrieNode | null}
 */
function walk(root, mode, pending) {
  let node = root;
  let i = 0;
  if (COUNT_MODES.has(mode)) {
    while (i < pending.length && /^[0-9]$/.test(/** @type {string} */ (pending[i]))) {
      const digit = /** @type {string} */ (pending[i]);
      // the dispatcher counts a digit only when the root does not bind it
      if (root.children.has(digit)) break;
      i++;
    }
  }
  if (i === pending.length) return null;
  for (; i < pending.length; i++) {
    const label = pending[i];
    let next = null;
    for (const [key, child] of node.children) {
      if (child.label === label || key === label) {
        next = child;
        break;
      }
    }
    if (!next) return null;
    node = next;
  }
  return node;
}

/**
 * The keys that can follow the pending sequence, or null when the strip should be hidden.
 * @param {Keymap} keymap
 * @param {Mode} mode
 * @param {readonly string[]} pending
 * @param {{ runnable?: ReadonlySet<string> }} [options] action ids the host implements;
 *   undefined shows every action as runnable
 * @returns {WhichKey | null}
 */
export function whichKey(keymap, mode, pending, { runnable } = {}) {
  const node = walk(keymap.trie(mode), mode, pending);
  if (!node || node.children.size === 0) return null;
  /** @type {Map<string, WhichKeyEntry[]>} */
  const bySection = new Map();
  for (const [key, child] of node.children) {
    const below = actionsBelow(child);
    /** @type {WhichKeyEntry} */
    let entry;
    /** @type {string} */
    let section;
    if (child.action) {
      const a = child.action;
      section = a.group;
      entry = {
        key,
        kind: "action",
        name: a.name,
        id: a.id,
        description: a.description,
        more: below.length,
        runnable: isRunnable(a.id, runnable),
      };
    } else {
      const groups = new Set(below.map((a) => a.group));
      const only = groups.size === 1 ? /** @type {string} */ ([...groups][0]) : null;
      section = only ?? MORE;
      entry = {
        key,
        kind: "group",
        description: only ? `+${only}` : `+${below.length} bindings`,
        more: below.length,
        runnable: below.some((a) => isRunnable(a.id, runnable)),
      };
    }
    bySection.set(section, [...(bySection.get(section) ?? []), entry]);
  }
  const order = [...GROUP_ORDER, MORE];
  const sections = [...bySection.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([group, entries]) => ({
      group,
      entries: entries.sort((x, y) => compareKeys(x.key, y.key)),
    }));
  return { pending: [...pending], sections };
}
