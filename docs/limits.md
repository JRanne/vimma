# Known limits

Every known limit or gap of Vimma on `main`, one line each, with the spec, ADR or issue that
records it. Plan §9's open questions resolve to an ADR or a line here. When a limit is fixed,
delete its line in the same PR.

## Features

- Tab keys count Firefox's visible tabs: the current workspace's and any pinned tab.
- The first key of a sequence with nothing runnable under it passes through to the page or
  Firefox ([m1-actor-insert-scroll](specs/m1-actor-insert-scroll.md), Settled). `ctrl+w`'s pane keys run
  only with two panes or more, so with one pane `ctrl+w` closes the tab; with a split, in normal
  mode, it is Vim's window prefix and does not close the tab
  ([m4-split-panes](specs/m4-split-panes.md), sub-spec 3).
- Pages that take keys outside a text field (games, Google Docs' canvas, Figma) lose their bare
  keys to normal mode; press `i` to let every key through until `Esc`. Text editors are
  detected ([m1-actor-insert-scroll](specs/m1-actor-insert-scroll.md), Limits).
- Bare digits are counts in normal mode, so a page's own digit shortcuts need `i` first
  ([m1-actor-insert-scroll](specs/m1-actor-insert-scroll.md), Limits).
- Extension pages (`moz-extension:`), `data:`, `view-source:` and `blob:` pages have no content
  actor: they stay in insert, with no Vim keys ([m1-actor-insert-scroll](specs/m1-actor-insert-scroll.md),
  Settled).
- Closed shadow roots in pages are seen (the actor is privileged), but a page script that moves
  focus from a frame to the top page's `<body>` can leave insert on until `Esc`
  ([m1-actor-insert-scroll](specs/m1-actor-insert-scroll.md), Limits).
- `Esc` in a text field leaves insert and does not reach the page; press `Esc` again for the
  site's own `Esc` (closing an autocomplete or a dialog)
  ([m1-actor-insert-scroll](specs/m1-actor-insert-scroll.md), Settled).
- After `Esc` in a `designMode` page, it stays in normal until the next click into it
  ([m1-actor-insert-scroll](specs/m1-actor-insert-scroll.md), Settled).
- Command line: history is kept in memory only, until Vimma quits; arguments are not
  completed (URLs, workspace names); no
  `:set`, ranges or counts ([m1-cmdline](specs/m1-cmdline.md), Settled).
- `:q` and `ctrl+b x` close the tab: with no split panes yet, every tab is one pane
  ([m1-cmdline](specs/m1-cmdline.md), Settled).
- Link hints label only what the page has as elements: canvas and WebGL apps (Google Docs,
  Figma, maps, games) have nothing to label, and delegated click handlers with no role or
  listener of their own, image-map `<area>` links and pinch-zoomed pages are missed or
  misplaced ([m1-hints](specs/m1-hints.md), Limits).
- Hint labels are drawn for the layout at `f`; a page that scrolls itself while they show
  leaves them stale. Frames inside a CSS-transformed `<iframe>` get misplaced labels, and a
  frame that takes over 150 ms to answer (busy) gets none that time. `F` does not open `blob:`
  links ([m1-hints](specs/m1-hints.md), Limits).
- `config.toml` changes show up to 2 s late (the poll; `:source` is at once). Two saves within
  one millisecond that keep the file's size are seen as one. A workspace removed from
  `[workspaces]` stays, as a runtime workspace with its tabs and container.
  Only the first error is in the status bar (all are in the Browser Console and
  `about:vimma`). Overridden bindings are not marked in `ctrl+b ?`; `:source <path>` and `:config` do not
  exist ([m5-config-load](specs/m5-config-load.md)).
- An Omarchy theme change shows up to 2 s late: Vimma polls `colors.toml`'s stat every 2 s
  (Firefox has no portable file watcher; plan §3). A `theme-set.d` hook through the control
  socket could make it instant later ([m5-omarchy-theme](specs/m5-omarchy-theme.md), Limits).
- If the Omarchy theme directory disappears after a theme was shown (as during
  `omarchy-theme-set`'s swap), the colours stay until a theme is back; Tokyo Night only when no
  theme was found since startup or the last `vimma.theme.*` change
  ([m5-omarchy-theme](specs/m5-omarchy-theme.md)).
- `about:vimma` is read when it opens: `r` or Refresh updates it, it does not follow changes
  live. It is registered when the first window opens, so a session that restores an
  `about:vimma` tab before that shows Firefox's error page until reloaded. Its key log keeps
  the last 20 keys Vimma dispatched; keys the goto picker, the `/` search and the help filter
  take are not in it, and an ambiguous key resolved by its timeout shows as `…`. `:bug` copies
  to the clipboard only; it writes no file ([m5-about-vimma](specs/m5-about-vimma.md)).

## Find

- `?` searches forward while you type, as Firefox's find bar does; `Enter` then steps back to
  the last match before where the search started ([m1-find](specs/m1-find.md), Settled).
- `Esc` scrolls the page back, not a frame or an inner scroller it scrolled (pdf.js scrolls its
  own viewer: there `Esc` leaves the view at the match) ([m1-find](specs/m1-find.md)).
- In the PDF viewer `/`, `Enter`, `n` and `N` work through pdf.js, but the status bar shows no
  match count: pdf.js reports it to the find bar only ([m1-find](specs/m1-find.md)).
- A count before `n` (`3n`) searches once. `N` right after `Esc`, or after the page reloads,
  searches forward once: Firefox's finder has no previous match to step back from
  ([m1-find](specs/m1-find.md)).
- A search starts at the top-left corner of the viewport; a fixed header there makes it start at
  the header's place in the document ([m1-find](specs/m1-find.md)).

## Copy mode

- Copy mode works in the frame that has focus; a frame from another site needs a click first,
  and the caret does not cross from one frame into another
  ([m1-copy-mode](specs/m1-copy-mode.md)).
- `w` / `b` are Firefox's word steps: on Linux `w` stops at the end of a word, not at the start
  of the next as in Vim. No `e`, `W`, `B`, `o` or line-wise `V`
  ([m1-copy-mode](specs/m1-copy-mode.md)).
- `y` copies plain text only. Text inside text fields is not part of the page's selection: focus
  the field and use `ctrl+c` ([m1-copy-mode](specs/m1-copy-mode.md)).
- After the page navigates, the first copy-mode key only ends copy mode
  ([m1-copy-mode](specs/m1-copy-mode.md)).

## Tabs and window

- "List all tabs" (View menu, `#alltabs-button`, the `ctrl+tab` panel's "show all") is unavailable
  while the tab strip is hidden, until M2's `ctrl+b g` picker
  ([m0-tabstrip-hidden](specs/m0-tabstrip-hidden.md)).
- `ctrl+shift+tab` with `browser.ctrlTab.sortByRecentlyUsed` on does nothing while the strip is
  hidden ([m0-tabstrip-hidden](specs/m0-tabstrip-hidden.md)).
- `vimma.ui.tabstrip.hidden` has no Settings UI; use `about:config`
  ([m0-tabstrip-hidden](specs/m0-tabstrip-hidden.md)).
- The nav bar's drag region on GNOME (client-side decorations) has not been checked by hand
  ([m0-tabstrip-hidden](specs/m0-tabstrip-hidden.md)).

## Workspaces (M3, by design)

Workspaces are partly built (switching, not yet persistence); these are the limits their design
accepts
([m3-workspaces](specs/m3-workspaces.md)).

- Containers do not isolate history, bookmarks, form history, the downloads list, HSTS or site
  permissions: they are shared by every workspace, and the URL bar suggests other workspaces'
  history.
- Saved passwords are not per container: a login saved in one workspace autofills in all of them
  until the per-workspace `autofill` setting (M6).
- Moving a tab to another workspace reopens its URL in the other container: back/forward
  history, form data, scroll position and POST data are lost.
- Closing a workspace created at runtime deletes its container's cookies and site data, and its
  closed tabs cannot be reopened.
- Setting `privacy.userContext.enabled` to `false` closes every workspace tab and deletes all
  containers and their data (Firefox's behaviour).
- Deleting a workspace's container outside Vimma (Settings → Containers, an extension) deletes
  its cookies and site data; the workspace gets a new, empty container, and tabs an extension
  left open in the deleted one stay there, marked `foreign`.
- A corrupt `containers.json` makes Firefox reset containers; workspace logins can be lost and
  tabs come back marked `foreign`.
- Pinned tabs belong to no workspace: they show in every workspace, and a tab opened pinned
  stays in no container (decision 11 plans to unpin them). A tab sharing camera, microphone or
  screen cannot be hidden and stays visible in other workspaces while it shares.
- The `foreign` mark is kept but not shown until the workspace picker and side panel.
- Workspaces are saved with Firefox's session, so a crash loses what the session file has not
  caught yet: up to 15 seconds of changes while you are active, and up to an hour after 3
  minutes without input (`browser.sessionstore.interval.idle`). Tabs then come back in the
  workspace that owns their container, but a workspace's selected tab, its panes and new tab
  names may be older.
- A window saved by a newer Vimma keeps its saved workspaces untouched: this version starts it
  with its tabs sorted into workspaces by container, without its panes, and does not save over
  it.
- Tabs of hidden workspaces keep playing audio and are never unloaded automatically.
- Closing the last tab opens a new tab instead of closing the window
  (`browser.tabs.closeWindowWithLastTab` is `false`); setting it to `true` lets the window close
  with every hidden workspace in it.
- Restoring workspaces needs `browser.startup.page = 3` (Vimma's default); with any other value
  tabs are not restored and workspaces start empty.
- New tabs get no preloaded `about:newtab`: Firefox preloads only for tabs without a container,
  so Vimma turns preloading off (`browser.newtab.preload`). A new tab paints about 40 ms later
  than with a preload (measured 76 ms against 35 ms, median of 20).
- On a new profile the very first tab opens before the first workspace exists, so it has no
  container and is marked `foreign`; later tabs and windows open in the workspace's container.
- `browser.link.force_default_user_context_id_for_external_opens` sends links from other apps to
  the active workspace's container, not to "no container".
- Firefox Sync no longer syncs `browser.startup.page` or `privacy.userContext.enabled` to Vimma.
- After 3 minutes without input, the session is saved hourly, so a crash can lose an hour of
  changes made by pages (tabs they opened), as in Firefox.
- Private windows and popups have no workspaces.
- Firefox's sidebar keys (`ctrl+h`, `ctrl+alt+x`, `ctrl+alt+u`, `ctrl+alt+z`) still open its own
  sidebar beside Vimma's side panel; Firefox's four default containers stay in Settings.
- Extensions that hide or show tabs (`tabs.hide`) conflict with workspace visibility.

## Panes

- No split panes yet: `ctrl+b v`, `-`, `x`, `z`, `h/j/k/l` and resize mode are planned for M4
  ([m4-split-panes](specs/m4-split-panes.md)).
- Planned for M4: panes are resized from the keyboard only (resize mode); dividers cannot be
  dragged with the mouse, and tabs cannot be dropped onto a pane
  ([m4-split-panes](specs/m4-split-panes.md), Out of scope).
- Planned for M4: a pinned tab cannot be shown in a pane; Firefox's split view refuses pinned
  tabs, so Vimma unpins a tab before it joins a split
  ([ADR-013](adr/013-split-on-firefox-split-view.md)).
- Firefox's own split-view UI is off: the tab and link context-menu items and alt-click
  (`browser.tabs.splitView.enabled` false), the URL bar's split button and the tab-group items of
  a split (hidden by `split.css`); splits come from Vimma's keys
  ([ADR-013](adr/013-split-on-firefox-split-view.md)).
- At most `[panes] max` panes (default 4, up to 16) in a window: a further split is refused with
  "at most N panes". Every visible pane's page stays live, so each one costs memory and CPU;
  a zoomed-away pane is paused (its docshell inactive) until unzoom
  ([m4-split-panes](specs/m4-split-panes.md), sub-spec 2).
- A tab whose pane is closed stays open in its workspace rather than hidden.
- One split per workspace: a split made outside Vimma (Firefox's split-view command, an
  extension, a restored Firefox session) is adopted as a row of panes; a second one in the same
  workspace, or one whose tabs are in different workspaces, is separated with a notice. Firefox's
  `about:opentabs` tab in such a split closes when Vimma separates it, as in Firefox
  ([m4-split-panes](specs/m4-split-panes.md), sub-spec 6).
- The accessible name of the third pane on ("<title>, pane 3 of 4") is English only; Firefox
  names the first two panes "left" and "right" whatever the layout
  ([m4-split-panes](specs/m4-split-panes.md), sub-spec 2).
- Planned for M4: with three or more panes, extensions that move a split tab (`tabs.move`) and
  the all-tabs list's drag targets assume two tabs per split and may misplace them
  ([ADR-013](adr/013-split-on-firefox-split-view.md)).
- Planned for M4: at most `panes.max` live panes per workspace (default 4); further splits are
  refused with a status-bar message ([m4-split-panes](specs/m4-split-panes.md), Risks).
- Planned for M4: more than two panes relies on Firefox's split view accepting n tabs, which
  Firefox permits but does not test; panes stay unproven until the sub-spec 1 spike
  ([ADR-013](adr/013-split-on-firefox-split-view.md), Acceptance criteria).
- Planned for M4: with three or more panes, the Tab key may move focus between panes in DOM
  order rather than reading order, unless the spike adds a host reorder
  ([ADR-013](adr/013-split-on-firefox-split-view.md), Known two-tab assumptions).
- Planned for M4: a split's tabs become adjacent in Firefox's own tab order; Vimma's tab numbers
  come from its own list and are unaffected ([m4-split-panes](specs/m4-split-panes.md)).

## Privacy, security and services

- Safe Browsing works only in builds made with a Google API key (the nightly, and local builds
  with the key file). Keyless builds, including PR CI's, fetch no phishing, malware or download
  lists and default the protection off, so Settings shows it unticked
  ([m0-safebrowsing-key](specs/m0-safebrowsing-key.md)).
- Every keyed build shares one Google key. Google's Safe Browsing API is free for
  non-commercial use only and has per-project quotas (Cloud console → Quotas); a large user base
  or commercial use needs a quota increase or Google's Web Risk API. The key is compiled into
  the binaries and can be extracted from them; that is normal for browsers (Firefox ships its
  own the same way) and accepted. Rotation: [runbook](runbook.md)
  ([m0-safebrowsing-key](specs/m0-safebrowsing-key.md)).
- No download reputation: Google serves its download lists (`goog-badbinurl-proto`,
- Safe Browsing's `goog-harmful-proto` list is requested but did not arrive in the smoke run
  with our key (phishing, malware and unwanted did); treat it as unavailable. See
  [m0-safebrowsing-key](specs/m0-safebrowsing-key.md).
  `goog-downloadwhite-proto`) and its remote download check only to Mozilla's key, so Vimma asks
  for neither, and "Block dangerous downloads" in Settings adds nothing beyond the site lists
  ([m0-safebrowsing-key](specs/m0-safebrowsing-key.md), Settled).
- Firefox's app updater is still built in and asks `aus5.mozilla.org` for updates on the `vimma`
  channel, and system add-on updates are on. Removing both is in review (PR #15, spec
  `m0-updater`).
- No update mechanism of our own and no update manifest until M6
  ([m0-app-version](specs/m0-app-version.md), Out of scope).
- No crash reporting: builds have no crash reporter, so crashes leave only a local core dump.
  Opt-in reporting to our own server is M6 ([m0-mozilla-services](specs/m0-mozilla-services.md)).
- Once Vimma writes its `false` for sponsored address-bar suggestions, that value looks like the
  user's own, and an `about:config` reset is undone at the next window
  ([m0-mozilla-services](specs/m0-mozilla-services.md), Settled).
- The ASRouter `cfr` provider pref is a copy of upstream's value and must be refreshed on every
  Firefox bump ([runbook](runbook.md), Upstream bumps).

## Compatibility and versions

- `runtime.getBrowserInfo().name` is `Vimma`, not `Firefox`
  ([m0-app-version](specs/m0-app-version.md), Out of scope).
- A Firefox backup cannot be restored into Vimma: BackupService refuses a different app name
  ([m0-app-version](specs/m0-app-version.md), Out of scope).
- Sidebar/GenAI Nimbus `minVersion`, `PageloadEvent` and Glean's display version still read
  Vimma's `0.1.0`. Harmless while Nimbus and telemetry are off
  ([m0-app-version](specs/m0-app-version.md)).
- The About dialog shows `0.1.0`, not the planned "Vimma 0.x · Firefox N" line
  ([m0-app-version](specs/m0-app-version.md), Out of scope).
- Builds from before the app-version change see newer profiles as a downgrade and refuse them. Use
  a separate `--profile` or `--allow-downgrade` ([runbook](runbook.md), Smoke check).
- Profiles from the old `unofficial`-brand builds are not picked up
  ([m0-branding](specs/m0-branding.md), Settled).
- `vimma --version` prints `Vimma Vimma 0.1.0` (vendor and name are both Vimma)
  ([m0-branding](specs/m0-branding.md), Settled).

## Files and profiles

- `~/.config/vimma/` holds both `config.toml` and the profiles (`vimma/`). The config loader
  reads only `config.toml` and never scans the folder ([m5-config-load](specs/m5-config-load.md);
  [m0-branding](specs/m0-branding.md), Settled).

## Branding

- The logo is a placeholder "V" ([m0-branding](specs/m0-branding.md)).
- Windows and macOS assets (installer bitmaps, `.icns`, MSIX) are still Surfer's `unofficial`
  copies until M7 ([m0-branding](specs/m0-branding.md), Out of scope).
- The default bookmarks are still Mozilla's links ([m0-branding](specs/m0-branding.md)).
- `--screenshot` on a brand-new profile logs a bookmarks import error, and `--screenshot about:home`
  hangs. Both are upstream headless quirks ([m0-branding](specs/m0-branding.md), Settled).

## Platforms and packaging

- Only Linux x86_64 is built and tested. aarch64 and macOS are later; Windows is M7, "when cheap"
  ([plan.md](../plan.md) §6).
- No binaries, packages or releases: build from source. Tarball, AppImage, `.deb` and AUR are M6
  ([plan.md](../plan.md) §6).
- The smol-toml BSD-3-Clause notice is not in `about:license` yet (M6, issue #16).
- `vimma-ctl` checks the discovery file's permissions on Unix only; on Windows `check_mode`
  does nothing (ACLs, not mode bits)
  ([m0-control-protocol-and-vimma-ctl](specs/m0-control-protocol-and-vimma-ctl.md)).

## Build and CI

- PR CI runs the mochitests on an artifact build, which cannot see compiled-in config: the C++
  `--version` string, `MOZ_APP_NAME` and the crash-reporter flag
  ([ADR-010](adr/010-pr-artifact-builds.md), Known gaps).
- The nightly full build is not live (no runner is registered and `NIGHTLY_ENABLED` is unset), so
  `skip-if = ["artifact"]` tests run only on local full builds. PRs that touch patches, `configs/`,
  `moz.configure` or branding must report a full-build run
  ([ADR-010](adr/010-pr-artifact-builds.md), [runbook](runbook.md)).
- Artifact builds depend on Mozilla's Taskcluster index for the pinned release, which expires
  after a year ([ADR-010](adr/010-pr-artifact-builds.md)).
- `e2e.yml` is path-filtered, so it cannot be a required check without handling skipped runs
  ([m0-build-strategy](specs/m0-build-strategy.md)).
- No socket-driven e2e or screenshot diffs yet: the control socket and `tools/e2e` are not on
  `main` ([m0-build-strategy](specs/m0-build-strategy.md), Out of scope).
- No performance gate yet (plan §5's >10 % regression check, issue #17).
- Flaky mochitests under investigation: `browser_vimma_key_capture.js` (issue #14) and
  `browser_vimma_help_overlay.js` (issue #18).
- PRs opened by `GITHUB_TOKEN` (upstream bumps, Claude, release-please) do not trigger CI by
  themselves ([runbook](runbook.md)).
- Firefox bumps are manual after the bot's PR. Plan §4's Claude conflict resolution (≤3 pushes),
  auto-merge of clean bumps and the auto-approved `security` path are not built. The bump PR
  carries a dry run of every patch against the new release ([rebase playbook](rebase.md),
  [m0-rebase-playbook](specs/m0-rebase-playbook.md)).
- `surfer import` stops at the first patch that fails, and `git apply` has no fuzz: a hunk whose
  context drifted fails like one whose code is gone. `tools/upstream/patch-check.py` reports
  every patch and hunk, and tells the two apart ([m0-rebase-playbook](specs/m0-rebase-playbook.md)).
- No branch protection on `main` (free private plan); write-token jobs could push to it
  ([m0-pipeline](specs/m0-pipeline.md), [runbook](runbook.md)).
- A change to build config needs a full rebuild of 15–30 min on 16 threads: 927 s
  ([m0-app-version](specs/m0-app-version.md)), 977 s ([m0-branding](specs/m0-branding.md)),
  1763 s ([m0-mozilla-services](specs/m0-mozilla-services.md)) and 1805 s (`m0-updater`, PR #15),
  all Settled. The first full build took 39 min ([runbook](runbook.md)).
