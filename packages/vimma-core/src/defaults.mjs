/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Default configuration, as the object a TOML parser would produce from defaults.toml.
 * packages/vimma-core/defaults.toml is generated from this (npm run gen-docs).
 */

import { DEFAULT_HINT_CHARS } from "./hints.mjs";
import { PANES_MAX_DEFAULT } from "./panes.mjs";

/**
 * @typedef {object} UserConfig
 * @property {Record<string, string | string[]>} [keys]
 * @property {{ leader?: string, timeout_ms?: number } & Record<string, unknown>} [modal]
 * @property {Record<string, string[]>} [unbind]
 * @property {number} [schema]
 * @property {Record<string, WorkspaceInput>} [workspaces]
 * @property {ThemeInput} [theme]
 * @property {{ max?: number }} [panes]
 * @property {Record<string, { insert?: import("./editable.mjs").InsertSiteMode }>} [sites]
 */

/**
 * @typedef {object} WorkspaceInput
 * @property {string} [color]
 * @property {string} [icon]
 * @property {string} [home]
 * @property {boolean} [autofill]
 */

/**
 * @typedef {object} ThemeInput
 * @property {"omarchy" | "file"} [source]
 * @property {string} [font]
 * @property {Record<string, string>} [colors]
 */

/** Herdr's default keymap (https://herdr.dev/docs/keyboard/), plus vimma's own global chords. */
const keys = {
  prefix: "ctrl+b",
  show_keybinds: ["prefix+?"],
  new_tab: ["prefix+c"],
  next_tab: ["prefix+n"],
  previous_tab: ["prefix+p"],
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`select_tab_${i + 1}`, [`prefix+${i + 1}`]]),
  ),
  rename_tab: ["prefix+shift+t"],
  close_tab: ["prefix+shift+x"],
  split_vertical: ["prefix+v"],
  split_horizontal: ["prefix+minus"],
  focus_pane_left: ["prefix+h"],
  focus_pane_down: ["prefix+j"],
  focus_pane_up: ["prefix+k"],
  focus_pane_right: ["prefix+l"],
  swap_pane_left: ["prefix+shift+h"],
  swap_pane_down: ["prefix+shift+j"],
  swap_pane_up: ["prefix+shift+k"],
  swap_pane_right: ["prefix+shift+l"],
  zoom: ["prefix+z"],
  close_pane: ["prefix+x"],
  resize_mode: ["prefix+r"],
  next_workspace: ["ctrl+i"],
  previous_workspace: ["ctrl+u"],
  workspace_picker: ["prefix+w"],
  new_workspace: ["prefix+shift+n"],
  rename_workspace: ["prefix+shift+w"],
  close_workspace: ["prefix+shift+d"],
  goto_picker: ["prefix+g"],
  toggle_sidebar: ["prefix+b", "<leader>n"],
  toggle_bookmarks: ["prefix+shift+b", "<leader>b"],
  add_bookmark: ["prefix+a"],
  copy_mode: ["prefix+["],
};

