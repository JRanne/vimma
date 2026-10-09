# ADR-013: Split panes build on Firefox's own split view, not on vendored Zen code

- Status: Accepted (2026-10-09, after the sub-spec 1 spike; see Spike results)
- Date: 2026-10-09
- Supersedes: ADR-006 ("Split view is vendored from Zen")

## Context

ADR-006 was written when the hard part of split panes, making `tabbrowser` show several
`<browser>`s at once, existed only in Zen. Firefox 157, the release we build on, now ships its
own split view, and Zen 157.0.1 turns it off to keep its own. The M4 research
([m4-split-panes](../specs/m4-split-panes.md)) compared the two on the engine tree
(`engine/`, Firefox 157.0.1) and on zen-browser/desktop at `185e856f` (2026-10-09, also
157.0.1).

**Firefox 157's split view** (`browser/components/tabbrowser/content/tabsplitview.mjs`,
`toolkit/content/widgets/tabbox.js` `MozTabpanels`, `Tabbrowser.sys.mjs`):

- On by default (`browser.tabs.splitView.enabled`, `browser/app/profile/firefox.js`). That pref
  gates only the UI entry points: the tab and link context menus and alt-click. The API works
  either way.
- A `<tab-split-view-wrapper>` holds the tabs. `gBrowser.addTabSplitView(tabs)` and
  `wrapper.addTabs(tabs)` take any number of tabs. `gBrowser.showSplitViewPanels(tabs)` loops
  over them: it inserts each browser, sets `docShellIsActive = true` and marks each panel
  `.split-view-panel-active`, which `toolkit/content/xul.css` already makes visible.
  `AsyncTabSwitcher.shouldDeactivateDocShell` never deactivates `gBrowser.splitViewBrowsers`.
- **Focus model:** one tab stays `gBrowser.selectedTab`. A `focus` on a split browser, or a
  click in its panel, selects that tab (`MozTabpanels.handleEvent`), so the URL bar, the find
  bar, page zoom and `gBrowser.selectedBrowser` follow the active pane with no extra code.
- Handled upstream: notification boxes per panel (`#insertNotificationBox`), the link status
  panel per panel, the find bar per panel, DOM fullscreen from a pane (the `deck-selected` panel
  fills the window under `:root[inDOMFullscreen]` in `content-area.css`), SessionStore
  (`splitViewId` on tabs, `numberOfTabs` on the wrapper, restored by
  `Tabbrowser.createTabsForSessionRestore` with no limit on n), hidden tabs (`hideTab` hides
  the whole wrapper), and the WebExtension `splitViewId`.
- Tested upstream: 18 mochitest files with 93 tasks under
  `browser/components/tabbrowser/test/browser/`, plus SessionStore and extension tests.
- **More than two panes is permitted, not supported.** The API accepts n tabs, but no upstream
  test uses more than two, and several code paths assume two (Known two-tab assumptions below).
- **What it lacks:** the layout is two columns. `content-area.css` styles `column="0"` and `"1"`
  with one `.split-view-splitter`. `reverseTabs()` and `resetRightPanelWidth()` assume two tabs,
  and so do `ext-tabs.js` ("a split view has 2 tabs") and `TabsList.sys.mjs`. There are no rows
  and no nesting. The wrapper's private `#tabs` list is not updated when a tab leaves a wrapper
  of three or more, because only the two-tab case dissolves (`#observeTabChanges`).

**Zen's split view** (`src/zen/split-view/ZenViewSplitter.mjs`, 2,659 lines, MPL-2.0 header):

- An n-ary tree of row and column nodes, positioned with `style.inset` percentages, up to
  `MAX_TABS = 4`. This is the closest match to our pane tree.
- It is not self-contained. It extends `nsZenDOMOperatedFeature` and calls `gZenUIManager`,
  `gZenGlanceManager`, `gZenWorkspaces`, `gZenPinnedTabManager` and `gZenShareManager`. About 120
  lines deal with drag and drop. Split groups are Firefox tab groups with a `split-view-group`
  attribute.
