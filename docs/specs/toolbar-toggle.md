# Spec: toolbar-toggle

Status: ready (not started) · Milestone: after M5 (builds on [m0-tabstrip-hidden](m0-tabstrip-hidden.md),
the status bar of [m2-statusbar-whichkey](m2-statusbar-whichkey.md) and the config of
[m5-config-load](m5-config-load.md)) · Area: `packages/vimma-core/src/actions.mjs`,
`defaults.mjs`, `config.mjs`, `cmdline.mjs`, `statusbar.mjs`; `ui/toolbar.mjs` (new),
`ui/statusbar.mjs`, `host/VimmaHost.sys.mjs`, `host/addon-ops.mjs`,
`config/ConfigHost.sys.mjs`, `browser/themes/shared/vimma/toolbar.css` (new). No upstream patch.

**This changes the default keymap. It lands as its own keymap PR, and only when no other keymap
PR is open (one keymap PR at a time).**

## The user's words

"We could also implement keybind that toggles toolbar"

The coordinator proposed, and the user approved ("do so"):

- a prefix key that toggles the navigation toolbar (`#nav-bar`: the URL bar and the add-on
  buttons);
- a config setting for the start state;
- while the toolbar is hidden, focusing the URL bar shows it as a temporary overlay, like Zen's
  compact mode. The user must never be left unable to type an address;
- add-on buttons stay reachable through Vimma's add-on picker.

## User stories

- As a user, `ctrl+b u` hides the toolbar in every window. The window is then the pages and
  Vimma's status bar, which already shows the page's URL. `ctrl+b u` again brings the toolbar
  back. The notice says "toolbar hidden" or "toolbar shown", and a screen reader hears it.
- As a user, with the toolbar hidden, `I`, `ctrl+l`, `alt+d`, `F6`, `t`, `ctrl+t`, `ctrl+b c`,
  a new pane, and the start page all still give me a focused address bar. The toolbar slides in
  over the top of the page and the page does not jump. When I press `Enter` the page loads, focus
  goes to it, and the toolbar hides again. `Esc` gives up and hides it too.
- As a user, `[ui] toolbar = "hidden"` in `config.toml` starts every window with the toolbar
  hidden.
- As a user, `:toolbar` toggles it, and `:toolbar show` / `:toolbar hide` set it, so
  `vimma-ctl` scripts can set it as well.
- As a user, `ctrl+b e` → `Enter` on an add-on still opens its popup under its button. The
  toolbar shows for as long as the popup is open.
- As a user, when a site asks for a permission (camera, location, notifications) while the
  toolbar is hidden, the toolbar shows. The prompt points at the address bar's icon, next to the
  site's identity, exactly as with the toolbar shown. It never appears unattributed in a corner.
- As a user, with the toolbar hidden I can still tell an insecure page: the status bar says
  `not secure` for a page that is not served over a secure connection. In a private window it
  says `private`.

## Research

### Vimma today

- **The tab strip** is hidden by `ui/tabstrip.mjs` and `tabstrip.css`. The pref
  `vimma.ui.tabstrip.hidden` is observed live in every window and sets the root attribute
  `vimma-tabstrip-hidden`. The CSS gives `#TabsToolbar` `visibility: collapse`, as Firefox's own
  `collapsed` does. It excludes `[customizing]`, `[popup-window]` and `[taskbartab]`.
  `tab-bar-visibility-js.patch` makes `TabBarVisibility.update()` treat the strip as hidden.
  The nav bar then gets the `browser-titlebar` class, and with a custom (CSD) titlebar it holds
  the window controls and the drag area.
- **Toggles:** `ctrl+b b` (`sidebar.toggle`, `:sidebar`) and `ctrl+b z` are per window or per
  workspace. The panel's open state is not persisted. Zoom rides in the workspace snapshot. No
  chrome visibility setting is in `config.toml` yet. Its top-level tables (`config.mjs`
  `TOP_KEYS`) are `keys`, `modal`, `unbind`, `schema`, `workspaces`, `theme`, `panes`, `sites`,
  `routes`, `firefox` and `bookmarks`. Newer keys are gated on `schema = 2`, as `[bookmarks]`
  was.
