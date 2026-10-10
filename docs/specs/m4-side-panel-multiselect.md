# Spec: m4-side-panel-multiselect

Status: done · Milestone: after M4 (builds on [tiling-layouts](tiling-layouts.md) and
the side panel of [m3-workspaces](m3-workspaces.md) sub-spec 6) · Area:
`packages/vimma-core/src/sidepanel.mjs`, `layouts.mjs`, `defaults.mjs`, `actions.mjs`;
`ui/side-panel.mjs`, `split/PaneView.mjs`, `host/VimmaHost.sys.mjs`, `side-panel.css`. No
upstream patch.

## The user's words

"A feature that allows selecting tabs from the side panel, and then when pressing a key the
panels should be shown in the same view. Select two tabs and show them in split view, select
three and show them split or dwindle etc."

## User stories

- As a user, in the side panel (`ctrl+b b`) `space` marks the highlighted tab and moves down,
  as ranger and neo-tree do; `space` on a marked row unmarks it.
- As a user, `V` starts a line-wise range: `j` / `k` stretch it, and `space` or `V` marks every
  row in it.
- As a user, `Enter` with marks shows the marked tabs together as the panes of this workspace,
  arranged with the workspace's layout (dwindle by default, or the preset I last picked with
  `ctrl+b space`), and closes the panel. No page reloads.
- As a user, `Esc` ends a range first, then clears the marks, and only then closes the panel.
- As a user, I can see which rows are marked without relying on colour (a `●` in the gutter
  plus a bar), the header says "2 marked", and a screen reader hears the rows as checked and the
  count when it changes.
- As a user, marking more tabs than `[panes] max` and pressing `Enter` says
  "Show together: at most 4 panes" and changes nothing; the marks stay so I can drop some.

## Research

- **ranger / neo-tree / Vim:** ranger's `space` toggles a mark and moves down, `V` starts a
  visual range whose rows are marked when it ends; neo-tree's `V` selects lines and an operator
  then acts on all of them. Vim's own `Esc` leaves visual mode before anything else.
