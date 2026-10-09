# Spec: m2-core-logic

Status: implemented (core), awaiting review; host wiring pending · Milestone: M2 · Area: `packages/vimma-core`

## User stories

- As a user, after `ctrl+b` a which-key strip lists every key I can press next with what it does,
  in a stable order; keys whose action is not built yet are greyed, exactly as in `prefix+?`.
- As a user, the status bar always shows my mode, pending keys, workspace, `tab 2/5`, the tab's
  name (my rename if I gave one) and its URL, whether the page is loading, and a config error with
  `file:line`. On a narrow window it shortens the least important parts first, and never wraps.
- As a user, `prefix+g` lists every tab in every workspace; I move with `j`/`k` (or arrows,
  `ctrl+n`/`ctrl+p`), press `/` and type a few letters of the title, URL, workspace or my rename,
  see the matching letters highlighted, and `Enter` takes me there; `Esc` backs out.
- As a user, `prefix+shift+t` renames a tab; the name replaces the page title in the status bar,
  picker and side panel, survives a restart, and renaming to an empty name restores the title.
- As the M2 host specs (Herdr tab keys, status bar, which-key strip, goto picker, tab rename), I
  hand `vimma-core` plain data and get plain data back (segments with text and theme token names,
  ranked matches with highlight ranges, picker effects). No DOM, no Firefox.

## Scope

| Module                | Exports                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `whichkey.mjs`        | `whichKey`, `compareKeys`, `isRunnable`                                                                                                      |
| `statusbar.mjs`       | `statusSegments`, `fitStatus`, `renderStatusBar`, `statusWidth`, `textWidth`, `truncate`, `displayUrl`, `WORKSPACE_COLOR_TOKENS`             |
| `picker.mjs`          | `scoreField`, `matchItem`, `filterItems`, `pickerItems`, `openPicker`, `pickerKey`, `setPickerItems`, `pickerSelection`, `TIER`              |
| `tablabels.mjs`       | `normalizeTabLabel`, `setTabLabel`, `clearTabLabel`, `pruneTabLabels`, `displayLabel`, `writeTabLabels`, `readTabLabels`, `TabLabelError`, … |
| `help.mjs` (changed)  | `bindingTable(keymap, { runnable })`: optional, adds `runnable` to each row (the same rule as the strip)                                     |
| `index.mjs` (changed) | re-exports                                                                                                                                   |

Everything is pure: inputs are never mutated, and a no-op returns its input (identity), so the
host can compare by `===`. These modules do not import `workspaces.mjs` (m3-m4-core-models, PR
#10, not on `main` yet): they take its `Workspaces` shape structurally (`{ workspaces: [{ id,
name, tabs, activeTab }], active }`), so either PR can merge first.

## Which-key (`whichkey.mjs`)

```js
whichKey(keymap, mode, pending, { runnable }) → null | {
  pending: string[],                       // as given, for the strip's heading
  sections: [{ group: string, entries: [{
    key: string,                           // formatKey of the next chord: "c", "shift+t", "minus"
    kind: "action" | "group",
    name?: string, id?: string,            // action entries
    description: string,                   // action description, or "+Panes" / "+3 bindings"
    more: number,                          // actions reachable below this key (0 for a leaf)
    runnable: boolean,
  }] }],
}
```

- `pending` is `dispatcher.pending()` (labels: `["prefix"]`, `["2", "g"]`, `["ctrl+w"]` for `<C-w>`). Leading
  digits the root does not bind are a count and are skipped, as the dispatcher does. Each label is
  matched against a child's `label` (`prefix`, `leader`) or its key.
- Returns `null` when nothing is pending (or only a count), or when `pending` does not name a node
  with children (stale input): the strip is shown only while a sequence is pending.
- **Entries**: one per child of the pending node. A child with children and no action is a
  `group`: its description is `+<Group>` when every action below it is in one action group
  (`<C-w>` → `+Panes`), else `+<n> bindings`. A child with both an action and children is an
  `action` with `more > 0`.
- **Sections** follow `ACTIONS` group order (Help, Tabs, Panes, Workspaces, …), the order of
  `prefix+?`; a group entry goes in its common group's section, else in a final `More` section.
- **Order within a section** (`compareKeys`, which-key's "alphanum, then mods"): digits
  numerically, then letters `a`–`z` (unshifted before `shift+`), then other printable characters
  by code point (`minus` / `plus` count as `-` / `+`), then named keys in `NAMED_KEYS` order;
  for the same base key, fewer modifiers first, then `shift`, `ctrl`, `alt`, `meta` (so `a`,
  `shift+a`, `ctrl+a`).
- `runnable` is a `ReadonlySet` of action **ids** the host implements; an entry is runnable when
  its id is in the set (a group: when any action below it is). `isRunnable(id, runnable)` is the
  single rule; `bindingTable(keymap, { runnable })` uses it for the help overlay.

## Status bar (`statusbar.mjs`)

```js
statusSegments({
  mode, pending = [],
  workspace = null,          // { name, index, color? }  color: a [workspaces] container colour
  tab = null,                // { index, count, title?, url?, label? }
  pane = null,               // { index, count } (M4)
  loading = false, progress = null,   // progress: 0..1 or null
  configErrors = [], configFile = "config.toml",
}) → Segment[]
/** @typedef {{ id, text, fg: string, bg: string | null, side: "left" | "right",
 *   priority: number, min: number, cut: "end" | "middle" | "none" }} Segment */
