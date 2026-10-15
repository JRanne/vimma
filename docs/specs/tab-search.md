# Spec: tab-search

Status: draft · Area: `packages/vimma-core/src/` (`picker.mjs`,
`tabsearch.mjs` new, `actions.mjs`, `defaults.mjs`, `cmdline.mjs`, `help.mjs`);
`src/browser/base/content/vimma/` (`host/goto.mjs`, `host/tab-search.mjs` new,
`host/VimmaHost.sys.mjs`, `ui/picker.mjs`); `src/browser/themes/shared/vimma/picker.css` ·
Upstream patches: none · ADR: none. No new dependency.

Issue: [#215](https://github.com/vimma-browser/vimma/issues/215)

Builds on [m2-picker-rename](m2-picker-rename.md) (the goto picker),
[m3-workspaces](m3-workspaces.md) (sub-spec 5, the workspace picker and its `m`),
[private-workspace](private-workspace.md) (decision 5b: a normal window never shows a private
tab's title or URL), [vimma-mcp](vimma-mcp.md) (the agent workspace, decisions 9, 11 and 24) and
[firefox-keys](firefox-keys.md) (`ctrl+shift+a` is `addons_manager`). Vimma paths are checked on
main at 7fc0226 and are under `src/browser/base/content/vimma/` unless they start with
`packages/`, `src/browser/themes/`, `docs/`, `tests/` or `tools/`. Engine paths are relative to
`engine/` and checked against Firefox 158.0.

## Summary

The goto picker (`ctrl+b g`, `b`, `:ls`) becomes tab search, modelled on Chromium's and Brave's
Tab Search: one keyboard list that finds any open tab in any workspace of any normal window, and
any recently closed tab or window. Each row shows its workspace, window and audio state; `x`
closes a tab from the list, `u` reopens a closed one and `m` moves a tab to the current
workspace. A new action, `tab_search` (`ctrl+b f f`, `:tabsearch [text]`), opens the same list
ready to type. Private tabs never appear outside the private workspace, agent tabs are marked
`◇`, and lazy tabs stay unloaded.

## Problem

With many tabs across workspaces and windows, finding one tab is slow or impossible from the
keyboard today:

- The goto picker lists only the current window. A tab in another window cannot be found from
  Vimma at all.
- A row does not show its workspace, so two tabs with the same title in `work` and `personal`
  look the same.
- A tab closed by mistake a few tabs ago can only be reached by pressing `ctrl+shift+t`
  repeatedly, which reopens every tab closed after it too. There is no list of closed tabs.
- A tab playing audio cannot be found from the picker; only the side panel marks it, and only
  for the current workspace.
- Tidying up means leaving the picker for every tab: there is no close or move from the list.
- The agent workspace's tabs appear in the picker with no marker, indistinguishable from the
  user's own.

## Behaviour

1. As a Vimma user with 150 tabs across `work`, `personal` and two windows, `ctrl+b f f` and a few
   letters (`jira 412`) find the tab, and `Enter` takes me there: the right window comes to the
   front and the right workspace becomes active. No tab that was not loaded loads.
2. As a Vimma user who closed a tab by mistake three tabs ago, `ctrl+b f f`, then `Tab` (to
   "Recently closed") or part of its title, then `Enter` (or `u`) reopen it in its own
   workspace, with its history. `ctrl+shift+t` still reopens only the last one.
3. As a Vimma user tidying up, `ctrl+b g`, `j`/`k` and `x` close tabs one after another without
   leaving the list. A pinned tab is refused with a notice and stays.
4. As a Vimma user who hears audio somewhere, the playing tab's row shows `♪` (and `muted` when
   muted), and typing `playing` or `muted` finds those rows.
5. As a Vimma user in `work`, `m` on a `personal` tab's row moves that tab here, after the same
   y/N question the workspace picker's `m` asks (the move reopens the page in this workspace's
   container).
6. As a user of the private workspace, a normal window's tab search never lists a private tab's
   title or URL, open or closed, and the private window's tab search lists only its own tabs.
7. As a Vimma user running an agent, the agent workspace's tabs are listed marked `◇ agent`,
   after my own workspaces, so an agent's tab is never mistaken for mine.
8. As a screen-reader user, the list is a listbox whose options name the tab, its workspace and
   its window or "recently closed", and the number of matches is announced as I type.

Keys and commands added (decision 2, decision 7):

| Key or command                           | Where         | Does                                              |
| ---------------------------------------- | ------------- | ------------------------------------------------- |
| `ctrl+b f f`, `:tabsearch [text]`, `:ts` | everywhere    | `tab_search`: opens tab search in search mode     |
| `ctrl+b g`, `b`, `:ls`, `:b`             | unchanged     | `goto_picker`: opens tab search in browse mode    |
| `Tab` / `shift+tab`                      | in the picker | next / previous section                           |
| `x`                                      | in the picker | closes the open tab, or forgets the closed one    |
| `u`                                      | in the picker | reopens the closed tab and keeps the list open    |
| `m`                                      | in the picker | moves the open tab to the current workspace (y/N) |

No config key is added. `keys.tab_search` and `keys.goto_picker` are configurable as every
action is (firefox-keys).

## Research

### Chromium and Brave Tab Search

