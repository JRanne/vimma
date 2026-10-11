# Spec: toolbar-toggle

Status: ready (not started) · Milestone: after M5 (builds on [m0-tabstrip-hidden](m0-tabstrip-hidden.md),
the status bar of [m2-statusbar-whichkey](m2-statusbar-whichkey.md) and the config of
[m5-config-load](m5-config-load.md)) · Area: `packages/vimma-core/src/actions.mjs`,
`defaults.mjs`, `config.mjs`, `cmdline.mjs`, `statusbar.mjs`; `ui/toolbar.mjs` (new),
`ui/statusbar.mjs`, `host/VimmaHost.sys.mjs`, `host/addon-ops.mjs`,
`config/ConfigHost.sys.mjs`, `browser/themes/shared/vimma/toolbar.css` (new). No upstream patch.

Revised 2026-10-11 after the user's answers (below): the key is decided, and focusing the URL bar
now shows a minimal bar (the URL field only), not the whole toolbar.

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

The user's answers to the first draft: "go with ctrl + b u, what happens if i want to access
toolbar when it's hidden? there should be some minimalistic bar that shows what i'm writing".

## User stories

- As a user, `ctrl+b u` hides the toolbar in every window. The window is then the pages and
  Vimma's status bar, which already shows the page's URL. `ctrl+b u` again brings the toolbar
  back. The notice says "toolbar hidden" or "toolbar shown", and a screen reader hears it.
- As a user, with the toolbar hidden, `I`, `ctrl+l`, `alt+d`, `F6`, `t`, `ctrl+t`, `ctrl+b c`,
  a new pane, and the start page all still give me a focused address bar. A minimal bar appears
  over the top of the page: only the URL field, with the site's identity icon (lock or "not
  secure"), the text I type, and Firefox's suggestions below it. No back, forward or reload, no
  add-on buttons, no bookmarks toolbar, no window controls. The page does not jump. When I press
  `Enter` the page loads, focus goes to it, and the bar hides again. `Esc` gives up and hides it
  too.
- As a user, moving the pointer to the window's top edge shows the whole toolbar, for the
  buttons and the window controls.
- As a user, `[ui] toolbar = "hidden"` in `config.toml` starts every window with the toolbar
  hidden.
- As a user, `:toolbar` toggles it, and `:toolbar show` / `:toolbar hide` set it, so
  `vimma-ctl` scripts can set it as well.
- As a user, `ctrl+b e` → `Enter` on an add-on still opens its popup under its button. The
  whole toolbar shows for as long as the popup is open.
- As a user, when a site asks for a permission (camera, location, notifications) while the
  toolbar is hidden, the minimal bar shows. The prompt points at the address bar's icon, next to
  the site's identity, exactly as with the toolbar shown. It never appears unattributed in a corner.
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

- **What `#nav-bar` holds** (`navigator-toolbox.inc.xhtml` 109–541):
  - outside the customizable target: the taskbar-tab favicon, titlebar spacers, the overflow
    button, `#PanelUI-button` (app menu), the private-browsing indicator and the titlebar
    buttons;
  - in `#nav-bar-customization-target`: back, forward, stop/reload, `#urlbar-container`,
    downloads, `#unified-extensions-button`, and whatever the user customised in;
  - inside `#urlbar` (and so inside `#urlbar-container`): `#identity-box` (lock, "not secure",
    site name), `#trust-icon-container`, `#notification-popup-box` (every permission prompt's
    anchor icon, `#geo-notification-icon` and the rest), the blocked-permission icons and
    `#page-action-buttons` (star, reader view).
- **The URL field's layout in this engine:**
  - `#urlbar-container` is `flex: 400 0 auto` with a `--urlbar-container-min-width` of 140–310 px
    (`urlbar.css` 14–83, 622–654).
  - There is no `breakout-extend` any more (Zen still has it). The results view is a top-layer
    popover (`popover="manual"`), placed with CSS anchor positioning (`position-anchor:
--urlbar-anchor; position-area: block-end center`, `urlbar.css` 350, 546–563), so it always
    opens below the field, with no flip.
  - `UrlbarInputBase` allows the popover only when the field is inside a toolbar
    (`#popoverAllowed = … !!this.closest("toolbar")`, lines 594–600). Moving `#urlbar` out of
    `#nav-bar` would leave it without a suggestions view.