fitStatus(segments, width) → Segment[]          renderStatusBar(input, width) → Segment[]
```

| id          | side  | text                                                      | fg / bg tokens                                                                                          | priority | shrinks to    |
| ----------- | ----- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------- | ------------- |
| `mode`      | left  | `NORMAL` (mode upper-cased)                               | `--vimma-mode-<mode>-fg` / `--vimma-mode-<mode>`                                                        | 0        | never dropped |
| `pending`   | left  | `prefix g` (labels joined by spaces)                      | `--vimma-mode-prefix-fg` / `--vimma-mode-prefix` when it starts with `prefix`, else `--vimma-fg-bright` | 1        | —             |
| `error`     | right | `formatConfigError(e[0], file)`; `3 errors: …` when more  | `--vimma-error`                                                                                         | 2        | 16, end       |
| `workspace` | left  | `● 1:work`                                                | `WORKSPACE_COLOR_TOKENS[color]` (accent if none)                                                        | 3        | 6, end        |
| `tab`       | left  | `tab 2/5`                                                 | `--vimma-statusbar-fg`                                                                                  | 4        | —             |
| `title`     | left  | `displayLabel(tab)` (rename > title > URL > `New Tab`)    | `--vimma-fg-bright`                                                                                     | 5        | 8, end        |
| `loading`   | right | `42%`, or `loading` without progress                      | `--vimma-fg-dim`                                                                                        | 6        | —             |
| `pane`      | left  | `pane 1/2`, only when `count > 1`                         | `--vimma-statusbar-fg`                                                                                  | 7        | —             |
| `url`       | right | `displayUrl(url)`; omitted when the title fell back to it | `--vimma-fg-dim`                                                                                        | 8        | 12, middle    |

- Segments are emitted left side first, each side in the table's on-screen order (`mode pending
workspace tab pane title` | `loading error url`). Absent inputs produce no segment.
- `displayUrl` drops `http://` / `https://` and a lone trailing `/`; other schemes stay.
- **Width** is counted in code points (`textWidth`); one separator column between neighbouring
  segments (`statusWidth`). East Asian wide characters are not measured as two (out of scope).
- **`fitStatus(segments, width)`**: if everything fits, the input is returned. Otherwise the
  segments are visited from the least important (highest `priority`) up: each is shrunk just as
  far as needed, down to its `min` (when it shrinks at all), and if that is not enough it is
  dropped and the next one is visited. So a segment is shortened or dropped only after every less
  important one is gone. `mode` is never dropped: if it alone is still too wide, it is cut to
  `width`. Truncation uses one `…`; `middle` keeps the head and the tail.
- Order of the kept segments never changes.

## Goto picker (`picker.mjs`)

### Items and matching

`pickerItems(workspaces, info, labels)` lists every tab of every workspace in workspace order,
then tab order: `{ tabId, workspaceId, workspaceName, workspaceIndex, tabIndex, title, url,
label, display, active }`, where `info(tabId) → { title, url }` comes from the host,
`label` from `tablabels.mjs`, `display = displayLabel(…)`, `active` marks the current workspace's
active tab.

`scoreField(text, term) → null | { tier, score, ranges }` (case-insensitive):

| tier (`TIER`)   | when                                                                     | score band |
| --------------- | ------------------------------------------------------------------------ | ---------- |
| 5 `exact`       | text equals term                                                         | 5000–5999  |
| 4 `prefix`      | text starts with term                                                    | 4000–4999  |
| 3 `word`        | term starts at a word start (after a non-alphanumeric, or a lower→upper) | 3000–3999  |
| 2 `substring`   | term occurs anywhere                                                     | 2000–2999  |
| 1 `subsequence` | term's characters occur in order (the alignment with the shortest span)  | 1000–1999  |

