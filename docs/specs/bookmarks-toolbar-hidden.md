# Spec: bookmarks-toolbar-hidden

Status: draft · Area: `src/browser/branding/vimma/pref/firefox-branding.js`,
`packages/vimma-core/src/config.mjs`, `actions.mjs`, `cmdline.mjs`, `defaults.mjs`;
`src/browser/base/content/vimma/ui/bookmarks-toolbar.mjs` (new), `config/ConfigHost.sys.mjs`,
`host/VimmaHost.sys.mjs`, `start/start.html` · Upstream patches:
`src/browser/components/places/PlacesUIUtils-sys-mjs.patch` (new, decision 6), with its ADR-003
register line: budget 1 hunk, 4 lines, "`maybeToggleBookmarkToolbarVisibility` returns early while
`browser.toolbars.bookmarks.visibility` is `"never"`, so importing bookmarks into the toolbar
folder does not show the toolbar Vimma hides by default (bookmarks-toolbar-hidden)" · ADR:
[ADR-003](../adr/003-own-files-minimal-patches.md) (register line only)

Builds on [bookmarks](bookmarks.md), [m5-config-load](m5-config-load.md) and
[start-page](start-page.md); coordinates with [toolbar-toggle](toolbar-toggle.md) and
[firefox-keys](firefox-keys.md). Engine references (`engine/…:line`) are Firefox 158.0 as
imported by `npm run import`; Vimma file references are to `main`.

## Summary

Firefox's Bookmarks Toolbar is hidden by default in Vimma, on the start page and new tabs
included, and stays hidden after a bookmarks import. Vimma's bookmarks panel (`ctrl+b shift+b`)
is the default way to bookmarks. A Vimma user who wants the toolbar turns it on with
`:bookmarkstoolbar show`, Firefox's own View → Toolbars menu, or `[ui] bookmarks_toolbar` in
`config.toml`, and that choice persists. Hiding the toolbar hides a view only; no bookmark data
changes.

## Problem

- With Firefox's default (`"newtab"`), the Bookmarks Toolbar shows on every new tab. Vimma's start
  page is the new-tab page, so a fresh Vimma profile shows the toolbar, with Firefox's empty-state
  text ("For quick access, place your bookmarks here…") and, on a first-run profile, an "Import
  bookmarks…" button, above Vimma's own start page.
- It disappears as soon as a page loads, so the window's layout jumps between the start page and
  every other page.
- Importing bookmarks from another browser forces the toolbar to `"always"`, even over a user's
  explicit "never".
- Vimma already has a keyboard-first bookmarks panel; the toolbar duplicates it with a
  mouse-first view.

## Behaviour

1. **Fresh profile.** As a new Vimma user, I never see Firefox's Bookmarks Toolbar: not on the
   start page, not on a new tab, not in a private window, not after I import bookmarks. The start
   page's key hint names `ctrl+b shift+b` for bookmarks.
2. **Existing profile.** As a Vimma user whose profile showed the toolbar before this change, it is
   hidden after the update, once, and a notice says how to open bookmarks and how to bring the
   toolbar back. (Subject to open question 2.)
3. **Turning it on.** As a Vimma user who likes the toolbar, `:bookmarkstoolbar show`, Firefox's
   View → Toolbars → Bookmarks Toolbar, or the toolbar context menu shows it, and it stays shown
   across restarts. `:bookmarkstoolbar newtab` shows it on new tabs only; `:bookmarkstoolbar hide`
   hides it; bare `:bookmarkstoolbar` toggles between shown and hidden.
4. **Config.** As a Vimma user who keeps settings in a file, `[ui] bookmarks_toolbar = "shown"`
   in `config.toml` shows it in every window from the next start, or from the next reload where
   that line changed, whatever was toggled before.
5. **Data unchanged.** As a Vimma user, the bookmarks in Vimma's per-workspace folders are the same
   whether the toolbar is shown or hidden: the panel, quick add (`ctrl+b a`), import, export, the
   Library and Sync keep working.
