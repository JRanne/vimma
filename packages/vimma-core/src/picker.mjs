/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The `prefix+g` goto picker (spec m2-core-logic): every tab of every workspace, fuzzy matching
 * with highlight ranges, and the picker's key handling as a pure state machine.
 */
import { displayLabel } from "./tablabels.mjs";

/** @import { TabLabels } from "./tablabels.mjs" */

/**
 * The workspace model's shape (workspaces.mjs), taken structurally.
 * @typedef {{ readonly active: string, readonly workspaces: readonly { readonly id: string,
 *   readonly name: string, readonly tabs: readonly string[],
 *   readonly activeTab: string | null }[] }} WorkspacesLike
 */
/**
 * @typedef {object} PickerItem
 * @property {string} tabId
 * @property {string} workspaceId
 * @property {string} workspaceName
 * @property {number} workspaceIndex 1-based
 * @property {number} tabIndex       1-based, within its workspace
 * @property {string} title
 * @property {string} url
 * @property {string | null} label   the rename, if any
 * @property {string} display        displayLabel(label, title, url)
 * @property {boolean} active        the active workspace's active tab
 */
/** @typedef {"display" | "title" | "url" | "workspace"} Field */
/** @typedef {[start: number, end: number]} Range */
/** @typedef {{ tier: number, score: number, ranges: Range[] }} FieldMatch */
/**
 * @typedef {object} Match
 * @property {PickerItem} item
 * @property {number} score
 * @property {Partial<Record<Field, Range[]>>} highlights
 */
/**
 * @typedef {object} PickerState
 * @property {readonly PickerItem[]} items
 * @property {string} query
 * @property {"browse" | "search"} mode
 * @property {readonly Match[]} matches
 * @property {number} selected  index into matches
 */
/** @typedef {null | { type: "select", tabId: string } | { type: "close" }} PickerEffect */

/** Match tiers; each owns a score band [tier·1000, tier·1000 + 999]. */
export const TIER = Object.freeze({ subsequence: 1, substring: 2, word: 3, prefix: 4, exact: 5 });

/** @type {Record<Field, number>} */
const FIELD_WEIGHT = { display: 300, title: 250, url: 150, workspace: 100 };

/** @param {string} s */
function lower(s) {
  const l = s.toLowerCase();
  return l.length === s.length ? l : s;
}

/** @param {string | undefined} ch */
const isAlnum = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);
/** @param {string | undefined} ch */
const isLower = (ch) => !!ch && ch !== ch.toUpperCase() && ch === ch.toLowerCase();
/** @param {string | undefined} ch */
const isUpper = (ch) => !!ch && ch !== ch.toLowerCase() && ch === ch.toUpperCase();

/**
 * @param {string} text
 * @param {number} i
 */
function isWordStart(text, i) {
  return i === 0 || !isAlnum(text[i - 1]) || (isLower(text[i - 1]) && isUpper(text[i]));
}

/**
 * @param {number[]} positions
 * @returns {Range[]}
 */
function toRanges(positions) {
  /** @type {Range[]} */
  const out = [];
  for (const p of positions) {
    const last = out[out.length - 1];
    if (last && last[1] === p) last[1] = p + 1;
    else out.push([p, p + 1]);
  }
  return out;
}

/**
 * Shortest-span alignment of `q` as a subsequence of `t` (both lowered), earliest on a tie.
 * @param {string} t
 * @param {string} q
 * @returns {number[] | null}
 */
function subsequence(t, q) {
  /** @type {number[] | null} */
  let best = null;
  for (
    let s = t.indexOf(/** @type {string} */ (q[0]));
    s >= 0;
    s = t.indexOf(/** @type {string} */ (q[0]), s + 1)
  ) {
    const pos = [s];
    let at = s + 1;
    for (let k = 1; k < q.length; k++) {
      const found = t.indexOf(/** @type {string} */ (q[k]), at);
      if (found < 0) return best;
      pos.push(found);
      at = found + 1;
    }
    const span = at - s;
    if (!best || span < /** @type {number} */ (best.at(-1)) + 1 - /** @type {number} */ (best[0]))
      best = pos;
  }
  return best;
}

/**
 * Case-insensitive match of one term against one field's text.
 * @param {string} text
 * @param {string} term
 * @param {Field} [field]
 * @returns {FieldMatch | null}
 */