Chromium source checked at `chromium/src` main, commit a879a00e (2026-10-14, `chrome/VERSION`
158.0.8105.0), through `chromium.googlesource.com`. Brave source checked at `brave/brave-core`
master, commit 3446fc820e (`package.json` version 1.99.42), through the GitHub API.

- **Brave ships Chromium's Tab Search** and adds a setting for its button: the pref
  `brave.tabs_search_show` (`components/constants/pref_names.h`, `kTabsSearchShow`), labelled
  "Show tab search button" (`app/brave_settings_strings.grdp:314-316`). Brave's help centre
  places Tab Focus Mode, an AI grouping feature out of scope here, under the same button
  (<https://support.brave.app/hc/ar/articles/35200007195917-How-to-use-Tab-Focus-Mode>; a help
  page, no version stated).
- **Shortcut.** `ctrl+shift+a` (`cmd+shift+a` on macOS) is `IDC_TAB_SEARCH` in Chromium
  (`chrome/browser/ui/accelerator_table.cc:63-64`, `VKEY_A` with `EF_SHIFT_DOWN |
EF_PLATFORM_ACCELERATOR`); Brave inherits it.
- **It is a WebUI bubble**, `chrome://tab-search.top-chrome`, source in
  `chrome/browser/resources/tab_search/`: `tab_search_page.ts`, `tab_search_item.ts`,
  `tab_search_group_item.ts`, `selectable_lazy_list.ts` (a virtualised list) and
  `alert_indicators/` (audio and recording icons).
- **Every window's tabs.** `tab_search_page.ts:682` walks `profileData.windows`, every window of
  the profile, into one open-tabs list, sorted by `lastActiveTimeTicks`, most recent first, with
  the active window's visible tab moved to the bottom "because it's not likely users want to
  click on it" (`:940-953`). Some third-party guides say it searches the current window only; the
  source says otherwise.
- **Sections.** "Audio and video" (tabs with `tabHasMediaAlerts()`, `:956-1002`, not shown while a
  query is typed), "Open tabs", and "Recently closed" (tabs, split views and closed tab groups,
  `:720-747`, `:1011-1035`), capped at `recentlyClosedDefaultItemDisplayCount` (`:167-168`) and
  expandable.
- **Search.** Fuse.js options (`:145-166`) over `tab.title` (weight 2), `tabGroup.title` (1.5) and
  `hostname` (1), `threshold: 0.0`, with matched characters highlighted.
- **Keys and accessibility.** `Up`/`Down` move, `Enter` switches (to another window too), `Esc`
  closes the bubble; each row has a close button (`apiProxy_.closeTab()`, `:652`), and the screen
  reader hears the result count (`getA11ySearchResultText_()`, `:480`).

What Vimma takes: one place to find any tab, every window, recently closed in the same list,
media markers, close from the list, and a way in that starts typing. What Vimma leaves: the
mouse-first bubble and its button, tab-group sections (Vimma has workspaces instead), the
recency order (decision 3) and the AI grouping.

### Vimma today

- **The goto picker** (`goto.picker`: `prefix+g`, `b` in normal mode, `:ls` and `:b`; guide
  "Goto picker and tab rename" and the command table; `packages/vimma-core/src/defaults.mjs:106`,
  `:198`, `cmdline.mjs:106`):
  - It lists every tab of every workspace **of the current window**, workspace by workspace
    (`host/goto.mjs:35-62` `pickerWorkspaces`, `:81-100` `gotoItems`; core `picker.mjs:353-373`
    `pickerItems`). A private window lists its own visible tabs (`goto.mjs:52-61`).
  - Matching is fuzzy per whitespace-separated term over the rename or title (`display`), title,
    URL and workspace name; every term must match some field (`picker.mjs:303-330`). Tiers are
    exact > prefix > word > substring > subsequence > diacritics-folded (`picker.mjs:85-92`,
    `scoreField` `:226`), and field weights are `display 300, title 250, url 150, workspace 100`
    (`:95`).
  - Keys: `j`/`k`/`Down`/`Up`/`ctrl+n`/`ctrl+p`, `/` to search, `left`/`right` to jump workspace
    sections on a blank query (`jumpSection`, `:466-485`), `Enter`, `Esc`/`q` (`pickerKey`,
    `:506-563`). `m` is the workspace picker's only (`:533`); `x`, `d`, `o`, `u` and `shift+p` are
    the add-on picker's (`ADDON_KEYS`, `:73-79`). No key acts on a tab row besides `Enter`.
  - The UI (`ui/picker.mjs`, look `GOTO` at `:45`) shows per row the tab number, the display
    label with `<mark>` highlights (the display field only, `:221-227`) and the host. **The
    workspace name is not shown on a row** and there are no section headings, though the list
    is ordered by workspace. The list is `role=listbox` with options and
    `aria-activedescendant` (`:247-253`, `:285`; m7-a11y).
  - Selecting a lazy tab works: `tabById` (`goto.mjs:69-74`) falls back to the window model's
    uuid for a tab with no `linkedPanel`; title and URL are read from `linkedBrowser` without
    loading (`:93-97`).
  - The agent workspace's tabs are listed with no marker: `pickerItems` takes no agent id, while
    `workspaceItems` marks the agent row `◇ agent` (`picker.mjs:382-398`, `AGENT_GLYPH` in
    `agent.mjs:13`).
  - A new item list while open keeps the selection (`setPickerItems`, `picker.mjs:433-440`,
    `ui/picker.mjs:157-161`); the add-on picker's refresh uses it.
