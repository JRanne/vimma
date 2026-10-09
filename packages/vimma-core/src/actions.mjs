/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The closed set of actions. Single source of truth for the dispatcher, config validation,
 * `prefix+?`, the `:` completion list and docs/bindings.md (`npm run gen-docs`).
 *
 * `name` is the config name used in `[keys]` (Herdr style, snake_case); `id` is the dotted
 * identifier the host executes and that `[modal.*]` tables may use. Several names can share an
 * `id` with different `arg`s (select_tab_1..9 → tab.goto with arg 1..9).
 */

/**
 * @typedef {object} ActionDef
 * @property {string} name
 * @property {string} id
 * @property {string} group
 * @property {string} description
 * @property {number} [arg]
 * @property {readonly string[]} [aliases]
 */

/** @type {ActionDef[]} */
const defs = [];

/**
 * @param {string} group
 * @param {Array<[name: string, id: string, description: string, extra?: Partial<ActionDef>]>} rows
 */
function group(group, rows) {
  for (const [name, id, description, extra] of rows) {
    defs.push(Object.freeze({ name, id, group, description, ...extra }));
  }
}

/**
 * @param {string} name
 * @param {string} id
 * @param {(n: number) => string} describe
 * @returns {Array<[string, string, string, Partial<ActionDef>]>}
 */
function numbered(name, id, describe) {
  return Array.from({ length: 9 }, (_, i) => [
    `${name}_${i + 1}`,
    id,
    describe(i + 1),
    { arg: i + 1 },
  ]);
}

group("Help", [
  ["show_keybinds", "help.show", "Show all bindings (filter with /)"],
  ["help_close", "help.close", "Close the bindings overlay"],
  ["help_filter", "help.filter", "Filter the bindings overlay"],
]);

group("Tabs", [
  ["new_tab", "tab.new", "New tab"],
  ["next_tab", "tab.next", "Next tab (with a count: go to tab N)"],
  ["previous_tab", "tab.previous", "Previous tab"],
  ...numbered("select_tab", "tab.goto", (n) => `Jump to tab ${n} in this workspace`),
  ["rename_tab", "tab.rename", "Rename tab"],
  ["close_tab", "tab.close", "Close tab"],
]);

group("Panes", [
  ["split_vertical", "pane.split_vertical", "Split right"],
  ["split_horizontal", "pane.split_horizontal", "Split down"],
  ["focus_pane_left", "pane.focus_left", "Focus pane to the left"],
  ["focus_pane_down", "pane.focus_down", "Focus pane below"],
  ["focus_pane_up", "pane.focus_up", "Focus pane above"],
  ["focus_pane_right", "pane.focus_right", "Focus pane to the right"],
  ["swap_pane_left", "pane.swap_left", "Swap with pane to the left"],
  ["swap_pane_down", "pane.swap_down", "Swap with pane below"],
  ["swap_pane_up", "pane.swap_up", "Swap with pane above"],
  ["swap_pane_right", "pane.swap_right", "Swap with pane to the right"],
  ["zoom", "pane.zoom", "Zoom pane"],
  ["close_pane", "pane.close", "Close pane; the last pane closes the tab"],
  ["resize_mode", "pane.resize_mode", "Resize mode"],
  ["resize_narrower", "pane.resize_narrower", "Make pane narrower"],
  ["resize_wider", "pane.resize_wider", "Make pane wider"],
  ["resize_taller", "pane.resize_taller", "Make pane taller"],
  ["resize_shorter", "pane.resize_shorter", "Make pane shorter"],
]);

group("Workspaces", [
  ["next_workspace", "workspace.next", "Next workspace"],
  [
    "previous_workspace",
    "workspace.previous",
    "Previous workspace",
    { aliases: ["prev_workspace"] },
  ],
  ["workspace_picker", "workspace.picker", "Workspace picker"],
  ["new_workspace", "workspace.new", "New workspace"],
  ["rename_workspace", "workspace.rename", "Rename workspace"],
  ["close_workspace", "workspace.close", "Close workspace"],
]);

group("Navigation", [
  ["goto_picker", "goto.picker", "Goto picker: every tab in every workspace"],
  ["toggle_sidebar", "sidebar.toggle", "Open / close the side panel"],
  ["scroll_down", "scroll.down", "Scroll down"],
  ["scroll_up", "scroll.up", "Scroll up"],
  ["scroll_left", "scroll.left", "Scroll left"],
  ["scroll_right", "scroll.right", "Scroll right"],
  ["scroll_half_down", "scroll.half_down", "Scroll half a page down"],
  ["scroll_half_up", "scroll.half_up", "Scroll half a page up"],
  ["scroll_top", "scroll.top", "Scroll to top"],
  ["scroll_bottom", "scroll.bottom", "Scroll to bottom"],
  ["history_back", "history.back", "Go back"],
  ["history_forward", "history.forward", "Go forward"],
  ["reload", "page.reload", "Reload page"],
]);