6. **Notices.** Each change made through Vimma says `bookmarks toolbar shown`,
   `bookmarks toolbar hidden` or `bookmarks toolbar shown on new tabs` in the polite live region;
   while `config.toml` sets the key, it adds `(config.toml sets "<value>"; until restart)`.

## Research

### Firefox 158.0 (`engine/`)

- **The toolbar** is `<toolbar id="PersonalToolbar">` in `#navigator-toolbox`
  (`browser/base/content/navigator-toolbox.inc.xhtml:546–552`, `customizable="true"`,
  `toolbarname` from `bookmarks-toolbar`). Its empty state is `#personal-toolbar-empty`
  (`navigator-toolbox.inc.xhtml:555–560`), the string `bookmarks-toolbar-empty-message`
  (`browser/locales/en-US/browser/browser.ftl:525`), managed by
  `BookmarkingUI.updateEmptyToolbarMessage()` (`browser/base/content/browser-places.js:1649–1700`).
  On a first-run profile with fewer than 3 bookmarks in the toolbar folder Firefox adds an "Import
  bookmarks…" button to it (`browser/components/places/PlacesBrowserStartup.sys.mjs:330–356` →
  `PlacesUIUtils.maybeAddImportButton`, `PlacesUIUtils.sys.mjs:1613–1644`; skipped under
  `Cu.isInAutomation`).
- **Visibility is one pref**, `browser.toolbars.bookmarks.visibility`, default `"newtab"`
  (`browser/app/profile/firefox.js:3097–3100`: `"newtab"` shows it on the New Tab page,
  `"always"`, `"never"`). Every window reads it through the lazy getter
  `gBookmarksToolbarVisibility` (`browser/base/content/browser.js:572–577`), which has no change
  callback: setting the pref alone does not update open windows.
- **Applying it.** `updateBookmarkToolbarVisibility()` (`browser.js:810–818`) runs at
  `onBeforeInitialXULLayout` (`browser/base/content/browser-init.js:119`) and on every
  non-same-document location change (`browser.js:2341–2344`). It calls
  `window.setToolbarVisibility(toolbar, value, false)` (`browser.js:3054–3144`): for the bookmarks
  toolbar, a string value is written to the pref when `persist` is true (lines 3075–3086), and
  `"newtab"` resolves per window to `BookmarkingUI.isOnNewTabPage(currentURI)` (lines 3097–3117).
  `CustomizableUI.setToolbarVisibility(id, value)`
  (`browser/components/customizableui/CustomizableUI.sys.mjs:5243–5253`) calls it in every
  window, persisting once. That is the call that updates open windows.
- **"New tab page" includes Vimma's start page.** `isOnNewTabPage` (`browser-places.js:1531–1564`)
  matches `AboutNewTab.newTabURL`, `about:home`, `chrome://browser/content/blanktab.html`,
  `about:privatebrowsing` in a private window, and a Smart Window's new tab
  (`AIWindow.isAIWindowNewTabPage`). Vimma's `start/StartPage.sys.mjs:25–34` sets
  `AboutNewTab.newTabURL` to the start page while `vimma.startpage.newtab` is on, so with
  Firefox's default every Vimma user sees the toolbar on the start page and on each new tab.