- **Overflow:** `OverflowableToolbar` (`CustomizableUI.sys.mjs` 7505 on) re-measures the nav bar
  only on window `resize` (`#onResize`, 8377), summing children's `getBoundingClientRect` widths
  and skipping `display: none` and positioned ones (`#getOverflowInfo`, 8019–8075). Items hidden
  with `visibility: hidden` keep their box, so the measurement does not change. Collapsed or
  `display: none` items would let a resize pull overflowed buttons back, and those would then
  overflow the bar when it is shown in full again.
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
- **Floating URL bar** (`zen-omnibox.css` 482–520, `zen.urlbar.behavior = "floating-on-type"`):
  on typing, `#urlbar[open][zen-floating-urlbar]` is positioned in place (`left: 50%`, a fixed
  width, `z-index: 1000`) without moving it in the DOM. Zen still has `breakout-extend`; this
  engine has the popover view instead, so Zen's styling does not carry over, but its principle
  does: restyle the field where it lives, never re-parent it.
- **Other:** `Esc` blurs the floating URL bar to the page. The toggle is `Accel+S`. In DOM
  fullscreen the wrapper is collapsed.

## Decisions

1. **Key: `ctrl+b u`**, the user's decision ("go with ctrl + b u"; `prefix+u`, mnemonic "URL
   bar"). It runs `toggle_toolbar`
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
7. **Reveal, as an overlay, in two sizes.**
   - While any reason in the window's reveal set holds, the root gets `vimma-toolbar-revealed`
     and the bar shows. Each reason asks for one of two sizes, and the largest asked for wins:
     - **minimal** (root attribute `vimma-toolbar-minimal` as well): only the URL field
       (decision 7a below);
     - **full**: `#nav-bar` and `#PersonalToolbar` as they are when shown.
   - Either size shows over the top of the content area, as Zen and the F11 toolbox do. Pages are
     not resized: no reflow, no `resize` event in the page, no jump. Zen's negative `margin-top`
     on the content is the reference technique. The mochitest's "page height unchanged" check
     (test plan) is the contract, not the technique.
   - Reasons, and the size each asks for:
     - **a. URL bar → minimal:** `beforefocus` / `beforeselect` on `#urlbar`, the same hook
       Firefox uses for F11. This adds the reason synchronously, before `focus()` runs, so focus
       lands on a laid-out field. Every path in Research → URL bar paths, and the start page, goes
       through it, with nothing to list or keep in sync. The reason holds while `#urlbar` has
       focus (`gURLBar.focused`) or its results view is open.
     - **b. Focus inside the bar → the size it is in:** `focusin` on `#nav-bar`. In the minimal
       bar only the field and its own icons can take focus. Once the full bar shows, the keyboard
       can reach its buttons, and the reason then holds the full size while focus is in one.
     - **c. Doorhangers → minimal or full by anchor:** `PopupNotificationsBeforeAnchor` bubbling
       up to `#nav-bar` adds the reason before `getVisibleAnchorElement` checks the anchor (the
       pattern Firefox uses for its own extensions button). An anchor inside `#urlbar` asks for
       minimal: every permission prompt (`#notification-popup-box`'s icons) and `#identity-icon`.
       Any other anchor asks for full: `#unified-extensions-button` for add-on install and
       permission prompts, `#PanelUI-menu-button` for the app menu's update doorhangers. The
       reason holds until `PopupNotifications.panel` fires `popuphidden`.
     - **d. Panels anchored in the bar → minimal or full by anchor:** a capture-phase
       `popupshowing` whose `anchorNode` or `triggerNode` is inside `#nav-bar` adds the reason,
       held until that popup's `popuphidden`, as F11's `_setPopupOpen` does. Inside `#urlbar`
       (the identity, permission and protections panels, page actions) asks for minimal.
       Elsewhere asks for full: downloads, the extensions menu, the app menu, browserAction
       popups (including an add-on's own `_execute_action` shortcut). `popupshowing` fires before
       the popup is positioned; the mochitest proves the popup lands under its button, and the
       picker path (decision 10) reveals before opening in any case.
     - **e. Hover → full:** see decision 9.
     - **f. Add-on picker → full:** see decision 10.
   - A switch from minimal to full while the field is focused (hover while typing, say) keeps
     focus, the typed text and the open suggestions: the field does not move (decision 7a).
   - On every change to the set or the size, the host calls
     `UpdatePopupNotificationsVisibility()`, so doorhanger anchors are re-evaluated.

7a. **The minimal bar.**

- **What shows:** `#urlbar-container` and everything inside `#urlbar`:
  - the identity box (lock, "not secure", site name);
  - the trust and remote-control icons;
  - the permission anchor icons in `#notification-popup-box`, and the blocked-permission icons;
  - page actions;
  - the text being typed, and Firefox's suggestions view below it.
- **What does not:** `#PersonalToolbar`, and every other item of `#nav-bar` and its
  customization target:
  - back, forward, stop/reload, home, downloads;
  - `#unified-extensions-button`, the overflow button, `#PanelUI-button`;
  - anything the user customised in;
  - the private-browsing indicator, the titlebar buttons and spacers.
- **How:** a CSS rule on `:root[vimma-toolbar-minimal]` gives those items `visibility: hidden`.
  `#nav-bar` itself is shown (no longer collapsed) with its theme background, and
  `#urlbar-container` keeps `visibility: visible`.
  - `visibility: hidden`, not collapse or `display: none`: the hidden items keep their boxes, so
    the URL field sits exactly where it sits in the full toolbar and at the same width.
    - A minimal-to-full switch never moves the field under the user's typing.
    - The urlbar's width-dependent layout (`--urlbar-container-min-width`) is untouched.
    - `OverflowableToolbar`'s measurement (Research → Overflow) stays the same, so a reveal
      never pulls a button out of the overflow menu or pushes one in.
  - Hidden items:
    - are not painted;
    - cannot take focus;
    - are out of the accessibility tree;
    - fail `checkVisibility({ visibilityProperty: true })`.

    Nothing anchors to them while the bar is minimal: a reason that needs one asks for full first
    (7c, 7d).

  - No CustomizableUI call and no DOM move. `#urlbar` stays inside `#nav-bar`, which its
    suggestions popover needs (`#popoverAllowed` needs `closest("toolbar")`).
  - **Rejected:**
    - Moving or re-parenting `#urlbar` into a bar of our own. It would lose the popover view and
      the anchors' place, and break the assumptions of every Firefox urlbar test.
    - Collapsing the other items so the field takes the whole width. The field would jump on a
      switch to full, and the overflow measurement would drift (see Research).
- **Look:** the nav bar's own height and background, and the URL field's own styling, which the
  theme already colours (theme-host). It spans the window's full width, as the toolbar does.
  - Not the status bar's height: shrinking the field would shrink the identity and permission
    icons, which are the prompts' anchors and the site's attribution.
- **Place: the top**, where the URL bar always is. Not at the bottom by the status bar, like the
  `:` command line:
  - **Anti-spoofing:** the site's identity and the address are where Firefox users expect them.
    Firefox's own permission prompts hang down from their icon. A page cannot draw over the chrome
    above the content area.
  - **Suggestions:** the view opens downward (`position-area: block-end`) with no fallback, so a
    bar at the bottom would push its suggestions off the window.
  - **One bar:** the full toolbar on hover appears in the same place, so the two sizes are one
    bar.

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
     shown at the size it asked for (decision 7c/d). When a full-size reason ends while a
     minimal one still holds, the bar becomes minimal, not hidden. The bar is never collapsed under an open arrow panel, so
     `CheckForAnchorChange` never closes or dismisses a prompt because of us.
9. **Hover reveals the full toolbar; not keyboard-only.** The user did not object to hover in
   the first draft, so it stays on.
   - Pointer at the window's top 2 px, or over the revealed bar, adds a full-size hover reason. It is added
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
10. **Add-on popups show the full toolbar.**
    - `openAddonPopup` adds a full-size "popup" reason before `triggerAction`, held until the popup or the
      extensions menu closes.
    - The popup therefore opens under its own button, or in the extensions menu, as with the
      toolbar shown, and the user sees which add-on it is.
    - The minimal bar would not do: those anchors are outside `#urlbar`.
    - No fallback anchor is invented. Firefox's extension popups are built to hang from their
      button.
    - Decision 7d covers the paths Vimma does not run (an add-on's own shortcut,
      `browserAction.openPopup()`).
11. **Permission prompts and security.**
    - Decision 7c is the security decision. A prompt always shows anchored to its icon in the URL
      bar, with the identity box (lock, site) beside it and the page's address in the field. That
      is exactly the attribution Firefox gives with the toolbar shown.
    - The minimal bar is enough: every permission prompt's anchor and the identity box are inside
      `#urlbar`.
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
    - The overlay, minimal or full, spans the window's width, as the bar does.
    - The focused pane's accent outline says which pane it belongs to.
    - A new pane (`ctrl+b v`, `ctrl+b enter`) focuses the URL bar through `gURLBar.select()`, so
      reason (a) covers it.
16. **The find bar** is per browser, at the bottom of the content. It is unaffected and never
    covered by the overlay.
17. **Window controls (CSD):** hidden with the bar, in the minimal bar too, and shown with
    the full toolbar on hover (decision 9). The guide says so. On Omarchy, with server-side or no decorations, nothing
    changes.
18. **Accessibility** (m7-a11y):
    - The toggle's notice ("toolbar hidden" / "toolbar shown") is announced through the polite
      live region.
    - A collapsed bar is out of the accessibility tree.
    - A reveal for focus is not announced, minimal or full. The focused URL bar is announced by the screen reader
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
  2. The minimal bar on focus:
     - for each of `I`, `ctrl+l`, `F6`, `t`, `ctrl+b c` and `ctrl+b v`, the URL bar is focused,
       `checkVisibility()` is true, and the root has `vimma-toolbar-minimal`;
     - only the URL field shows:
       - `#identity-box` and `#urlbar-container` pass `checkVisibility`;
       - `#back-button`, `#stop-reload-button`, `#unified-extensions-button`, `#PanelUI-button`,
         the titlebar buttons and `#PersonalToolbar` fail it;
     - typing shows in the field (`gURLBar.value`);
     - the suggestions view opens below the field (`:popover-open`, its top at or below the
       field's bottom); `Down` selects a row, and `Enter` on it loads that row's page;
     - `#urlbar-container`'s rectangle is the same as with the full toolbar shown (no jump);
     - the selected browser's height and `innerHeight` are unchanged (overlay, no resize event in
       the page).
  3. `Enter` on a typed address: the page loads, focus is in the page, and the bar is collapsed
     again.
  4. `Esc`:
     - after typing, the first `Esc` reverts, as in Firefox, and the bar stays;
     - the next `Esc` focuses the page and the bar collapses.
  5. Permission prompt while hidden:
     - a test page requests geolocation;
     - the bar is minimal (`vimma-toolbar-minimal`), not full;
     - the prompt's `anchorNode` is `#geo-notification-icon` (not null, not the tab), and that
       node and `#identity-icon` pass `checkVisibility`;
     - the bar stays revealed while the prompt is open;
     - after "Block", the bar collapses;
     - the prompt is never dismissed by the reveal or the hide.
  6. Identity panel while hidden: it opens anchored to `#identity-icon-box` in the minimal bar,
     and keeps that bar shown until it closes.
  7. Add-on popup while hidden:
     - a test extension with a browserAction popup, pinned to the toolbar, then in the extensions
       menu;
     - `ctrl+b e` → `Enter` shows the full toolbar (no `vimma-toolbar-minimal`) and opens the
       popup anchored to its button, then to `#unified-extensions-button`;
     - the full bar stays shown while it is open;
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
  14. Hover:
      - a synthesized mouse at `y = 0` shows the full toolbar after the delay: the back button
        and the app menu pass `checkVisibility`;
      - leaving hides it;
      - hovering while the minimal bar has focus and typed text switches to full without moving
        the field or losing focus or the text.
  15. Overflow: with enough buttons customised in to overflow, revealing minimal and then full
      leaves the same items in the overflow menu as before.
  16. Mixed sizes: a minimal reason (URL bar focused) and a full one (downloads panel) together
      show full. Closing the panel leaves the minimal bar, not a hidden one.
- **e2e:**
  - No existing baseline changes, because the default is shown (decision 12 keeps the status bar
    identical).
  - Add a scenario `tests/e2e/scenarios/toolbar-hidden.json`:
    - `ctrl+b u`;
    - a screenshot baseline `tests/e2e/baselines/toolbar-hidden.png`: the page reaching the top
      edge and the status bar below;
    - `I` and a typed address;
    - a second baseline, `tests/e2e/baselines/toolbar-minimal.png`: the minimal bar with the
      typed text (suggestions off in the e2e profile, so the shot is stable);
    - `Enter`.
  - The new baselines need their changelog line (see below).

## Docs and changelog the implementation must update

- **`docs/guide.md`:**
  - a "Hiding the toolbar" section covering:
    - `ctrl+b u`, `:toolbar` and `[ui] toolbar`;
    - the minimal bar on URL bar focus: what it shows and what it does not;
    - the full toolbar on hover, and for add-on popups and toolbar-button panels;
    - `Esc`;
    - permission prompts showing the minimal bar;
    - the `not secure` and `private` status bar segments;
    - window controls under CSD;
  - the `config.toml` reference gains `[ui]`;
  - the Add-ons "Popups" paragraph notes that the full toolbar shows while a popup is open.
- **`docs/bindings.md`** and `packages/vimma-core/defaults.toml`: `npm run gen-docs`.
- **README feature list:** one line ("hide the toolbar; it comes back when you need the address
  bar").
- **CHANGELOG `[Unreleased]`:** added by the maintainer at merge time, per CLAUDE.md. Suggested
  lines:
  - "Added: `ctrl+b u` and `[ui] toolbar` hide the toolbar; typing an address shows a minimal
    bar with only the URL field, and the full toolbar comes back on hover and for add-on popups."
  - "Added: e2e baselines `toolbar-hidden.png` and `toolbar-minimal.png` for the hidden toolbar
    and its minimal URL bar."

## Out of scope

- Hiding the status bar.
- A per-window or per-workspace toolbar state.
- A floating, centred URL bar (Zen's `floating-on-type`), or a minimal bar at the bottom.
- A minimal bar shorter than the URL field (the status bar's height).
- Moving the tab strip pref into `[ui]`.
- Changing `Esc` in the URL bar while the toolbar is shown.

## Open questions for the user

None blocking. Decided by default, open to change:

- **Hover at the top edge** shows the full toolbar (decision 9). The user did not object in the
  first round. If it gets in the way, it can go behind a pref.