export function scoreField(text, term, field = "display") {
  if (!term) return null;
  const t = lower(text);
  const q = lower(term);
  /** @type {number} */
  let tier;
  let start = t.indexOf(q);
  /** @type {number[] | null} */
  let positions = null;
  if (t === q) tier = TIER.exact;
  else if (start === 0) tier = TIER.prefix;
  else if (start > 0) {
    tier = TIER.substring;
    for (let i = start; i >= 0; i = t.indexOf(q, i + 1)) {
      if (isWordStart(text, i)) {
        tier = TIER.word;
        start = i;
        break;
      }
    }
  } else {
    positions = subsequence(t, q);
    if (!positions) return null;
    tier = TIER.subsequence;
    start = /** @type {number} */ (positions[0]);
  }
  const span = positions ? /** @type {number} */ (positions.at(-1)) + 1 - start : q.length;
  const gaps = span - q.length;
  const adjust =
    FIELD_WEIGHT[field] +
    Math.max(0, 200 - start * 10) +
    Math.max(0, 200 - gaps * 25) +
    Math.max(0, 200 - text.length * 2);
  return {
    tier,
    score: tier * 1000 + adjust,
    ranges: positions ? toRanges(positions) : [[start, start + q.length]],
  };
}

/**
 * @param {Range[]} a
 * @param {Range[]} b
 * @returns {Range[]}
 */