- **Free prefix keys** (`defaults.mjs` `keys`, `docs/bindings.md`):
  - Bound: `? c n p 1–9 T X v - h j k l H J K L z x r enter space ) ( ^ ctrl+6 w N W D g b B a [ e`.
  - `T` is `rename_tab`, so the suggested `ctrl+b T` is taken.
  - `t` is free, but two mochitest files use it as the "unbound by default" key
    (`browser_vimma_config.js:122` and on, `browser_vimma_config_first_run.js:108`), and so does the guide's `config.toml` example
    (`new_tab = ["prefix+t"]`).
  - `u` is free. tmux does not bind it, and the only test use is a typo key (`new_tabb = "prefix+u"`)
    that does not depend on `u` being unbound.
  - A second key after the prefix never reaches Firefox, so it cannot clash with Firefox's own
    chords.
- **URL bar paths:**
  - `I` (`urlbar.focus`) runs `Browser:OpenLocation`, which calls `gURLBar.select()` and opens
    the results.
  - `tab.new` runs `BrowserCommands.openTab` (the start page, URL bar focused).
  - A split runs `gURLBar.select()` (`pane-ops.mjs`).
  - All of these, and Firefox's own `ctrl+l` / `alt+d` (the same `Browser:OpenLocation`), go
    through `UrlbarInputBase.focus()` / `select()`. `F6` is expected to as well; the mochitest
    checks it rather than assuming.
- **Status bar** (core `statusbar.mjs`): the `url` segment shows `displayUrl(url)`, which drops
  `http://` and `https://` alike. It has priority 8, so it is the first segment dropped, and it is
  left out when the title is the URL. No segment shows security or private browsing.
- **Add-on popups** (`addon-ops.mjs` `openAddonPopup`): `gUnifiedExtensions.browserActionFor(policy)
.triggerAction(win)`. A pinned button anchors its popup to itself. A button in the extensions
  menu opens that menu first, and the popup anchors to `#unified-extensions-button`. Both are in
  `#nav-bar`.
- **Notices** go to a persistent polite live region (m7-a11y decision 3). The status bar is
  `aria-live=off`.

### Firefox (engine/)

- **Structure** (`navigator-toolbox.inc.xhtml`): `#navigator-toolbox` holds `#toolbar-menubar`,
  `#TabsToolbar`, `#nav-bar`, `#PersonalToolbar` and `#notifications-toolbar`. The last one
  holds the global notification bars (`gNotificationBox`, `browser.js:421`) and the per-tab
  notification deck. With the tab strip hidden, the private-browsing indicator and the titlebar
  buttons are those in `#nav-bar` (lines 539–541).
- **Collapsing a toolbar:**
  - `window.setToolbarVisibility` / `CustomizableUI.setToolbarVisibility` toggles `collapsed`,
    persists it in xulstore and fires `toolbarvisibilitychange`.
  - `#nav-bar` has no `toolbarname`, so Firefox offers no menu item to collapse it.
  - `browser-addons.js` `onToolbarVisibilityChange` moves extension buttons off a collapsed
    toolbar into the extensions menu, and anchors their popups to `#unified-extensions-button`.
    That button is itself in `#nav-bar`.
- **F11 fullscreen** (`browser-fullScreenAndPointerLock.js`) is the closest prior art for "hidden
  until needed":
  - `hideNavToolbox` uses a negative `margin-top`, not collapse, so the content moves up.
  - The `gURLBar` getter (`browser.js:379–415`) listens for `beforefocus` / `beforeselect` on
    `#urlbar` and calls `FullScreen.showNavToolbox()` before focus lands. `UrlbarInputBase.focus()`
    and `select()` dispatch these events (lines 870–915), and they can be cancelled.
  - It keeps the toolbox shown while a chrome popup is open (`_setPopupOpen`, on document
    `popupshown` / `popuphidden`).
  - It refuses to hide while a chrome `<input>` is focused.
  - `Esc` and `F6` are handled by `_keyToggleCallback`.
  - A 1 px `#fullscr-toggler` at the top shows the toolbox on hover.
- **DOM fullscreen** collapses `#navigator-toolbox`. Unless the site may stay fullscreen, it
  removes pending permission prompts on entry, and a permission prompt that shows later exits
  DOM fullscreen (`_handlePermPromptShow`).