const modal = {
  leader: " ",
  timeout_ms: 800,
  hint_chars: DEFAULT_HINT_CHARS,
  normal: {
    j: "scroll.down",
    k: "scroll.up",
    h: "scroll.left",
    l: "scroll.right",
    d: "scroll.half_down",
    u: "scroll.half_up",
    gg: "scroll.top",
    G: "scroll.bottom",
    H: "history.back",
    L: "history.forward",
    r: "page.reload",
    f: "hint.follow",
    F: "hint.follow_new_tab",
    "/": "find.forward",
    "?": "find.backward",
    n: "find.next",
    N: "find.previous",
    i: "mode.insert",
    v: "mode.visual",
    ":": "command.open",
    t: "tab.new",
    x: "tab.close",
    gt: "tab.next",
    gT: "tab.previous",
    b: "goto.picker",
    yy: "page.yank_url",
    p: "page.open_clipboard",
    P: "page.open_clipboard_new_tab",
    gi: "page.focus_input",
    gu: "page.url_up",
    gU: "page.url_root",
    gf: "page.view_source",
    "<C-w>h": "pane.focus_left",
    "<C-w>j": "pane.focus_down",
    "<C-w>k": "pane.focus_up",
    "<C-w>l": "pane.focus_right",
    "<C-w>H": "pane.swap_left",
    "<C-w>J": "pane.swap_down",
    "<C-w>K": "pane.swap_up",
    "<C-w>L": "pane.swap_right",
    "<C-w>o": "pane.zoom",
    "<C-w><": "pane.resize_narrower",
    "<C-w>>": "pane.resize_wider",
    "<C-w>+": "pane.resize_taller",
    "<C-w>-": "pane.resize_shorter",
  },
  insert: { "<Esc>": "mode.normal" },
  visual: {
    "<Esc>": "mode.normal",
    h: "caret.left",
    j: "caret.down",
    k: "caret.up",
    l: "caret.right",
    w: "caret.word_forward",
    b: "caret.word_backward",
    0: "caret.line_start",
    $: "caret.line_end",
    gg: "caret.top",
    G: "caret.bottom",
    e: "caret.word_end",
    ge: "caret.word_end_backward",
    W: "caret.bigword_forward",
    B: "caret.bigword_backward",
    E: "caret.bigword_end",
    "^": "caret.first_nonblank",
    "{": "caret.paragraph_backward",
    "}": "caret.paragraph_forward",
    f: "caret.find_forward",
    F: "caret.find_backward",
    t: "caret.till_forward",
    T: "caret.till_backward",
    ";": "caret.find_repeat",
    ",": "caret.find_repeat_reverse",
    v: "selection.toggle",
    V: "selection.line",
    o: "selection.swap",
    iw: "selection.inner_word",
    aw: "selection.a_word",
    y: "selection.yank",
    Y: "selection.yank_lines",
  },
  command: { "<Esc>": "command.cancel" },
  hint: { "<Esc>": "hint.cancel" },
  help: { "<Esc>": "help.close", "/": "help.filter", q: "help.close" },
  panel: {
    ...Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`${i + 1}`, `panel_select_${i + 1}`]),
    ),
    j: "panel.down",
    k: "panel.up",
    "<CR>": "panel.open",
    "<Esc>": "panel.close",
    // The bookmarks panel (docs/specs/bookmarks.md), neo-tree's keys; nothing in the tabs panel.
    h: "bookmarks.collapse",
    l: "bookmarks.expand",
    t: "bookmarks.open_tab",
    s: "bookmarks.open_vsplit",
    S: "bookmarks.open_hsplit",
    a: "bookmarks.add",
    A: "bookmarks.add_folder",
    r: "bookmarks.rename",
    m: "bookmarks.move",
    d: "bookmarks.delete",
    y: "bookmarks.yank",
    "/": "bookmarks.filter",
  },
  // ctrl+b r (m4-split-panes sub-spec 5, ADR-014): each key moves the focused pane's divider a
  // step; a count repeats it (3l).
  resize: {
    h: "pane.resize_narrower",
    l: "pane.resize_wider",
    j: "pane.resize_taller",
    k: "pane.resize_shorter",
    "<Left>": "pane.resize_narrower",
    "<Right>": "pane.resize_wider",
    "<Down>": "pane.resize_taller",
    "<Up>": "pane.resize_shorter",
    "<lt>": "pane.resize_narrower",
    ">": "pane.resize_wider",
    "+": "pane.resize_taller",
    "-": "pane.resize_shorter",
    "<Esc>": "pane.resize_exit",
    "<CR>": "pane.resize_exit",
    q: "pane.resize_exit",
  },
};

/** Values a `[workspaces.<name>]` table takes for keys it leaves out. */
export const WORKSPACE_DEFAULTS = Object.freeze({ color: "gray", icon: "circle", autofill: true });

const theme = { source: /** @type {const} */ ("omarchy"), font: "monospace", colors: {} };