- **The workspace picker** (`ctrl+b w`): one row per workspace, the agent workspace last among
  the normal ones and the `◆ private` row after them (`host/private-ops.mjs:286`
  `pickerItemsWithPrivate`; private-workspace decision 5, vimma-mcp decision 9). `m` moves the
  current tab there after `moveTabQuestion` (`packages/vimma-core/src/workspacedefs.mjs:534`),
  which asks the agent variant of the question when the target is the agent workspace
  (vimma-mcp decision 11; host `host/workspace-ops.mjs:341`).
- **The side panel** (`ctrl+b b`): the current workspace only. Rows carry `♪` for
  `tab.soundPlaying` (`host/VimmaHost.sys.mjs:1073`, `ui/side-panel.mjs:262`). `x` closes the
  tab and keeps the panel open, refusing a pinned tab with `PINNED_TEXT`
  (`packages/vimma-core/src/sidepanel.mjs:66`, `:354-364`; host `closeTabById`,
  `host/tab-ops.mjs:79-87`). Its header never names the agent workspace as a neighbour (the
  `skip` option, `sidepanel.mjs:58-59`, `:99-108`).
- **Recently closed.** Only `restore_tab` (`ctrl+shift+t`), which runs Firefox's
  `History:RestoreLastClosedTabOrWindowOrSession` (`host/tab-ops.mjs:94-99`), and
  `restore_window`, mapped to `History:UndoCloseWindow` (`host/browser-ops.mjs:17`). No list.
- **Other windows.** Nothing in Vimma lists their tabs. `BrowserWindowTracker.orderedWindows` is
  used by about:vimma and the private workspace (`about/AboutVimma.sys.mjs:241`,
  `host/private-ops.mjs:89-102`).