Within a band the score adds the field weight (`display` 300, `title` 250, `url` 150,
`workspace` 100), up to 200 for an earlier start, up to 200 for fewer gaps, up to 200 for a
shorter text; so it stays inside the band. **A better tier always outranks a worse one**, whatever
the field or length. `ranges` are `[start, end)` UTF-16 offsets into `text`, sorted, merged.

`matchItem(item, query)`: the query is split on whitespace into terms; every term must match at
least one field (`display`, `title` when a rename hides it, `url`, `workspace`); per term the
best field counts; the item's score is the sum. Highlights are per field, merged.
`filterItems(items, query)`: blank query → every item, score 0, input order; otherwise the
matches sorted by score, **ties in input order** (workspace order, then tab order).

### State machine

```js
openPicker(items, { activeTabId }) → PickerState      // { items, query, mode, matches, selected }
pickerKey(state, key) → { state, effect: null | { type: "select", tabId } | { type: "close" } }
setPickerItems(state, items) → PickerState            // keeps the selected tab when it survives
pickerSelection(state) → Match | undefined
```

`key` is `formatKey(chord)`. The picker opens in **browse** mode with an empty query (Herdr),
the list in workspace order, the active tab selected.

| mode   | key                                              | effect                                                           |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------- |
| both   | `down`, `ctrl+n` / `up`, `ctrl+p`                | next / previous match; clamps at the ends (no wrap)              |
| both   | `enter`                                          | `select` the selected tab (nothing when there are no matches)    |
| browse | `j` / `k`                                        | next / previous                                                  |
| browse | `right` / `left`                                 | first tab of the next / this-or-previous workspace (empty query) |
| browse | `/`                                              | search mode, query kept                                          |
| browse | `esc`, `q`                                       | `close`                                                          |
| search | a printable character, `shift+<letter>`, `space` | appended to the query; selection resets to the best match        |
| search | `backspace` / `ctrl+w` / `ctrl+u`                | delete a character / a word / the whole query                    |
| search | `esc`                                            | back to browse mode, the filtered list stays                     |

Every other key is ignored: the same state comes back (identity) with no effect.

## Tab labels (`tablabels.mjs`)

`TabLabels` is a frozen `{ [tabId]: label }` map, separate from the workspace model.

- `normalizeTabLabel(text)`: control characters and whitespace runs become one space, trimmed,
  cut to `MAX_TAB_LABEL` (100) code points.
- `setTabLabel(labels, tabId, text)`: sets the normalised label; an empty result **clears** it
  (renaming to nothing restores the title, as `prefix+shift+t` + `Enter` on an empty prompt).
  `clearTabLabel`, `tabLabel(labels, tabId)`, `pruneTabLabels(labels, liveTabIds)` (the host
  prunes on tab close and before a write). No-ops return the input.
- `displayLabel({ label, title, url })`: rename > non-blank title > URL > `New Tab`.

**Persistence (decided): an additive optional field `tabLabels` in snapshot schema v1**, not a
new schema and not a separate file:

```json
{ "schema": 1, "active": "w1", "next": 2, "workspaces": [ … ], "tabLabels": { "t3": "mail" } }
```

- `writeTabLabels(labels)` → sorted plain object, or `undefined` when empty, so a snapshot without
  renames is byte-identical to today's v1.
- `readTabLabels(raw, tabIds)`: `undefined` → `{}`; otherwise an object whose keys are tabs of the
  snapshot and whose values are already-normalised non-empty strings; else `TabLabelError` with a
  JSON path (`tabLabels["t9"]`), in the style of `SnapshotError`.
- Compatibility: v1's `fromSnapshot` builds its result from the fields it knows, so a v1 reader
  ignores `tabLabels` (a downgrade loses renames, nothing else). No migration is needed.
