# Spec: bookmarks-toolbar-hidden

Status: proposed (research done, design chosen; not implemented) · Milestone: after M5 (builds on
[bookmarks](bookmarks.md), [m5-config-load](m5-config-load.md), [start-page](start-page.md);
coordinates with [toolbar-toggle](toolbar-toggle.md) and [firefox-keys](firefox-keys.md)) ·
Area: `branding/vimma/pref/firefox-branding.js`, `packages/vimma-core/src/config.mjs`,
`actions.mjs`, `cmdline.mjs`, `defaults.mjs`; `ui/bookmarks-toolbar.mjs` (new),
`config/ConfigHost.sys.mjs`, `host/VimmaHost.sys.mjs`, `start/start.html`. One upstream patch
(`PlacesUIUtils-sys-mjs.patch`, decision 6), with its ADR-003 line.

Checked against main on 2026-10-13 (8911be3). File:line references to `engine/` are Firefox 157
as imported there.

## The user's words

"write also spec for always hiding firefox bookmarks by default, user can enable toolbar if they
want, but default would be Vimma bookmarks pane"

## User stories

- As a new Vimma user, I never see Firefox's Bookmarks Toolbar: not on the start page, not on a
  new tab, not after I import bookmarks from another browser. My bookmarks are one key away in
  Vimma's bookmarks panel (`ctrl+b shift+b`), and the start page tells me that key.
- As a user who had Vimma before this change and saw the toolbar on the start page, it is gone
  after the update, and a one-time notice says how to open bookmarks and how to bring the toolbar
  back.