group("Hints", [
  ["follow_link", "hint.follow", "Follow link"],
  ["follow_link_new_tab", "hint.follow_new_tab", "Follow link in new tab"],
  ["hint_cancel", "hint.cancel", "Leave hint mode"],
]);

group("Find", [
  ["find_forward", "find.forward", "Search in page"],
  ["find_backward", "find.backward", "Search backwards in page"],
  ["find_next", "find.next", "Next match"],
  ["find_previous", "find.previous", "Previous match"],
]);

group("Modes", [
  ["normal_mode", "mode.normal", "Back to normal mode"],
  ["insert_mode", "mode.insert", "Insert mode: focus the first input"],
  ["copy_mode", "mode.visual", "Copy mode (caret browsing + selection)"],
  ["command_line", "command.open", "Command line"],
  ["command_cancel", "command.cancel", "Close the command line"],
]);

group("Copy mode", [
  ["caret_left", "caret.left", "Move caret left"],
  ["caret_down", "caret.down", "Move caret down"],
  ["caret_up", "caret.up", "Move caret up"],
  ["caret_right", "caret.right", "Move caret right"],
  ["caret_word_forward", "caret.word_forward", "Move caret a word forward"],
  ["caret_word_backward", "caret.word_backward", "Move caret a word back"],
  ["yank_selection", "selection.yank", "Copy selection and leave copy mode"],
]);

group("Side panel", [
  ...numbered("panel_select", "panel.select", (n) => `Select row ${n}`),
  ["panel_down", "panel.down", "Next row"],
  ["panel_up", "panel.up", "Previous row"],
  ["panel_open", "panel.open", "Open the selected row"],
  ["panel_close", "panel.close", "Close the side panel"],
]);

group("Config", [["reload_config", "config.reload", "Reload config"]]);

/** @type {readonly ActionDef[]} */
export const ACTIONS = Object.freeze(defs);

/** @type {Map<string, ActionDef>} */
const byName = new Map();
/** @type {Map<string, ActionDef[]>} */
const byId = new Map();
for (const a of ACTIONS) {
  byName.set(a.name, a);
  for (const alias of a.aliases ?? []) byName.set(alias, a);
  byId.set(a.id, [...(byId.get(a.id) ?? []), a]);
}

/**
 * Look up by config name (or alias).
 * @param {string} name
 * @returns {ActionDef | undefined}
 */
export function getAction(name) {
  return byName.get(name);
}

/**
 * Resolve a config value: a config name, an alias, or a dotted id that names exactly one action.
 * @param {string} text
 * @returns {ActionDef | undefined}
 */
export function resolveActionName(text) {
  const named = byName.get(text);
  if (named) return named;
  const ids = byId.get(text);
  return ids && ids.length === 1 ? ids[0] : undefined;
}

/**
 * @param {string} a
 * @param {string} b
 */
function editDistance(a, b) {
  /** @type {number[]} */
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        /** @type {number} */ (prev[j]) + 1,
        /** @type {number} */ (cur[j - 1]) + 1,
        /** @type {number} */ (prev[j - 1]) + cost,
      );
    }
    prev = cur;
  }
  return /** @type {number} */ (prev[b.length]);
}

/**
 * Closest valid action spelling, in the same style (dotted id vs config name) as the input.
 * @param {string} text
 * @returns {string | undefined}
 */
export function suggestAction(text) {
  return closest(text, text.includes(".") ? [...byId.keys()] : [...byName.keys()]);
}

/**
 * The candidate nearest to `text` by edit distance, if it is near enough to be a likely typo.
 * @param {string} text
 * @param {Iterable<string>} pool
 * @returns {string | undefined}
 */
export function closest(text, pool) {
  let best;
  let bestD = Infinity;
  for (const cand of pool) {
    const d = editDistance(text, cand);
    if (d < bestD) {
      bestD = d;
      best = cand;
    }
  }
  return bestD <= Math.max(2, Math.floor(text.length / 3)) ? best : undefined;
}

/**
 * The human label of a dispatched action: the description of the action with its id and arg,
 * else the id itself.
 * @param {{ id: string, arg?: number }} action
 * @returns {string}
 */
export function describeAction(action) {
  const def = byId.get(action.id)?.find((a) => a.arg === action.arg);
  return def?.description ?? action.id;
}

/**
 * What the host shows for a bound action it cannot run yet (spec: docs/specs/m2-tab-keys.md).
 * @param {{ id: string, arg?: number }} action
 * @returns {string}
 */
export function notImplementedText(action) {
  return `${describeAction(action)}: not implemented yet`;
}
