# Spec: side-panel-unsplit

Status: draft, waiting on the open questions · Milestone: after M4 (builds on
[m4-side-panel-multiselect](m4-side-panel-multiselect.md), [m4-split-panes](m4-split-panes.md) and
[tiling-layouts](tiling-layouts.md)) · Area: `packages/vimma-core/src/sidepanel.mjs`,
`layouts.mjs` (or `panes.mjs`), `actions.mjs`; `ui/side-panel.mjs`, `split/PaneView.mjs`,
`host/pane-ops.mjs`, `host/VimmaHost.sys.mjs`, `side-panel.css`. No upstream patch.

## The user's words

"we also need feature that allows unsplitting split view. when opening sidebar in split view show
which windows were selected and then allow unselecting them similarly to how they were selected
for split in a first place" (2026-10-12)

## User stories

- As a user with a split (say editor, docs and chat as three panes), `ctrl+b b` opens the side
  panel with those three tabs already marked, so I can see at a glance which tabs are the panes.
- As a user, `space` on a marked pane row unmarks it, as it does for any mark. Applying the change
  takes that tab out of the split; the tab stays open as an ordinary tab of the workspace, and the
  other panes stay shown together. No page reloads.
- As a user, unmarking until one tab is left and applying ends the split: that tab is shown alone.
- As a user, `space` on a tab that is not a pane marks it, and applying adds it as a pane, within
  `[panes] max`.
- As a user, I can add and remove in one go: unmark one pane, mark another tab, apply once.
- As a user, opening the panel only to jump to a tab (`j`/`k`, `Enter`, or a digit) still works
  while a split exists; the pre-marked panes do not get in the way (see open question 1).
- As a user, I can back out of my changes without touching the split (see open question 2).
- As a screen-reader user, I hear the pane rows as checked when the panel opens on a split, and
  the header tells me how the split will change.

## Research

All references are to `main` at 27972ab.

### How marks work today

- The panel's state is `PanelState` (`packages/vimma-core/src/sidepanel.mjs:30-35`): rows, the
  highlight `selected`, `marked` (tab ids in row order) and `anchor` (an open `V` range).
- `openPanel` always starts with no marks: `marked: Object.freeze([])`, `anchor: null`
  (`sidepanel.mjs:114-115`).
- `space` is `panel.mark` (`packages/vimma-core/src/defaults.mjs:212`): it toggles the
  highlighted row's mark and moves down, refusing a pinned row (`sidepanel.mjs:241-256`). `V` is
  `panel.visual` (`defaults.mjs:213`, `sidepanel.mjs:257-262`); `markRange` adds the range to the
  marks (a union, pinned rows skipped) (`sidepanel.mjs:192-198`).
- `Esc` (`panel.close`) ends a range, then clears every mark, and only then closes the panel
  (`sidepanel.mjs:270-277`).
- A refresh (a tab opened, closed, retitled, moved) keeps the marks on tabs still listed in the
  same workspace; a workspace switch inside the panel (`ctrl+b )`) drops them
  (`sidepanel.mjs:129-140`).
- The UI shows a mark as a `●` in a gutter plus a bar (`ui/side-panel.mjs:226-231`), sets
  `aria-checked` on every row while anything is marked or a range is open
  (`ui/side-panel.mjs:216`, `228`), and the header's `role="status"` count reads "2 marked"
  (`markSummary`, `sidepanel.mjs:178-185`; `ui/side-panel.mjs:208-210`, `265-267`).
- The host routes `panel.mark` / `panel.visual` to the side panel only, never the bookmarks panel
  (`host/VimmaHost.sys.mjs:587-592`). Marks are the side panel's only kind of mark; there is no
  other feature that marks tabs today.

### How a split is made from marks

- `Enter` is `panel.open` (`defaults.mjs:206`). With an open range it marks the range first; with
  marks it calls `openMarked`; without marks it goes to the highlighted row
  (`sidepanel.mjs:236-240`).
- `openMarked` (`sidepanel.mjs:206-213`): one mark is a plain `select` effect (go to that tab);
  two or more are a `together` effect with the ids in row order and the focus on the highlighted
  row when it is marked, else the first marked.
- The UI hands `together` to the host and closes the panel unless the host refuses
  (`ui/side-panel.mjs:134-138`). The host wires it to `showTabs` (`VimmaHost.sys.mjs:980`).