- As a user who likes the toolbar, `:bookmarkstoolbar show` (or Firefox's own View → Toolbars →
  Bookmarks Toolbar, or the toolbar's context menu) shows it, and it stays shown across restarts.
- As a user who keeps settings in a file, `[ui] bookmarks_toolbar = "shown"` in `config.toml`
  shows it in every window from the next start (or the next poll), whatever was toggled before.
- As a user, the bookmarks I keep in Vimma's per-workspace folders are the same whether the
  toolbar is shown or hidden: hiding it hides a view, never the data.

## Research

### Firefox (engine/)

- **The toolbar** is `<toolbar id="PersonalToolbar">` in `#navigator-toolbox`
  (`browser/base/content/navigator-toolbox.inc.xhtml:544–550`, `customizable="true"`,
  `toolbarname` from `bookmarks-toolbar`). Its empty state is `#personal-toolbar-empty`
  (`navigator-toolbox.inc.xhtml:553–558`), the text "For quick access, place your bookmarks here
  on the bookmarks toolbar. Manage bookmarks…" (`browser/locales/en-US/browser/browser.ftl:525`),
  managed by `BookmarkingUI.updateEmptyToolbarMessage()` (`browser-places.js:1649–1700`). On a
  first-run profile with fewer than 3 toolbar items Firefox also adds an "Import bookmarks…"
  button to it (`PlacesBrowserStartup.sys.mjs:330–356` → `PlacesUIUtils.maybeAddImportButton`,
  `PlacesUIUtils.sys.mjs:1615–1643`; skipped under `Cu.isInAutomation`).
- **Visibility is one pref**, `browser.toolbars.bookmarks.visibility`, default `"newtab"`
  (`browser/app/profile/firefox.js:3072–3077`: `"newtab"` shows it on the New Tab page,
  `"always"`, `"never"`). Every window reads it through the lazy getter
  `gBookmarksToolbarVisibility` (`browser.js:573–578`), which has **no change callback**: setting
  the pref alone does not update open windows.
- **Applying it:** `updateBookmarkToolbarVisibility()` (`browser.js:787–795`) runs at
  `onBeforeInitialXULLayout` (`browser-init.js:119`) and on every non-same-document location
  change (`browser.js:2313–2316`). It calls `window.setToolbarVisibility(toolbar, value, false)`
  (`browser.js:3022–3116`): for the bookmarks toolbar a string value persists to the pref when
  `persist` is true (lines 3042–3057), and `"newtab"` resolves per window to
  `BookmarkingUI.isOnNewTabPage(currentURI)` (lines 3070–3088).
  `CustomizableUI.setToolbarVisibility(id, value)` (`CustomizableUI.sys.mjs:5127–5137`) calls it
  in every window, persisting once.
  That is the call that updates open windows.
- **"New tab page" includes Vimma's start page today.** `isOnNewTabPage`
  (`browser-places.js:1531–1564`) matches `AboutNewTab.newTabURL`, `about:home`, `blanktab.html`,
  and `about:privatebrowsing` in a private window. Vimma's `StartPage.sys.mjs:26–30` sets
  `AboutNewTab.newTabURL` to the start page while `vimma.startpage.newtab` is on, so **with
  Firefox's default every Vimma user sees the Bookmarks Toolbar on the start page and on each new
  tab**, empty-state text and all.
- **Who changes it:**
  - The user: View → Toolbars → Bookmarks Toolbar and the toolbar context menu, a radio of
    always / only on new tab / never (`BookmarkingUI.buildBookmarksToolbarSubmenu`,
    `browser-places.js:1576–1645`, → `onViewToolbarCommand`, `browser.js:3009–3029`, which writes
    the pref); `ctrl+shift+b` (`viewBookmarksToolbarKb`, `browser-sets.inc.xhtml:294–296`, →
    `BookmarkingUI.toggleBookmarksToolbar("shortcut")`, `browser-sets.js:351–353`), and the same
    toggle in the bookmarks menu button (`BMB_viewBookmarksToolbar`) and the app menu's bookmarks
    view (`panelMenu_viewBookmarksToolbar`, `browser-places.js:2115–2116`). The toggle flips
    between `"always"` and `"never"` only (`browser-places.js:1515–1529`).
  - **Import:** `MigrationUtils` inserting bookmarks into the toolbar folder calls
    `PlacesUIUtils.maybeToggleBookmarkToolbarVisibility(true /* aForceVisible */)`
    (`MigrationUtils.sys.mjs:829–833`), which notifies `browser-set-toolbar-visibility`
    (`PlacesUIUtils.sys.mjs:1293–1328`), handled by `CustomizableUI.setToolbarVisibility(…, true)`
    (`CustomizableUI.sys.mjs:5181–5184`): the pref becomes `"always"`, even over the user's
    `"never"`. It is the only caller (grep of `browser/` and `toolkit/`, tests excluded).
  - **Adding a bookmark** in the star panel to a toolbar folder shows the toolbar for the moment,
    unless the pref is `"never"` (`editBookmark.js:994–1013`, `_autoshowBookmarksToolbar`).
    The star's default folder is the toolbar (`browser.bookmarks.defaultLocation`,
    `firefox.js:1295`).
  - **Customize → Restore Defaults** sets the area's hard-coded `defaultCollapsed: "newtab"`
    (`CustomizableUI.sys.mjs:436–443`, applied in `_rebuildRegisteredAreas`, 4670–4692, with
    persist), so it writes `"newtab"` as a user value. The "is default" check compares the pref
    to that same `"newtab"` (5004–5023), so with any other value Restore Defaults is enabled.
  - **Profile upgrade:** `ProfileDataUpgrader` (data version < 103,
    `ProfileDataUpgrader.sys.mjs:270–295`) moved an old xulstore `collapsed=false` to
    `"always"`. Long past; a profile carried over from Firefox may hold `"always"` from it.
  - **Sync** does not carry it: there is no `services.sync.prefs.sync.browser.toolbars.bookmarks.*`
    in `firefox.js` (grep), so only a user who adds that pref syncs it.
- **Related, unchanged by this spec:** `browser.toolbars.bookmarks.showOtherBookmarks`
  (`firefox.js:3081`) only decides whether "Other Bookmarks" sits at the toolbar's end. Firefox's
  `ctrl+b` is the bookmarks sidebar (`viewBookmarksSidebarKb`, `browser-sets.inc.xhtml:291–293`,
  `browser-sets.js:345–347`); in Vimma it is the prefix (firefox-keys inventory, fate a, "the
  prefix"), and the sidebar stays reachable from Firefox's own sidebar launcher and menus.

### Vimma today

- **Bookmarks panel** (`ui/bookmarks-panel.mjs`, spec [bookmarks](bookmarks.md)): `ctrl+b shift+b`
  (`toggle_bookmarks`, `:bookmarks`), quick add `ctrl+b a`. Its default root is `"workspace"`
  (bookmarks decision 11): a folder per workspace **at the top of the Bookmarks Toolbar folder**
  (`toolbar_____`). The toolbar folder is the store; the toolbar widget is only one view of it.
  Hiding the widget changes no Places data, and the panel, quick add, import, export, the Library
  and Sync keep working. Bookmarks spec "Out of scope" lists "the bookmarks toolbar's
  visibility": this spec is that item.
- **Firefox's `ctrl+shift+b`** is "unbound" in Vimma (`docs/bindings.md:352`; firefox-keys
  inventory, fate c, "— (`ctrl+b u` hides the whole toolbar)"). After firefox-keys sub-PR 2 a
  fate-c key is off by default and reachable by `:firefox` or `[firefox] enable`.