- **Vimma today:**
  - `[modal.panel]` (defaults.mjs) is shared by the side panel and the bookmarks panel.
    `space` and `V` are free in it (bound: digits, `j k Enter Esc x I ctrl+shift+t` and the
    bookmarks' `h l t s S a A r m d y /`). The leader is `space` but has no default bindings
    (guide, "Every key is yours"); a leader binding the user adds works in panel mode too
    (keymap.mjs), and then `space` is both a binding and a prefix: the dispatcher waits
    `timeout_ms` and then marks (its usual ambiguity rule), so nothing breaks.
  - The panel lists the active workspace's tabs; pinned tabs belong to no workspace and are not
    listed (a row pinned since it was drawn has `pinned`).
  - `PaneView` holds the shown tree; `#set` + `reconcile()` make Firefox match any tree. A tab
    leaving the split rebuilds the wrapper (`unsplitTabs` + `addTabSplitView`, ADR-013), which
    moves panels and never recreates a `<browser>`; tiling-layouts measured no reload.
  - `createRow` (panes.mjs) builds a row of tabs; `arrange` (layouts.mjs) rearranges a tree into
    a preset. Together they build "these tabs in this layout" with no new tree code.
  - Rows carry the tab's `linkedPanel`, or a uuid for a lazy (never selected) tab;
    `gBrowser.insertBrowser(tab)` gives a lazy tab its panel (Firefox's split view does the same
    in `showSplitViewPanels`).
  - The m7-a11y contract: the panel's list is a single-select `listbox` whose `aria-selected`
    row is the highlight (`aria-activedescendant`), checked by `browser_vimma_a11y.js`.

## Decisions

1. **Keys** (`[modal.panel]`, all rebindable, new actions in the "Side panel" group):
   `<Space>` → `panel.mark` (`panel_mark`), `V` → `panel.visual` (`panel_visual`). `Enter`
   (`panel.open`) and `Esc` (`panel.close`) keep their actions and gain the mark-aware meaning
   below, so one binding still does "go" and "back". The bookmarks panel ignores both new
   actions, as it ignores `x`.
2. **`space`:** toggles the mark on the highlighted row, then moves down one row (stays on the
   last). In a range it marks the range instead and ends it.
3. **`V`:** starts a range anchored on the highlighted row; `j` / `k` move the highlight and the
   range is anchor..highlight. `V` or `space` again marks every row in it (a union: rows already
   marked stay marked) and ends it. `Enter` in a range marks it and then acts as below.
4. **`Esc`:** ends a range; else clears the marks; else closes the panel (as today).
5. **`Enter` with marks:** one mark goes to that tab and closes the panel, exactly as `Enter`
   on its row. Two or more become the panes of the current workspace's view, replacing its
   split; `Enter` without marks is unchanged. Digits still go to their row's tab.
6. **Order: tab order** (the panel's row order), not mark order. It is what you see in the
   panel, it is well defined for ranges, and it matches how `ctrl+b space` reads panes (reading
   order). The first pane (dwindle's big half) is the first marked row. Firefox's split view
   keeps a split's tabs together in the tab strip (`addTabSplitView` inserts the wrapper before
   its first tab), so after a split its tabs sit next to each other in the panel: tab order is
   today's, not the order the tabs were opened in.
7. **Focus:** the highlighted row when it is marked, else the first marked row. That is "the
   one I am on", and main-* presets make it the main pane (tiling-layouts decision 3).
8. **Layout:** the preset the workspace's split last had (`Panes.layout`, set by
   `ctrl+b space` / `:layout`) when it has one; else `[panes] layout`: `"dwindle"` (default)
   arranges as dwindle, `"manual"` puts them in a row, side by side (the shape Firefox's own
   split view uses). The stored preset stays stored, so `ctrl+b space` continues from it; a tree
   built from `[panes] layout` alone stores no preset, as before. 2 tabs on a wide window are
   side by side in dwindle, 3 a dwindle (`x[a, y[b, c]]`), 4 the spiral.
9. **Limits:** more marks than `[panes] max` is refused with "Show together: at most N panes";
   a preset with no room (only past 10 panes) with core's "no space for …" reason. Nothing
   changes and the panel stays open with its marks.
10. **Membership:** tabs in the old split that are not marked leave it and stay as ordinary tabs
    of the workspace; marked tabs not in it join. Pages are moved, never reloaded (reconcile).
11. **Pinned:** a pinned row cannot be marked ("pinned tab: unpin it to show it in a split"):
    pinned tabs belong to no workspace, and a pane tree holds only the workspace's tabs
    (`planSplit` throws for anything else). A range skips pinned rows silently. In practice the
    panel lists no pinned tab, so this is the rare row pinned after it was drawn.
12. **After:** the panel closes, as after `Enter` today; focus goes to the focused pane's page.
    Marks live in the panel's state, so they are gone with it. A refresh (a tab opened, closed,
    retitled) keeps marks on tabs still listed; a workspace switch (`ctrl+b )`) clears them.
13. **Lazy tabs:** a marked tab that was never selected gets its browser
    (`gBrowser.insertBrowser`) before the tree is built, so it can be a pane.
14. **Marker and a11y (deviation from "aria-selected / multiselectable"):** `aria-selected`
    already means the highlight in this single-select listbox, a contract the m7-a11y test pins
    (the active row is selected and focused). Marks therefore use `aria-checked` on the options
    (ARIA 1.2: options in a listbox may be checkable), set on every row while any row is marked
    or a range is open and absent otherwise, so a list without marks reads as before. Visually a
    marked row has a `●` in a gutter column and a green bar on its leading edge
    (`--vimma-text-green`), so the glyph carries it without colour; a row inside an open range has
    a dim `│` there. The header gains a `role="status"` count: "2 marked", or
    "range: 3 · 2 marked" while a range is open; empty with no marks. The footer hint names the
    keys.