- **Doorhangers** (`PopupNotifications.sys.mjs`, set up in `browser.js:442–508`):
  1. `getVisibleAnchorElement` first dispatches the bubbling event `PopupNotificationsBeforeAnchor`
     on the anchor. Firefox's own `browser-addons.js` uses it to unhide the auto-hidden
     extensions button before a prompt anchors to it.
  2. It then checks `checkVisibility({ visibilityProperty: true })`, which fails for
     `visibility: collapse` and for no frame, and passes for zero size or opacity 0.
  3. Its fallbacks (`#trust-icon-container`, `#identity-icon`, …) are all in `#nav-bar`.
  4. `_showPanel` then falls back to `gBrowser.selectedTab`. That is hidden too in Vimma (the tab
     strip), so it falls back to null, which shows the prompt at the window's top-left with no
     anchor ("entirely chromeless environment").
  5. `shouldSuppress` already hides doorhangers while the URL bar is focused and edited.
  6. `UpdatePopupNotificationsVisibility()` re-evaluates anchors. The URL bar calls it on focus
     and blur.
- **Arrow panels follow their anchor:** `nsMenuPopupFrame::CheckForAnchorChange` runs every
  refresh tick and hides a popup whose anchor lost its frame or became invisible. Hiding the bar
  under an open doorhanger therefore closes it. A non-persistent prompt then counts as dismissed.
  Opening a panel on a frameless anchor positions it against the whole window. A null anchor
  puts it at the top-left.
- **Panels with no fallback** (they need the bar shown before they open):
  - the identity panel (`gIdentityHandler._openPopup`);
  - the permission panel and the protections panel;
  - the app menu (`PanelUI`);
  - `PanelUI.showSubView`'s widget panel, which hosts browserAction popups;
  - the extensions menu.

  PanelMultiView and `ViewPopup.attach` pass the anchor through unchecked. `ext-browserAction.js`
  `openPopup` / `triggerAction` never check the button's visibility.

- **Popup windows** (`window.open` with `chromehidden`) keep `#nav-bar` with a read-only URL bar,
  for anti-spoofing (`browser-init.js:335–340`). Extension popup windows and chromeless windows
  hide `#nav-bar` with `display: none` (`browser-shared.css`, about line 506), and their prompts
  open at the top-left. Prior art, not a model.

### Zen's compact mode (Zen's installed `omni.ja`, `zen-components/ZenCompactMode.mjs`, `zen-styles/zen-compact-mode.css`)

- **Hiding:** the mode is `zen-compact-mode="true"` on `:root`. The navbar wrapper is clipped to
  a few pixels of height (`overflow: clip`) and given `opacity: 0`. It is never collapsed, so the
  URL bar stays focusable and anchors stay measurable.
- **Revealing:**
  - The wrapper gets `zen-compact-mode-active` while it matches
    `:where([panelopen], [open], #urlbar:focus-within, [breakout-extend])`. Zen watches this with
    a MutationObserver polyfill for `:has`.
  - `has-popup-menu` is set from document `popupshowing` / `popuphidden` when the trigger is
    inside the bar.
  - `zen-has-hover` is set on hover, and when the pointer crosses the top window edge, with a
    1000 ms hide delay (`zen.view.compact.toolbar-hide-after-hover.duration`).
- **Content:** a negative `margin-top` on `.browserContainer` lets the revealed bar cover the
  page instead of pushing it down.
- **Doorhangers:** no special handling. They are covered only because anchors in the URL bar get
  `[open]`, and an opacity-0 bar passes `checkVisibility`. While it is still hidden, a prompt
  anchors to an invisible icon.
- **Other:** `Esc` blurs the floating URL bar to the page. The toggle is `Accel+S`. In DOM
  fullscreen the wrapper is collapsed.

## Decisions

1. **Key: `ctrl+b u`** (`prefix+u`, mnemonic "URL bar"). It runs `toggle_toolbar`
   (`toolbar.toggle`, "Show / hide the toolbar (URL bar and add-on buttons)") in the "Navigation"
   group, next to `toggle_sidebar`.
   - `T` is `rename_tab`.
   - `t` is free but is the tests' and the guide's stand-in for an unbound key. Taking it would
     mean editing two test files and the guide's example. That is not loosening a test, but it
     is churn for a mnemonic.
   - `u` is free, unused by tmux, and nothing depends on it being unbound.
   - Also added: `show_toolbar` (`toolbar.show`) and `hide_toolbar` (`toolbar.hide`), unbound.
2. **`:toolbar [show|hide]`.** Without an argument it is `toolbar.toggle`. With one it is
   `toolbar.show` or `toolbar.hide`.
   - Tab completes `show` and `hide`. These are core-supplied fixed names, as for `:layout`.
   - An unknown word is refused with the closest name.
   - `:sidebar` / `:bookmarks` are the model, plus arguments so `vimma-ctl` can set a known state
     rather than flip an unknown one.