- **Defaults** are Firefox prefs in `src/browser/branding/vimma/pref/firefox-branding.js` (the
  start page, Mozilla services), checked by `tools/branding/test/branding-prefs.test.mjs` (Vitest).
  Defaults only, never locked, so the user's own value wins.
- **Settings in config.toml:** no `[ui]` table on main yet (`config.mjs:153–167` `TOP_KEYS`).
  [toolbar-toggle](toolbar-toggle.md) (spec merged, not built) introduces
  `[ui] toolbar = "shown" | "hidden"` (schema 2), held in `vimma.ui.toolbar.hidden`,
  written by `ConfigHost` at startup and on a reload only when that line changed; a toggle lasts
  until the next restart or edit
  (toolbar-toggle decision 4). Its decision 5 already hides `#PersonalToolbar` with `#nav-bar`,
  its minimal bar never shows it (7a), and its full reveal shows it "as when shown".
  [theme-appearance](theme-appearance.md) decision 4 is the other precedent: without the config
  key a pref stores the runtime choice; with it, config wins.
- **Precedent:** [m0-tabstrip-hidden](m0-tabstrip-hidden.md) hid Firefox's tab strip by default with
  a default pref (`vimma.ui.tabstrip.hidden`, `true`), CSS `visibility: collapse` and one patch.
  For the bookmarks toolbar Firefox already has the switch and the "never" state, so no CSS of
  ours is needed.
- **e2e** already runs with `browser.toolbars.bookmarks.visibility = "never"`
  (`tools/e2e/launcher.mjs:107`), as Mozilla's own web-platform profile does
  (`engine/testing/profiles/web-platform/user.js:16`). No baseline shows the toolbar.
- **Theme:** Vimma themes its own UI, Firefox's sidebar and focus colour
  (`ui/theme-host.mjs:26–31`);
  the nav bar and the bookmarks toolbar follow Firefox's own theme (`browser.theme.toolbar-theme`,
  theme-host line 13), so a shown bookmarks toolbar looks like the nav bar above it.

## Decisions

1. **Hidden by default: `"never"`.** `firefox-branding.js` gains
   `pref("browser.toolbars.bookmarks.visibility", "never");`, a default, not locked. A fresh
   profile never shows the toolbar, on the start page included. Firefox's own menus, the
   context menu and the toggle keep working and still write the pref, so the user's choice
   persists across restarts as in Firefox. No CSS, no DOM change: `"never"` is a state Firefox
   ships and tests. It also turns off the star panel's momentary autoshow (`editBookmark.js:994`).
2. **The Vimma bookmarks panel is the default way in.** The start page's hint line, the place the
   toolbar showed with Firefox's default, gains `<kbd>ctrl+b shift+b</kbd> bookmarks` (rendered from
   the bound key, so a rebinding shows the user's key; hidden when `toggle_bookmarks` is
   unbound). No first-run notice for a fresh profile: it has never seen the toolbar. Firefox's
   empty-state text and "Import bookmarks…" button are left as they are: they live inside the
   hidden toolbar and show only to a user who turns it on.
3. **Config: `[ui] bookmarks_toolbar = "hidden" | "shown" | "newtab"`.** In the `[ui]` table of
   toolbar-toggle (schema 2), with its words: `"hidden"` is `"never"`, `"shown"` is `"always"`,
   `"newtab"` is Firefox's "only on new tab" (Vimma's start page, a new tab, a private window's
   `about:privatebrowsing`). Anything else is an error with the closest value, and the last good
   config stays. **Not written in `defaults.toml`** (a comment only), as `[theme] appearance`:
   left out, the setting is the Firefox pref of decision 1. Whichever of this and toolbar-toggle
   lands first adds `[ui]` to `TOP_KEYS`; the second adds its key.
