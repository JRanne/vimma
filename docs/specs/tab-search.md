# Spec: tab-search

Status: spec in review (not started) · Milestone: after firefox-keys (plan §6, queued) · Area:
`packages/vimma-core/src/picker.mjs`, `tabsearch.mjs` (new), `actions.mjs`, `defaults.mjs`,
`cmdline.mjs`, `help.mjs`; `host/goto.mjs`, `host/tab-search.mjs` (new), `host/VimmaHost.sys.mjs`,
`ui/picker.mjs`, `browser/themes/shared/vimma/picker.css`. No upstream patch, no new dependency,
no ADR.

Builds on [m2-picker-rename](m2-picker-rename.md) (the goto picker), [m3-workspaces](m3-workspaces.md)
(sub-spec 5, the picker's workspace sections), [private-workspace](private-workspace.md)
(decision 5 and its "never shows a private title" rule), [vimma-mcp](vimma-mcp.md) (the agent
workspace, decision 9) and [firefox-keys](firefox-keys.md) (`ctrl+shift+a` is `addons_manager`).
Vimma paths are on main at a3558d2 (2026-10-13), under `src/browser/base/content/vimma/` unless
they start with `packages/`, `docs/` or `tests/`. Engine paths are relative to `engine/`
(Firefox 157).

**This adds default keys (`ctrl+b f`, and the picker's own `x`, `m`, `u`, `tab`). It lands as its own
keymap PR, one keymap PR open at a time, after firefox-keys sub-PR 2 and Vimma MCP's key.**

## The user's words

"We could write spec for "tab search", it could be quite similar to brave"

## Short answer

The goto picker (`ctrl+b g`, `b`, `:ls`) already lists every tab of every workspace in the window
and fuzzy-matches title, URL, rename and workspace name. Tab search makes it Brave's Tab Search
in Vimma's style, rather than a second picker: it also lists the tabs of your other windows, and
a "Recently closed" section; it shows the workspace on every row and a `♪`/muted marker; `x` closes
the selected tab from the list, `u` reopens a closed one, `m` moves a tab to another workspace.
`ctrl+b f` (tmux's `find-window`) and `:tabsearch [text]` open it with the search line already
typing, as Brave's `ctrl+shift+a` does. Private tabs never show outside the private workspace, and
the agent workspace's tabs carry `◇`. Lazy tabs stay unloaded.

## User stories

- As a user with 150 tabs across `work`, `personal` and two windows, `ctrl+b f` and a few letters
  (`jira 412`) find the tab, `Enter` takes me there: the right window comes to the front and the
  right workspace becomes active. No tab loads that was not loaded.
- As a user who just closed a tab by mistake three tabs ago, `ctrl+b f`, `Tab` (to "Recently
  closed") or typing part of its title, and `Enter` (or `u`) reopen it in its own workspace, with
  its history. `ctrl+shift+t` still reopens only the last one.
- As a user tidying up, `ctrl+b g`, `j`/`k` and `x` close tabs one after another without leaving
  the list. A pinned tab says it is pinned and stays.
- As a user who hears audio somewhere, the playing tab's row shows `♪` (and `muted` when muted),
  so I find it at a glance, and typing `playing` or `muted` finds those rows.
- As a user in `work`, `m` on a `personal` tab's row moves it here, with the same warning the
  workspace picker's `m` gives (the move reopens the page in this workspace's container).
- As a user of the private workspace, a normal window's search never lists a private tab's title
  or URL, and the private window's search lists only its own tabs.
- As a user running an agent, the agent workspace's tabs are in the list marked `◇ agent`, so I
  never mistake an agent's tab for mine, and they come after my own workspaces.
- As a screen-reader user, the list is a listbox whose options name the tab, its workspace and
  its window or "recently closed", and the count of matches is announced as I type.

## Research

### Brave / Chromium Tab Search

Brave ships Chromium's Tab Search unchanged in its core and adds a setting for its button.

- **Shortcut and button.** `ctrl+shift+a` (`cmd+shift+a` on macOS) opens it; Brave shows a "Search
  tabs" button when Settings → Appearance → Tabs → "Show tab search button" is on
  (Brave community, <https://community.brave.app/t/search-tabs-or-shift-control-a/398924>,
  <https://community.brave.com/t/where-has-the-find-tab-button-gone-i-have-203-tabs-open-help/628636>).
  Brave's help centre places Tab Focus Mode under the same button's "Organise" tab
  (<https://support.brave.app/hc/ar/articles/35200007195917-How-to-use-Tab-Focus-Mode>), an AI
  feature out of scope here.
- **It is a WebUI bubble**, `chrome://tab-search.top-chrome`, source in
  `chrome/browser/resources/tab_search/` (<https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/resources/tab_search/>):
  `tab_search_page.ts`, `tab_search_item.ts`, `tab_search_group_item.ts`,
  `selectable_lazy_list.ts` (a virtualised list), `alert_indicators/` (audio/recording icons).
- **Every window's tabs.** `tab_search_page.ts` walks `profileData.windows` (all windows of the
  profile) and puts the current window's tabs into the list with the rest, the rest sorted by
  `lastActiveTimeTicks`, most recent first
  (<https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/resources/tab_search/tab_search_page.ts>).
  Some third-party guides say it searches the current window only; the source says otherwise.
- **Sections.** "Audio and video" (tabs with media alerts, `tabHasMediaAlerts()`), "Open tabs",
  "Recently closed" (tabs and whole closed tab groups, which reopen as a group), capped at a
  default display count and collapsible (same file; closed groups:
  <https://chromeunboxed.com/closed-tab-groups-appear-in-tab-search>, recently closed:
  <https://chromeunboxed.com/chrome-tab-search-recently-closed>).
- **Search.** Fuse.js-style fuzzy search over `tab.title` (weight 2), `tabGroup.title` (1.5) and
  `hostname` (1), with matched characters highlighted (same file, its search options).
- **Keys.** `Up`/`Down` move, `Enter` switches (to another window too), `Esc` closes the bubble;
  each row has a close button (`apiProxy_.closeTab()`), and the screen reader hears the result
  count (`getA11ySearchResultText_()`).

What we take: one place to find any tab, every window, recently closed in the same list, media
markers, close from the list, opening straight into typing. What we leave: the mouse-first bubble
and button, the tab-group sections (Vimma has workspaces instead of tab groups), "Organise" / AI
grouping.

### Vimma today

- **The goto picker** (`goto.picker`: `prefix+g`, `b` in normal mode, `:ls`, `:b` per guide.md:1383;
  `packages/vimma-core/src/defaults.mjs:106`, `:198`, `cmdline.mjs:106`):
  - Lists every tab of every workspace **of the current window**, workspace by workspace
    (`host/goto.mjs:28-62` `pickerWorkspaces`, `:81-100` `gotoItems`; core `picker.mjs:353-372`
    `pickerItems`). A private window lists its own visible tabs (`goto.mjs:52-61`).
  - Fuzzy match per whitespace-separated term over rename/title (`display`), title, URL and
    workspace name, every term must match some field (`picker.mjs:303-330`), tiers exact >
    prefix > word > substring > subsequence > diacritics-folded (`picker.mjs:85-92`, `:226-268`),
    field weights `display 300, title 250, url 150, workspace 100` (`:95`).
  - Keys: `j`/`k`/`Down`/`Up`/`ctrl+n`/`ctrl+p`, `/` to search, `left`/`right` jump workspace
    sections on a blank query (`:466-484`), `Enter`, `Esc`/`q` (`:506-563`). `m` is the workspace
    picker's only; `x`, `d`, `o`, `u` are the add-on picker's (`:73-79`), nothing on a tab row.
  - The UI (`ui/picker.mjs:45-51` look `GOTO`): rows show tab number, the display label with
    `<mark>` highlights (display field only, `:221-227`), and the host. **The workspace name is
    not shown on a row** and there are no section headings, though the list is ordered by
    workspace. `role=listbox` / `option`, `aria-activedescendant` (`:247-253`, m7-a11y).
  - Selecting a lazy tab works (`tabById`, `goto.mjs:69-74`: the model's uuid for a tab with no
    `linkedPanel`); title and URL are read from `linkedBrowser` without loading (`:93-97`).
  - The agent workspace's tabs are listed with no marker: `pickerItems` takes no `agentId`,
    while `workspaceItems` marks `◇ agent` (`picker.mjs:382-397`, `AGENT_GLYPH` `agent.mjs:13`).
  - A new item list while open: `setPickerItems` keeps the selection (`picker.mjs:433-440`,
    `ui/picker.mjs:157-161`), used by the add-on picker's refresh.
- **The workspace picker** (`ctrl+b w`): one row per workspace, `m` moves the current tab there
  with the warning `moveTabQuestion` (m3-workspaces sub-spec 5); the private workspace's row
  shows a count only (`VimmaHost.sys.mjs` `pickerItemsWithPrivate`; private-workspace decision 5).
- **The side panel** (`ctrl+b b`): the current workspace only; rows carry `♪` for
  `tab.soundPlaying` (`VimmaHost.sys.mjs:1070`, `ui/side-panel.mjs:262`) and `x` closes the tab
  and keeps the panel open, refusing a pinned tab with `PINNED_TEXT` (`core/sidepanel.mjs:41`,
  `:64`, `:345-354`; host `closeTabById`, `host/tab-ops.mjs:79-87`).
- **Recently closed:** only `restore_tab` (`ctrl+shift+t`), which runs Firefox's
  `History:RestoreLastClosedTabOrWindowOrSession` (`host/tab-ops.mjs:94-98`), and
  `restore_window` → `History:UndoCloseWindow` (`host/browser-ops.mjs:17`). No list.
- **Other windows:** nothing in Vimma lists them; `BrowserWindowTracker.orderedWindows` is used
  by about:vimma and the private workspace (`about/AboutVimma.sys.mjs:241`,
  `host/private-ops.mjs:89-97`).
- **Keys.** `ctrl+shift+a` is `addons_manager`, page first (docs/bindings.md:139, :309, from
  firefox-keys sub-PR 1, #171). Prefix keys in use (`defaults.mjs`): `( ) ? [ ^ a b c ctrl+6 e
enter g h j k l minus n p r space v w x z` and `shift+a b d h j k l n p t w x`; toolbar-toggle
  reserves `u`. `prefix+f` is free and unspecced.
- **Themes:** `picker.css` uses the theme tokens (`--vimma-bg-dark`, `--vimma-fg`,
  `--vimma-muted`, `--vimma-text-accent`, `--vimma-accent`, `--vimma-focus`) with system-colour
  fallbacks (`browser/themes/shared/vimma/picker.css:9-60`).
- **Tests to extend:** `tests/browser/browser_vimma_picker.js` (19 references),
  `browser_vimma_workspace_picker.js`, `_private_workspace.js` (pins "no private tab in a normal
  window's goto picker"), `_a11y.js`, `_focus_rings.js`; e2e baselines are
  `m0-happy-path-help.png`, `m3-private-workspace.png`, `m4-split-panes.png` (no picker baseline).

### Firefox (engine/)

- **"List all tabs"** (`gTabsPanel`, `browser/components/tabbrowser/content/browser-allTabsMenu.js:13`,
  `init` :52): an "audio" list (`tab.soundPlaying || tab.muted`, :62) above the window's visible
  tabs (`!tab.hidden`, :68), a hidden-tabs subview (:215). It has **no search field of its own**:
  its "Search tabs" button (`allTabsMenu-searchTabs`, `browser-allTabsMenu.inc.xhtml:8`, handled
  :147) calls `gURLBar.search(RESTRICT_TOKENS.OPENPAGE, { searchModeEntry: "tabmenu" })`
  (:277-280). Rows come from `TabsListBase` / `TabsPanel`
  (`browser/components/tabbrowser/TabsList.sys.mjs:58`, :449). Its key: `ctrl+shift+tab` through
  `browser-ctrlTab.js` `onKeyDown` (:585, :607-608 → `showAllTabs`, :471-473), with the
  most-recently-used `ctrl+tab` (`browser.ctrlTab.sortByRecentlyUsed`, `firefox.js:1267`, default
  false; in Vimma `ctrl+shift+tab` is `previous_tab`). `Browser:ShowAllTabs`
  (`browser-sets.inc.xhtml:90`, `browser-sets.js:208-209`) is also in the View menu.
- **URL bar tab search**: the `%` restrict token (`browser/components/urlbar/content/UrlbarShared.mjs:195`,
  `RESTRICT_OPENPAGE` :172) or the "Tabs" search mode (:441-447). `UrlbarProviderOpenTabs`
  (`browser/components/urlbar/UrlbarProviderOpenTabs.sys.mjs:30-32`) keeps open URLs per
  `userContextId` and group, registered on location change (`Tabbrowser.sys.mjs:10694-10712`)
  and for lazy browsers from their `lazyBrowserURI` (:3850-3861); hidden tabs (other workspaces)
  stay registered. Switch-to-tab respects containers (`URILoadingHelper.sys.mjs:1048-1050`, via
  `UrlbarParentController.sys.mjs:1104-1150`). It matches URL and title through Places, ranks with
  history, and shows neither workspace, window nor rename: it is a URL bar result, not a list.
  The only `switchTabs` pref is `browser.urlbar.switchTabs.adoptIntoActiveWindow` (`firefox.js:698`).
- **Firefox View** (no keyboard shortcut; menu item `menu_openFirefoxView`,
  `browser-menubar.inc.xhtml:380`): "Open tabs" per window, hidden tabs filtered out
  (`browser/components/firefoxview/OpenTabs.sys.mjs:355-357`, privacy filter :124, :146,
  :442-448); "Recently closed" (`recentlyclosed.mjs:167-186`) from `SessionStore.getClosedTabData`
  plus `getClosedTabDataFromClosedWindows` when `browser.sessionstore.closedTabsFromClosedWindows`
  is on (`firefox.js:1551`, default true), sorted by `closedAt`, URL from
  `state.entries[index - 1].url`; reopen with `undoCloseById` (:220) or
  `undoClosedTabFromClosedWindow` (:222), dismiss with `forgetClosedTabById` (:263-275).
- **SessionStore** (`browser/components/sessionstore/SessionStore.sys.mjs`):
  `getClosedTabData(options)` (:3993; `closedTabsFromAllWindows`, `private`, `firefox.js:1550`
  default true), `getClosedTabDataForWindow` (:3970), `getClosedTabDataFromClosedWindows`
  (:4014), `getClosedTabCount` (:3929), `getClosedWindowData` (:4587), `undoCloseById(closedId,
includePrivate, targetWindow)` (:4914), `undoClosedTabFromClosedWindow` (:4329),
  `forgetClosedTabById` (:4527), `undoCloseWindow` (:4643). An entry (`#maybeSaveClosedTab`,
  :2910-2938) carries `title`, `image`, `closedAt`, `closedId`, `sourceWindowId` and the full
  `state`, whose `userContextId` (`TabState.sys.mjs:210`) is the tab's container, so a reopened
  tab returns to its workspace's container. A private tab closed in a normal window is never
  saved (:2917-2919); a private window keeps its own closed tabs. Caps:
  `browser.sessionstore.max_tabs_undo` 25 per window, `max_windows_undo` 5 (`firefox.js:1585`,
  :1589).
- **Audio:** `tab.muted`, `tab.soundPlaying`, `tab.activeMediaBlocked` read attributes
  (`browser/components/tabbrowser/content/tab.js:241`, :255, :263); `toggleMuteAudio` :826-844.
- **Lazy tabs:** a lazy browser (`Tabbrowser.sys.mjs:3140` `#createLazyBrowser`) answers
  `currentURI` and `contentTitle` from `SessionStore.getLazyTabValue(tab, "url" | "title")`
  (about :3154-3164; `getLazyTabValue` SessionStore :4856), so reading them loads nothing; a lazy
  tab has no `linkedPanel` (Vimma's `tabById` already handles it). Pending tabs carry
  `pending="true"` (SessionStore :2979, :6378). `browser.sessionstore.restore_on_demand` is true
  (`firefox.js:1602`).
- **`ctrl+shift+a`** is `key_openAddons` → `Tools:Addons` (`browser/base/content/browser-sets.inc.xhtml:187`);
  Firefox has no tab-search key besides the all-tabs panel's `ctrl+shift+tab`.

### Zen

No Zen source tree is checked out (`engine/browser/base/zen-components/` holds only Vimma's
tests). From Zen's installed `omni.ja` (`~/Downloads/zen/browser/omni.ja`): its command palette is
a URL bar provider (`modules/ZenUBActionsProvider.sys.mjs:139`, actions in
`ZenUBGlobalActions.sys.mjs`, strings in `zen-command-palette.ftl`) with "switch to workspace"
entries (:178-197), but **no tab-search list**. Its patched `switchToTabHavingURI` walks every
workspace's browsers (`URILoadingHelper.sys.mjs:1028`) and switches workspace when needed
(:1084), so Zen's tab search is Firefox's `%` across spaces. Nothing to borrow beyond "switching
to a tab in another space switches the space", which Vimma's picker already does.

## Decisions

1. **Extend the goto picker; no second picker.** `goto.picker` becomes tab search: same dialog,
   same core state machine, same keys plus the new ones below. Two lists that both find tabs would
   split muscle memory and tests; Brave has one. Its heading becomes "Tabs", its action stays
   `goto_picker` (a config name users may have bound), and its help text
   becomes "Tab search: every tab, every window, recently closed". (Open question 1.)
2. **Two ways in.** `ctrl+b g`, `b` and `:ls` open it as today, in browse mode (`j`/`k` first).
   New action `tab_search` (`goto.search`) opens the same picker **in search mode**, typing at
   once, as Brave's `ctrl+shift+a`: default `prefix+f` (tmux's `find-window` is `prefix f`), and
   `:tabsearch [text]` (alias `:ts`) with the text as the query. `ctrl+shift+a` stays
   `addons_manager` (firefox-keys inventory, fate a); a user who wants Brave's chord writes
   `keys.tab_search = ["prefix+f", "ctrl+shift+a"]`, and "bound means off" then disables
   Firefox's add-ons key for them. (Open question 2.)
3. **What it lists, in order** (blank query):
   1. The current window's workspaces, current workspace first, then the window's workspace
      order (today it is the window's order with the current one wherever it falls; the current
      workspace first matches Brave's "where you are first" and keeps `Enter` on the current tab
      a no-op). Agent workspace last (decision 6).
   2. Every other normal window, most recently used first (`BrowserWindowTracker.orderedWindows`),
      each window's workspaces in its own order. Rows carry the window as `w2`, `w3` (Vimma's
      window number: order of `orderedWindows` at open time; window 1 is this one).
   3. "Recently closed": closed tabs of every normal window, newest first, then closed windows
      as one row each (`3 tabs · closed window`). Cap: 25 tabs and 5 windows by default, Firefox's
      own caps are `browser.sessionstore.max_tabs_undo` 25 per window and `max_windows_undo` 5. (Open question 3.)
      A section starts with a heading row (`role=presentation`, not an option), so `j`/`k` skip it:
      `work · 12`, `personal · 40 · w2`, `Recently closed · 9`. With a query, matches are ranked
      across sections by score, and each row still shows its workspace, window and "closed" tag.
4. **A row** reads: index (the tab's number in its workspace, or blank for a closed tab), the
   display label with highlights, then muted cells: workspace name, window (`w2`, only for
   other windows), markers, host. Markers: `♪` playing, `muted`, `pinned`, `◇` agent, `closed`.
   The marker words are searchable (a fifth field, `markers`, weight 50), so `playing` finds the
   audible tabs, as Firefox's all-tabs panel lists them apart. Highlights cover the URL cell's host too (today only `display` is rendered,
   `ui/picker.mjs:221-227`).
5. **Private stays private.** A normal window's search never lists a private window's tab, open
   or closed (private-workspace decision 5b). The private window's search lists only the private
   workspace's tabs and its own closed tabs; no other window's. Firefox does the same
   (Firefox View by window privacy, and SessionStore never saves a private tab closed in a normal window; see Research). Pinned by a test in each direction.
6. **Agent workspace: listed, marked, last.** Its tabs show `◇ agent` and come after the user's
   workspaces in the current window, never ranked above a user tab with an equal score (a tie
   breaker, not a score penalty). With `[mcp]` off and the agent workspace empty, nothing shows.
   `x` on an agent tab closes it like any tab (it is the user's browser); `m` moving a tab
   **into** agent asks with vimma-mcp decision 11's question, never silently. (Open question 4.)
7. **Keys in the picker** (browse mode; search mode types them): `j`/`k`, `ctrl+n`/`ctrl+p`,
   `Down`/`Up`, `left`/`right` (sections), `Enter`, `/`, `Esc`/`q` as today, and:
   - `Tab` / `shift+tab` jump to the next / previous section in every mode, with a query too (in
     search mode they move without leaving it), so "Recently closed" is one key away.
   - `x` closes the selected open tab and keeps the list open with the selection on the next
     row, as the side panel's `x`; a pinned tab is refused with `PINNED_TEXT`. Closing the last
     tab of a window asks first, as `ctrl+w` does not (the window would close under the list).
     On a closed row `x` forgets it (`SessionStore.forgetClosedTabById`), as Firefox View's
     "dismiss" does.
   - `u` on a closed row reopens it and keeps the list open; `Enter` reopens it and goes there.
   - `m` on an open tab moves that tab to the current workspace (`moveTabQuestion` y/N, the
     reopen-in-container warning); refused for a private tab or across private and normal,
     as `:wsmove`.
   - `d` is not used: in Vim `d` is delete and here it would be a second close key; leaving it
     free avoids a muscle-memory accident between `x` and `d`.
     These are the picker's own keys, not keymap bindings (as `j`, `/` and `q` today,
     m2-picker-rename "Keys"), listed in the hint line and in `ctrl+b ?` under the picker's group.
8. **Enter on another window's tab** focuses that window (`win.focus()`), switches its workspace
   if needed (WindowWorkspaces' `TabSelect` path, as today) and selects the tab, then closes the
   picker in this window. On another workspace in this window, as today.
9. **Lazy tabs stay lazy.** Title and URL come from `linkedBrowser.contentTitle || tab.label` and
   `linkedBrowser.currentURI` as today (`goto.mjs:93-97`; for a pending tab SessionStore's lazy
   browser answers `currentURI` without loading, see Research). Closed tabs from
   `SessionStore.getClosedTabData` / `getClosedTabDataFromClosedWindows` / `getClosedWindowData` (title and the last history entry's
   URL); nothing is fetched. Favicons are not shown (Vimma's picker is text; loading icons for
   hundreds of rows is the cost Brave pays with a virtual list).
10. **Performance.** The list is built once on open and on `TabOpen`/`TabClose`/`TabAttrModified`
    events while open (debounced to one animation frame), not per key. Matching runs per key over
    at most a few hundred items: today's `scoreField` builds grapheme units for every field per
    term; with 500 tabs × 4 fields that is ~2,000 segmentations per key. Units are cached per
    item (computed once on build). Budget: 500 open + 25 closed items, query `abc def`, under 8 ms
    per key in Vitest on CI (a bench test, as the key-to-action bench), and the rendered list is
    capped at 200 rows with a `… N more, type to narrow` row; `selectable_lazy_list` is Brave's
    answer, ours is a cap, since a keyboard user narrows by typing.
11. **Accessibility.** Same listbox / option semantics and `aria-activedescendant` as today.
    Heading rows are `role=presentation` with the section's name in each option's accessible
    name instead (`"Jira 412, work, window 2"`, `"Docs, recently closed"`), since a listbox
    cannot hold headings. A polite live region announces `12 tabs` / `no tabs match` after a
    query change (Brave's `getA11ySearchResultText_`). Markers are words or glyphs with an
    accessible word (`♪` is announced "playing").
12. **Theme.** Existing tokens only: headings `--vimma-text-accent`, marker and window cells
    `--vimma-muted`, the `closed` tag `--vimma-muted` in italics, `◇` the agent segment's colour.
    No new token; Omarchy and the built-in themes work unchanged.
13. **Out of the window.** Tabs in Firefox's other profiles, synced tabs from other devices
    (Firefox View has them; Vimma's Sync stance is m0-mozilla-services), and page content search
    (see Out of scope).

## Test plan (written first, red before green)

### Vitest (`packages/vimma-core`)

- `picker.test.mjs`:
  - `pickerItems` gains `agentId`, window and closed items: the agent workspace's rows carry
    `agent: true` and sort after user workspaces; the current workspace's rows come first;
    other windows' items carry `window: 2..n`; closed items carry `closed: true` and no `tabIndex`.
  - `matchItem` on a closed item matches title and URL; highlights for `url` are kept;
    ties order agent rows last (decision 6).
  - `pickerKey`: `tab` / `shift+tab` jump sections with and without a query and in search mode;
    `x` on an open row gives `{ type: "closeTab", id }`, on a closed row `{ type: "forget", id }`;
    `u` on a closed row `{ type: "reopen", id, stay: true }`, Enter on it `{ type: "reopen", id }`;
    `m` on an open tab row gives `{ type: "moveHere", id }`; `x`, `u`, `m` type in search mode;
    the add-on keys still work on add-on rows only.
  - `openPicker(items, { mode: "search", query })` starts in search mode with the query applied.
  - Bench: 500 + 25 items, 20 keystrokes, each under the budget (decision 10), and item units are
    built once (a spy on the segmenter count).
- `tabsearch.test.mjs` (new, pure): sections and headings from a list of windows (current first,
  then by recency), the private filter (a private window's items never in a normal list and
  the reverse), the closed caps, the 200-row cap and its "more" row, the accessible names.
- `actions.test.mjs`, `defaults.test.mjs`, `cmdline.test.mjs`, `help.test.mjs`: `tab_search` on
  `prefix+f`; `:tabsearch [text]` / `:ts`; the overlay row; snapshots re-recorded with a
  changelog line each (`defaults.test.mjs.snap`, `help.test.mjs.snap`), bindings.md / .json /
  defaults.toml regenerated.

### Mochitests (`tests/browser/`)

- `browser_vimma_picker.js` (extended):
  - Two windows, two workspaces each: `ctrl+b g` lists all four groups with headings, this
    window's current workspace first; `Enter` on a window-2 tab focuses window 2, switches its
    workspace and selects the tab; window 1's picker closed.
  - `ctrl+b f` opens in search mode (`/` shown), typing `jira` filters; `:tabsearch jira` same.
  - `x` closes the selected tab, the list stays open on the next row; a pinned tab is refused
    with the notice; closing a window's last tab asks.
  - Recently closed: close three tabs, `Tab` jumps to the section, `u` reopens the second in its
    workspace's container with its history (`SessionStore` state, `userContextId`), the list
    stays; `Enter` on a closed row reopens and selects it; `x` forgets it
    (`getClosedTabCount` drops by one); `undoCloseById` is the reopen path.
  - A lazy tab (restored, never selected) is listed with title and URL and is still pending
    (`tab.hasAttribute("pending")`) after the picker opens and closes.
  - A tab playing audio shows `♪`; muted shows `muted`.
  - The agent workspace with a tab: its row shows `◇ agent` and sorts last; `m` into agent asks.
  - `m` on another workspace's tab asks `moveTabQuestion`, `y` moves it here.
- `browser_vimma_private_workspace.js`: a normal window's tab search lists no private tab, open
  or closed; the private window's lists only its own (both directions, decision 5).
- `browser_vimma_a11y.js`: option names include workspace / window / "recently closed"; heading
  rows are not options; the live region text after a query.
- `browser_vimma_focus_rings.js` and `browser_vimma_theme.js`: unchanged and green.
- `browser_vimma_help_overlay.js`: `tab_search` row with `ctrl+b f`.

### e2e (`tools/e2e`, Xvfb) and screenshots

- New scenario `tab-search.json`: two windows, three workspaces, one agent tab, two closed
  tabs, one audio tab (a `pages.mjs` fixture with a silent looping `<audio>`); `ctrl+b f`, type
  `doc`; screenshot `tab-search.png` as a new baseline, with the CHANGELOG line "a baseline for
  tab search". Verified first with the real Omarchy theme
  (`vimma.theme.source=omarchy`) per the screenshot-verify rule, and in Tokyo Night for the
  baseline.
- Bench: 300 tabs across 3 workspaces (plan §9's hidden-tab risk row says "measure with 200"),
  open-to-render and per-key time logged, no loaded tab gained.

## Sub-PRs

| #   | Title                                                                               | Scope                                                                                                                                                                                                                                                                                                                                   | Size                      |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | `feat(picker): tab search lists the workspace, window and audio on each row`        | Core: `agentId`, current-workspace-first order, cached units + bench, url highlights, section heading rows, `tab`/`shift+tab`, accessible names, live region; UI rows and headings; `x` close and `m` move-here; mochitests; guide "Goto picker" section rewritten as "Tab search". No new default key yet (picker-internal keys only). | M (~600 lines with tests) |
| 2   | `feat(picker): tab search finds tabs in your other windows and reopens closed ones` | `host/tab-search.mjs`: other windows, closed tabs/windows from SessionStore, `undoCloseById`, `undoClosedTabFromClosedWindow`, `forgetClosedTabById`, private filter; `u`; Enter across windows; mochitests incl. private both ways; e2e scenario + baseline.                                                                           | M (~700)                  |
| 3   | `feat(keys): ctrl+b f opens tab search ready to type` (keymap PR)                   | `tab_search` action, `prefix+f`, `:tabsearch`/`:ts`, help row, gen-docs, snapshots, README feature line.                                                                                                                                                                                                                                | S (~250)                  |

Sub-PR 3 is the only keymap PR; 1 and 2 add picker-internal keys only, which are not keymap
bindings, so they do not wait for the keymap queue. Each lands screenshot-verified.

## Docs and changelog the implementation must update

- **guide.md**: "Goto picker and tab rename" (guide.md:1272) becomes "Tab search and tab rename":
  what is listed, sections, the keys (`x`, `u`, `m`, `Tab`), other windows, recently closed, the
  private and agent rules; the keys table row at guide.md:429; "The command line" (`:tabsearch`);
  the workspaces paragraph at guide.md:681 ("lists every workspace's tabs") gains "and other
  windows'".
- **README**: the feature list's picker line becomes "tab search: every tab of every workspace
  and window, and recently closed, fuzzy by title, URL or your rename".
- **bindings.md / bindings.json / defaults.toml** via `npm run gen-docs` (sub-PR 3).
- **CHANGELOG.md [Unreleased]**, added by the maintainer at merge, suggested lines:
  "Tab search: the goto picker shows each tab's workspace, closes tabs with `x` and moves them
  with `m`" (1); "Tab search lists your other windows' tabs and reopens recently closed ones"
  (2); "`ctrl+b f` and `:tabsearch` open tab search ready to type" (3); plus the baseline line.

## Out of scope

Searching page content (text inside every tab; Firefox has no index of it, and loading lazy tabs
to search them breaks decision 9; a later spec could search loaded tabs only through the find
actor); synced tabs from other devices; tab groups (Vimma has workspaces); Brave's "Organise" /
AI grouping and Tab Focus Mode; favicons in the list; a toolbar button (Vimma has no tab strip).

## Open questions for the user

1. **Extend `ctrl+b g` or add a new picker?** Recommended: extend it. One list for finding
   any tab, as Brave has one; `ctrl+b g`, `b` and `:ls` keep working and gain other windows,
   recently closed, `x`, `m`, `u`. A separate picker would duplicate keys, tests and docs.
2. **Default key?** Recommended: `ctrl+b f` (tmux's find-window, free today) opens it ready to
   type, plus `:tabsearch`. Not `ctrl+shift+a`: since firefox-keys it is the add-ons manager, as in
   Firefox; you can add it to `tab_search` in config.toml if you want Brave's key.
3. **Include recently closed tabs (and closed windows)?** Recommended: yes, both, as a last
   section capped at 25 tabs and 5 windows; `Enter` reopens and goes there, `u` reopens and
   stays, `x` forgets.
4. **Agent workspace tabs?** Recommended: listed, marked `◇ agent`, always after your own
   workspaces; never hidden, so you can see and close what an agent opened.
5. **Other windows' tabs?** Recommended: yes, after this window's, marked `w2`, `w3`; `Enter`
   brings that window forward. (Brave lists every window.)
