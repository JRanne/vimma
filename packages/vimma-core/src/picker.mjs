/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The `prefix+g` goto picker (spec m2-core-logic): every tab of every workspace, fuzzy matching
 * with highlight ranges, and the picker's key handling as a pure state machine. The `prefix+w`
 * workspace picker (m3-workspaces 5) is the same machine over one item per workspace.
 */
import { AGENT_GLYPH } from "./agent.mjs";
import { deleteWordBackward } from "./strings.mjs";
import { displayLabel } from "./tablabels.mjs";
import { graphemes } from "./textwidth.mjs";

/** @import { TabLabels } from "./tablabels.mjs" */
/** @import { Workspaces } from "./workspaces.mjs" */
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
/**
 * @typedef {object} WorkspaceItem
 * @property {"workspace"} kind
 * @property {string} workspaceId
 * @property {string} workspaceName
 * @property {number} workspaceIndex 1-based, the workspace order
 * @property {number} tabCount
 * @property {number} foreignCount   tabs adopted from a container no workspace owns
 * @property {string} display        the name (`◇ agent` for the agent workspace)
 * @property {boolean} active        the window's active workspace
 * @property {true} [agent]          the agent workspace (docs/specs/vimma-mcp.md, decision 9)
 */
/** @import { AddonItem } from "./addons.mjs" */
/** @typedef {PickerItem | WorkspaceItem | AddonItem} AnyItem */
/** @typedef {"display" | "title" | "url" | "workspace"} Field */
/** @typedef {[start: number, end: number]} Range */
/** @typedef {{ tier: number, score: number, ranges: Range[] }} FieldMatch */
/**
 * @typedef {object} Match
 * @property {AnyItem} item
 * @property {number} score
 * @property {Partial<Record<Field, Range[]>>} highlights
 */
/**
 * @typedef {object} PickerState
 * @property {readonly AnyItem[]} items
 * @property {string} query
 * @property {"browse" | "search"} mode
 * @property {readonly Match[]} matches
 * @property {number} selected  index into matches
 */
/**
 * `select`: Enter on an item (a tab, workspace or add-on id); `move`: `m` on a workspace, the
 * current tab to go there; `addon`: one of an add-on's keys (docs/specs/addon-manager.md).
 * @typedef {null | { type: "select" | "move", id: string } | { type: "close" }
 *   | { type: "addon", op: AddonOp, id: string }} PickerEffect
 */
/** @typedef {"options" | "toggle" | "remove" | "update" | "private"} AddonOp */

/**
 * The add-on picker's own keys in browse mode.
 * @type {Readonly<Record<string, AddonOp>>}
 */
const ADDON_KEYS = Object.freeze({
  o: "options",
  x: "toggle",
  d: "remove",
  u: "update",
  "shift+p": "private",
});

/**
 * Match tiers; each owns a score band [tier·1000, tier·1000 + 999]. `folded` (diacritics
 * stripped) ranks below every exact-letter tier.
 */
export const TIER = Object.freeze({
  folded: 0,
  subsequence: 1,
  substring: 2,
  word: 3,
  prefix: 4,
  exact: 5,
});

/** @type {Record<Field, number>} */
const FIELD_WEIGHT = { display: 300, title: 250, url: 150, workspace: 100 };

/**
 * A text as grapheme clusters: `keys` compare exact letters (NFC, lower case per cluster),
 * `folded` compare without diacritics (NFD, marks dropped, lower case); `starts`/`ends` are the
 * clusters' UTF-16 offsets in the original text, for highlight ranges.
 * @typedef {{ clusters: string[], keys: string[], folded: string[], starts: number[],
 *   ends: number[] }} Units
 */

/**
 * @param {string} text
 * @returns {Units}
 */
function units(text) {
  const g = graphemes(text);
  const clusters = g.map((x) => x.segment);
  return {
    clusters,
    keys: clusters.map((c) => c.normalize("NFC").toLowerCase()),
    folded: clusters.map((c) => c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()),
    starts: g.map((x) => x.index),
    ends: g.map((x) => x.index + x.segment.length),
  };
}