- `showTabs` (`host/pane-ops.mjs:124-138`) gives lazy tabs a browser (`insertBrowser`,
  `pane-ops.mjs:133`) and calls `PaneView.showTabs` (`split/PaneView.mjs:432-449`), which checks
  `togetherRefusal` (`layouts.mjs:265-271`) and replaces the tree with `showTogether`
  (`layouts.mjs:283-292`).
- `showTogether` builds a **new** tree: a row of the tabs re-arranged with the workspace's stored
  preset, else `[panes] layout` (`togetherName`, `layouts.mjs:253-256`). The old tree's shape and
  any manual resizes are not kept. It throws for fewer than two tabs (`layouts.mjs:284`).
- Membership is already a diff (m4-side-panel-multiselect decision 10): tabs of the old split that
  are not marked leave it and stay open; new ones join. `PaneView.#membership`
  (`split/PaneView.mjs:681-705`) rebuilds Firefox's wrapper when a tab leaves
  (`unsplitTabs` + `addTabSplitView`, `PaneView.mjs:692-696`, ADR-013), which moves panels and
  never recreates a `<browser>`.

So "unsplit by unmarking" already half works today, but only if the user re-marks every pane they
want to keep by hand: nothing pre-marks the panes, and one mark does not end the split (below).

### What the side panel shows for tabs that are panes

- Nothing. A row carries `tabId`, `number`, `display`, `host`, `active`, `foreign`, `playing`,
  `pinned` (`sidepanel.mjs:87-98`); there is no pane field.
- The panel's model comes from `pickerWorkspaces` (`VimmaHost.sys.mjs:946-951`), which
  deliberately sets `panes: null` on every workspace (`host/goto.mjs:48`). The workspace model does
  carry each workspace's tree elsewhere (`WorkspaceState.panes`, `workspaces.mjs:26-28`, filled by
  `WindowWorkspaces.sys.mjs:946-958`), but the panel never sees it.
- The only hint of a split is `active`, the workspace's active tab, which during a split is the
  focused pane's tab (`WindowWorkspaces.sys.mjs:957`).
- Pane leaves are keyed by `linkedPanel` (`PaneView.mjs:433`), and the panel's row ids are the
  `linkedPanel` too (a uuid only for a lazy tab, `goto.mjs:41`). A pane always has a panel, so pane
  ids and row ids match directly.

### What closing or removing a pane does today

- `prefix+x` / `:q` is `pane.close` (`defaults.mjs:72`, `actions.mjs:80`) →
  `closePane` in `host/pane-ops.mjs:172-181` → `PaneView.close` (`PaneView.mjs:468-472`) → core
  `closePane` (`panes.mjs:377-392`). It closes the **focused** pane only; its tab stays open.
- Core `closePane` keeps the rest of the tree: the sibling before the closed pane (or after it,
  for the first) absorbs its share (`panes.mjs:385-386`); focus moves to that sibling's first leaf
  when the closed pane had it (`panes.mjs:390`); a zoom ends (`focused`, `panes.mjs:131-134`). The
  stored preset name is kept (`panes.mjs:23-24`, tiling-layouts decision 5), but the tree is not
  re-arranged: a dwindle of four minus one is no longer a dwindle of three.
- `PaneView.#set` (`PaneView.mjs:528-535`): a tree of one leaf is no split; the split is removed
  and the remaining tab is selected.
- Closing a pane's tab (`#onTabClose`, `PaneView.mjs:538-546`) and moving it to another workspace
  (`release`, `PaneView.mjs:259-262`) both close its pane the same way.
- Where a removed tab lands in the tab strip: on a rebuild, Firefox's `unsplitTabs`
  (`engine/browser/components/tabbrowser/content/tabsplitview.mjs:381-414`) moves every member
  right after the wrapper, in order, then `addTabSplitView(kept, { insertBefore: kept[0] })` wraps
  the kept tabs again. Reading the code, the removed tab ends up directly after the new split, so
  it shows as the row after the split's rows in the panel. The mochitest must pin this.
- There is no "unsplit" action, and no tmux `break-pane` or Vim `<C-w>o` ("only"); `<C-w>o` is
  `pane.zoom` in Vimma (`defaults.mjs:155`).

### Why one mark does not unsplit today