- **What changes the pref:**
  - **Firefox's menus.** View → Toolbars → Bookmarks Toolbar and the toolbar context menu offer
    always / only on new tab / never (`BookmarkingUI.buildBookmarksToolbarSubmenu`,
    `browser-places.js:1576–1641`) and run `onViewToolbarCommand` (`browser.js:3032–3052`), which
    writes the pref and calls `CustomizableUI.setToolbarVisibility`.
  - **The toggle.** `ctrl+shift+b` (`viewBookmarksToolbarKb`,
    `browser/base/content/browser-sets.inc.xhtml:294–296`, →
    `BookmarkingUI.toggleBookmarksToolbar("shortcut")`, `browser-sets.js:351–353`), the bookmarks
    menu button's item (`BMB_viewBookmarksToolbar`, `navigator-toolbox.js:94–96`) and the app
    menu's bookmarks view (`panelMenu_viewBookmarksToolbar`, `browser-places.js:2115`). The toggle
    (`browser-places.js:1515–1529`) flips between `"always"` and `"never"` only, writes the pref,
    then calls `CustomizableUI.setToolbarVisibility(id, newState, false)`.
  - **Import.** `MigrationUtils.insertManyBookmarksWrapper` inserting into the toolbar folder
    calls `PlacesUIUtils.maybeToggleBookmarkToolbarVisibility(true /* aForceVisible */)`
    (`browser/components/migration/MigrationUtils.sys.mjs:829–833`), which notifies
    `browser-set-toolbar-visibility` (`PlacesUIUtils.sys.mjs:1293–1328`). `CustomizableUI`'s
    observer handles it with `CustomizableUI.setToolbarVisibility(…, true)`
    (`CustomizableUI.sys.mjs:5297–5300`), so the pref becomes `"always"`, even over `"never"`.
    It is the only caller outside tests (grep of `browser/` and `toolkit/`).
  - **The star panel.** Bookmarking a page into a toolbar folder shows the toolbar for the moment,
    without persisting, unless the pref is `"never"`
    (`browser/components/places/content/editBookmark.js:994–1013`,
    `_autoshowBookmarksToolbar`). The star's default folder is the toolbar
    (`browser.bookmarks.defaultLocation`, `firefox.js:1306`).
  - **Customize → Restore Defaults.** `reset()` (`CustomizableUI.sys.mjs:4671–4681`) rebuilds the
    areas with the toolbar area's hard-coded `defaultCollapsed: "newtab"` (lines 436–443, applied
    by `_rebuildRegisteredAreas`, 4786–4810, with persist), so it writes `"newtab"` as a user
    value. The "is in default state" check for this area is `prefHasUserValue` on the pref (lines
    5120–5131), so the Restore Defaults button stays disabled while the pref has no user value,
    whatever the default is.
  - **Profile upgrade.** `ProfileDataUpgrader` (data version < 103,
    `browser/components/ProfileDataUpgrader.sys.mjs:272–296`) moved an old xulstore
    `collapsed=false` to `"always"`. A profile carried over from an old Firefox may hold
    `"always"` from it.
  - **Sync** does not carry it: `firefox.js` has no `services.sync.prefs.sync.browser.toolbars.*`
    line (grep), so only a user who adds that pref syncs it.
- **Related, unchanged here.** `browser.toolbars.bookmarks.showOtherBookmarks` (`firefox.js:3104`)
  only decides whether "Other Bookmarks" sits at the toolbar's end. Firefox's `ctrl+b` is the
  bookmarks sidebar (`viewBookmarksSidebarKb`, `browser-sets.inc.xhtml:291–293`,
  `browser-sets.js:345–347`); in Vimma it is the prefix. Firefox's `ctrl+shift+o` (the Library) is
  already Vimma's `bookmarks_library` (`packages/vimma-core/src/defaults.mjs:129`).

### Vimma on main

- **Bookmarks panel** (`ui/bookmarks-panel.mjs`, spec [bookmarks](bookmarks.md)): `toggle_bookmarks`
  on `ctrl+b shift+b` (`defaults.mjs:147`), `:bookmarks`, quick add `ctrl+b a`. Its default root
  is `"workspace"` (bookmarks decision 11): a folder per workspace at the top of the Bookmarks
  Toolbar folder (`toolbar_____`). The toolbar folder is the store; the toolbar widget is one view
  of it. The bookmarks spec lists "the bookmarks toolbar's visibility" as out of scope
  (`bookmarks.md:149`); this spec is that item.
