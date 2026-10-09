# Spec: m0-tabstrip-hidden

Status: implemented, awaiting review · Milestone: M0 · Area: UI (`src/browser/base/content/vimma/ui/`,
`src/browser/themes/shared/vimma/`)

## User story

As a Vimma user, I don't see Firefox's tab strip: the window starts with the nav bar and URL bar
at the top, like Vimma will look once M2 brings its own status bar and tab picker. Until then I
still open, close, switch and list tabs with Firefox's own keys, the window controls are still
there when the browser draws its own titlebar (GNOME/KDE with CSD), and I can bring the strip
back from about:config without restarting.

## Scope

- **Pref `vimma.ui.tabstrip.hidden`** (bool, default `true`, in our default pref file
  `browser/branding/vimma/pref/firefox-branding.js`). Read and observed per window: flipping it
  shows or hides the strip live, with no restart.
- **Mechanism.** `ui/tabstrip.mjs` (a `TabStrip` per window, created by `VimmaHost.init`):
  - sets the attribute `vimma-tabstrip-hidden` on the window root (`<html>`) from the pref;
  - loads `chrome://browser/skin/vimma/tabstrip.css` (author sheet, registered in our `jar.mn`
    from `browser/themes/shared/vimma/tabstrip.css`, as in m0-help-overlay), which keys off it:
    `#TabsToolbar` gets `visibility: collapse` (zero height, as Firefox's own `collapsed`), and
    with vertical tabs (`sidebar.verticalTabs`) the tab list `#vertical-tabs` is `display: none`;
  - tells Firefox the tab strip is hidden, so its own titlebar handling applies (see Settled):
    after every `TabBarVisibility.update()` it sets `tabs-hidden` on `#navigator-toolbox` and
    gives `#nav-bar` the `browser-titlebar` class when the titlebar is drawn by the browser.
- **The "List all tabs" panel keeps working.** Firefox opens it only when `#alltabs-button`
  (inside the hidden strip) has a size; while the strip is hidden and that button is not visible,
  the panel anchors to the app menu button instead (`gTabsPanel.canOpen`, `showAllTabsPanel`).
- **Customize mode** shows the strip while customizing (`:root[customizing]`), so its widgets can
  still be moved; it hides again on leaving.
- No upstream patch, no build-config change.

## Tests (write first)

`tests/browser/browser_vimma_tabstrip.js`:

- Given default prefs, then `vimma.ui.tabstrip.hidden` is `true`, the root has
  `vimma-tabstrip-hidden`, `#TabsToolbar` and `#tabbrowser-tabs` have zero height, and `#nav-bar`
  and the URL bar are visible; `ctrl+l` focuses the URL bar.
- Given the strip hidden, when the pref is set to `false`, then `#TabsToolbar` is visible again
  without a restart; when it is set back to `true`, it is hidden again.
- Given the strip hidden, when `ctrl+t`, then a new tab is selected; `ctrl+w` closes it.
- Given three tabs and the strip hidden, `ctrl+tab` and `ctrl+pagedown` select the next tab,
  `ctrl+shift+tab` the previous one, and the tab-number key (`ctrl+2`; `alt+2` on Linux)
  the second tab.
- Given the strip hidden, when "List all tabs" runs (`Browser:ShowAllTabs`, and `ctrl+shift+tab`
  with `browser.ctrlTab.sortByRecentlyUsed`), then the all-tabs panel opens and lists every tab.
- Given the strip hidden and a titlebar drawn by the browser (`customtitlebar`), then the window
  controls are in `#nav-bar` and visible, `#nav-bar` is a drag region (`browser-titlebar`), and
  none are left in `#TabsToolbar`. When the system cannot draw one (headless, tiling WMs), the
  test sets the attribute itself, as `CustomTitlebar` would.
- Given fullscreen, the strip stays hidden and the nav bar is still in the toolbox.
- Given customize mode, the strip is visible; after leaving it, hidden again.
- Given vertical tabs (`sidebar.revamp`, `sidebar.verticalTabs`), the vertical tab list has no
  size; with the pref `false` it is visible.
- Given the strip hidden, when `ctrl+b` `?`, then the help overlay opens.

## Out of scope

Vimma's own tab UI and keys (`prefix+c`, `prefix+1..9`, `prefix+n/p`), the status bar's
`tab 2/5` and the `prefix+g` picker (M2); hiding the sidebar launcher (M3 side panel); theme
tokens (M5); a settings UI for the pref.

## Settled (2026-10-09, from the engine tree)

- **Element ids** (`browser/base/content/navigator-toolbox.inc.xhtml`): the horizontal strip is
  `toolbar#TabsToolbar` (contains `#tabbrowser-tabs`, `#new-tab-button`, `#alltabs-button`, the
  private-browsing indicator and a copy of `titlebar-items.inc.xhtml`, the window controls).
  Vertical tabs live in `#vertical-tabs`, the `tabstrip` slot of `<sidebar-main>` in
  `browser-box.inc.xhtml`, under `#sidebar-container`.
- **Window controls.** Firefox 157 includes the window controls (`.titlebar-buttonbox-container`)
  in `#toolbar-menubar`, `#TabsToolbar` and `#nav-bar`; `browser-shared.css` shows them in the
  first visible toolbar only, keyed on `#navigator-toolbox[tabs-hidden]`, which
  `tab-bar-visibility.js` sets for popups and vertical tabs. Its `update()` recomputes that
  attribute on every call (tab open/close, titlebar pref, customize mode), so `TabStrip` wraps
  the window's `TabBarVisibility.update` and re-asserts `tabs-hidden` and the nav bar's
  `browser-titlebar` class after it. This reuses upstream's maintained path rather than copying
  its CSS conditions (menubar shown permanently, fullscreen, CSD button order, spacers, inactive
  opacity, private-browsing indicator). Under Hyprland there is no `customtitlebar` and no
  controls anywhere, as in Firefox; nothing to replace. `menu_closeWindow` and the File menu's
  "Close Tab" label stay as Firefox computes them (we do not hide the strip from Firefox's model,
  only from view).
- **`visibility: collapse`, not `display: none`**, for `#TabsToolbar`: the same as Firefox's
  `collapsed`, which popups and vertical tabs use, so the tab strip's frames and the tabbrowser's
  layout code behave as in a tested state.
- **Vertical tabs:** only `#vertical-tabs` is hidden; the sidebar launcher's tool buttons are not
  a tab strip and stay (M3 replaces them with the side panel). `@media -moz-pref(...)` as
  `sidebar-main.css` does.
- **List all tabs.** `gTabsPanel.canOpen` is `isElementVisible(#alltabs-button)`, false while the
  strip is hidden, so `ctrl+shift+tab` (with `browser.ctrlTab.sortByRecentlyUsed`, default
  `false` in Firefox 157), View > List All Tabs and the ctrl+tab panel's "show all" would do
  nothing. `TabStrip` wraps both on the window's `gTabsPanel`: if the strip is hidden by us and
  the button has no size, anchor to `#PanelUI-menu-button`. If the user moves `#alltabs-button`
  to the nav bar, it is used as before. With default prefs `ctrl+shift+tab` is "previous tab".
- **Zen** (`src/zen/tabs/zen-tabs/vertical-tabs.css`, `zen-browser-ui.css`) replaces the strip:
  it reparents `#TabsToolbar` into its own sidebar, moves the window controls into its sidebar
  top buttons and hides `#alltabs-button` outside customize mode. Nothing to vendor for M0.
- **Fullscreen / kiosk / popups:** the toolbox's fullscreen auto-hide still works on the nav bar
  (`fullscreentoolbar="true"`); with `tabs-hidden` the nav bar shows the window controls in
  fullscreen, as with vertical tabs. Popups already hide the strip; `TabStrip` leaves windows
  without a toolbar (`window.toolbar.visible == false`) to Firefox.
- **`ctrl+1..9` is `alt+1..9` on Linux** (`NUM_SELECT_TAB_MODIFIER` is `alt` under `XP_GNOME`
  in `browser-sets.inc.xhtml`); the test reads the modifier from `#key_selectTab2`.
- **Verified:** red run 13 passed / 21 failed; green 31/0; full suite 151/0. Mutation: making
  `fallbackAnchor()` return `null` while hidden fails "gTabsPanel.canOpen with the strip hidden"
  (reverted). Headless has no CSD, so the window-controls test sets `customtitlebar` itself.
- **Open for M2:** Vimma's tab keys and the `prefix+g` picker replace "List all tabs"; decide
  then whether the app-menu anchor stays. The pref has no Settings UI. Hyprland users get no
  window controls (none needed); check the nav bar's drag region on GNOME by hand once.