- Wiring (a few lines in `snapshot.mjs` once #10 merges): `toSnapshot(s, { tabLabels })` adds
  `tabLabels: writeTabLabels(…)`; `fromSnapshot` returns `readTabLabels(doc.tabLabels, allTabs)`
  beside the state. Kept out of this PR because `snapshot.mjs` is not on `main`.

## Herdr tab actions (audit)

Every M2 row of plan §2 already exists in `actions.mjs` with its default binding, so
`actions.mjs`, `defaults.mjs`, `docs/bindings.md` and `defaults.toml` are unchanged:

| Plan §2             | Action (default)                                                   |
| ------------------- | ------------------------------------------------------------------ |
| Show all bindings   | `show_keybinds` (`prefix+?`)                                       |
| New tab             | `new_tab` (`prefix+c`, `t`)                                        |
| Jump to tab 1–9     | `select_tab_1..9` (`prefix+1..9`); `3gt` = `next_tab` with a count |
| Next / previous tab | `next_tab` / `previous_tab` (`prefix+n`/`p`, `gt`/`gT`)            |
| Rename tab          | `rename_tab` (`prefix+shift+t`)                                    |
| Close tab           | `close_tab` (`prefix+shift+x`, `x`)                                |
| Goto picker         | `goto_picker` (`prefix+g`, `b`)                                    |

Ex commands (`:tabnew`, `:q`, `:tabrename name`, `:ls`, `:map`) belong to the `:` command line
(M1, `cmdline.mjs`). Of Herdr's "learn these five first" (`prefix+c`, `prefix+v`/`minus`,
`prefix+h/j/k/l`, `prefix+w`, `prefix+q`), only **`prefix+q` (detach)** has no action; it is not
added (see Settled). A test pins the table above.

## Tests first (Given / When / Then)

Which-key (`whichkey.test.mjs`):

- Given the defaults and pending `["prefix"]` in normal mode, then the `Tabs` section lists
  `1`…`9` before `c`, `n`, `p`, `shift+t`, `shift+x`; `?` is under `Help`; `minus` is under `Panes`;
  sections are in `ACTIONS` group order.
- Given pending `[]` or `["3"]`, then `null`; given `["prefix", "zz"]`, then `null`.
- Given `runnable = {tab.new}`, then `c` is runnable and `v` is not; `bindingTable(km, {runnable})`
  marks the same rows.
- Given pending `["ctrl+w"]` (the label of `<C-w>`) in normal mode, then `h`, `shift+h`, `j`, …,
  `shift+l`, `o`, `plus`, `minus`, `<`, `>` (`compareKeys` order).
- Given user bindings `prefix+g n` and `prefix+g p` (both Tabs actions), then pending `["prefix"]`
  shows `g` as a `group` with `+Tabs`, `more: 2`; mixed groups → `+<n> bindings` in `More`.
- `leader` resolves through its label (`["leader"]` → `n`); text that is not a key sorts last.
- Given `prefix+g` bound to `goto_picker` and `prefix+g x` to `close_tab`, then `g` is an action
  entry with `more: 1`.
- Given pending `["2", "g"]` in normal mode, then the count is skipped and `t`, `shift+t`, `g` are
  listed.
- Property: `compareKeys` is a total order (antisymmetric, transitive) over random chords.

Status bar (`statusbar.test.mjs`):

- Given normal mode, workspace `{work, 1, blue}`, tab `{2, 5, "GitHub", "https://github.com/"}`,
  then texts `NORMAL`, `● 1:work`, `tab 2/5`, `GitHub`, `github.com` with the tokens above.
- Given pending `["prefix"]`, then a `pending` segment in prefix colours.
- Given a tab label `mail`, then the title segment reads `mail`; given an empty title, then the
  title reads the URL and there is no `url` segment; no URL either → `New Tab`.
- Given `loading` with `progress 0.42` → `42%`; without progress → `loading`; not loading → none.
- Given two config errors at lines 3 and 7, then `2 errors: config.toml:3: keys.new_tabb: …`.
- Given `pane {1, 1}` → no pane segment; `{1, 2}` → `pane 1/2`.
- Given width 200 → unchanged (identity); a little too narrow → only the URL is shortened (middle);
  narrower → the URL is dropped before the title is shortened; given 3 → only `mode`, cut to `NO…`.
- `truncate("abcdef", 4, "end") = "abc…"`, `"middle" = "ab…f"`, width ≤ 0 → `""`.
- Properties (random segments and widths): the result fits whenever `width ≥ 1`; `mode` is always
  kept; relative order is preserved; a fitting input is returned as is; every kept text is its
  original or a truncation of it no shorter than its `min` unless it is `mode`; when a segment is
  shortened or dropped, every less important segment is dropped.

Picker (`picker.test.mjs`):

- `scoreField("GitHub", "github")` → tier 5; `"git"` → 4; `scoreField("my-github", "git")` → 3;
  `"thub"` → 2; `"ghb"` → 1 with ranges `[0,1] [3,4] [5,6]`; `"xyz"` → `null`.
- Given tabs in `work` (`GitHub`, `Mail`) and `personal` (`Recipes`, renamed `cook`), then
  `filterItems(…, "cook")` finds the renamed tab with a `display` highlight; `"recipes"` still finds
  it through its title; `"personal"` matches both personal tabs through the workspace;
  `"work mail"` needs both terms and finds `Mail` only.