- It needs upstream patches that also carry Zen's folders, glance and workspaces in the same
  hunks. These include `browser-custom-element-mjs.patch` (`zenModeActive` keeps a browser's
  `isActive` and `renderLayers` on) and `AsyncTabSwitcher-sys-mjs.patch`. They also include
  `Tabbrowser-sys-mjs.patch` (1,289 lines in all, 48 split-related lines: `splitViewBrowsers`
  redirected to Zen, `addTabGroup({ forSplitView })`, moves, restore and removal), plus
  `xul-css.patch`, `SessionStore`, `TabGroupState`, `tabs.js`, `tab.js`, `tabgroup.mjs`,
  `drag-and-drop.js` and `tabs.css`: 20 of Zen's upstream patch files are split-related.
- It is locked against Firefox's split view (`prefs/firefox/browser.yaml`:
  `browser.tabs.splitView.enabled` false, locked).
- `ZenViewSplitter.mjs` had 60 commits from 2026-01-01 to 2026-10-09 (GitHub API). Tracking it
  means following a fast-moving file whose dependencies we do not ship.

## Decision

Split panes are built on **Firefox's own split view**. Each workspace with more than one pane
has one `<tab-split-view-wrapper>` holding the tabs of its panes. Our layout code, in our own
files under `src/browser/base/content/vimma/split/` and `browser/themes/shared/vimma/`, places
the active panels at the rectangles that `vimma-core`'s `layout()` returns. Firefox keeps doing
what it already does: several active docshells, selection follows focus, notifications, find
bar, fullscreen and session restore.

Zen's split view is a **design reference**, not vendored code. We copy no Zen code. If a later
spec copies a function (for example the inset maths of `applyGridLayout`), that file keeps
Zen's MPL-2.0 header, gets a "Derived from zen-browser/desktop `<path>` at `<sha>`" line, and
this ADR gets an addendum.