3. **Config: `[ui] toolbar = "shown" | "hidden"`.** This is a new top-level table, gated on
   `schema = 2` like `[bookmarks]`. The default is `"shown"`.
   - Anything else is an error with the closest value, and the last good config stays.
   - `[ui]` is the home for later chrome-visibility settings; the tab strip pref could move there.
   - Default shown: a new user gets Firefox's familiar address bar. Hiding is opt-in, because it
     moves security information into the status bar (decision 12).
4. **One state for all windows, held in a pref.**
   - `vimma.ui.toolbar.hidden` (bool, default `false`) is observed live in every window, as the
     tab strip pref is.
   - The toggle, `:toolbar` and `vimma-ctl` write it.
   - `ConfigHost` writes it from `[ui] toolbar` at startup, and on a reload only when that value
     changed from the last good config. A toggle therefore lasts until the next restart or the
     next edit of that line, as a tmux `set` lasts until `.tmux.conf` is sourced.
   - A restart starts from the config. That is the safe direction: a broken or missing config
     means `"shown"`.
   - Not per window: it is a look you choose for the browser, as Zen's compact mode is. A
     per-window toggle would make new windows guess.
5. **What hides:**
   - **Hidden:** `#nav-bar`, and `#PersonalToolbar` (the bookmarks toolbar would otherwise float
     alone at the top).
   - **Untouched:**
     - `#notifications-toolbar`: notification bars ("this site was prevented from opening a
       popup", crash and update bars) stay where they are and move to the top edge.
     - The menu bar: `alt` still shows it.
     - The tab strip, which keeps its own pref.
   - **Excluded:** like `tabstrip.css`, the rules do not apply to:
     - customize mode (`[customizing]`);
     - popup windows (`[popup-window]`): their read-only URL bar is anti-spoofing and must stay;
     - taskbar tabs (`[taskbartab]`);
     - F11 fullscreen (`[inFullscreen]`) and DOM fullscreen (`[inDOMFullscreen]`). Firefox's own
       toolbox handling owns those, with its own reveal on hover, `F6` and URL bar focus.
6. **Hidden means collapsed.**
   - `ui/toolbar.mjs` sets the root attribute `vimma-toolbar-hidden` from the pref, and
     `toolbar.css` gives the two toolbars `visibility: collapse`, the same mechanism as the tab
     strip.
   - A collapsed bar:
     - takes no space and is not painted;
     - is out of the tab order and the accessibility tree;
     - honestly fails `checkVisibility`, so nothing anchors to an invisible icon.
   - Not Zen's opacity and clip: Zen's bar stays "visible" to Firefox while invisible to the user.
     A prompt could then point at a hidden icon, and a screen reader could still browse into the
     bar.
   - The cost: focus and anchoring need the bar shown first. Decisions 7 and 8 do that before
     either happens, synchronously.
7. **Reveal, as an overlay.**
   - While any reason in the window's reveal set holds, the root gets `vimma-toolbar-revealed`
     and the bar shows.
   - It shows over the top of the content area, as Zen and the F11 toolbox do. Pages are not
     resized: no reflow, no `resize` event in the page, no jump. Zen's negative `margin-top` on the
     content is the reference technique. The mochitest's "page height unchanged" check
     (test plan) is the contract, not the technique.
   - Reasons:
     - **a. URL bar:** `beforefocus` / `beforeselect` on `#urlbar`, the same hook Firefox uses for
       F11. This adds the reason synchronously, before `focus()` runs, so focus lands on a laid-out
       field. Every path in Research → URL bar paths, and the start page, goes through it, with
       nothing to list or keep in sync. The reason holds while `#urlbar` has focus
       (`gURLBar.focused`) or its results view is open.
     - **b. Focus inside the bar:** `focusin` on `#nav-bar` (keyboard into a button from the
       revealed URL bar). The reason holds while focus is inside.
     - **c. Doorhangers:** `PopupNotificationsBeforeAnchor` bubbling up to `#nav-bar` adds the
       reason before `getVisibleAnchorElement` checks the anchor. This is Firefox's own pattern
       for the extensions button. The reason holds until `PopupNotifications.panel` fires
       `popuphidden`.
     - **d. Panels anchored in the bar:** a capture-phase `popupshowing` whose `anchorNode` or
       `triggerNode` is inside `#nav-bar` adds the reason. This covers the identity, permission and
       protections panels, the app menu, the extensions menu, downloads, and browserAction popups
       (including an add-on's own `_execute_action` shortcut). The reason holds until that popup's
       `popuphidden`, as F11's `_setPopupOpen` does. `popupshowing` fires before the popup is
       positioned. The mochitest proves the popup lands under its button; if it does not, the
       picker path (decision 10) still reveals first.
     - **e. Hover:** see decision 9.
   - On every change to the set, the host calls `UpdatePopupNotificationsVisibility()`, so
     doorhanger anchors are re-evaluated.
8. **Hide.** When the last reason ends, the overlay goes. There is no timer, except for hover.
   - **After `Enter`:** Firefox focuses the loading page on `Enter` (`UrlbarInputBase #loadURL`;
     the browser is focused parent-side). The URL bar's blur then ends reason (a), at the moment
     the load starts.
   - **No "hide on load commit" rule:** a focused URL bar is never hidden. Hiding it would leave
     focus inside a collapsed element.
   - **`Esc`:**
     - Firefox's own `Esc` runs first: it closes the results, then reverts typed text.
     - Then, while the bar is revealed only by reason (a), an `Esc` that Firefox had nothing left
       to do with (results closed, value not edited, `pageproxystate` valid) focuses the selected
       browser.
     - Reason (a) then ends, and the bar hides.
     - With the toolbar shown, `Esc` behaves exactly as in Firefox; this spec changes nothing
       there.
   - **Never under an open panel:** an open doorhanger or panel anchored in the bar keeps it
     shown (decision 7c/d). The bar is never collapsed under an open arrow panel, so
     `CheckForAnchorChange` never closes or dismisses a prompt because of us.
9. **Hover reveals; not keyboard-only.**
   - Pointer at the window's top 2 px, or over the revealed bar, adds a hover reason. It is added
     after 150 ms and removed 600 ms after the pointer leaves both.
   - The edge is a fixed, transparent `#vimma-toolbar-edge` strip shown only while hidden, as F11's
     `#fullscr-toggler`.
   - Why:
     - Keyboard-first is not keyboard-only.
     - With a custom (CSD) titlebar the window's close, minimise and maximise buttons live in the
       hidden bar. Hover is how a mouse user reaches them, and add-on buttons.
     - The overlay never resizes the page, so a stray reveal costs nothing.
     - On a tiling WM (Omarchy) the edge is the window's top, not the screen's, so the delay
       keeps a pointer crossing from the window above from flashing it.
10. **Add-on popups.**
    - `openAddonPopup` adds a "popup" reason before `triggerAction`, held until the popup or the
      extensions menu closes.
    - The popup therefore opens under its own button, or in the extensions menu, as with the
      toolbar shown, and the user sees which add-on it is.
    - No fallback anchor is invented. Firefox's extension popups are built to hang from their
      button.
    - Decision 7d covers the paths Vimma does not run (an add-on's own shortcut,
      `browserAction.openPopup()`).
11. **Permission prompts and security.**
    - Decision 7c is the security decision. A prompt always shows anchored to its icon in the URL
      bar, with the identity box (lock, site) beside it and the page's address in the field. That
      is exactly the attribution Firefox gives with the toolbar shown.
    - Without it, Vimma's hidden tab strip would send the prompt to the top-left with no anchor.
    - Nothing is suppressed or delayed by us. Firefox's `security.notification_enable_delay` and
      its `shouldSuppress` (URL bar focused and edited) still apply.
    - DOM fullscreen keeps Firefox's rules (decision 5): a permission prompt exits it.
12. **The status bar carries what the hidden bar did.** Only while the toolbar is hidden:
    - **`not secure`:** a new right-side segment in `--vimma-text-error`, priority 2 (as config
      errors), never dropped before the URL. It shows when the selected browser's
      `securityUI.state` is insecure (an `http:` page), broken (a certificate exception, mixed
      active content), or `gIdentityHandler` would show the "not secure" icon. The host passes a
      `security: "secure" | "insecure" | "neutral"` input:
      - `neutral` is `about:`, `file:`, the start page and similar;
      - `secure` shows nothing, as Firefox's lock is quiet.

      Text, not only colour, so it reads without colour vision (m7-a11y).

    - **`private`:** a new segment in a private window, as the toolbar's indicator did.
    - **URL priority:** the `url` segment's priority rises from 8 to 5, so the address outlasts
      the title in a narrow window. `http://` is no longer dropped by `displayUrl` for an `http:`
      page: the scheme is part of the warning.
    - **Toolbar shown:** the bar is exactly as today, with the same inputs and no new segments.
      This keeps every existing screenshot baseline unchanged.
13. **Never unable to type an address.**
    - Reason (a) reveals before focus.
    - As a safety net, if after the reveal the URL bar still fails `checkVisibility` when a focus
      or select runs, the host:
      - cancels nothing;
      - writes the pref back to shown;
      - says "toolbar shown: the address bar could not be revealed";
      - logs to `about:vimma`'s key log.

      A user is never left with keys that go nowhere. This should never happen, and a test forces
      it.

    - **Customize mode** shows the toolbar (decision 5).
14. **Hiding with focus inside the bar.** `ctrl+b u` (or `:toolbar hide`) while focus is in the
    URL bar or a toolbar button first focuses the selected browser, then hides. Focus never
    stays in a collapsed element.
15. **Split panes:** the URL bar is the selected tab's, which is the focused pane's, as today.
    - The overlay spans the window's width, as the bar does.
    - The focused pane's accent outline says which pane it belongs to.
    - A new pane (`ctrl+b v`, `ctrl+b enter`) focuses the URL bar through `gURLBar.select()`, so
      reason (a) covers it.
16. **The find bar** is per browser, at the bottom of the content. It is unaffected and never
    covered by the overlay.
17. **Window controls (CSD):** hidden with the bar and shown with the overlay or on hover
    (decision 9). The guide says so. On Omarchy, with server-side or no decorations, nothing
    changes.
18. **Accessibility** (m7-a11y):
    - The toggle's notice ("toolbar hidden" / "toolbar shown") is announced through the polite
      live region.
    - A collapsed bar is out of the accessibility tree.
    - A reveal for focus is not announced. The focused URL bar is announced by the screen reader
      as usual.
    - Focus is never lost:
      - decision 14 moves focus out before hiding;
      - reason (a) reveals before focusing;
      - `Esc` returns focus to the page.
    - The status bar segments of decision 12 are text, and are read with "read status bar".
19. **No upstream patch.**
    - Firefox's own events (`beforefocus`, `beforeselect`, `PopupNotificationsBeforeAnchor`,
      `popupshowing`) and its `UpdatePopupNotificationsVisibility()` are enough.
    - The CSS is ours, loaded as an author sheet like `tabstrip.css`.
    - `TabBarVisibility` is not touched. The nav bar keeps its `browser-titlebar` class whether
      hidden or not.

## Test plan

Write first; paste red, then green (CLAUDE.md).

- **Vitest:**
  - `actions.test.mjs` / `defaults.test.mjs`: `toggle_toolbar` on `prefix+u` reaches
    `toolbar.toggle` through the dispatcher; `show_toolbar` / `hide_toolbar` are unbound; no
    default key collides.
  - `config.test.mjs`:
    - `[ui] toolbar` parses `"shown"` and `"hidden"`;
    - a wrong value is an error with the closest value;
    - `[ui]` in a schema-1 file gets the "new in schema 2" error;
    - an unknown `[ui]` key is an error;
    - the default is `"shown"`.
  - `cmdline.test.mjs`: `:toolbar`, `:toolbar show`, `:toolbar hide`, the completion of the two
    words, and an unknown word refused.
  - `statusbar.test.mjs`:
    - with the toolbar hidden, `not secure` for `insecure` and none for `secure` and `neutral`;
    - `private` in a private window;
    - the URL's raised priority, so it outlasts the title in a narrow fit;
    - `http://` kept for an `http:` page;
    - with the toolbar shown, segments identical to today's for the same input (a property over
      the existing fixtures).
  - Snapshots:
    - `help.test.mjs.snap` gains three rows;
    - `defaults.test.mjs.snap` gains the key and `[ui]`;
    - `defaults.toml` is regenerated.
