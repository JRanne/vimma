# ADR-013: Split panes build on Firefox's own split view, not on vendored Zen code

- Status: Proposed
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
  `Tabbrowser.createTabsForSessionRestore` with no limit on n), hidden tabs (`hideTab` hides the whole wrapper), and the WebExtension
  `splitViewId`.
- Tested upstream: 18 mochitest files with 93 tasks under
  `browser/components/tabbrowser/test/browser/`, plus SessionStore and extension tests.
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
  `drag-and-drop.js` and `tabs.css`: 22 upstream patch files mention split view.
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

- **Patches.** Vendoring Zen brings about 10 of its upstream hunks into at least 8 churny
  front-end files. Disentangling them from Zen's folders, glance and workspaces is our own work,
  and it is not tested anywhere. Building on Firefox needs public `gBrowser` APIs and CSS in our
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
  fallback.
- Firefox's own split-view entry points would create splits outside our model. We set
  `browser.tabs.splitView.enabled` to `false` in our branding prefs (it gates UI only), hide the
  URL bar's `#split-view-button` and the panel footers in our CSS, and adopt any split that
  still appears (an extension, the keyboard command) through `SplitViewCreated`.
- `browser_vimma_split_contract.js` asserts every upstream behaviour we rely on, so a rebase that
  changes one fails CI instead of breaking panes silently.
- Code that assumes two tabs per split stays upstream: extension `tabs.move` of a split tab and
  the all-tabs list's labels. These are recorded in `docs/limits.md`.
- plan.md §1, §3 and §6 still say "vendor Zen". When this ADR is accepted, the same PR updates
  them to point here. ADR-006 stays as written, with this ADR superseding it.