- **`ctrl+shift+b`.** The firefox-keys inventory gives `viewBookmarksToolbarKb` fate c (no Vimma
  binding, "`ctrl+b u` hides the whole toolbar"; `docs/specs/firefox-keys.md:225`,
  `packages/vimma-core/src/firefox-keys.mjs:309`), and `docs/bindings.md:352` lists it as
  unbound. Firefox-keys sub-PR 1 (#171) is built; the default `[firefox] disable` is still
  `OVERLAP_CHORDS` (`firefox-keys.mjs:21–32`), which does not list `ctrl+shift+b`, so on main the
  key is still Firefox's own toggle. Firefox-keys sub-PR 2 (default `disable = "all"`) turns every
  fate-c key off by default; `[firefox] enable = ["ctrl+shift+b"]` then gives it back.
- **Defaults** are Firefox prefs in `src/browser/branding/vimma/pref/firefox-branding.js`, checked
  by `tools/branding/test/branding-prefs.test.mjs` (Vitest). They are defaults, never locked, so
  the user's own value wins.
- **Config.** `config.toml` has no `[ui]` table on main (`TOP_KEYS`,
  `packages/vimma-core/src/config.mjs:155–169`). [toolbar-toggle](toolbar-toggle.md) (ready,
  not built) introduces `[ui] toolbar = "shown" | "hidden"` (decision 3, schema 2), held in
  `vimma.ui.toolbar.hidden`, written by `ConfigHost` at startup and on a reload only when that
  value changed; a toggle lasts until the next restart or edit of that line (decision 4). Its
  decision 5 hides `#PersonalToolbar` with `#nav-bar`; its minimal bar never shows the bookmarks
  toolbar (decision 7a), and its full reveal shows `#PersonalToolbar` "as when shown" (decision
  7). [theme-appearance](theme-appearance.md) B4 is the other precedent: without the config key a
  pref stores the runtime choice; with it, config wins.
- **Start page.** The key hint is static markup (`start/start.html:25–31`: `ctrl+b ?` keys, `:`
  commands, `f` hints, and the `:theme` tip that `start.mjs` shows or hides).
- **Precedent.** [m0-tabstrip-hidden](m0-tabstrip-hidden.md) hid Firefox's tab strip by default
  with a pref, CSS and one patch. For the bookmarks toolbar Firefox already has the switch and a
  `"never"` state, so no CSS is needed.
- **e2e** already runs with `browser.toolbars.bookmarks.visibility = "never"`
  (`tools/e2e/launcher.mjs:107`), as Mozilla's web-platform test profile does
  (`engine/testing/profiles/web-platform/user.js:21`). No baseline shows the toolbar.
- **Theme.** Vimma themes its own UI, Firefox's sidebar and the focus colour
  (`ui/theme-host.mjs:26–31`); the nav bar and the bookmarks toolbar follow Firefox's own theme
  (`browser.theme.toolbar-theme`, `theme-host.mjs:13`), so a shown bookmarks toolbar looks like the
  nav bar above it.
- **Control socket.** `vimma-ctl` has no command for prefs or ex commands (`CONTROL_COMMANDS`,
  `packages/vimma-core/src/control.mjs:24`); it reaches `:bookmarkstoolbar` only by `send-keys`,
  which the `agent` role of protocol 2 cannot use ([vimma-mcp](vimma-mcp.md)).

## Design

`ui/bookmarks-toolbar.mjs` owns the feature in the chrome: it applies a value to every window,
runs the one-time migration and posts the notices. Core adds the config key, the action and the
command. The branding file adds the default; one patch stops the import's forced reveal.

### Decisions

1. **Hidden by default: `"never"`.** `firefox-branding.js` gains
   `pref("browser.toolbars.bookmarks.visibility", "never");`, a default, not locked. A fresh
   profile never shows the toolbar, on the start page included. Firefox's menus, the context menu
   and the toggle keep working and still write the pref, so a choice persists across restarts as
   in Firefox. No CSS and no DOM change: `"never"` is a state Firefox ships and tests. It also
   turns off the star panel's momentary autoshow (`editBookmark.js:994–1003`). Rejected: CSS
   `visibility: collapse` as for the tab strip, because it would fight Firefox's own menus instead
   of using them.
2. **The bookmarks panel is the default way in.** The start page's hint line gains
   `<kbd>ctrl+b shift+b</kbd> bookmarks`, static like the other items in it. No first-run notice
   for a fresh profile: it has never seen the toolbar. Firefox's empty-state text and "Import
   bookmarks…" button are left as they are: they live inside the hidden toolbar and show only to a
   user who turns it on. Rejected: rendering the hint from the keymap for this one item, because
   the rest of the line is static and a keymap-driven hint is a change for the whole line.
3. **Config: `[ui] bookmarks_toolbar = "hidden" | "shown" | "newtab"`.** In the `[ui]` table of
   toolbar-toggle (schema 2), with its words: `"hidden"` is `"never"`, `"shown"` is `"always"`,
   `"newtab"` is Firefox's "only on new tab" (Vimma's start page, a new tab, a private window's
   `about:privatebrowsing`). Anything else is an error with the closest value, and the last good
   config stays. It is not written in `defaults.toml` (a comment only), as `[theme] appearance`:
   left out, the setting is the pref of decision 1. Whichever of this spec and toolbar-toggle is
   built first adds `[ui]` to `TOP_KEYS` and the schema-2 gate; the second adds its key.
   (`"newtab"` is subject to open question 3.)
