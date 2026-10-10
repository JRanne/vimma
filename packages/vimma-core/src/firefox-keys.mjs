/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Firefox's own shortcuts (docs/specs/key-handling-batch.md § 1): which `<key>` elements of the
 * browser window's #mainKeyset Vimma turns off. The host reads each element's chord with
 * xulKeyChord and disables what planFirefoxKeys returns.
 */
import { formatKey, makeChordText, parseKey } from "./keys.mjs";

/** @import { Chord } from "./keys.mjs" */

/**
 * The default `[firefox] disable`: the chords Vimma's keymap or Vim's text-field keys use. On
 * Linux, Firefox 157 binds all but ctrl+e and ctrl+y (`key_search2` is ctrl+j there).
 */
export const OVERLAP_CHORDS = Object.freeze([
  "ctrl+b",
  "ctrl+d",
  "ctrl+e",
  "ctrl+h",
  "ctrl+i",
  "ctrl+k",
  "ctrl+o",
  "ctrl+u",
  "ctrl+w",
  "ctrl+y",
]);

/** What `disable = "all"` keeps, as written on Linux and Windows (accel+q: cmd+q on macOS). */
export const ALL_KEEP = Object.freeze(["ctrl+q"]);

/** XUL `keycode` names (nsIDOMKeyEvent DOM_VK_*) → our named keys. */
/** @type {Record<string, string>} */
const KEYCODES = {
  VK_ESCAPE: "esc",
  VK_RETURN: "enter",
  VK_TAB: "tab",
  VK_SPACE: "space",
  VK_BACK: "backspace",
  VK_DELETE: "delete",
  VK_UP: "up",
  VK_DOWN: "down",
  VK_LEFT: "left",
  VK_RIGHT: "right",
  VK_HOME: "home",
  VK_END: "end",
  VK_PAGE_UP: "pageup",
  VK_PAGE_DOWN: "pagedown",
  VK_INSERT: "insert",
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`VK_F${i + 1}`, `f${i + 1}`])),
};

/**
 * The chord a `<key>` element answers to, from its own attributes, or null when it has none
 * yet (Fluent fills `key` in after load) or none we can name.
 * @param {{ key?: string | null, keycode?: string | null, modifiers?: string | null }} el
 * @param {{ mac?: boolean }} [options]  `accel` is cmd (meta) on macOS, else ctrl
 * @returns {string | null}
 */
export function xulKeyChord(el, { mac = false } = {}) {
  /** @type {Partial<Record<"ctrl" | "alt" | "shift" | "meta", boolean>>} */
  const mods = {};
  for (const m of (el.modifiers ?? "").split(/[\s,]+/).filter(Boolean)) {
    if (m === "accel") mods[mac ? "meta" : "ctrl"] = true;
    else if (m === "control") mods.ctrl = true;
    else if (m === "alt") mods.alt = true;
    else if (m === "shift") mods.shift = true;
    else if (m === "meta" || m === "os") mods.meta = true;
  }
  let key = null;
  if (el.key && [...el.key].length === 1) key = el.key.toLowerCase();
  else if (!el.key && el.keycode) key = KEYCODES[el.keycode] ?? null;
  if (!key) return null;
  return makeChordText(key, mods);
}

/** @param {string} chord canonical */
const isModified = (chord) => {
  const c = /** @type {Chord} */ (parseKey(chord));
  return c.ctrl || c.alt || c.meta;
};

/**
 * Whether a chord can name a Firefox shortcut: it has ctrl, alt or meta, or is a function key.
 * @param {Chord} c
 */
export function isShortcutChord(c) {
  return c.ctrl || c.alt || c.meta || /^f\d+$/.test(c.key);
}

/**
 * The canonical text of a chord as written in `[firefox]` (`control+W` → `ctrl+shift+w`).
 * @param {string} text
 * @returns {string}
 * @throws {import("./keys.mjs").KeyNotationError}
 */
export function canonicalChord(text) {
  return formatKey(parseKey(text));
}

/**
 * @template {{ chord: string | null, internal?: boolean }} K
 * @typedef {{ off: K[], unmatched: string[] }} FirefoxKeyPlan
 */

/**
 * Which keys to turn off. `disable = "all"`: every key with ctrl, alt or meta but accel+q;
 * a list: the keys with those chords. `enable` keeps its chords on either way. A key Firefox
 * runs elsewhere (`internal`: copy, paste, undo) or without a chord yet is never touched.
 * `unmatched`: chords of a `disable` list that no key has (ctrl+e on Linux), for about:vimma.
 * @template {{ chord: string | null, internal?: boolean }} K
 * @param {readonly K[]} keys  in document order
 * @param {{ disable: "all" | readonly string[], enable: readonly string[] }} setting  canonical
 * @param {{ mac?: boolean }} [options]
 * @returns {FirefoxKeyPlan<K>}
 */
export function planFirefoxKeys(keys, setting, { mac = false } = {}) {
  const enable = new Set(setting.enable);
  const keep = new Set(ALL_KEEP.map((c) => (mac ? c.replace(/^ctrl\+/, "meta+") : c)));
  const all = setting.disable === "all";
  const listed = new Set(all ? [] : setting.disable);
  const off = keys.filter((k) => {
    if (!k.chord || k.internal || enable.has(k.chord)) return false;
    return all ? isModified(k.chord) && !keep.has(k.chord) : listed.has(k.chord);
  });
  const matched = new Set(off.map((k) => k.chord));
  const unmatched = [...listed].filter((c) => !matched.has(c) && !enable.has(c));
  return { off, unmatched };
}
