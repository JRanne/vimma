# Spec: m2-tab-keys

Status: implemented, awaiting review · Milestone: M2 (prototype slice) · Area: host
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
  that build an overlay by hand) nothing is marked.
- **One source of truth:** `RUNNABLE = new Set(Object.keys(RUNNERS))`, exported by the host.
  `_dispatch` uses it to pass or consume, `_run` shows the notice for what is not in it, and the
  overlay dims what is not in it.
- No upstream patch, no build-config change, no new dependency. Two new chrome files and one
  stylesheet in our `jar.mn`.

## Tests (written first)

- `packages/vimma-core/test/tabs.test.mjs`: wrapping, single tab, goto, goto past the end, counts
  (`Ngt`, `NgT`), degenerate input; `describeAction` / `notImplementedText`.
- `tests/browser/browser_vimma_tab_keys.js`: each key on `gBrowser` (count, `selectedTab`),
  wrapping both ways, hidden tabs skipped, `ctrl+b 9` past the end a silent no-op, from the URL bar
  (nothing typed into it) and from `about:preferences`; every page sees none of the chord keys;
  the notice for `ctrl+b v` (text, `role`, no focus taken, hides by itself after > 1 s); no notice
  for a passed-through `Esc`.
- `browser_vimma_help_overlay.js`: rows marked from the host's set (implemented and not-yet),
  computed opacity, the legend; a given `runnable` set decides the marks. The old "unrunnable key
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
  layer).
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
- **`tab.close`** calls `gBrowser.removeCurrentTab({ animate: true })`: it closes a pinned tab too
  (an explicit command; `ctrl+w`'s "select the first unpinned tab instead" applies to
  `BrowserCommands.closeTabOrWindow` with a modifier event only), and the last tab closes the
  window when `browser.tabs.closeWindowWithLastTab` is true, as `ctrl+w`. Multi-selection is not
  reachable with the strip hidden, so only the selected tab is closed.
- **The notice is a `popover="manual"`**, not a `<dialog>` or a positioned element under
  `#browser`: the top layer puts it above remote content and the modal help overlay, and
  `showPopover()` does not move focus (asserted). One element per window, removed on
  `VimmaHost.uninit`; the stylesheet is loaded once per window, as the overlay's.
- **The overlay dims in the UI**, not through `bindingTable`: PR #22 (core M2, unmerged) adds
  `bindingTable(keymap, { runnable })` and `isRunnable(id, runnable)` (`runnable.has(id)`, the
  same rule). After it merges, switch `HelpOverlay` to it; the marks and tests stay.
- **M3 seam.** `host/tab-ops.mjs` `selectableTabs(win)` is the only place that decides which tabs
  the keys count. M3 returns the active workspace's tabs in its model order (m3-m4-core-models
  `selectTab`/`openTab`/`closeTab`) and routes `tab.new`/`tab.close` through the model; the
  runners and tests keep their shape.
- **Race-free page-key checks** (#14, #18): `head.js` from the flaky fix (#24). Each tab awaits
  `recordPageKeys`, then `focusContent`; then the key; then `waitForPageKey` for a sentinel `j`
  and `pageKeys`. Never `waitForContentEvent` before a key.
- **After merging main** (lanes #20, flaky fix #24, M1 core #21, updater #15): full
  `tests/browser/` 300/0 on the artifact build.
- **Verified:** red (host without the runners): 45 passed / 10 failed (no tab opened, `n` did not
  move, digits did not select, `shift+x` timed out); overlay red 32/15 (no marks, no legend).
  Green: `browser_vimma_tab_keys.js` + `browser_vimma_help_overlay.js` 130/0. Mutation:
  `tabTarget`'s `tab.next` without wrap (`Math.min(current + 1, length - 1)`) fails "ctrl+b n on
  the last tab wraps to the first" (and, from the wrong tab, the `p` assertion after it); reverted.