4. **Config wins, at the moments config applies.**
   - Without the key, the pref is the setting. Firefox's menus, `:bookmarkstoolbar` and the toggle
     change it for good.
   - With the key, `ConfigHost` applies it at every start and on a reload where that line changed
     from the last good config. A runtime change works and lasts until the next start or edit of
     that line, as toolbar-toggle's `ctrl+b u` does; the notice says so (Behaviour 6).
   - Applying always goes through `CustomizableUI.setToolbarVisibility("PersonalToolbar", value)`,
     never the pref alone, because the pref has no change callback in open windows (Research).
5. **An action and a command, no default key here.** `toggle_bookmarks_toolbar` (id
   `bookmarks.toolbar_toggle`, "Show / hide Firefox's Bookmarks Toolbar"), group "Bookmarks",
   unbound. It runs exactly `BookmarkingUI.toggleBookmarksToolbar("shortcut")`, as firefox-keys
   decision 4 has every Firefox-derived action run what Firefox's key ran, so it flips between
   `"always"` and `"never"`. `:bookmarkstoolbar` toggles; `:bookmarkstoolbar show|hide|newtab`
   sets a known state (Tab completes the three words; an unknown word is refused with the
   closest). A default key is open question 1.
6. **Import does not show it while it is `"never"`.** A one-hunk patch to
   `PlacesUIUtils.maybeToggleBookmarkToolbarVisibility` (`PlacesUIUtils.sys.mjs:1293`) returns
   early when `browser.toolbars.bookmarks.visibility` is `"never"`, the rule `editBookmark.js`
   already applies to its own autoshow. Imported bookmarks still land in the toolbar folder; only
   the forced reveal and its write of `"always"` are skipped. With `"newtab"` or `"always"` the
   import behaves as in Firefox. A patch, not a runtime wrap of the method or a second observer of
   `browser-set-toolbar-visibility`: a one-hunk patch fails loudly when `npm run import` applies it
   on a rebase (and in the Beta canary's patch dry-run, [upstream-beta-canary](upstream-beta-canary.md)
   B4), a wrap of upstream internals breaks silently at runtime, and the order of observers of
   one topic is not a contract. This is the reasoning m0-tabstrip-hidden applied to its patch.
   ADR-003 gains the register line in the header. (Subject to open question 4.)
7. **Existing profiles: hidden once on upgrade.** At the first start with this change, when
   `[ui] bookmarks_toolbar` is not set and the pref has a user value other than `"never"`
   (`"always"` from an import or an old Firefox profile, `"newtab"` from Restore Defaults), Vimma
   sets `"never"` once and says, in the polite region, "bookmarks toolbar hidden: ctrl+b shift+b
   opens your bookmarks; :bookmarkstoolbar show brings it back". The bool pref
   `vimma.ui.bookmarksToolbar.migrated` records it, so it never runs again and a later choice
   stands. A profile with no user value needs nothing: decision 1's default hides it. With the
   config key set, the key decides and the migration only records itself. (Subject to open
   question 2.)
8. **With toolbar-toggle.** When the nav bar is hidden (`ctrl+b u`, `[ui] toolbar = "hidden"`), the
   bookmarks toolbar is hidden with it (toolbar-toggle decision 5), whatever this setting says; the
   minimal URL bar never shows it (7a); the full reveal on hover or for an add-on popup shows it
   only when this setting would (shown, or newtab on a new tab). The two settings stay
   independent: neither writes the other's pref. Whichever spec is built second adds the
   combined mochitest (Tests, mochitest 10).
