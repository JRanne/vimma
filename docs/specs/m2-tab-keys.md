# Spec: m2-tab-keys

Status: implemented · Milestone: M2 (prototype slice) · Area: host
(`src/browser/base/content/vimma/host/`), UI (`ui/notice.mjs`, `ui/help-overlay.mjs`), core
(`tabs.mjs`, `actions.mjs`)

## User story

As a user, the Herdr tab keys work over Firefox's tabs: `ctrl+b c` opens a tab, `ctrl+b n`/`p`
cycle, `ctrl+b 1..9` jump to tab N and `ctrl+b shift+x` closes the tab, from any page, the URL
bar and `about:preferences`. A binding that does not run yet is never silent: it says so for a
moment, and the `ctrl+b ?` overlay shows at a glance which bindings run today.

## Scope

- **Tab keys** (plan §2 rows that need only `gBrowser`): `new_tab` (`tab.new`), `next_tab`
  (`tab.next`), `previous_tab` (`tab.previous`), `select_tab_1..9` (`tab.goto`, arg 1..9),
  `close_tab` (`tab.close`). Runners in `VimmaHost.sys.mjs`'s `RUNNERS`, by id, so the modal
  bindings `t`, `x`, `gt`, `gT` and `3gt` run the same code once M1's `normal` mode exists.
- **Core:** `tabs.mjs` `tabTarget(action, current, length)` (which index a selection lands on);
  `actions.mjs` `describeAction(action)` and `notImplementedText(action)`.
- **Host:** `host/tab-ops.mjs` (`newTab`, `closeTab`, `selectTab`, `selectableTabs`) over plain
  `gBrowser`. `selectableTabs` is the M3 seam (below).
- **Notice:** `ui/notice.mjs` + `browser/themes/shared/vimma/notice.css`: one `div#vimma-notice`
  per window, `popover="manual"` in the chrome document, `role="status"`, `aria-live="polite"`,
  bottom right, `pointer-events: none`, hidden after `NOTICE_MS` = 1500 ms; a new message replaces
  the old and restarts the timer.
- **Overlay:** `HelpOverlay(win, keymap, runnable)`; rows get `data-runnable="true|false"`,
  not-yet rows are dimmed (`opacity: 0.45`) and carry `aria-description="not implemented yet"`;
  a legend "Dimmed rows: not implemented yet" sits under the header. Without `runnable` (tests
  that build an overlay by hand) every row counts as runnable, as core's default, and there is
  no legend.
- **One source of truth:** `RUNNABLE = keys(RUNNERS) ∪ keys(CONTENT_RUNNERS)` (m1-actor-insert-
  scroll's page actions), exported by the host. The overlay dims what is not in it, `_run` shows
  the notice for what is not in it, and the which-key strip takes it when wired.
  `_runnable(state, id)` (pass or consume) derives from it, adding "the focused browser has our
  actor" for content actions. Scroll keys, `i` and `Esc` are therefore never dimmed.
- **`_run` order:** content runner (on the focused page, if it has our actor; a content action
  elsewhere does nothing), then host runner (`state.win` carries the window), then the notice.
- No upstream patch, no build-config change, no new dependency. Two new chrome files and one
  stylesheet in our `jar.mn`.

## Tests (written first)

- `packages/vimma-core/test/tabs.test.mjs`: wrapping, single tab, goto, goto past the end, counts
  (`Ngt`, `NgT`), degenerate input; `describeAction` / `notImplementedText`.
- `tests/browser/browser_vimma_tab_keys.js`: each key on `gBrowser` (count, `selectedTab`),
  wrapping both ways, hidden tabs skipped, `ctrl+b 9` past the end a silent no-op, from the URL bar
  (nothing typed into it) and from `about:preferences`; every page sees none of the chord keys;
  the notice for `ctrl+b v` (text, `role`, no focus taken, hides by itself after > 1 s) and for
  `3H`; none for a passed-through `f` or `Esc`, none in DOM fullscreen; `ctrl+b p`/`c` from the
  PDF viewer; pinned tabs first in the order and not closed by `ctrl+b shift+x`/`x`; normal-mode
  `t`, `x`, `gt`, `gT`; the last tab closing the window, or not with
  `browser.tabs.closeWindowWithLastTab` false.
- `browser_vimma_help_overlay.js`: rows marked from the host's set (implemented and not-yet),
  computed opacity (scroll, `i` and `Esc` rows not dimmed), the legend; a given `runnable` set
  decides the marks. The old "unrunnable key
  inside a prefix sequence is consumed" test now uses `ctrl+b v` (split, M4) instead of `ctrl+b c`,
  which runs now; the assertion is unchanged.

## Out of scope

`rename_tab` (M2, label persistence), the `ctrl+b g` picker, the status bar and which-key strip
(M2, other specs), workspaces and hidden-tab bookkeeping (M3), Herdr's `move_tab_*` (not in our
action set).

## Settled (2026-10-09)