function mergeRanges(a, b) {
  const all = [...a, ...b].sort((x, y) => x[0] - y[0]);
  /** @type {Range[]} */
  const out = [];
  for (const [s, e] of all) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Every whitespace-separated term must match some field; per term the best field counts.
 * @param {PickerItem} item
 * @param {string} query
 * @returns {Match | null}
 */
export function matchItem(item, query) {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  /** @type {[Field, string][]} */
  const fields = [
    ["display", item.display],
    ...(item.label ? [/** @type {[Field, string]} */ (["title", item.title])] : []),
    ["url", item.url],
    ["workspace", item.workspaceName],
  ];
  /** @type {Partial<Record<Field, Range[]>>} */
  const highlights = {};
  let score = 0;
  for (const term of terms) {
    /** @type {{ field: Field, m: FieldMatch } | null} */
    let best = null;
    for (const [field, text] of fields) {
      const m = scoreField(text, term, field);
      if (m && (!best || m.score > best.m.score)) best = { field, m };
    }
    if (!best) return null;
    score += best.m.score;
    highlights[best.field] = mergeRanges(highlights[best.field] ?? [], best.m.ranges);
  }
  return { item, score, highlights };
}

/**
 * Matches sorted by score, ties in input order; a blank query lists every item in order.
 * @param {readonly PickerItem[]} items
 * @param {string} query
 * @returns {Match[]}
 */
export function filterItems(items, query) {
  if (!query.trim()) return items.map((item) => ({ item, score: 0, highlights: {} }));
  return items
    .map((item) => matchItem(item, query))
    .filter((m) => m !== null)
    .sort((a, b) => b.score - a.score);
}

/**
 * Every tab of every workspace, in workspace order then tab order.
 * @param {WorkspacesLike} state
 * @param {(tabId: string) => { title?: string | null, url?: string | null } | undefined} info
 * @param {TabLabels} labels
 * @returns {PickerItem[]}
 */
export function pickerItems(state, info, labels) {
  return state.workspaces.flatMap((w, wi) =>
    w.tabs.map((tabId, ti) => {
      const { title, url } = info(tabId) ?? {};
      const label = Object.hasOwn(labels, tabId) ? /** @type {string} */ (labels[tabId]) : null;
      return Object.freeze({
        tabId,
        workspaceId: w.id,
        workspaceName: w.name,
        workspaceIndex: wi + 1,
        tabIndex: ti + 1,
        title: title ?? "",
        url: url ?? "",
        label,
        display: displayLabel({ label, title, url }),
        active: w.id === state.active && w.activeTab === tabId,
      });
    }),
  );
}

/**
 * @param {PickerState} s
 * @param {Partial<PickerState>} changes
 * @returns {PickerState}
 */
function update(s, changes) {
  return Object.freeze({ ...s, ...changes });
}

/**
 * @param {readonly PickerItem[]} items
 * @param {{ activeTabId?: string | null }} [options]
 * @returns {PickerState}
 */
export function openPicker(items, { activeTabId = null } = {}) {
  const matches = filterItems(items, "");
  const at = matches.findIndex((m) => m.item.tabId === activeTabId);
  return Object.freeze({ items, query: "", mode: "browse", matches, selected: Math.max(0, at) });
}

/**
 * @param {PickerState} state
 * @returns {Match | undefined}
 */
export function pickerSelection(state) {
  return state.matches[state.selected];
}

/**
 * New items (a tab opened, closed or retitled); the selected tab stays selected if it survives.
 * @param {PickerState} state
 * @param {readonly PickerItem[]} items
 * @returns {PickerState}
 */
export function setPickerItems(state, items) {
  const tabId = pickerSelection(state)?.item.tabId;
  const matches = filterItems(items, state.query);
  const at = matches.findIndex((m) => m.item.tabId === tabId);
  const selected = at >= 0 ? at : Math.max(0, Math.min(state.selected, matches.length - 1));
  return update(state, { items, matches, selected });
}

/**
 * @param {PickerState} s
 * @param {number} to
 */
function select(s, to) {
  const i = Math.max(0, Math.min(to, s.matches.length - 1));
  return i === s.selected || !s.matches.length ? s : update(s, { selected: i });
}

/**
 * @param {PickerState} s
 * @param {string} query
 */
function setQuery(s, query) {
  if (query === s.query) return s;
  return update(s, { query, matches: filterItems(s.items, query), selected: 0 });
}

/**
 * First match of the workspace section after (`+1`) or at/before (`-1`) the selection; only in
 * the grouped view (blank query).
 * @param {PickerState} s
 * @param {1 | -1} dir
 */
function jumpSection(s, dir) {
  if (s.query.trim()) return s;
  const ws = (/** @type {number} */ i) => s.matches[i]?.item.workspaceId;
  const startOf = (/** @type {number} */ i) => {
    while (i > 0 && ws(i - 1) === ws(i)) i--;
    return i;
  };
  if (dir > 0) {
    let i = s.selected;
    while (i < s.matches.length && ws(i) === ws(s.selected)) i++;
    return i < s.matches.length ? select(s, i) : s;
  }
  const here = startOf(s.selected);
  if (s.selected > here) return select(s, here);
  return here > 0 ? select(s, startOf(here - 1)) : s;
}

/** @type {Record<string, string>} */
const TYPED = { space: " ", minus: "-", plus: "+" };

/**
 * The character a key types in search mode, or null.
 * @param {string} key formatKey text
 */
function typed(key) {
  if (key in TYPED) return /** @type {string} */ (TYPED[key]);
  if ([...key].length === 1) return key;
  const shifted = /^shift\+([a-z])$/.exec(key);
  return shifted ? /** @type {string} */ (shifted[1]).toUpperCase() : null;
}

/**
 * One key (formatKey text) in the picker.
 * @param {PickerState} state
 * @param {string} key
 * @returns {{ state: PickerState, effect: PickerEffect }}
 */
export function pickerKey(state, key) {
  /** @param {PickerState} s @param {PickerEffect} [effect] */
  const done = (s, effect = null) => ({ state: s, effect });
  switch (key) {
    case "down":
    case "ctrl+n":
      return done(select(state, state.selected + 1));
    case "up":
    case "ctrl+p":
      return done(select(state, state.selected - 1));
    case "enter": {
      const m = pickerSelection(state);
      return done(state, m ? { type: "select", tabId: m.item.tabId } : null);
    }
  }
  if (state.mode === "browse") {
    switch (key) {
      case "j":
        return done(select(state, state.selected + 1));
      case "k":
        return done(select(state, state.selected - 1));
      case "right":
        return done(jumpSection(state, 1));
      case "left":
        return done(jumpSection(state, -1));
      case "/":
        return done(update(state, { mode: "search" }));
      case "esc":
      case "q":
        return done(state, { type: "close" });
      default:
        return done(state);
    }
  }
  switch (key) {
    case "esc":
      return done(update(state, { mode: "browse" }));
    case "backspace":
      return done(setQuery(state, [...state.query].slice(0, -1).join("")));
    case "ctrl+u":
      return done(setQuery(state, ""));
    case "ctrl+w":
      return done(setQuery(state, state.query.replace(/\S*\s*$/, "")));
  }
  const ch = typed(key);
  return done(ch === null ? state : setQuery(state, state.query + ch));
}