9. **Private workspace.** The pref is per profile, so private windows follow it. With `"newtab"`,
   a private window's `about:privatebrowsing` counts as a new tab (Firefox's rule). A private
   window's bookmarks panel shows the toolbar folder (bookmarks decision 11); nothing else
   changes.
10. **Theme and keyboard when shown.** Unchanged from Firefox: the toolbar takes the nav bar's look
    (Research → Theme); keyboard reach is Firefox's toolbar navigation (its `toolbartabstop`,
    `navigator-toolbox.inc.xhtml:553`, and arrow keys within, `browser.toolbars.keyboard_navigation`,
    `firefox.js:3094`). Vimma's panel stays the keyboard way to bookmarks.
11. **Customize → Restore Defaults writes Firefox's `"newtab"`.** Accepted, not patched: it is an
    explicit "Firefox's defaults" action, rare, and the next start's config (when set) corrects it.
    The guide says so. Because Firefox 158 checks this area's default state with
    `prefHasUserValue` (Research), a fresh Vimma profile's Restore Defaults button stays disabled
    with the branding default, so no patch of `defaultCollapsed` is needed.

### Not in scope

- Theming the bookmarks toolbar (or the nav bar) with Vimma's tokens.
- Changing where Firefox's star files bookmarks (the toolbar root, outside the workspace folders);
  Vimma's `ctrl+b a` files into the workspace's folder.
- Firefox's bookmarks sidebar and the Library.
- `browser.toolbars.bookmarks.showOtherBookmarks`.
- A per-window or per-workspace toolbar state.

## Security and privacy

No new surface. The change adds a default pref, a config key, an action and an ex command that
change a view of data Vimma already shows; it reads or sends nothing. The patch only skips a
reveal and a pref write, so it narrows Firefox's behaviour. The command is reachable from the
control socket only through `send-keys`, which the `agent` role cannot use, so a confined agent
cannot change the browser-wide pref.

## Tests

Written first and seen to fail (red, then green, per CLAUDE.md).