4. **What wins (config always wins, at the moments config applies).**
   - Without the key: the pref is the setting. Firefox's menus, `:bookmarkstoolbar` and the key
     change it for good.
   - With the key: at every start, and on a reload where that line changed from the last good
     config, `ConfigHost` applies it. A runtime change (Firefox's menu, `:bookmarkstoolbar`, the
     key) works and lasts until the next start or edit of that line, as toolbar-toggle's `ctrl+b u`
     does; the notice adds `(config.toml sets "hidden"; until restart)`.
   - Applying always goes through `CustomizableUI.setToolbarVisibility("PersonalToolbar", value)`,
     never the pref alone: the pref has no change callback in open windows (Research).
5. **An action and a command, no default key in sub-PR 1.** `toggle_bookmarks_toolbar`
   (`bookmarks.toolbar_toggle`, "Show / hide Firefox's Bookmarks Toolbar"), group "Bookmarks",
   unbound. It runs exactly Firefox's `BookmarkingUI.toggleBookmarksToolbar("shortcut")`
   (firefox-keys decision 4: each action runs what Firefox's key ran), so it flips between
   `"always"` and `"never"`. `:bookmarkstoolbar` toggles; `:bookmarkstoolbar show|hide|newtab`
   sets (Tab completes the three words, an unknown word is refused with the closest), so
   `vimma-ctl` can set a known state. Notices: `bookmarks toolbar shown` / `hidden` /
   `shown on new tabs`, through the polite live region. Binding `ctrl+shift+b` is Q1 and, if
   yes, sub-PR 2 (a keymap PR).
6. **Import does not show it while it is `"never"`.** A one-hunk patch to
   `PlacesUIUtils.maybeToggleBookmarkToolbarVisibility` (`PlacesUIUtils.sys.mjs:1293`): return
   early when `browser.toolbars.bookmarks.visibility` is `"never"`, the rule `editBookmark.js`
   already applies to its own autoshow. Imported bookmarks still land in the toolbar folder;
   only the forced reveal (and its write of `"always"`) is skipped. With `"newtab"` or `"always"`
   the import behaves as in Firefox. A patch, not a runtime wrap of the method or an observer of
   `browser-set-toolbar-visibility`: a wrap breaks silently on a rebase and the order of observers
   of one topic is not a contract (m0-tabstrip-hidden, review round 1). ADR-003 gains its line
   (budget 1 hunk, 4 lines).
7. **Existing profiles: hidden once on upgrade** (Q2). At the first start with this change, when
   `[ui] bookmarks_toolbar` is not set and the pref has a user value other than `"never"`
   (`"always"` from an import or a Firefox profile, or `"newtab"` from Restore Defaults), Vimma
   sets `"never"` once and says, in the polite region, "bookmarks toolbar hidden: ctrl+b shift+b
   opens your bookmarks; :bookmarkstoolbar show brings it back". The pref
   `vimma.ui.bookmarksToolbar.migrated` (bool) records it, so it never runs again and a later
   choice stands. Profiles with no user value (most Vimma profiles: Firefox's `"newtab"` default)
   need nothing: decision 1's new default hides it with no notice beyond the start page's hint.
   With the config key set, the key decides and the migration only records itself.
8. **With toolbar-toggle.** When the nav bar is hidden (`ctrl+b u`, `[ui] toolbar = "hidden"`), the
   bookmarks toolbar is hidden with it (toolbar-toggle decision 5), whatever this setting says;
   the minimal URL bar never shows it (7a); the full reveal on hover or for an add-on popup shows
   it only when this setting would (shown, or newtab on a new tab). The two settings stay
   independent: neither writes the other's pref. Whichever spec is built second runs the other's
   mochitest.
9. **Private workspace.** The pref is per profile, so private windows follow it. With `"newtab"`
   a private window's `about:privatebrowsing` counts as a new tab (Firefox's rule). A private
   window's bookmarks panel shows the toolbar folder (bookmarks decision 11); nothing else
   changes.
10. **Theme and keyboard when shown.** Unchanged from Firefox: the toolbar takes the nav bar's
    look (Research → Theme); keyboard reach is Firefox's toolbar navigation (its `toolbartabstop`,
    `navigator-toolbox.inc.xhtml:551`, and arrow keys within,
    `browser.toolbars.keyboard_navigation`).
    Vimma's panel stays the keyboard way to bookmarks. Theming it with Vimma's tokens is out of
    scope (it goes with the nav bar, if ever).
11. **Customize → Restore Defaults** writes Firefox's `"newtab"` (Research). Accepted, not patched:
    it is an explicit "Firefox's defaults" action, rare, and the next start's config (when set)
    corrects it. The guide says so. Its button is enabled even in a fresh profile, since the
    area's default stays `"newtab"`; a one-line patch of `defaultCollapsed` would fix that and is
    not worth a second patch.