/** @type {Readonly<UserConfig>} */
export const DEFAULT_CONFIG = Object.freeze({
  keys,
  modal,
  unbind: {},
  workspaces: {},
  theme,
  panes: { max: PANES_MAX_DEFAULT },
  sites: {},
});

/** @param {string} s */
const tomlString = (s) => JSON.stringify(s);

/** @param {string} k */
const tomlKey = (k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlString(k));

/**
 * Render DEFAULT_CONFIG as defaults.toml.
 * @returns {string}
 */
export function formatDefaultsToml() {
  const lines = [
    "# vimma default configuration.",
    "# Generated from packages/vimma-core/src/defaults.mjs by `npm run gen-docs`; do not edit.",
    "# Copy any line into ~/.config/vimma/config.toml to change it.",
    "schema = 2",
    "",
    "[keys]",
  ];
  for (const [name, value] of Object.entries(keys)) {
    const v = Array.isArray(value) ? `[${value.map(tomlString).join(", ")}]` : tomlString(value);
    lines.push(`${tomlKey(name)} = ${v}`);
  }
  lines.push(
    "",
    "[modal]",
    `leader = ${tomlString(modal.leader)}`,
    `timeout_ms = ${modal.timeout_ms}`,
    "# Hint labels are made of these characters, the first ones most often.",
    `hint_chars = ${tomlString(modal.hint_chars)}`,
  );
  for (const [mode, table] of Object.entries(modal)) {
    if (typeof table !== "object") continue;
    lines.push("", `[modal.${mode}]`);
    for (const [seq, action] of Object.entries(table)) {
      lines.push(`${tomlString(seq)} = ${tomlString(action)}`);
    }
  }
  lines.push(
    "",
    "[unbind]",
    "normal = []",
    "",
    "# Order here is ctrl+i order; each workspace is a Firefox container. None by default.",
    `# Left-out keys: color = ${tomlString(WORKSPACE_DEFAULTS.color)}, icon = ${tomlString(WORKSPACE_DEFAULTS.icon)}, autofill = ${WORKSPACE_DEFAULTS.autofill}.`,
    "[workspaces]",
    '# work = { color = "blue", icon = "briefcase", home = "https://intranet.example" }',
    "",
    '# "omarchy" follows the current Omarchy theme (Tokyo Night without one); "file" is Tokyo Night.',
    "[theme]",
    `source = ${tomlString(theme.source)}`,
    `font = ${tomlString(theme.font)}`,
    "",
    "# Overrides on top of the palette, with the keys of Omarchy's colors.toml.",
    "[theme.colors]",
    '# accent = "#7aa2f7"',
    "",
    "# The most panes (live pages) one workspace shows at once, 1 to 16.",
    "[panes]",
    `max = ${PANES_MAX_DEFAULT}`,
    "",
    "# Per-site insert mode: auto (detect text fields), never (keys stay vimma's), always.",
    "# A host also covers its subdomains. None by default.",
    '# [sites."docs.google.com"]',
    '# insert = "always"',
    "",
  );
  return lines.join("\n");
}

/** The lines of defaults.toml's header, which the template replaces. */
const DEFAULTS_HEADER = 3;

/**
 * What `:config` writes when config.toml does not exist yet (spec m5-config-load): defaults.toml
 * with every setting commented out, so the file means exactly the defaults until a line is
 * uncommented. Table headers stay, so an uncommented line lands in its table.
 * @returns {string}
 */
export function formatConfigTemplate() {
  const body = formatDefaultsToml()
    .split("\n")
    .slice(DEFAULTS_HEADER)
    .map((line) =>
      line === "" || line.startsWith("#") || line.startsWith("[") || line.startsWith("schema =")
        ? line
        : `# ${line}`,
    );
  return [
    "# Vimma config. Every line below is a default, commented out: uncomment one and change it.",
    "# Vimma reads this file within 2 seconds of a save; :source reads it at once.",
    "# Reference: docs/guide.md, section config.toml.",
    ...body,
  ].join("\n");
}