- **Mochitest `tests/browser/browser_vimma_toolbar.js`:**
  1. `ctrl+b u` collapses `#nav-bar` and `#PersonalToolbar` in two windows. The notice says
     "toolbar hidden", and `#notifications-toolbar` is still shown. Then `ctrl+b u` restores the
     bar.
  2. Reveal on focus:
     - for each of `I`, `ctrl+l`, `F6`, `t`, `ctrl+b c` and `ctrl+b v`, the URL bar is focused,
       `checkVisibility()` is true, and typing lands in it;
     - the selected browser's height and `innerHeight` are unchanged (overlay, no resize event in
       the page).
  3. `Enter` on a typed address: the page loads, focus is in the page, and the bar is collapsed
     again.
  4. `Esc`:
     - after typing, the first `Esc` reverts, as in Firefox, and the bar stays;
     - the next `Esc` focuses the page and the bar collapses.
  5. Permission prompt while hidden:
     - a test page requests geolocation;
     - the prompt's `anchorNode` is `#geo-notification-icon` (not null, not the tab), and that
       node passes `checkVisibility`;
     - the bar stays revealed while the prompt is open;
     - after "Block", the bar collapses;
     - the prompt is never dismissed by the reveal or the hide.
  6. Identity panel while hidden: it opens anchored to `#identity-icon-box` and keeps the bar
     shown until it closes.
  7. Add-on popup while hidden:
     - a test extension with a browserAction popup, pinned to the toolbar, then in the extensions
       menu;
     - `ctrl+b e` → `Enter` opens it anchored to its button, then to `#unified-extensions-button`;
     - the bar stays shown while it is open;
     - `Esc` closes it and the bar collapses;
     - also via the add-on's own `_execute_action` shortcut (decision 7d).
  8. Hiding with focus in the URL bar moves focus to the page first (decision 14).
  9. Safety net (decision 13): stub the reveal to fail. Focusing the URL bar writes the pref back
     to shown, the notice says so, and the URL bar is focused.
  10. Exclusions: a `window.open` popup window keeps its URL bar; customize mode shows the bar;
      F11 fullscreen uses Firefox's own toolbox; DOM fullscreen is unaffected.
  11. Status bar:
      - with the bar hidden, an `http:` test page shows `not secure` and an `https:` one does not;
      - a private window shows `private`;
      - with the bar shown, neither appears.
  12. Config: `[ui] toolbar = "hidden"` hides it after the poll. A toggle then lasts until that
      line changes.
  13. a11y: with the bar hidden, the collapsed `#urlbar` has no accessible. The notice reaches the
      polite region.
  14. Hover: synthesized mouse at `y = 0` reveals after the delay, and leaving hides.