- **Keys.** `ctrl+shift+a` is `addons_manager`, page first (`defaults.mjs:127`;
  `docs/bindings.md:139`, `:309`; firefox-keys sub-PR 1, #171). Prefix keys in use
  (`defaults.mjs`): `( ) ? [ ^ a b c ctrl+6 e enter g h j k l minus n p r space v w x z` and
  `shift+a b d h j k l n p t w x`. toolbar-toggle reserves `prefix+u`. `prefix+f` is unbound; it
  becomes the find group that tab search and live grep share (decision 2), so `prefix+f` has no
  action of its own and `prefix+f f` and `prefix+f g` are three-chord bindings.
- **Three-key sequences.** `compileKeymap` builds one trie per mode and walks every chord of a
  binding, however many (`packages/vimma-core/src/keymap.mjs:263-277`). A node may have
  children and no action: normal mode's `y` is one today
  (`packages/vimma-core/test/keymap.test.mjs:139-143`). The dispatcher returns pending at such a
  node (`dispatcher.mjs:138-141`), arms no timeout because the node has no action
  (`ambiguous`, `:174`) and cancels on a key with no child (`:123-136`). Checked on main at
  7280cd5 by compiling `prefix+f f` and `prefix+f g` as user keys: both ran their actions,
  `ctrl+b f x` cancelled and `ctrl+b g` still ran `goto_picker`. No default binding has three
  chords yet.
- **Telescope's keys.** telescope.nvim's README (v0.2.1) suggests `<leader>ff` for
  `find_files`, `<leader>fg` for `live_grep`, `<leader>fb` for `buffers` and `<leader>fh` for
  `help_tags`.
- **Themes.** `picker.css` uses the theme tokens `--vimma-bg-dark`, `--vimma-fg`,
  `--vimma-fg-bright`, `--vimma-fg-dim`, `--vimma-muted`, `--vimma-selection`,
  `--vimma-text-accent` and `--vimma-focus`, with system-colour fallbacks. The agent's colour is
  `--vimma-text-cyan` (vimma-mcp decision 24; `packages/vimma-core/src/statusbar.mjs:65`).
- **Tests to extend.** `tests/browser/browser_vimma_picker.js`, `browser_vimma_workspace_picker.js`,
  `browser_vimma_private_workspace.js` (pins "no private tab in a normal window's goto picker"),
  `browser_vimma_a11y.js`, `browser_vimma_focus_rings.js`. The e2e baselines in
  `tests/e2e/baselines/` are `m0-happy-path-help.png`, `m0-mcp-stdio-grant.png`,
  `m0-mcp-stdio-question.png`, `m3-private-workspace.png` and `m4-split-panes.png`; none shows the
  picker.

### Firefox (checked against 158.0)

- **"List all tabs"** (`gTabsPanel`, `browser/components/tabbrowser/content/browser-allTabsMenu.js:13`,
  `init` `:52`): an audio list (`tab.soundPlaying || tab.muted`, `:62`) above the window's
  visible tabs (`!tab.hidden`, `:68`), and a hidden-tabs subview (`:214`). It has **no search
  field of its own**: its "Search tabs" button (`allTabsMenu-searchTabs`,
  `browser-allTabsMenu.inc.xhtml:8`, handled at `:147`) calls
  `gURLBar.search(UrlbarShared.RESTRICT_TOKENS.OPENPAGE, { searchModeEntry: "tabmenu" })`
  (`searchTabs`, `:277-281`). Rows come from `TabsListBase` / `TabsPanel`
  (`browser/components/tabbrowser/TabsList.sys.mjs:58`, `:449`). The panel opens on
  `ctrl+shift+tab` only when the most-recently-used `ctrl+tab` is on
  (`browser/components/tabbrowser/content/browser-ctrlTab.js` `onKeyDown` `:585`, `:607-608`;
  `showAllTabs` `:471-473`; `browser.ctrlTab.sortByRecentlyUsed`,
  `browser/app/profile/firefox.js:1278`, default false). In Vimma `ctrl+shift+tab` is
  `previous_tab`. `Browser:ShowAllTabs` (`browser/base/content/browser-sets.inc.xhtml:90`,
  `browser-sets.js:208`) is also in the View menu.
- **URL bar tab search.** The `%` restrict token (`OPENPAGE`,
  `browser/components/urlbar/content/UrlbarShared.mjs:194`; `RESTRICT_OPENPAGE` `:171`) or the
  "Tabs" search mode (`:444-448`). `UrlbarProviderOpenTabs`
  (`browser/components/urlbar/UrlbarProviderOpenTabs.sys.mjs:30-32`) keeps open URLs per
  `userContextId` and group. Tabs register on location change
  (`browser/components/tabbrowser/Tabbrowser.sys.mjs:10744-10761`) and lazy browsers from their
  `lazyBrowserURI` (`:3850-3860`); hidden tabs (other workspaces) stay registered. Switch-to-tab
  respects containers (`browser/modules/URILoadingHelper.sys.mjs:1049-1051`, called from
  `switchToTab`, `UrlbarParentController.sys.mjs:1119`). It matches URL and title through
  Places, ranks with history, and shows neither workspace, window nor rename: it is a URL bar
  result, not a list. The only `switchTabs` pref is
  `browser.urlbar.switchTabs.adoptIntoActiveWindow` (`firefox.js:703`, default false).
- **Firefox View** (no keyboard shortcut; menu item `menu_openFirefoxView`,
  `browser/base/content/browser-menubar.inc.xhtml:380`). "Open tabs" lists tabs per window with
  hidden tabs filtered out (`browser/components/firefoxview/OpenTabs.sys.mjs:357`) and separate
  targets for normal and private windows (`:124`, `:146`, `:442-448`). "Recently closed"
  (`recentlyclosed.mjs:167-180`) is `SessionStore.getClosedTabData` plus
  `getClosedTabDataFromClosedWindows` when `browser.sessionstore.closedTabsFromClosedWindows` is
  on (`firefox.js:1565`, default true), sorted by `closedAt`, with the URL from the current
  history entry of the saved state (`getTabStateValue`, `:155`). It reopens with
  `undoCloseById` (`:220`) or `undoClosedTabFromClosedWindow` (`:222`) and dismisses with
  `forgetClosedTabById` (`:263-275`).
- **SessionStore** (`browser/components/sessionstore/SessionStore.sys.mjs`):
  `getClosedTabData(options)` (`:4036`; `browser.sessionstore.closedTabsFromAllWindows`,
  `firefox.js:1564`, default true), `getClosedTabDataForWindow` (`:4013`),
  `getClosedTabDataFromClosedWindows` (`:4057`), `getClosedTabCount` (`:3972`),
  `getClosedWindowData` (`:4630`), `undoCloseById(closedId, includePrivate, targetWindow)`
  (`:4957`), `undoClosedTabFromClosedWindow` (`:4372`), `forgetClosedTabById` (`:4570`),
  `undoCloseWindow` (`:4686`). A closed-tab entry (`#maybeSaveClosedTab`, `:2947-2990`) carries
  `title`, `image`, `closedAt`, `sourceWindowId` and the full `state`, whose `userContextId`
  (`TabState.sys.mjs:210`) is the tab's container, so a reopened tab returns to its workspace's
  container. A private tab closed in a normal window is never saved (`:2953-2957`); a private
  window keeps its own closed tabs. Caps: `browser.sessionstore.max_tabs_undo` 25 per window and
  `max_windows_undo` 5 (`firefox.js:1599`, `:1603`).
- **Audio.** `tab.muted`, `tab.soundPlaying` and `tab.activeMediaBlocked` read attributes
  (`browser/components/tabbrowser/content/tab.js:241`, `:255`, `:263`); `toggleMuteAudio` is at
  `:826`.
- **Lazy tabs.** A lazy browser (`#createLazyBrowser`, `Tabbrowser.sys.mjs:3136`) answers
  `contentTitle` and `currentURI` from `SessionStore.getLazyTabValue(tab, "title" | "url")`
  (`:3150-3160`; `getLazyTabValue`, `SessionStore.sys.mjs:4899`), so reading them loads nothing.
  A lazy tab has no `linkedPanel` (Vimma's `tabById` handles it). Pending tabs carry
  `pending="true"` (`SessionStore.sys.mjs:3016`, `:6527`), and
  `browser.sessionstore.restore_on_demand` is true (`firefox.js:1616`).
- **`ctrl+shift+a`** is `key_openAddons`, command `Tools:Addons`
  (`browser/base/content/browser-sets.inc.xhtml:187`). Firefox has no tab-search key besides the
  all-tabs panel's conditional `ctrl+shift+tab`.

### Zen

Checked against Zen 1.23.1b (built on Firefox 157.0.1, `application.ini`), by unpacking its
installed `browser/omni.ja`; no Zen source tree is checked out. Zen's command palette is a URL
bar provider (`modules/ZenUBActionsProvider.sys.mjs:139`, `ZenUrlbarProviderGlobalActions`, with
actions in `ZenUBGlobalActions.sys.mjs`) that offers "switch to workspace" entries (`:178-197`),
but Zen has **no tab-search list**. Its patched `switchToTabHavingURI` walks every workspace's
browsers (`modules/URILoadingHelper.sys.mjs:1028`, `gZenWorkspaces.allUsedBrowsers`) and switches
workspace when needed (`:1084`), so Zen's tab search is Firefox's `%` across spaces. The one idea
to borrow, "switching to a tab in another space switches the space", Vimma's picker already
does.

## Design

Data flow: the host (`host/tab-search.mjs`, new) collects items from the current window
(`gotoItems`, extended), the other normal windows and SessionStore's closed tabs and windows. The
pure core (`tabsearch.mjs`, new) orders them into sections, applies the private filter, the caps
and the accessible names; `picker.mjs` matches, ranks and handles keys and returns effects; the
host applies the effects (select, close, forget, reopen, move) and refreshes the list.

Decisions 1, 3 (closed tabs and windows), 3 (other windows) and 6 are the recommended answers
to the open questions below and change if those are answered otherwise.

1. **Extend the goto picker; no second picker.** `goto.picker` becomes tab search: the same
   dialog, the same core state machine, the same keys plus the new ones in decision 7. Two lists
   that both find tabs would split muscle memory, tests and docs; Chromium and Brave have one.
   Its heading becomes "Tabs", its action name stays `goto_picker` (a config name users may have
   bound), and its help text becomes "Tab search: every tab, every window, recently closed".
   (Open question 1.)
2. **Two ways in.** `ctrl+b g`, `b` and `:ls` open it as today, in browse mode (`j`/`k` first).
   A new action `tab_search` (`goto.search`) opens the same picker **in search mode**, typing at
   once, as Chromium's `ctrl+shift+a` does. Its default key is `prefix+f f`, and
   `:tabsearch [text]` (alias `:ts`) opens it with the text as the query. `prefix+f` is a find
   group shared with live grep, a prefix with no action of its own: `f f` is tab search and
   `f g` is live grep (live-grep decision 2). The pair mirrors Telescope's suggested
   `<leader>ff` and `<leader>fg`, so a Neovim user's habit carries over, and the group leaves
   `f h` and `f b` for later finders without spending more prefix keys. The keymap supports
   three-chord bindings and actionless prefix nodes already (Research, "Three-key sequences").
   A plain `prefix+f` would have been one key shorter, but it would leave live grep on an
   unrelated key.
   `ctrl+shift+a` stays `addons_manager` (firefox-keys, fate a), because Firefox users expect it
   there; a Vimma user who wants Chromium's chord writes
   `keys.tab_search = ["prefix+f f", "ctrl+shift+a"]`, which, because a bound key is no longer
   Firefox's, turns Firefox's add-ons key off for them.
3. **What it lists, in order** (blank query):
   1. The current window's workspaces: the current workspace first, then the window's workspace
      order, the agent workspace last (decision 6). Today the current workspace sits wherever it
      falls in the order. Putting it first keeps the selected row, which the picker opens on,
      at the top, and the nearest tabs nearest. Chromium's recency order with the visible tab
      at the bottom was rejected: Vimma's tabs are organised by workspace, and a list that
      reorders on every switch defeats `left`/`right` and `Tab` section jumps.
   2. Every other normal window, most recently used first (`BrowserWindowTracker.orderedWindows`),
      each window's workspaces in its own order. Rows carry the window as `w2`, `w3`: Vimma's
      window number is the position in `orderedWindows` when the picker opens, so window 1 is
      always this one. (Open question 4.)
   3. "Recently closed": closed tabs of every normal window, newest first, then closed windows
      as one row each (`3 tabs · closed window`). The caps are 25 tabs and 5 windows, matching
      Firefox's own `browser.sessionstore.max_tabs_undo` (25 per window) and `max_windows_undo`
      (5). (Open question 2.)

   A section starts with a heading row (`role=presentation`, not an option), so `j`/`k` skip it:
   `work · 12`, `personal · 40 · w2`, `Recently closed · 9`. With a query, matches are ranked
   across sections by score, and each row still shows its workspace, window and `closed` tag.

4. **A row** reads: index (the tab's number in its workspace, blank for a closed tab), the
   display label with highlights, then muted cells: workspace name, window (`w2`, other windows
   only), markers, host. Markers are `♪` (playing), `muted`, `pinned`, `◇` (agent) and `closed`.
   The marker words are searchable as a fifth field, `markers`, weight 50, so `playing` finds
   the audible tabs, as Firefox's all-tabs panel lists them apart. Highlights also cover the
   host cell (today only `display` is rendered, `ui/picker.mjs:221-227`).
5. **Private stays private.** A normal window's tab search never lists a private tab, open or
   closed (private-workspace decision 5b). The private window's tab search lists only the
   private workspace's tabs and its own closed tabs, never another window's. Firefox draws the
   same line: Firefox View keeps separate targets for normal and private windows, and
   SessionStore never saves a private tab closed in a normal window (Research). A test pins each
   direction.
6. **Agent workspace: listed, marked, last.** Its tabs show `◇ agent` and come after the user's
   workspaces in each window; a tie in score never ranks an agent row above a user row (a tie
   breaker, not a score penalty). With `[mcp]` off and the agent workspace empty, nothing shows.
   Listing them is what lets the user see and close what an agent opened; hiding them was
   rejected for that reason. `x` on an agent tab closes it like any tab. `m` moving a tab
   **into** the agent workspace asks `moveTabQuestion`'s agent variant (vimma-mcp decision 11),
   never silently. A closed agent tab is marked `◇` too, and reopens in the agent container
   because SessionStore's saved `userContextId` puts it there. (Open question 3.)
7. **Keys in the picker.** In browse mode (search mode types them as text): `j`/`k`,
   `ctrl+n`/`ctrl+p`, `Down`/`Up`, `left`/`right` (sections), `Enter`, `/` and `Esc`/`q` as today,
   and:
   - `Tab` / `shift+tab` jump to the next / previous section in every mode and with a query
     too; in search mode they move without leaving it, so "Recently closed" is one key away.
   - `x` closes the selected open tab and keeps the list open with the selection on the next
     row, as the side panel's `x` does; a pinned tab is refused with `PINNED_TEXT`. Closing the
     last tab of a window asks y/N first, because the window would close under the list. On a
     closed row `x` forgets it (`SessionStore.forgetClosedTabById`), as Firefox View's dismiss
     does.
   - `u` on a closed row reopens it and keeps the list open; `Enter` reopens it and goes there.
   - `m` on an open tab moves that tab to the current workspace after `moveTabQuestion` (y/N,
     the reopen-in-container warning). It is refused for a private tab and across private and
     normal, as `:wsmove` is.
   - `d` is not used: in Vim `d` deletes, and a second close key next to `x` invites mistakes.

   These are the picker's own keys, not keymap bindings (as `j`, `/` and `q` are today,
   m2-picker-rename "Keys"). They are listed in the picker's hint line and in `ctrl+b ?` under
   the picker's group. The add-on picker's keys keep working on add-on rows only.

8. **`Enter` on another window's tab** focuses that window (`win.focus()`), switches its
   workspace if needed (WindowWorkspaces' `TabSelect` path, as today) and selects the tab, then
   closes the picker in this window. On another workspace in this window it behaves as today.
9. **Lazy tabs stay lazy.** Title and URL come from `linkedBrowser.contentTitle || tab.label` and
   `linkedBrowser.currentURI`, as today (`goto.mjs:93-97`); for a pending tab, SessionStore's lazy
   browser answers both without loading (Research). Closed tabs come from
   `SessionStore.getClosedTabData`, `getClosedTabDataFromClosedWindows` and
   `getClosedWindowData` (title, and the URL of the saved state's current history entry); nothing
   is fetched. Favicons are not shown: Vimma's picker is text, and loading icons for hundreds of
   rows is the cost Chromium pays with a virtual list.
10. **Performance.** The list is built once on open and again on `TabOpen`, `TabClose` and
    `TabAttrModified` events while open (debounced to one animation frame), not per key. Matching
    runs per key over at most a few hundred items. Today's `scoreField` builds grapheme units
    for every field per term; with 500 tabs and 4 fields that is about 2,000 segmentations per
    key, so units are cached per item when the list is built. Budget: 500 open and 25 closed
    items, query `abc def`, under 8 ms per key in Vitest on CI (a bench test, as the existing
    key-to-action bench). The rendered list is capped at 200 rows with a
    `… N more, type to narrow` row. Chromium answers the same problem with a virtualised list
    (`selectable_lazy_list.ts`); Vimma uses a cap, because a keyboard user narrows by typing.
11. **Accessibility.** The same listbox and option semantics and `aria-activedescendant` as
    today. Heading rows are `role=presentation`, and the section's name is in each option's
    accessible name instead (`"Jira 412, work, window 2"`, `"Docs, recently closed"`), because a
    listbox cannot hold headings. A polite live region announces `12 tabs` or `no tabs match`
    after a query change (as Chromium's `getA11ySearchResultText_`). Every marker is a word, or
    a glyph with an accessible word (`♪` is announced "playing").
12. **Theme.** Existing tokens only: headings `--vimma-text-accent`; marker and window cells
    `--vimma-muted`; the `closed` tag `--vimma-muted` in italics; `◇` in the agent's colour,
    `--vimma-text-cyan` (vimma-mcp decision 24). No new token, so Omarchy and the built-in
    themes work unchanged.
13. **Out of scope.** Tabs in other Firefox profiles; synced tabs from other devices (Firefox
    View has them; Vimma keeps Sync as Firefox has it, m0-mozilla-services); searching page
    content (Firefox has no index of it, and loading lazy tabs to search them breaks decision 9;
    a later spec could search loaded tabs only through the find actor); tab groups (Vimma has
    workspaces); AI grouping and Brave's Tab Focus Mode; favicons in the list; a toolbar button
    (Vimma has no tab strip).

## Security and privacy

Tab search is chrome UI in the user's own window and adds no control-socket command, so nothing
new is exposed to `vimma-ctl` or to an agent connection; an agent cannot open, read or drive the
picker. The data it shows (titles and URLs of open and closed tabs) is already visible in
Firefox View and the URL bar's `%` mode. The two boundaries that matter are enforced and tested:
a normal window never lists a private tab, open or closed (decision 5), and agent tabs are
always marked so the user can tell them apart (decision 6). Moving a tab into the agent
workspace, which hands its page to the agent's container, keeps the y/N question with the agent
wording (vimma-mcp decision 11). Closed-tab data is read from SessionStore in the parent process
and never leaves it.

## Tests

Written first and seen to fail.

### Vitest (`packages/vimma-core/test/`)

- `picker.test.mjs`:
  - `pickerItems` gains an agent id, window and closed items: the agent workspace's rows carry
    `agent: true` and sort after user workspaces; the current workspace's rows come first;
    other windows' items carry `window: 2..n`; closed items carry `closed: true` and no
    `tabIndex`.
  - `matchItem` on a closed item matches title and URL; highlights for `url` are kept; ties
    order agent rows last (decision 6); `playing` and `muted` match the `markers` field.
  - `pickerKey`: `tab` / `shift+tab` jump sections with and without a query and in search mode;
    `x` on an open row gives `{ type: "closeTab", id }`, on a closed row `{ type: "forget", id }`;
    `u` on a closed row gives `{ type: "reopen", id, stay: true }`, `Enter` on it
    `{ type: "reopen", id }`; `m` on an open tab row gives `{ type: "moveHere", id }`; `x`, `u`
    and `m` type in search mode; the add-on keys still work on add-on rows only.
  - `openPicker(items, { mode: "search", query })` starts in search mode with the query applied.
  - Bench: 500 + 25 items, 20 keystrokes, each under the budget (decision 10), and item units are
    built once (a spy on the segmenter count).
- `tabsearch.test.mjs` (new, pure): sections and headings from a list of windows (current first,
  then by recency); the private filter (a private window's items never in a normal list, and the
  reverse); the closed caps; the 200-row cap and its "more" row; the accessible names.
- `keymap.test.mjs`: the `prefix+f` node has no action and has the child `f` (and `g` once live
  grep's key exists); `ctrl+b f f` dispatches `tab_search`, `ctrl+b g` still dispatches
  `goto_picker`, and `ctrl+b f` followed by an unbound key cancels.
- `actions.test.mjs`, `defaults.test.mjs`, `cmdline.test.mjs`, `help.test.mjs`: `tab_search` on
  `prefix+f f`; `:tabsearch [text]` and `:ts`; the overlay row. The snapshots
  (`defaults.test.mjs.snap`, `help.test.mjs.snap`) are re-recorded with a changelog line each, and
  `docs/bindings.md`, `bindings.json` and `defaults.toml` are regenerated.

### Mochitests (`tests/browser/`)

- `browser_vimma_picker.js` (extended):
  - Two windows with two workspaces each: `ctrl+b g` lists all four groups with headings, this
    window's current workspace first; `Enter` on a window-2 tab focuses window 2, switches its
    workspace and selects the tab, and window 1's picker is closed.
  - `ctrl+b f f` opens in search mode (`/` shown) and typing `jira` filters; `:tabsearch jira` does
    the same.
  - `x` closes the selected tab and the list stays open on the next row; a pinned tab is refused
    with the notice; closing a window's last tab asks.
  - Recently closed: close three tabs; `Tab` jumps to the section; `u` reopens the second in its
    workspace's container with its history (SessionStore state, `userContextId`) and the list
    stays; `Enter` on a closed row reopens and selects it; `x` forgets it (`getClosedTabCount`
    drops by one); `undoCloseById` is the reopen path.
  - A lazy tab (restored, never selected) is listed with title and URL and is still pending
    (`tab.hasAttribute("pending")`) after the picker opens and closes.
  - A tab playing audio shows `♪`; a muted tab shows `muted`.
  - The agent workspace with a tab: its row shows `◇ agent` and sorts last; `m` into the agent
    workspace asks the agent question; a closed agent tab reopens in the agent container.
  - `m` on another workspace's tab asks `moveTabQuestion`, and `y` moves it here.
- `browser_vimma_private_workspace.js`: a normal window's tab search lists no private tab, open or
  closed; the private window's lists only its own (both directions, decision 5).
- `browser_vimma_a11y.js`: option names include workspace, window or "recently closed"; heading
  rows are not options; the live region text after a query.
- `browser_vimma_focus_rings.js` and `browser_vimma_theme.js`: unchanged and green.
- `browser_vimma_help_overlay.js`: the `tab_search` row with `ctrl+b f f`.

### e2e (`tests/e2e/scenarios/`, Xvfb) and screenshots

- New scenario `tab-search.json`: two windows, three workspaces, one agent tab, two closed tabs
  and one audio tab (a `tools/e2e/pages.mjs` fixture with a silent looping `<audio>`); `ctrl+b f f`,
  type `doc`; screenshot `tab-search.png` as a new baseline, with the changelog line "a baseline
  for tab search". It is checked first with the real Omarchy theme
  (`vimma.theme.source=omarchy`) and recorded in Tokyo Night for the baseline.
- Bench: 300 tabs across 3 workspaces (plan §9's hidden-tab risk row says to measure with 200);
  open-to-render and per-key time logged; no tab gains a loaded browser.

## Docs and changelog

- **`docs/guide.md`**: the section "Goto picker and tab rename" becomes "Tab search and tab
  rename": what is listed, the sections, the keys (`x`, `u`, `m`, `Tab`), other windows,
  recently closed, and the private and agent rules. Also the keys-table row for `ctrl+b g`, `b`;
  "The command line" (`:tabsearch`, `:ts`); and the workspaces paragraph that says the goto
  picker "lists every workspace's tabs" gains "and other windows'".
- **README**: the feature list's picker line becomes "tab search: every tab of every workspace
  and window, and recently closed, fuzzy by title, URL or your rename".
- **`docs/bindings.md`, `bindings.json`, `defaults.toml`**: regenerated with `npm run gen-docs`
  (sub-PR 3).
- **`CHANGELOG.md` [Unreleased]**, added by the maintainer at merge. Suggested lines: "Tab search:
  the goto picker shows each tab's workspace, closes tabs with `x` and moves them with `m`"
  (sub-PR 1); "Tab search lists your other windows' tabs and reopens recently closed ones"
  (sub-PR 2); "`ctrl+b f f` and `:tabsearch` open tab search ready to type" (sub-PR 3); and the
  baseline line.

## Delivery

| #   | Title                                                                               | Scope                                                                                                                                                                                                                                                                                                                                | Size                      |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| 1   | `feat(picker): tab search lists the workspace, window and audio on each row`        | Core: agent id, current-workspace-first order, cached units and bench, URL highlights, section heading rows, `tab`/`shift+tab`, accessible names, live region; UI rows and headings; `x` close and `m` move-here; mochitests; guide "Goto picker" section rewritten as "Tab search". No new default key (picker-internal keys only). | M (~600 lines with tests) |
| 2   | `feat(picker): tab search finds tabs in your other windows and reopens closed ones` | `host/tab-search.mjs`: other windows, closed tabs and windows from SessionStore, `undoCloseById`, `undoClosedTabFromClosedWindow`, `forgetClosedTabById`, the private filter; `u`; `Enter` across windows; mochitests including private in both directions; e2e scenario and baseline.                                               | M (~700)                  |
| 3   | `feat(keys): ctrl+b f f opens tab search ready to type`                             | `tab_search` action, `prefix+f f`, `:tabsearch`/`:ts`, help row, gen-docs, snapshots, README feature line.                                                                                                                                                                                                                           | S (~250)                  |

Sub-PR 3 is the only one that adds a default key, so it is a keymap PR and lands after firefox-keys
sub-PR 2, one keymap PR at a time. Whichever of it and live-grep sub-PR 3 lands first adds the first
three-chord default binding and the keymap test for the `prefix+f` group. Sub-PRs 1 and 2 add
picker-internal keys only, which are not keymap bindings, so they do not wait for the keymap queue.
Each sub-PR is checked in e2e screenshots before review.

## Open questions

1. **Extend the goto picker or add a new picker?**
   - a. Extend `goto_picker` into tab search (decision 1). One list for finding any tab;
     `ctrl+b g`, `b` and `:ls` keep working and gain the new sections and keys. The goto picker's
     look and test baseline change.
   - b. A separate tab-search picker next to the goto picker. The goto picker stays exactly as it
     is, at the cost of two lists with overlapping jobs, duplicated keys, tests and docs.

   Recommendation: a, because Chromium and Brave have one list and two would split muscle memory.

2. **Include recently closed tabs and closed windows?**
   - a. Both, as a last section capped at 25 tabs and 5 windows (decision 3). `Enter` reopens and
     goes there, `u` reopens and stays, `x` forgets.
   - b. Closed tabs only. A smaller list, but a closed window then has no keyboard path besides
     `restore_window`, which reopens only the last one.
   - c. Neither; `ctrl+shift+t` stays the only way back. The simplest, and the mistakes case in
     behaviour 2 stays unsolved.

   Recommendation: a, because it matches Chromium's and Firefox View's "Recently closed" and uses
   SessionStore APIs Firefox View already relies on.

3. **List the agent workspace's tabs?**
   - a. Listed, marked `◇ agent`, after the user's workspaces (decision 6).
   - b. Hidden from tab search, reachable only through the workspace picker and `:mcp`. A shorter
     list, but the user cannot find or close an agent's tab from the one place that finds tabs.
   - c. Listed only while `[mcp]` is on.

   Recommendation: a, because seeing and closing what an agent opened is part of staying in
   control of it, and the marker and ordering keep the tabs apart.

4. **List other windows' tabs?**
   - a. Yes, after this window's, marked `w2`, `w3`; `Enter` brings that window forward
     (decisions 3 and 8).
   - b. This window only, as today. Simpler, but a tab in another window stays unfindable from
     the keyboard.
   - c. Every window by default, with a config switch to limit to this window.

   Recommendation: a, as Chromium lists every window; a switch (c) can follow if anyone needs it.