/** @param {string | undefined} c */
const isAlnum = (c) => !!c && /^[\p{L}\p{N}]/u.test(c);
/** @param {string | undefined} c */
const isLower = (c) => !!c && c !== c.toUpperCase() && c === c.toLowerCase();
/** @param {string | undefined} c */
const isUpper = (c) => !!c && c !== c.toLowerCase() && c === c.toUpperCase();

/**
 * @param {string[]} clusters
 * @param {number} i
 */
function isWordStart(clusters, i) {
  const prev = clusters[i - 1];
  return i === 0 || !isAlnum(prev) || (isLower(prev) && isUpper(clusters[i]));
}

/**
 * Index of `q` as a contiguous run in `t` at or after `from`, or -1.
 * @param {string[]} t
 * @param {string[]} q
 * @param {number} [from]
 */
function indexOfRun(t, q, from = 0) {
  outer: for (let i = from; i + q.length <= t.length; i++) {
    for (let k = 0; k < q.length; k++) if (t[i + k] !== q[k]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Shortest-span alignment of `q` as a subsequence of `t`, earliest on a tie.
 * @param {string[]} t
 * @param {string[]} q
 * @returns {number[] | null}
 */
function subsequence(t, q) {
  /** @type {number[] | null} */
  let best = null;
  const first = /** @type {string} */ (q[0]);
  for (let s = t.indexOf(first); s >= 0; s = t.indexOf(first, s + 1)) {
    const pos = [s];
    let at = s + 1;
    for (let k = 1; k < q.length; k++) {
      const found = t.indexOf(/** @type {string} */ (q[k]), at);
      if (found < 0) return best;
      pos.push(found);
      at = found + 1;
    }
    if (!best || at - s < /** @type {number} */ (best.at(-1)) + 1 - /** @type {number} */ (best[0]))
      best = pos;
  }
  return best;
}

/**
 * @param {number[]} positions unit indices, ascending
 * @param {Units} u
 * @returns {Range[]}
 */
function toRanges(positions, u) {
  /** @type {Range[]} */
  const out = [];
  let prev = -2;
  for (const p of positions) {
    const last = out[out.length - 1];
    if (last && p === prev + 1) last[1] = /** @type {number} */ (u.ends[p]);
    else out.push([/** @type {number} */ (u.starts[p]), /** @type {number} */ (u.ends[p])]);
    prev = p;
  }
  return out;
}

/**
 * @param {number} tier
 * @param {number[]} positions
 * @param {number} length text length in clusters
 * @param {Field} field
 */
function score(tier, positions, length, field) {
  const start = /** @type {number} */ (positions[0]);
  const gaps = /** @type {number} */ (positions.at(-1)) + 1 - start - positions.length;
  return (
    tier * 1000 +
    FIELD_WEIGHT[field] +
    Math.max(0, 200 - start * 10) +
    Math.max(0, 200 - gaps * 25) +
    Math.max(0, 200 - length * 2)
  );
}

/**
 * @param {number} start
 * @param {number} n
 */
const run = (start, n) => Array.from({ length: n }, (_, k) => start + k);

/**
 * Case-insensitive, NFC-normalised match of one term against one field's text: exact letters
 * first (tiers subsequence..exact), then with diacritics folded away (tier `folded`).
 * @param {string} text
 * @param {string} term
 * @param {Field} [field]
 * @returns {FieldMatch | null}
 */
export function scoreField(text, term, field = "display") {
  if (!term) return null;
  const u = units(text);
  const qu = units(term);
  const q = qu.keys;
  const t = u.keys;
  /** @type {number} */
  let tier;
  /** @type {number[] | null} */
  let positions;
  let start = indexOfRun(t, q);
  if (start === 0) {
    tier = t.length === q.length ? TIER.exact : TIER.prefix;
    positions = run(0, q.length);
  } else if (start > 0) {
    tier = TIER.substring;
    for (let i = start; i >= 0; i = indexOfRun(t, q, i + 1)) {
      if (isWordStart(u.clusters, i)) {
        tier = TIER.word;
        start = i;
        break;
      }
    }
    positions = run(start, q.length);
  } else {
    positions = subsequence(t, q);
    tier = TIER.subsequence;
  }
  if (!positions) {
    // diacritics folded away; clusters that fold to nothing (lone marks) are skipped
    const qf = qu.folded.filter(Boolean);
    const idx = u.folded.flatMap((f, i) => (f ? [i] : []));
    const tf = idx.map((i) => /** @type {string} */ (u.folded[i]));
    if (!qf.length) return null;
    const at = indexOfRun(tf, qf);
    const found = at >= 0 ? run(at, qf.length) : subsequence(tf, qf);
    if (!found) return null;
    tier = TIER.folded;
    positions = found.map((i) => /** @type {number} */ (idx[i]));
    return { tier, score: score(tier, found, tf.length, field), ranges: toRanges(positions, u) };
  }
  return { tier, score: score(tier, positions, t.length, field), ranges: toRanges(positions, u) };
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
 * The id an item is selected by: a tab's, a workspace's or an add-on's.
 * @param {AnyItem} item
 */
export function itemId(item) {
  if (!("kind" in item)) return item.tabId;
  return item.kind === "addon" ? item.addonId : item.workspaceId;
}

/**
 * Every whitespace-separated term must match some field; per term the best field counts. A
 * workspace or an add-on matches by its name only.
 * @param {AnyItem} item
 * @param {string} query
 * @returns {Match | null}
 */
export function matchItem(item, query) {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  /** @type {[Field, string][]} */
  const fields =
    "kind" in item
      ? [["display", item.display]]
      : [
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
 * @param {readonly AnyItem[]} items
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
 * @param {Workspaces} state
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
 * One item per workspace, in workspace order, with its tab count (`isForeign` tells the foreign
 * ones among them).
 * @param {Workspaces} state
 * @param {(tabId: string) => boolean} [isForeign]
 * @param {string | null} [agentId]  the agent workspace's id
 * @returns {WorkspaceItem[]}
 */
export function workspaceItems(state, isForeign = () => false, agentId = null) {
  return state.workspaces.map((w, wi) =>
    Object.freeze({
      kind: /** @type {const} */ ("workspace"),
      workspaceId: w.id,
      workspaceName: w.name,
      workspaceIndex: wi + 1,
      tabCount: w.tabs.length,
      foreignCount: w.tabs.filter(isForeign).length,
      // The agent workspace's row: `◇ agent` (docs/specs/vimma-mcp.md, decision 9).
      display: w.id === agentId ? `${AGENT_GLYPH} ${w.name}` : w.name,
      active: w.id === state.active,
      ...(w.id === agentId ? { agent: /** @type {const} */ (true) } : {}),
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
 * @param {readonly AnyItem[]} items
 * @param {{ activeId?: string | null }} [options]  the item selected at first (`itemId`)
 * @returns {PickerState}
 */
export function openPicker(items, { activeId = null } = {}) {
  const matches = filterItems(items, "");
  const at = matches.findIndex((m) => itemId(m.item) === activeId);
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
 * New items (a tab opened, closed or retitled); the selected item stays selected if it survives.
 * @param {PickerState} state
 * @param {readonly AnyItem[]} items
 * @returns {PickerState}
 */
export function setPickerItems(state, items) {
  const current = pickerSelection(state);
  const id = current && itemId(current.item);
  const matches = filterItems(items, state.query);
  const at = matches.findIndex((m) => itemId(m.item) === id);
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
  const ws = (/** @type {number} */ i) => {
    const item = s.matches[i]?.item;
    return item && "workspaceId" in item ? item.workspaceId : undefined;
  };
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
      return done(state, m ? { type: "select", id: itemId(m.item) } : null);
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
      case "m": {
        const m = pickerSelection(state);
        const ws = m && "kind" in m.item && m.item.kind === "workspace" ? m.item : null;
        return done(state, ws ? { type: "move", id: ws.workspaceId } : null);
      }
      case "esc":
      case "q":
        return done(state, { type: "close" });
      default: {
        const op = Object.hasOwn(ADDON_KEYS, key) ? ADDON_KEYS[key] : undefined;
        const m = pickerSelection(state);
        if (op && m && "kind" in m.item && m.item.kind === "addon") {
          return done(state, { type: "addon", op, id: m.item.addonId });
        }
        return done(state);
      }
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
      return done(setQuery(state, deleteWordBackward(state.query)));
  }
  const ch = typed(key);
  return done(ch === null ? state : setQuery(state, state.query + ch));
}
