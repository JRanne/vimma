# Known limits

Every known limit or gap of Vimma on `main`, one line each, with the spec, ADR or issue that
records it. Plan §9's open questions resolve to an ADR or a line here. When a limit is fixed,
delete its line in the same PR.

## Features

- Only `ctrl+b ?` runs. Every other binding in the overlay and in [bindings.md](bindings.md) is
  planned, and other `ctrl+b` sequences are consumed and do nothing
  ([m0-help-overlay](specs/m0-help-overlay.md), Settled).
- Every page is in `insert` mode until M1's content actor can detect editable focus. Bare keys go
  to the page ([m0-help-overlay](specs/m0-help-overlay.md)).
- Single-key actions the host cannot run yet (`Esc`, `ctrl+i`, `ctrl+u`) pass through to Firefox.
  This is an M0 stopgap, to be revisited per action in M1
  ([m0-help-overlay](specs/m0-help-overlay.md)).
- `config.toml` is not read by the browser. Its validator and theme tokens exist in `vimma-core`,
  but loading, polling, `:source` and theming wait for the M5 host spec
  ([m5-core-config-and-theme](specs/m5-core-config-and-theme.md)).
- The overlay has legible defaults only: no theme tokens and no which-key strip (M2, M5)
  ([m0-help-overlay](specs/m0-help-overlay.md)).

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

## Panes

- No split panes yet: `ctrl+b v`, `-`, `x`, `z`, `h/j/k/l` and resize mode are planned for M4
  ([m4-split-panes](specs/m4-split-panes.md)).
- Planned for M4: panes are resized from the keyboard only (resize mode); dividers cannot be
  dragged with the mouse, and tabs cannot be dropped onto a pane
  ([m4-split-panes](specs/m4-split-panes.md), Out of scope).
- Planned for M4: a pinned tab cannot be shown in a pane; Firefox's split view refuses pinned
  tabs, so Vimma unpins a tab before it joins a split
  ([ADR-013](adr/013-split-on-firefox-split-view.md)).
- Planned for M4: Firefox's own split-view menus (tab and link context menu, alt-click) are off
  (`browser.tabs.splitView.enabled` false); splits come from Vimma's keys
  ([ADR-013](adr/013-split-on-firefox-split-view.md)).
- Planned for M4: with three or more panes, extensions that move a split tab (`tabs.move`) and
  Firefox's all-tabs list assume two tabs per split and may misplace or mislabel them
  ([ADR-013](adr/013-split-on-firefox-split-view.md)).
- Planned for M4: panes hidden by `ctrl+b z` keep rendering in the background (their docshells
  stay active) ([m4-split-panes](specs/m4-split-panes.md), Open questions).
- Planned for M4: a split's tabs become adjacent in Firefox's own tab order; Vimma's tab numbers
  come from its own list and are unaffected ([m4-split-panes](specs/m4-split-panes.md)).

## Privacy, security and services

- Safe Browsing does not work: there is no Google API key, so no phishing, malware or download
  lists are fetched, yet Settings shows the protection ticked. Follow-up spec
  `m0-safebrowsing-key` ([m0-mozilla-services](specs/m0-mozilla-services.md), Open issues).
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

- `~/.config/vimma/` holds both `config.toml` (M5) and the profiles (`vimma/`). The M5 config
  loader must read only `config.toml` and never scan the folder
  ([m5-core-config-and-theme](specs/m5-core-config-and-theme.md), host spec;
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
- No branch protection on `main` (free private plan); write-token jobs could push to it
  ([m0-pipeline](specs/m0-pipeline.md), [runbook](runbook.md)).
- A change to build config needs a full rebuild of 15–30 min on 16 threads: 927 s
  ([m0-app-version](specs/m0-app-version.md)), 977 s ([m0-branding](specs/m0-branding.md)),
  1763 s ([m0-mozilla-services](specs/m0-mozilla-services.md)) and 1805 s (`m0-updater`, PR #15),
  all Settled. The first full build took 39 min ([runbook](runbook.md)).