- **Vitest**
  - `tools/branding/test/branding-prefs.test.mjs`: given the branding pref file, then
    `browser.toolbars.bookmarks.visibility` is `"never"` and not locked.
  - `config.test.mjs` / `config-v2.test.mjs`: given `schema = 2` and
    `[ui] bookmarks_toolbar = "shown"`, then it parses to `"always"`; `"hidden"` → `"never"`,
    `"newtab"` → `"newtab"`; given `"always"` (Firefox's word), then an error suggesting
    `"shown"`; given `[ui]` in a schema-1 file, then the "new in schema 2" error; given no key,
    then the parsed config has none (the pref decides); given an unknown `[ui]` key, then an error
    with the closest name.
  - `cmdline.test.mjs`: `:bookmarkstoolbar` → `bookmarks.toolbar_toggle`; `show`, `hide`,
    `newtab` → the set action with that value; Tab completes the three; Tab after
    `:bookmarkstoolbar sho` gives `show`; `:bookmarkstoolbar blue` is refused with the closest.
  - `actions.test.mjs` / `defaults.test.mjs`: `toggle_bookmarks_toolbar` exists, group
    "Bookmarks", unbound; no default key collides. Snapshots: `help.test.mjs.snap` gains one row;
    `defaults.toml` gains the commented `[ui] bookmarks_toolbar` line (regenerated by
    `npm run gen-docs`, not hand-edited).
- **Mochitest `tests/browser/browser_vimma_bookmarks_toolbar.js`**
  1. Fresh profile: given default prefs and no user value, when a window opens on the start page,
     then `#PersonalToolbar` is collapsed; when a new tab opens, then still collapsed; in a private
     window on `about:privatebrowsing`, collapsed.
  2. Start page hint: given the start page, then its hint line has `ctrl+b shift+b` and
     "bookmarks".
  3. Existing profile, shown: given the user value `"always"` and
     `vimma.ui.bookmarksToolbar.migrated` unset, when the host starts, then the pref is `"never"`,
     every window's toolbar is collapsed, the notice says `bookmarks toolbar hidden: …`, and the
     migrated pref is `true`; when the pref is then set to `"always"` and the host runs its startup
     path again, then it stays `"always"` with no notice. The same for a user value `"newtab"`.
  4. Existing profile with config: given `"always"` and `[ui] bookmarks_toolbar = "shown"`, then no
     migration notice and the toolbar shows.
  5. Import: given `"never"`, when `MigrationUtils.insertManyBookmarksWrapper` inserts 5 bookmarks
     into the toolbar folder, then they are in Places, the pref is still `"never"` and the toolbar
     is collapsed; given `"newtab"`, then the import shows the toolbar as in Firefox (`"always"`).
  6. Star panel: given `"never"`, when a page is bookmarked into the toolbar folder through the
     star panel, then the toolbar does not show.
  7. Action and command: `:bookmarkstoolbar` shows it in two windows at once and the pref is
     `"always"`; again hides it; `:bookmarkstoolbar newtab` shows it on a new tab and not on a
     loaded page; each notice reaches the polite region.
  8. Config wins: given `[ui] bookmarks_toolbar = "shown"` written after start, when the reload
     reads it, then it shows in every open window (not only after a location change); when
     `:bookmarkstoolbar hide`, then hidden and the notice says "until restart"; when the config is
     reloaded unchanged, then still hidden; when the line changes to `"hidden"` and back to
     `"shown"`, then shown.
  9. Firefox's own controls: View → Toolbars' "Always show" item (`onViewToolbarCommand`) shows
     it and writes `"always"`, with no Vimma interference.
  10. With toolbar-toggle (in whichever is built second): given `"shown"` and the nav bar hidden,
      then `#PersonalToolbar` is collapsed and the minimal URL bar does not show it; on the full
      hover reveal it shows.
  11. Workspace folders: given `root = "workspace"` and a bookmark in the workspace's folder, when
      the toolbar is hidden, then `ctrl+b shift+b` lists it and `ctrl+b a` files into it,
      unchanged.
- **e2e:** no existing baseline changes from the hidden toolbar: the e2e profile already sets
  `"never"` (`tools/e2e/launcher.mjs:107`). That line stays, so the e2e profile does not depend on
  the branding default. A baseline that shows the start page's hint line changes with decision 2
  and gets its changelog line. The start page and the shown toolbar are screenshot-verified under
  Xvfb with the built-in and an Omarchy theme before merge.
- **Mutation check:** without the patch's early return, mochitest 5 fails (`"always"`); without
  the migrated pref, mochitest 3's second start hides the toolbar again.

## Docs and changelog

- **`docs/guide.md`:** the Bookmarks section gains "Firefox's Bookmarks Toolbar": hidden by
  default; your bookmarks are in the panel (`ctrl+b shift+b`) and in the toolbar folder either
  way; `:bookmarkstoolbar [show|hide|newtab]`; `[ui] bookmarks_toolbar`; View → Toolbars still
  works; config wins at start; Restore Defaults brings back Firefox's `"newtab"`. The start page
  section mentions the new hint; the `config.toml` reference gains the key.
- **`docs/bindings.md`**, `docs/bindings.json`, `defaults.toml`: `npm run gen-docs`.
- **README:** no feature-list change (the bookmarks panel is already listed).
- **`CHANGELOG.md` `[Unreleased]`** (added by the maintainer at merge time). Suggested: "Changed:
  Firefox's Bookmarks Toolbar is hidden by default, also on the start page and after an import;
  `ctrl+b shift+b` opens your bookmarks, and `:bookmarkstoolbar show` or `[ui] bookmarks_toolbar`
  brings the toolbar back." If open question 1 is answered yes, the keymap PR adds: "Added:
  `ctrl+shift+b` shows or hides the bookmarks toolbar, as in Firefox."
- **`docs/adr/003-own-files-minimal-patches.md`:** the register line in the header.

## Delivery

1. **`feat(bookmarks): firefox's bookmarks toolbar hidden by default`** (about 300 lines with
   tests, no default binding): decisions 1–7 and 9–11: the branding default,
   `[ui] bookmarks_toolbar`, `toggle_bookmarks_toolbar` unbound, `:bookmarkstoolbar`,
   `ui/bookmarks-toolbar.mjs` (apply, migrate once, notices), the `PlacesUIUtils` patch and its
   ADR-003 line, the start page's hint, gen-docs and the guide. It adds no default key, so it is
   not a keymap PR and need not wait for the keymap queue; it adds one `actions.mjs` row, so it
   merges `origin/main` and regenerates `docs/bindings.md` and the snapshots before merging.
2. **`feat(keys): ctrl+shift+b shows or hides the bookmarks toolbar`** (small; only if open
   question 1 is answered yes): a keymap PR after firefox-keys sub-PR 2. It binds `ctrl+shift+b`
   to `toggle_bookmarks_toolbar`, page first as in Firefox; the firefox-keys inventory row
   (`firefox-keys.mjs:309`, `firefox-keys.md:225`) moves from fate c to fate a, and
   `docs/bindings.md` "Firefox's shortcuts" says `toggle_bookmarks_toolbar`, page first.

Decision 8 adds no code here; it is mochitest 10 in whichever of this spec and toolbar-toggle is
built second.

## Open questions

1. **Default key for `toggle_bookmarks_toolbar`.** Firefox's `ctrl+shift+b` is fate c in the
   firefox-keys inventory: on main it is still Firefox's own toggle, and firefox-keys sub-PR 2 turns
   it off by default.
   - (a) Bind `ctrl+shift+b` to `toggle_bookmarks_toolbar` (delivery 2, fate c → a, a keymap PR
     after firefox-keys sub-PR 2). It keeps Firefox's muscle memory, gives the key a name in
     `ctrl+b ?` and makes it rebindable, as firefox-keys decision 1 does for every key it keeps.
     Cost: one more keymap PR in the queue.
   - (b) Leave it fate c: off by default after firefox-keys sub-PR 2; `[firefox] enable =
["ctrl+shift+b"]` gives Firefox's key back, and `:bookmarkstoolbar` works without a key. No
     extra PR, but the action has no default key for a toolbar that is now hidden by default.
   - Recommendation: (a), because once the action exists, fate a is how firefox-keys treats a
     Firefox key with a named Vimma equivalent, and the key runs exactly Firefox's toggle.
2. **Hide it once for existing profiles that show it (decision 7)?**
   - (a) Yes: one migration, guarded by `vimma.ui.bookmarksToolbar.migrated`, with a notice. The
     default applies to every profile, and a later choice stands.
   - (b) No: only profiles without a user value change (through decision 1's default). No
     migration code or pref; profiles that imported bookmarks before this change keep the
     toolbar.
   - Recommendation: (a), because it is one bool pref and one test, and it covers profiles that an
     earlier import or Restore Defaults left showing the toolbar. No release has been published
     yet, so the migration affects only development and test profiles today; (b) is acceptable if
     the code is not wanted for that reason.
3. **Offer `"newtab"` as a config and command value?**
   - (a) Yes: `[ui] bookmarks_toolbar = "newtab"` and `:bookmarkstoolbar newtab`.
   - (b) No: `"shown"` and `"hidden"` only; Firefox's View menu still sets "only on new tab".
   - Recommendation: (a), because it is Firefox's own third state, already in its View menu, and
     without it `:bookmarkstoolbar` and `[ui]` cannot express what the menu can; it also shows
     the toolbar only on Vimma's start page, the one place a row of shortcuts helps.
4. **Should importing bookmarks show the toolbar while it is hidden (decision 6)?**
   - (a) No while `"never"`: the one-hunk `PlacesUIUtils` patch; with `"shown"` or `"newtab"` the
     import behaves as in Firefox.
   - (b) Yes, as Firefox: no patch, but the first import overrides the default to `"always"`.
   - (c) Undo it afterwards from an observer: no patch, but it relies on observer order and
     flashes the toolbar.
   - Recommendation: (a), because an explicit `"never"` should survive an import, as Firefox's
     own star panel already respects it, and a one-hunk patch fails loudly on a rebase.