Target patch count for M4: **zero** new upstream patches. One contingency patch is named in
advance (`tabsplitview-mjs.patch`, which rebuilds `#tabs` from the wrapper's children). It is
used only if the first sub-spec's spike shows that rebuilding the wrapper when a pane leaves
flickers or breaks. It then gets its line in ADR-003's register.

## Reasoning

- **Patches.** Vendoring Zen brings split-related hunks from 20 of its upstream patch files,
  most of them churny front-end files. Disentangling them from Zen's folders, glance and
  workspaces is our own work, and it is not tested anywhere. Building on Firefox needs public `gBrowser` APIs and CSS in our
  own sheet. ADR-003 prefers the smaller patch set.
- **Rebase risk.** Firefox's split view is maintained and tested by Mozilla in the same tree we
  rebase onto. Zen's patches are rebased by Zen on Zen's schedule. We would rebase a third-party
  patch onto a Firefox whose own split view keeps moving underneath it.
- **The hard part is already upstream.** The plan §9 risk is selection, focus and the URL bar.
  In Firefox's model one tab stays selected, the other split browsers stay active, and focus
  selects. This is the same model Zen uses (`setTabsDocShellState`, `_handleTabEvent`) and is
  covered by the 93 upstream tasks.
- **Trees are the easy part.** Our n-ary tree, its ratios and its geometry are already pure and
  property-tested in `vimma-core` (m3-m4-core-models). What we need from Firefox is "these n
  panels are visible and active", which the API gives for any n. The layout is about 100 lines
  of positioning that we would have had to adapt from Zen anyway.
- **Licence.** Both are MPL-2.0. Building on Firefox needs no attribution beyond the tree we
  already ship.

## Known two-tab assumptions and how we handle them

| Upstream code                                                                        | Assumption                                                     | Handling                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reverseTabs()`, `resetRightPanelWidth()` (`tabsplitview.mjs:441`, `:317`)           | Exactly two tabs; right panel is `panels[1]`                   | Unused: swap is geometry only, and Firefox's splitter is hidden.                                                                                                                 |
| `MozTabpanels.setSplitViewActive` (`tabbox.js:604-630`)                              | Orders panels 0 and 1 in the DOM and puts the splitter after 0 | Tab-key focus order across three or more panes follows DOM order, not reading order. Sub-spec 1 decides: the host reorders panels with `moveBefore`, or we accept it as a limit. |
| `tab.updateSplitViewAriaLabel(index)` (`tab.js:1043`)                                | Labels "left" and "right" only                                 | The host sets the accessible label of a third or later tab itself after each `reconcile`.                                                                                        |
| `TabsList.sys.mjs:887-889` (all-tabs drag targets), `ext-tabs.js:1155` (`tabs.move`) | `tabs[0]` / `tabs[1]`, "a split view has 2 tabs"               | Recorded in `docs/limits.md`; the all-tabs list is hidden with the tab strip.                                                                                                    |
| Glean `splitview.*` labels (`tabsplitview.mjs:368`)                                  | Labels "1" and "2"                                             | Harmless: telemetry is off in Vimma.                                                                                                                                             |

## Acceptance criteria (sub-spec 1 spike)

This ADR becomes Accepted when the `m4-split-contract` spike shows all of the following on a
local build, in `browser_vimma_split_contract.js` with wrappers of three and four tabs:

1. An L shape (`x[p1, y[p2, p3]]`) and a four-pane grid render each panel at core's `layout()`
   rectangle within ±1 px, with every member's docshell active.
2. DOM fullscreen from one pane fills the window and exiting restores every rectangle within
   ±1 px; the focus outline is on the focused pane only; the find bar and a notification bar
   open in the right pane.
3. `gBrowser.removeTab` on a member of a three-tab split does not throw on the next
   `TabSelect`. If it throws, the contingency patch is adopted instead of rebuilds and gets its
   ADR-003 line.
4. After a rebuild (`unsplitTabs`, then `addTabSplitView`), the kept members are active and
   the dropped member is inactive once the host deactivates it, with no scroll position lost.

If any criterion fails without a fix in our own files or the one contingency patch, this ADR is
rejected and M4 returns to ADR-006.

## Spike results

`tests/browser/browser_vimma_split_contract.js` with the spike module
`src/browser/base/content/vimma/split/spike-layout.mjs` and `split-spike.css`, on a local artifact
build of Firefox 157.0.1 (headless, Linux), window 1280 × 800, content area 1280 × 760. The
pane trees are built with `vimma-core`'s pane ops (`split`, `resize`, `toggleZoom`) and the
rectangles come from its `layout()`. 12 tasks, 234 checks, green on repeated runs and in the full
`tests/browser/` suite.

| #   | Criterion                                           | Result   | Measured                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | L shape and 4-pane grid at `layout()` ±1 px, active | **Pass** | Δ 0 px for every panel and `<browser>` in `x[p1, y[p2, p3]]` and in a grid at ratios .37/.63, .45/.55, .61/.39 (edges 474, 342, 464). `docShellIsActive` true on every member with each member selected in turn.                                                                                                                                                                                                                                             |
| 2   | Fullscreen, focus outline, find bar, notification   | **Pass** | DOM fullscreen from pane 2 of 3: its panel is 1366 × 768, the whole (headless) screen, Δ 0; the others stay active, and the point where pane 3 was hits pane 2. After exit every rect is back, Δ 0. Outline: 2 px `--focus-outline-color` on the focused pane only; the others keep the 1 px separator outline. `accel+f` in pane 3 opens pane 3's find bar inside its panel and rect; a notification for pane 2 is in pane 2's `browserContainer` and rect. |
| 3   | `removeTab` on a 3-split member, next `TabSelect`   | **Pass** | No exception: 0 console errors. The wrapper keeps the other two tabs, `panels` and `.split-view-panel-active` are exactly theirs, and so is `splitViewBrowsers`. Removing the selected member selects another member. The closed tab stays in the private `#tabs`, but `showSplitViewPanels` skips it (`linkedPanel` kept, `linkedBrowser` null).                                                                                                            |
| 4   | Rebuild: kept active, dropped inactive, scroll kept | **Pass** | `unsplitTabs()` then `addTabSplitView([a, c])` in one task, `c` selected: `a` and `c` active at every sample (sync, microtask, next tick, two frames); `b` false once the host deactivates it. Scroll 600 px kept on `a` and `c`. One late `TabSplitViewDeactivate` (old wrapper, `detail.tabs` = a, b, c) arrives; it neither strips the kept panels nor clears `activeSplitView`.                                                                          |

Also measured:

- Without the host, `unsplitTabs` leaves the dropped tab's docshell active at every sample, so
  the host's `docShellIsActive = false` on a leave is required, as Consequences says.
- `browser.tabs.splitView.enabled = false` still allows `addTabSplitView` with three tabs, and
  `hideTab` on one member hides every member.
- Zoom: `-moz-subtree-hidden-only-visually` works from our own sheet. Without it, the column-0
  panel (`z-index: 1` in `content-area.css`) paints and hit-tests on top of a full-size zoomed
  panel; with it, the zoomed panel is hit. The hidden panels' docshells stay active (CSS alone),
  so the host deactivates them as the M4 spec says. After unzoom every rect is back (Δ 0) and
  scroll positions are kept.
- Tab-key order: with a wrapper of `[o2, o3, o1]`, DOM order stays `o1, o2, o3`
  (`setSplitViewActive` orders panels 0 and 1 only). The host fixes it with `moveBefore` in
  reading order, which keeps each page loaded, active and scrolled. Sub-spec 2 does that in
  `reconcile` instead of recording a limit.

Decision: all four criteria hold with our own files only. The contingency patch
(`tabsplitview-mjs.patch`) is not adopted, and leaves are rebuilds.

## Verification

Claims confirmed by an independent review of PR #25 against the engine tree (Firefox 157.0.1):

- `browser/app/profile/firefox.js:2842`: `browser.tabs.splitView.enabled` defaults to `true`,
  with no `#ifdef`.
- `browser/components/tabbrowser/content/tabsplitview.mjs:332-358`: `addTabs` loops over any
  number of tabs.
- `browser/components/tabbrowser/Tabbrowser.sys.mjs:4090-4103`: `showSplitViewPanels` sets
  `docShellIsActive = true` on every member.
- `browser/components/tabbrowser/AsyncTabSwitcher.sys.mjs:940`: `shouldDeactivateDocShell`
  skips `splitViewBrowsers`.
- `toolkit/content/widgets/tabbox.js:372-397`: `focus` on a split browser, or a click in its
  panel, selects its tab.
- `browser/themes/shared/tabbrowser/content-area.css:364-470`: `#tabbrowser-tabpanels` is a
  flexbox with a two-column split layout.
- Firefox writes panel widths inline without `!important` (`tabsplitview.mjs:308`, `:321`;
  `tabbox.js:471`), so our `!important` rules win.
- `split-view-footer` is a light-DOM `MozXULElement` (`split-view-footer.js`), so our sheet can
  hide it.
- Zen: 20 upstream patch files carry split-related changes.

## Alternatives rejected

- **Vendor Zen's split view (ADR-006).** Rejected for the patch weight, the Zen-only
  dependencies and the churn listed above. It also forces Firefox's split view off, and with it
  the upstream fixes and tests.
- **Firefox's split view as-is (two panes, side by side).** Rejected because it cannot express
  `prefix+-` (split down), nesting or three panes, which plan §2 and the core tree need.
- **Write our own from scratch** (our own docshell activation, without Firefox's wrapper or
  Zen's patches). Rejected because it would need the same `docShellIsActive` patches Zen
  carries, and it would compete with Firefox's split view inside one `tabbrowser`.

## Consequences

- When a pane joins or leaves, we rebuild the wrapper (`unsplitTabs`, then `addTabSplitView`
  with the new list), because Firefox's wrapper cannot drop one tab out of three or more. The
  first sub-spec proves this with a contract mochitest, and the contingency patch above is the
  fallback. `unsplitTabs` does not deactivate the dropped tab's docshell, so the host does.
- Firefox's own split-view entry points would create splits outside our model. We set
  `browser.tabs.splitView.enabled` to `false` in our branding prefs (it gates UI only), hide the
  URL bar's `#split-view-button` and the panel footers in our CSS, and adopt any split that
  still appears (an extension, the keyboard command) through `SplitViewCreated`.
- `browser_vimma_split_contract.js` asserts every upstream behaviour we rely on, so a rebase that
  changes one fails CI instead of breaking panes silently.
- Code that assumes two tabs per split stays upstream; the table above says how we handle each
  case, and the ones we accept are recorded in `docs/limits.md`.
- plan.md §1, §3 and §6 still say "vendor Zen". When this ADR is accepted, the same PR updates
  them to point here. ADR-006 stays as written, with this ADR superseding it.