- **Unimplemented actions.** A completed `ctrl+b` sequence whose action the host cannot run is
  consumed **and** shows "<description>: not implemented yet" (e.g. "Split right: not implemented
  yet"). A single-key binding the host cannot run, outside a sequence and outside help (`Esc` →
  `mode.normal`, `ctrl+i`, `ctrl+u`), still passes to Firefox **with no notice**, so typing and
  Firefox's own shortcuts are not disrupted. This keeps m0-help-overlay's deviation as it is; the
  notice is added only on the path that already consumed the key (`_run`, also reached by a
  `replay` and by the ambiguity timeout). Unbound keys after the prefix stay a silent `pass`
  (consumed, no notice): there is no action to name. In help mode an unimplemented prefix action
  is consumed (modal) and shows the notice above the overlay (popover after the dialog in the top
  layer). A count makes the next key part of a sequence: `3H` (history.back, not built) is
  consumed and shows the notice; a count before an unbound key (`3z`) is cancelled by core with
  no action to name, so it stays silent. After #32, single keys that pass are `f`, `/`, `r`,
  `ctrl+i`, `ctrl+u` and the like; `Esc` in normal mode is unbound and reaches the page.
- **Selection order: visible tabs, wrapping.** `prefix+n`/`p` and `prefix+1..9` count
  `gBrowser.visibleTabs` (hidden tabs skipped). Herdr's docs do not say; its source does
  (`src/client/shell/actions.rs`): `NextTab`/`PreviousTab` use `rem_euclid` over the focused
  workspace's tabs (wrap), and `SwitchTab(index)` is `tabs.get(index)?` (nothing when out of
  range). We do the same. Selection sets `gBrowser.selectedTab` rather than
  `tabContainer.advanceSelectedTab`, so the order is exactly `selectableTabs` (the M3 seam) and not
  the strip's own (tab-group label) traversal.
- **`prefix+1..9` past the last tab: silent no-op**, as Herdr. The notice means "this binding is
  not built yet"; using it for "no tab 7" would blur that, and the status bar's `tab 2/5` (M2)
  will show the count.
- **Counts (normal mode, M1):** `Ngt` goes to tab N (nothing when N is too large), `NgT` goes back
  N tabs, wrapping, as Vim. Prefix sequences carry no count today.
- **`tab.new`** calls `BrowserCommands.openTab()`, Firefox's `ctrl+t` path: the new-tab page (the
  harness's prefs make it `about:blank`, so the test waits for `TabOpen`, not
  `waitForNewTab`), appended at the end, URL bar focused.
- **`tab.close` behaves like Firefox's `ctrl+w`** (review round 1; `closeTabOrWindow` with a
  modifier event, browser-commands.js:377-388): on a pinned tab it
  selects the first unpinned tab instead of closing; otherwise `gBrowser.removeCurrentTab` with
  `animate` and ctrl+w's keyboard `metricsContext`, and the last tab closes the window unless
  `browser.tabs.closeWindowWithLastTab` is false (M3 sets it false). Multi-selection is not
  reachable with the strip hidden, so only the selected tab is closed.
- **Normal-mode tab keys go live with #32:** `t`, `x`, `gt`, `gT` (and `3gt`) run the same
  runners. On a page without our actor (the new-tab `about:blank`, extension pages) the tab is in
  insert, so these bare keys reach the page; `ctrl+b` works everywhere.
- **No notice in DOM fullscreen** (a video): `Notice.show` returns while the chrome root has
  `inDOMFullscreen` (set by browser-fullScreenAndPointerLock.js), as Firefox hides its own chrome
  there. The key is still consumed.
- **The notice is a `popover="manual"`**, not a `<dialog>` or a positioned element under
  `#browser`: the top layer puts it above remote content and the modal help overlay, and
  `showPopover()` does not move focus (asserted). One element per window, removed on
  `VimmaHost.uninit`; the stylesheet is loaded once per window, as the overlay's.
- **The overlay marks rows through core's `bindingTable(keymap, { runnable })`** (M2 core, #22):
  `isRunnable` is the same rule the which-key strip will use, so the strip can take the host's
  `RUNNABLE` too when it is wired.
- **M3 seam.** `host/tab-ops.mjs` `selectableTabs(win)` is the only place that decides which tabs
  the keys count. M3 returns the active workspace's tabs in its model order (m3-m4-core-models
  `selectTab`/`openTab`/`closeTab`) and routes `tab.new`/`tab.close` through the model; the
  runners and tests keep their shape.
- **Race-free page-key checks** (#14, #18): `head.js` from the flaky fix (#24). Each tab awaits
  `recordPageKeys`, then `focusContent`; then the key; then `waitForPageKey` for a sentinel `z`
  (unbound; `j` scrolls in normal mode since #32) and `pageKeys`. Never `waitForContentEvent`
  before a key.
- **After merging main** (lanes #20, flaky fix #24, M1 core #21, updater #15, M2 core #22): full
  `tests/browser/` 300/0 on the artifact build; after the split spike and vimma-ctl, 534/0.
- **Verified:** red (host without the runners): 45 passed / 10 failed (no tab opened, `n` did not
  move, digits did not select, `shift+x` timed out); overlay red 32/15 (no marks, no legend).
  Green: `browser_vimma_tab_keys.js` + `browser_vimma_help_overlay.js` 130/0. Mutation:
  `tabTarget`'s `tab.next` without wrap (`Math.min(current + 1, length - 1)`) fails "ctrl+b n on
  the last tab wraps to the first" (and, from the wrong tab, the `p` assertion after it); reverted.
- **Reconciled with #32 (actor, insert, scroll):** merged with rerere off, every conflict by hand.
  New tests passed on the first run, so mutations stand in for red: dropping the pinned branch of
  `closeTab` fails "ctrl+b shift+x on a pinned tab closes nothing - 3 == 4"; dropping the
  fullscreen check fails "no notice over a fullscreen video"; both reverted. Full
  `tests/browser/` 697/0 on the artifact build.