- Given two identical tabs, then ties keep workspace/tab order.
- Picker: open → browse, active tab selected; `j`, `down`, `ctrl+n` move down and clamp; `k`, `up`,
  `ctrl+p` up; `/` → search; `g`, `i`, `t` type `git`; selection is the best match; `backspace`,
  `ctrl+w`, `ctrl+u` edit; `esc` → browse with the filter; `enter` → `select` the tab; `esc` again
  → `close`; `right`/`left` jump workspace sections; an unknown key returns the same state.
- `setPickerItems` keeps the selected tab when it is still there, else clamps.
- Properties: (1) any non-blank substring of a field (no whitespace) matches it with tier ≥ 2,
  and the range spells the term; (2) a subsequence always matches (tier ≥ 1) and a
  non-subsequence never does; (3) tier dominance: for any two field matches, a higher tier has a
  higher score; `scoreField(s, s)` outscores every other term against `s`; (4) ranges are sorted,
  disjoint, non-adjacent and in bounds; (5) `filterItems` output is sorted by score descending,
  ties by input index.

Tab labels (`tablabels.test.mjs`):

- `setTabLabel({}, "t1", "  my\n mail ")` → `{ t1: "my mail" }`; setting `""` clears; same label →
  identity; 150 characters → 100.
- `pruneTabLabels({t1, t2}, ["t1"])` → `{t1}`; nothing to prune → identity.
- `displayLabel` precedence: label > title > url > `New Tab`; a whitespace title falls through.
- `writeTabLabels({})` → `undefined`; keys sorted; `readTabLabels(writeTabLabels(l), ids)`
  round-trips; `readTabLabels(undefined)` → `{}`; an array, an unknown tab, a non-string, an empty
  or non-normalised value → `TabLabelError` with the path.
- Property: `normalizeTabLabel` is idempotent and `readTabLabels(writeTabLabels(l))` round-trips.

Actions (`actions.test.mjs`): the audit table above holds for `compileKeymap()`.

Coverage stays ≥ 90 % lines/branches/functions/statements.

## Out of scope (host specs)

Rendering (the strip, the bar, the picker list), CSS, `gBrowser` events, focus, the rename prompt
UI, timers, the state file, and wiring `tabLabels` into `snapshot.mjs`. For the host:

- Feed `whichKey(keymap, mode, dispatcher.pending(), { runnable })` after every `pending` result;
  hide the strip on any other result. Use the same `runnable` set for `bindingTable`.
- Recompute `renderStatusBar(input, columns)` on mode, pending, tab, location, progress,
  workspace and config changes; `columns` = bar width ÷ the font's character width.
- The picker takes keys before the dispatcher while it is open (it is not a dispatcher mode, so
  no `MODES` change and no ADR); map `effect.select` to `selectTab(workspaces, tabId)`.
- Rename: prompt prefilled with `displayLabel(tab)`; on `Enter`, `setTabLabel`; prune on close.

## Settled (2026-10-09)

- **Which-key order is alphanumeric, not binding order**, grouped by `ACTIONS` group so the strip
  and `prefix+?` read the same way; `prefix+1..9` sort numerically before letters.
- **`runnable` is an input** (a set of action ids), never hard-coded in core: the host knows what
  it implements, and the strip and the help overlay share `isRunnable`.
- **The strip shows only while a sequence is pending**, not for a bare count (`3` alone would list
  the whole normal-mode keymap).
- **Status bar gives way least important first**: a segment is shortened, then dropped, only once
  every less important one is gone; the mode badge always stays; widths are code points.
- **The title segment shows the rename**; the URL segment hides when the title already is the URL.
- **Picker tiers are disjoint score bands** so "a better kind of match always wins" is a provable
  property, and ties keep workspace/tab order so the list does not jump while typing.
- **The picker opens in browse mode** (Herdr: `j`/`k`, `/` to search); `Esc` leaves search first,
  then closes. No wrap at the ends (fzf).
- **Tab labels are an additive optional `tabLabels` field in snapshot v1**: no schema bump and no
  migration, older v1 readers ignore it, and it lives in the one state file the host already
  writes atomically. A separate file would need its own versioning and could drift from the tab
  ids in the snapshot.
- **Empty rename clears the label**, restoring the page title.
- **No `detach` action**: Herdr's `prefix+q` detaches a terminal session from its server; a
  browser window has no equivalent, and binding it to quit would make a Herdr habit destroy the
  session. `prefix+q` stays unbound.