`Enter` with one mark is a `select` (`sidepanel.mjs:208-209`); the host sets `selectedTab`
(`VimmaHost.sys.mjs:972-978`). With a split, `PaneView.#onTabSelect` (`PaneView.mjs:558-568`)
then focuses that pane if the tab is a pane, or **replaces the focused pane's tab** with it
(`setPaneTab`, `PaneView.mjs:566`) if it is not. So today the split survives, and the user's
"unmark down to one" needs new behaviour.

## Decisions

These follow the user's core idea. Anything that shapes what the user sees and is not settled by
it is under [Open questions](#open-questions-for-the-user) instead.

1. **Pre-marked panes.** When the panel opens, or lists another workspace after `ctrl+b )`, and
   that workspace has a split, every pane's tab starts marked, with the same marks, gutter `●`,
   bar and `aria-checked` as multiselect. Without a split, the panel opens with no marks, as
   today.
2. **One kind of mark.** `space` and `V` work exactly as today on pre-marked rows: `space` on a
   pane row unmarks it, on any other row marks it. No new mark key.
3. **What applying means.** The marks after editing are the wanted set of panes:
   - two or more marked: those tabs are the panes (tabs no longer marked leave, new ones join);
   - one marked: no split; that tab is shown alone and selected;
   - pages move, never reload (the existing `reconcile` path).
4. **Removed tabs stay open** as ordinary tabs of the workspace, as after `prefix+x`. Nothing is
   closed by unmarking.
5. **Limits and refusals as multiselect.** More than `[panes] max` marked is refused with
   "Show together: at most N panes", nothing changes, and the panel stays open with its marks.
6. **The baseline follows the window.** The core keeps the split's tabs as `panes` in the panel
   state. A refresh recomputes it from the window (a pane closed with `x` meanwhile is no longer a
   pane), keeps the user's edits on rows still listed, and a workspace switch resets marks to that
   workspace's panes.
7. **Pure core.** `openPanel` / `refreshPanel` take the split's tab ids through `PanelOptions`
   (`panes: string[]`), filled by the host from `PaneViews.get(win).panes` (`leaves(...).tab`), so
   `pickerWorkspaces` stays as it is for the pickers. `panelKey` decides the effect from `marked`
   versus `panes`; `vimma-core` imports nothing from Firefox.
8. **New effect for "one left".** Core emits `{ type: "alone", id }` when a split goes down to one
   marked tab, so the host ends the split before selecting (a plain `select` would replace the
   focused pane's tab, see Research). `PaneView` gains `showAlone(tab)`: `#set(null)` then select
   the tab.
9. **Removals-only layout hook.** Whatever open question 4 decides, core gets one pure function
   that turns "this tree, these tabs wanted" into the new tree, so the host does not combine
   `closePane` calls itself: either `showTogether` (re-arrange, today's behaviour) or a new
   `withoutTabs(panes, ids)` that composes `closePane` (keep the shape).
10. **Private workspace.** Works the same: the private window has its own `PaneView`
    (private-workspace.md, "Split view and PaneView"), and its panel model goes through the same
    `SidePanel`.
11. **Help and bindings.** `panel_open`'s and `panel_close`'s help text change to say what they
    now do with a split; `help.test.mjs.snap` and `docs/bindings.md` are regenerated with a
    changelog line. No new default key unless open question 1 picks one.

## Sub-PRs

1. **core: pre-marks and the split diff** (`sidepanel.mjs`, `layouts.mjs` or `panes.mjs`,
   `actions.mjs` help text; Vitest only). `PanelState.panes`; `openPanel` / `refreshPanel` with
   `panes`; `panel.open` / `panel.close` per the answers to questions 1–3; the `alone` effect;
   `markSummary` text per question 5; `withoutTabs` if question 4 picks "keep the shape".
2. **host + UI: show and apply** (`ui/side-panel.mjs`, `side-panel.css`, `PaneView.mjs`,
   `pane-ops.mjs`, `VimmaHost.sys.mjs`; mochitest; guide, README, footer hint). The host passes the
   split's tabs, wires `alone`, and `PaneView.showTabs` keeps or re-arranges the tree per
   question 4.

Sub-PR 2 depends on 1. If the answers leave the change small, the two can land as one PR.

## Test plan

TDD as CLAUDE.md: each test is written first, run red, and its red output pasted in the PR.

### Vitest (`packages/vimma-core/test/`)

- `sidepanel.test.mjs`
  - `openPanel` with `panes: [a, c]` marks `a` and `c` (row order), `anchor` null; without
    `panes` (or `[]`) no marks, as today.
  - `space` on a pre-marked row unmarks it and moves down; on another row marks it.
  - `Enter` with marks equal to the panes: per question 1's answer (recommended: go to the
    highlighted row, the `select` effect).
  - `Enter` after unmarking one of three: `together` with the two left, in row order, focus per
    question 6.
  - `Enter` after unmarking two of three: `alone` with the one left.
  - `Enter` after unmarking all: per question 3's answer.
  - `Enter` after marking an extra tab: `together` with four; after unmarking one and marking
    another: `together` with the new set.
  - `Esc` with changed marks / unchanged marks: per question 2's answer.
  - `refreshPanel`: a pane tab closed while open leaves both `panes` and `marked`; a user's unmark
    survives a refresh; a workspace switch resets marks to the new workspace's `panes`.
  - `markSummary` with a split, unchanged and changed, per question 5.
  - A range (`V`) over pre-marked and unmarked rows unions as today.
- `layouts.test.mjs` (or `panes.test.mjs`): if question 4 picks "keep the shape",
  `withoutTabs` on a dwindle of four minus one keeps the other ratios and the preset name, ends the
  zoom, moves focus as `closePane`; minus all but one gives one leaf.
- Default keys still reach the actions through the dispatcher; snapshots of help and defaults
  regenerated, with a changelog line in the PR.

### Mochitest (`tests/browser/browser_vimma_side_panel_unsplit.js`, new)

- Three panes; `ctrl+b b` shows those three rows with `●` and `aria-checked="true"`, the others
  `aria-checked="false"`, and the header text per question 5.
- No split: the panel opens with no marks and no `aria-checked`, as
  `browser_vimma_side_panel.js` and the a11y test already expect.
- Unmark one, apply: two panes left, the removed tab still open, not hidden, in the workspace,
  at the position question 7 decides; no reload (same `<browser>`, `outerWindowID`, a JS marker,
  a typed field value and scroll position kept, as `browser_vimma_side_panel_marks.js` measures).
- Unmark down to one, apply: `PaneViews.get(win).panes` is null, that tab is selected and has
  focus, the other tabs are open.
- Mark an extra tab, apply: four panes; past `[panes] max` refused, nothing changed, panel open.
- Remove one and add one in a single apply.
- The layout of the panes that remain, per question 4 (tree shape and ratios asserted).
- Focus after apply, per question 6.
- `Esc` and plain `Enter` behaviour with the pre-marks, per questions 1 and 2.
- `ctrl+b )` inside the panel to a workspace with its own split shows that split's marks.
- The private workspace: one case with two private panes, unmark one, apply.
- Existing suites stay green unchanged: `browser_vimma_side_panel.js`,
  `browser_vimma_side_panel_marks.js`, `browser_vimma_a11y.js`, the pane suites.

## Docs to update

- `docs/guide.md`, "Side panel" table (`Enter`, `Esc`, `space` rows) and "Showing tabs together":
  a paragraph on changing or ending a split from the panel, with an example.
- `README.md` feature list, the "Side panel" line: mention that the panel shows the split and can
  shrink or end it.
- The panel's footer hint (`ui/side-panel.mjs:263`) if keys or wording change.
- `actions.mjs` help text for `panel_open` / `panel_close`; regenerate `docs/bindings.md`
  (`npm run gen-docs`).
- `CHANGELOG.md` `[Unreleased]`: added by the maintainer at merge time (CLAUDE.md), not in the PR.
- This spec's Results section when done.

## Out of scope

- A key or `:` command outside the panel to end or shrink a split (a tmux `break-pane` or Vim
  `<C-w>o` "only"); `prefix+x` already closes one pane.
- Reordering panes from the panel (mark order is row order, as multiselect decision 6).
- Marks across workspaces; marks in the bookmarks panel; mouse selection.
- Keeping marks after the panel closes.
- Showing parked splits of other workspaces anywhere but when the panel lists that workspace.

## Open questions for the user

Each of these changes what you see. The spec recommends an answer but does not decide it.

1. **What key applies the change, and what does plain `Enter` do while the panes are pre-marked?**
   Today `Enter` with marks shows the marked tabs together, and without marks goes to the
   highlighted tab. With a split the panel always opens with marks, so `Enter` would always mean
   "apply", and you could no longer jump to a tab with `Enter`.
   - (a) `Enter` applies when the marks differ from the split; when they are unchanged it goes to
     the highlighted tab as today (a pane: focus that pane; another tab: it replaces the focused
     pane's tab, as today's picker does). Digits keep going to their row.
   - (b) `Enter` always applies the marks; going to a tab needs the digits.
   - (c) A separate key applies (for example `p` for "panes", unbound in `[modal.panel]`; `s`
     is taken by the bookmarks panel's `bookmarks.open_vsplit`, `defaults.mjs:222`); `Enter`
     always goes to the highlighted tab.

   Recommendation: (a). It is the key you used to make the split, as you asked, and it keeps
   `Enter` as "go" when you only opened the panel to move.

2. **What does `Esc` do with pre-marked panes?** Today `Esc` clears all marks first and closes the
   panel on a second press, so with a split you would need `Esc Esc` every time.
   - (a) Unchanged marks: `Esc` closes at once. Changed marks: the first `Esc` puts the marks back
     to the split's panes, the second closes.
   - (b) `Esc` always closes and discards any changes.
   - (c) As today: first clears every mark, second closes.

   Recommendation: (a). One `Esc` to leave when nothing changed, and an undo when something did.

3. **Unmarking every pane (zero marks), then applying.** Is that "end the split" too, and which
   tab is then shown?
   - (a) End the split and show the highlighted row's tab alone.
   - (b) End the split and show the focused pane's tab alone.
   - (c) Nothing happens to the split; `Enter` just goes to the highlighted tab (today's
     no-marks `Enter`).

   Recommendation: (a): you are on that row when you press the key.

4. **The layout of the panes that remain after removing one.**
   - (a) Keep the shape: each removed pane closes as `prefix+x` closes it (its neighbour takes its
     space, the other sizes stay); the stored preset name is kept for `ctrl+b space`.
   - (b) Re-arrange: the remaining panes are laid out fresh in the workspace's layout (stored
     preset, else `[panes] layout`), exactly as multiselect does today; manual resizes are lost.

   When a tab is **added** (with or without removals), the spec assumes the whole set is
   re-arranged as today's multiselect does. Say if added tabs should instead go in as a new pane
   next to the focused one, as `prefix+enter` does.

   Recommendation: (a) for removals only, (b) whenever a tab is added. Removing should not undo
   sizes you set; adding has no obvious place without a layout.

5. **What the panel shows for the split.** The marks are the same `●` as multiselect. The header
   could read:
   - (a) "3 marked" as today, nothing split-specific.
   - (b) "split: 3 panes" when unchanged, "split: 3 → 2" after an unmark, "split: 3 → 1 (unsplit)"
     at one; and an unmarked pane row shows `○` (a pane that will leave) instead of a blank gutter.
   - (c) (b)'s header without the `○`.

   Recommendation: (b). You see which tabs are panes now and what applying will do, without colour.

6. **Which pane has focus after the change.**
   - (a) As multiselect: the highlighted row if it is marked, else the first marked row.
   - (b) The pane that had focus, if it is still marked; else (a).

   Recommendation: (b). Removing a background pane should not move you.

7. **Where the removed tab goes in the tab order.**
   - (a) Right after the split, where Firefox's rebuild leaves it (no extra move).
   - (b) Back where it was before it joined the split (Vimma would have to remember that).
   - (c) At the end of the workspace's tabs.

   Recommendation: (a). It needs no extra state, and in the panel the removed tab is the row just
   below the split's rows.

8. **Do split marks mix with marks made for another purpose?** Today the panel's marks exist only
   to make a split, so pre-marked panes and your own marks are one set. If a later feature uses
   marks for something else (close the marked tabs, move them to a workspace), the pre-marked
   panes would be in its selection too.
   - (a) One kind of mark: pre-marks are ordinary marks. A future marks feature decides then how
     it treats them.
   - (b) Two kinds now: pane rows get their own indicator (for example a pane number), and
     `space` toggles a separate "keep as pane" state that only the split uses.

   Recommendation: (a). It is what you asked for ("similarly to how they were selected"), and
   there is no other mark use today.