15. **Core:** `sidepanel.mjs` gains `marked` and `anchor` in `PanelState`, the two actions, the
    mark-aware `panel.open` / `panel.close`, a `together` effect (`ids` in row order, `focus`),
    `markedRows`/`inRange`, and `markSummary` for the header text. `layouts.mjs` gains
    `togetherRefusal(ids, options)` and `showTogether(ids, options)`, which compose `createRow`
    and `arrange` (no new tree builder) and `togetherLayout(panes, mode)`. `PaneView.showTabs`
    applies it; the host wires the effect.
16. **`:` command:** not in this change. `:split` is taken (split down); a `:panes 2 5 7` that
    picks rows by number is a follow-up.

## Test plan

- **Vitest** `sidepanel.test.mjs`: `space` toggles and moves down, stays on the last row,
  unmarks; pinned refused; `V` + `j`/`k` + `V`/`space` marks a range (union, either direction,
  pinned skipped); `Esc` order (range, marks, close); `Enter` with 0, 1, 2+ marks and in a
  range (row order, focus rule); refresh keeps listed marks, drops closed tabs, a workspace
  switch clears; `markSummary`. Default keys reach the actions through the dispatcher.
  `layouts.test.mjs`: `showTogether` for 2, 3, 4 tabs in dwindle (shapes), a preset kept and
  used (main-vertical with the focus as main, tiled), manual is a row, focus, `layout` stored only
  for a preset; `togetherRefusal` over max and with no space; `togetherLayout`.
- **Mochitest** `browser_vimma_side_panel_marks.js`: marking with `space` / `V`, the `●` gutter,
  `aria-checked`, the header count; `Esc` order; `Enter` with 2, 3 and 4 marks (pane count, tree
  shape, focus, panel closed); a tab of the old split not marked leaves it and stays open; no
  reload (same `<browser>`, `outerWindowID`, a JS marker, a typed form value and scroll position
  kept); 5 marks with `max = 4` refused with the notice and nothing changed; a stored preset
  (`main-horizontal`) used.
- Snapshots: `help.test.mjs.snap` and `defaults.test.mjs.snap` gain the two rows / keys.

## Out of scope

Marks across workspaces; marking in the bookmarks panel; mouse selection (click / shift-click);
`:panes 2 5 7`; keeping marks after the panel closes.

## Results

Done: `panel.mark` / `panel.visual` and the mark-aware `panel.open` / `panel.close` in core
`sidepanel.mjs`; `showTogether` / `togetherRefusal` in `layouts.mjs` (createRow + arrange, no
new tree builder); `PaneView.showTabs`, `pane-ops.mjs`'s `showTabs`, the panel's gutter, count
and `aria-checked`.

- **Red/green:** Vitest red with 36 failing (no marks, no `showTogether`, unknown actions), green
  after (2572 passed). The mochitest `browser_vimma_side_panel_marks.js` red before the UI and
  host code (7 unexpected: no count, nothing marked, nothing shown together), green after (143
  checks). The side panel, a11y, pane keys / focus / swap-resize / adopt / workspaces / layouts,
  split layout, bookmarks, help overlay and workspace buffer key suites together: 1524 checks, 0
  unexpected.
- **No reloads, measured:** for 2, 3 and 4 tabs shown together each page keeps its `<browser>`,
  `outerWindowID`, document (`innerWindowId`), history length, a JS marker, the text typed in a
  field and its scroll position (1234 px).
- **Found while testing:** the split view regroups a split's tabs in the tab strip, so rows move
  after a split (decision 6 now says so); the test derives its expectation from the row order.
- **Snapshots:** `help.test.mjs.snap` (`panel_open` and `panel_close` describe the marks; the
  `panel_mark` and `panel_visual` rows) and `defaults.test.mjs.snap` (the two `[modal.panel]`
  keys) were re-recorded, with `defaults.toml` and `docs/bindings.md` regenerated. No e2e
  baseline changed (none shows the side panel).