- **e2e:**
  - No existing baseline changes, because the default is shown (decision 12 keeps the status bar
    identical).
  - Add a scenario `tests/e2e/scenarios/toolbar-hidden.json`:
    - `ctrl+b u`;
    - a screenshot baseline `tests/e2e/baselines/toolbar-hidden.png`: the page reaching the top
      edge and the status bar below;
    - `I` and a typed address, a screenshot-free check that the URL bar has focus, `Enter`.
  - The new baseline needs its changelog line (see below).

## Docs and changelog the implementation must update

- **`docs/guide.md`:**
  - a "Hiding the toolbar" section: `ctrl+b u`, `:toolbar`, `[ui] toolbar`, the reveal on focus
    and on hover, `Esc`, popups and permission prompts showing the bar, the `not secure` and
    `private` status bar segments, and window controls under CSD;
  - the `config.toml` reference gains `[ui]`;
  - the Add-ons "Popups" paragraph notes the toolbar shows while a popup is open.
- **`docs/bindings.md`** and `packages/vimma-core/defaults.toml`: `npm run gen-docs`.
- **README feature list:** one line ("hide the toolbar; it comes back when you need the address
  bar").
- **CHANGELOG `[Unreleased]`:** added by the maintainer at merge time, per CLAUDE.md. Suggested
  lines:
  - "Added: `ctrl+b u` and `[ui] toolbar` hide the toolbar; it shows again whenever the address
    bar, a popup or a permission prompt needs it."
  - "Added: e2e baseline `toolbar-hidden.png` for the hidden toolbar."

## Out of scope

- Hiding the status bar.
- A per-window or per-workspace toolbar state.
- A floating, centred URL bar (Zen's `floating-on-type`).
- Moving the tab strip pref into `[ui]`.
- Changing `Esc` in the URL bar while the toolbar is shown.

## Open questions for the user

1. **Key:** `ctrl+b u` (free, "URL bar"), or `ctrl+b t` ("toolbar", which needs two test files
   and the guide's example moved to another unbound key)?
2. **Hover at the top edge:** on, as decided (decision 9), or keyboard-only, with hover behind a
   pref?