## Tests (written first)

Paste red, then green (CLAUDE.md).

- **Vitest**
  - `tools/branding/test/branding-prefs.test.mjs`: Given the branding pref file, then
    `browser.toolbars.bookmarks.visibility` is `"never"` and not locked.
  - `config.test.mjs` / `config-v2.test.mjs`: Given `schema = 2` and
    `[ui] bookmarks_toolbar = "shown"`, then it parses to `"always"`; `"hidden"` → `"never"`,
    `"newtab"` → `"newtab"`;
    Given `"always"` (Firefox's word), then an error suggesting `"shown"`; Given `[ui]` in a
    schema-1 file, then the "new in schema 2" error; Given no key, then the parsed config has none
    (the pref decides); Given an unknown `[ui]` key, then an error with the closest name.
  - `cmdline.test.mjs`: `:bookmarkstoolbar` → `bookmarks.toolbar_toggle`; `show`, `hide`,
    `newtab` → the set action with that value; Tab completes the three; Tab after
    `:bookmarkstoolbar sho` gives `show`; `:bookmarkstoolbar blue` refused with the closest.
  - `actions.test.mjs` / `defaults.test.mjs`: `toggle_bookmarks_toolbar` exists, group
    "Bookmarks", unbound; no default key collides. Snapshots: `help.test.mjs.snap` gains one row,
    `defaults.toml` gains the commented `[ui] bookmarks_toolbar` line (regenerated, not
    hand-edited).
- **Mochitest `tests/browser/browser_vimma_bookmarks_toolbar.js`**
  1. Fresh profile: Given default prefs and no user value, when a window opens on the start page,
     then `#PersonalToolbar` is collapsed; when a new tab opens, then still collapsed; and in a
     private window on `about:privatebrowsing`, collapsed.
  2. Start page hint: Given the start page, then its hint line has `ctrl+b shift+b` and
     "bookmarks"; Given `toggle_bookmarks` unbound in config, then the hint has no bookmarks item.
  3. Existing profile, shown: Given the user value `"always"` and
     `vimma.ui.bookmarksToolbar.migrated` unset, when the host starts, then the pref is `"never"`,
     every window's toolbar is collapsed, the notice says `bookmarks toolbar hidden: …`, and the
     migrated pref is `true`; when the user then sets `"always"` and the host runs its startup
     path again, then it stays `"always"` and no notice. Same for a user value `"newtab"`.
  4. Existing profile with config: Given `"always"` and `[ui] bookmarks_toolbar = "shown"`, then no
     migration notice and the toolbar shows.
  5. Import: Given `"never"`, when `MigrationUtils.insertManyBookmarksWrapper` inserts 5 bookmarks
     into the toolbar folder, then they are in Places, the pref is still `"never"` and the toolbar
     is
     collapsed; Given `"newtab"`, then the import shows the toolbar as in Firefox (`"always"`).
  6. Star panel: Given `"never"`, when a page is bookmarked into the toolbar folder through the
     star panel, then the toolbar does not show.
  7. Action and command: `:bookmarkstoolbar` shows it in two windows at once and the pref is
     `"always"`; again hides it; `:bookmarkstoolbar newtab` shows it on a new tab and not on a
     loaded page; each notice reaches the polite region.
  8. Config wins: Given `[ui] bookmarks_toolbar = "shown"` written after start, when the poll reads
     it, then shown in every open window (not only after a location change); when
     `:bookmarkstoolbar hide`, then hidden and the notice says "until restart"; when the config is
     reloaded unchanged, then still hidden; when the line changes to `"hidden"` and back to
     `"shown"`, then shown.
  9. Firefox's own controls: View → Toolbars' "Always show" radio item (`onViewToolbarCommand`)
     shows it and writes `"always"`, with no Vimma interference.
  10. With toolbar-toggle (in whichever lands second): Given `"shown"` and the nav bar hidden,
      then `#PersonalToolbar` is collapsed and the minimal URL bar does not show it; on the full
      hover reveal it shows.
  11. Workspace folders: Given `root = "workspace"` and a bookmark in the workspace's folder, when
      the toolbar is hidden, then `ctrl+b shift+b` lists it and `ctrl+b a` files into it, unchanged.
- **e2e:** no existing baseline changes from the hidden toolbar: the e2e profile already sets
  `"never"` (`tools/e2e/launcher.mjs:107`). Keep that line, so the e2e profile does not depend on
  the branding default. A baseline that shows the start page's hint line changes with decision 2
  and gets its changelog line. Screenshot-verify the start page and the shown toolbar by hand
  under the built-in and an Omarchy theme before merge.
- **Mutation check:** without the patch's early return, test 5 fails (`"always"`); without the
  migrated pref, test 3's second start hides the toolbar again.

## Sub-PRs

1. **`feat(bookmarks): firefox's bookmarks toolbar hidden by default`** (M, ~300 lines with
   tests, no keymap change): decisions 1–7 and 9–11: the branding default,
   `[ui] bookmarks_toolbar`, `toggle_bookmarks_toolbar` unbound, `:bookmarkstoolbar`,
   `ui/bookmarks-toolbar.mjs` (apply, migrate once, notices), the `PlacesUIUtils` patch and its
   ADR-003 line, the start page's hint, gen-docs, guide. Not a keymap PR (no default binding), so
   it can land while a keymap PR is open; it adds one `actions.mjs` row and merges `origin/main`
   and regenerates `docs/bindings.md` and the snapshots before merging, as theme-appearance did.
2. **`feat(keys): ctrl+shift+b shows or hides the bookmarks toolbar`** (S, only if Q1 is yes; a
   keymap PR, in the keymap queue after firefox-keys sub-PR 2 and Vimma MCP's key): bind
   `ctrl+shift+b` to `toggle_bookmarks_toolbar`, page first as in Firefox; the firefox-keys
   inventory row moves from fate c to fate a; `docs/bindings.md` "Firefox's shortcuts" says
   `toggle_bookmarks_toolbar`, page first.

Decision 8 adds no code here; it is a test in whichever of this and toolbar-toggle is built second.

## Docs and changelog the implementation must update

- **`docs/guide.md`:** the Bookmarks section gains "Firefox's Bookmarks Toolbar": hidden by
  default, your bookmarks are in the panel (`ctrl+b shift+b`) and in the toolbar folder either
  way; `:bookmarkstoolbar [show|hide|newtab]`; `[ui] bookmarks_toolbar`; View → Toolbars still
  works; config wins at start; Restore Defaults brings back Firefox's "newtab". The start page
  section mentions the new hint; the config.toml reference gains the key.
- **`docs/bindings.md`**, `defaults.toml`: `npm run gen-docs`.
- **README:** no feature-list change (it lists what Vimma adds; the bookmarks panel is there).
- **CHANGELOG `[Unreleased]`** (the maintainer adds it at merge time). Suggested:
  - "Changed: Firefox's Bookmarks Toolbar is hidden by default, also on the start page and after
    an import; `ctrl+b shift+b` opens your bookmarks, and `:bookmarkstoolbar show` or
    `[ui] bookmarks_toolbar` brings the toolbar back."
  - Sub-PR 2: "Added: `ctrl+shift+b` shows or hides the bookmarks toolbar, as in Firefox."

## Out of scope

- Theming the bookmarks toolbar (or the nav bar) with Vimma's tokens.
- Changing where Firefox's star files bookmarks (the toolbar root, outside the workspace folders);
  Vimma's `ctrl+b a` files into the workspace's folder.
- Firefox's bookmarks sidebar and the Library.
- `browser.toolbars.bookmarks.showOtherBookmarks`.
- A per-window or per-workspace toolbar state.

## Open questions for the user

1. **Default key to toggle it: `ctrl+shift+b`, as in Firefox?** Recommended: yes, as sub-PR 2 in
   the keymap queue. It is Firefox's own key for this, Vimma binds nothing on it, and it runs
   exactly Firefox's toggle. Until then (and if no), `:bookmarkstoolbar` and Firefox's View menu
   do it.
2. **Hide it once for existing profiles that show it?** Recommended: yes (decision 7): "always
   hiding by default" applies to upgraded profiles too, the notice says how to bring it back, and
   it runs once, so a later choice stands. The alternative is to touch only profiles with no
   choice of their own.
3. **Offer `"newtab"`?** Recommended: yes: it is Firefox's own third state, already in its View
   menu, so `:bookmarkstoolbar` and `[ui]` would otherwise be unable to say what the menu can. It
   shows the toolbar on Vimma's start page, which is the one place a toolbar of shortcuts helps.
4. **Should importing bookmarks show it, as Firefox does?** Recommended: no while it is hidden
   (decision 6, one small patch); with "shown" or "newtab" the import behaves as in Firefox.
