# Known limits

This page lists every known limit or gap in Vimma on `main`, one line each, with the spec, ADR
or issue that records it, so you know what to expect before you run into it. Each of plan §9's
open questions ends as an ADR or as a line here. When a limit is fixed, its line is deleted in
the same PR.

## Features

- Tab keys count Firefox's visible tabs: the current workspace's and any pinned tab.
- The first key of a sequence with nothing runnable under it passes through to the page or
  Firefox ([m1-actor-insert-scroll](specs/m1-actor-insert-scroll.md), Settled). `ctrl+w`'s pane keys run
  only with two panes or more, so with one pane `ctrl+w` reaches the page; with a split, in
  normal mode, it is Vim's window prefix ([m4-split-panes](specs/m4-split-panes.md), sub-spec 3).
- Firefox's shortcuts on Vimma's keys (`ctrl+w` close tab, `ctrl+u` view source, `ctrl+h`
  history sidebar, `ctrl+d` bookmark, `ctrl+o` Open File, `ctrl+i` Page Info, `ctrl+k` web
  search, `ctrl+b` bookmarks sidebar) are off in every mode, so they need `x`, `gf`,
  `ctrl+shift+h`, `ctrl+b a`, `:open`, the menus or `[firefox] enable`. `[firefox]` reaches only
  the window's `#mainKeyset`: tab switching (`ctrl+tab`, `ctrl+pagedown`) and the developer
  tools' keys cannot be turned off there ([key-handling-batch](specs/key-handling-batch.md)).
- The text-field keys (`ctrl+w`, `ctrl+u`, `ctrl+h`) wait for the page: one that takes the key
  keeps it, and the edit runs a moment after the key, so a key typed in that moment can land
  before it. A text field with focus in normal mode (a page's autofocus) gets no edit. On macOS
  `ctrl+h` is Cocoa's own backspace, and only `ctrl+…` (not `cmd`) shortcuts are matched; it is
  untested there ([key-handling-batch](specs/key-handling-batch.md)).
- AltGr and Option characters are told from real `alt` chords by what the physical key types
  on a US layout: on a layout where a key's plain character differs from the US one, a
  `ctrl+alt` chord on it that types another character counts as AltGr (Windows'
  `ctrl+alt` stand-in) ([key-handling-batch](specs/key-handling-batch.md), § 3).
- The side panel takes no count: `3x` selects row 3 and closes the panel, and the `x` then
  closes that tab in normal mode ([key-handling-batch](specs/key-handling-batch.md), § 4).
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
- Command line: history is kept in memory only, until Vimma quits; arguments (URLs, workspace
  names) are not completed, except `:addon`'s add-on names; there is no `:set`, and no ranges or
  counts ([m1-cmdline](specs/m1-cmdline.md), Settled; [addon-manager](specs/addon-manager.md)).
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
  `about:vimma`) ([m5-config-load](specs/m5-config-load.md)).
- Without the `theme-set.d` hook Vimma installs (no Omarchy hooks folder,
  `vimma.theme.omarchyHook` off, or the hook deleted), an Omarchy theme change shows up to 2 s
  late: Vimma polls `colors.toml`'s stat every 2 s (Firefox has no portable file watcher; plan
  §3). With the hook, Vimma follows only after Omarchy has retinted its own apps; a hook run in
  the moment between Vimma's start and its first window opens a window
  ([m5-omarchy-theme](specs/m5-omarchy-theme.md), Limits and "Instant reload by default").
- If the Omarchy theme directory disappears after a theme was shown (as during
  `omarchy-theme-set`'s swap), the colours stay until a theme is back; the built-in palette only
  when no theme was found since startup or the last `vimma.theme.*` change
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
  of the next as in Vim; `e`, `W`, `B` and `E` are Vim's ([m1-copy-mode](specs/m1-copy-mode.md)).
- `e`, `ge`, `W`, `B`, `E`, `^`, `f`, `t`, `iw` and `aw` read the text around the caret (a few
  thousand characters each way, more with a count) and stop at its edge. They do not enter a
  shadow root or a frame, and `f` / `t` search the text between line breaks, not the wrapped
  line on screen ([m1-copy-mode](specs/m1-copy-mode.md)).
- `V` selects visual lines, as `j` / `k` move: a paragraph the page wraps is several lines. At a
  soft wrap the end of one line and the start of the next are the same point, so `V` there can
  take the neighbouring line ([m1-copy-mode](specs/m1-copy-mode.md)).
- `iw` / `aw` always select the word at the caret; they do not grow a selection by a word as in
  Vim, and take no count. `Y` copies the lines without a trailing line break
  ([m1-copy-mode](specs/m1-copy-mode.md)).
- The primary selection (middle-click paste) follows the mouse and the motions Firefox moves
  (`h j k l w b 0 $ { } gg G`); after `e`, `W`, `f`, `V`, `o`, `iw` and the other Vim text
  motions it still holds the selection from before them. `y` copies to the clipboard
  ([m1-copy-mode](specs/m1-copy-mode.md)).
- A click in copy mode that selects nothing moves the caret there and stays in copy mode
  ([m1-copy-mode](specs/m1-copy-mode.md)).
- `y` copies plain text only. Text inside text fields is not part of the page's selection: focus
  the field and use `ctrl+c` ([m1-copy-mode](specs/m1-copy-mode.md)).
- After the page navigates, the first copy-mode key only ends copy mode
  ([m1-copy-mode](specs/m1-copy-mode.md)).

## Tabs and window

- "List all tabs" (View menu, `#alltabs-button`, the `ctrl+tab` panel's "show all") is unavailable
  while the tab strip is hidden; the `ctrl+b g` goto picker lists every tab instead
  ([m0-tabstrip-hidden](specs/m0-tabstrip-hidden.md)).
- `ctrl+shift+tab` with `browser.ctrlTab.sortByRecentlyUsed` on does nothing while the strip is
  hidden ([m0-tabstrip-hidden](specs/m0-tabstrip-hidden.md)).
- `vimma.ui.tabstrip.hidden` has no Settings UI; use `about:config`
  ([m0-tabstrip-hidden](specs/m0-tabstrip-hidden.md)).
- The nav bar's drag region on GNOME (client-side decorations) has not been checked by hand
  ([m0-tabstrip-hidden](specs/m0-tabstrip-hidden.md)).

## Workspaces (M3, by design)

These are the trade-offs the workspaces' design accepts on purpose
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
- Workspaces are saved with Firefox's session, so a crash loses what the session file has not
  caught yet: up to 15 seconds of changes while you are active, and up to an hour after 3
  minutes without input (`browser.sessionstore.interval.idle`). Tabs then come back in the
  workspace that owns their container, but a workspace's selected tab, its panes and new tab
  names may be older.
- A window saved by a newer Vimma keeps its saved workspaces untouched: this version starts it
  with its tabs sorted into workspaces by container, without its panes, and does not save over
  it.
- Tabs in hidden workspaces keep playing audio, and they are never unloaded automatically.
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
- Pop-ups have no workspaces. Private windows have no normal workspaces: together they are the
  one [private workspace](guide.md#private-workspace), a second window-manager window (Firefox
  keeps privacy per window), not a part of the Vimma window. On Hyprland, Vimma hides the one you
  are not using in `special:vimma`, but Hyprland's event stream and other tools (`hyprctl
clients`) still see both windows; elsewhere both are visible windows. There is one private
  workspace, not several; all private windows share one cookie jar. Links from other apps never
  open in it.
- Firefox's sidebar keys (`ctrl+alt+x`, `ctrl+alt+u`, `ctrl+alt+z`; `ctrl+h` is off) still open its own
  sidebar beside Vimma's side panel; Firefox's four default containers stay in Settings.
- Extensions that hide or show tabs (`tabs.hide`) conflict with workspace visibility.

### Routing rules ([workspace-routing](specs/workspace-routing.md))

- A page's own navigation (link click, redirect, sign-in bounce) is never moved to the workspace
  a rule names; the status bar hints and `:route move` reopens it there, without its history.
- Rules never route a link a page opens (a click, middle- or ctrl-click, `F` hints,
  `target="_blank"`, `window.open`): it stays in the page's container, so a page cannot open a
  site with another workspace's cookies. The tab gets the same hint when shown.
- App rules need `vimma-open` (the packages' desktop entry). Apps in Flatpak or other sandboxes
  open links through the desktop portal, apps started by systemd (`uwsm app`, `app2unit`) are not
  in the link's process tree, and `gio open` may exit before `vimma-open` looks: those links have
  no app. A script run by an interpreter may be named after the interpreter (`python3`). A link
  opened from a shell is the terminal's.
- The app name is a hint any local program can send (`vimma -vimma-from slack <url>`); it can
  only pick a workspace a rule already names, as typing the URL would.
- With `browser.link.open_newwindow` set to open external links in a window or in the current
  tab, app rules do not apply to them (domain rules do in a new window).
- A cold start from a link routes its first tab with the rules cached at the last run; a rule
  added while Vimma was closed applies from its next read of `config.toml`.

## Bookmarks

- Tags, keywords, separators, sorting, drag and drop, undo and editing a bookmark's address are
  left to Firefox's Library (`ctrl+shift+o`); a folder's bookmarks cannot be opened all at once
  ([bookmarks](specs/bookmarks.md), Out of scope).
- `javascript:` and `data:` bookmarks (bookmarklets) are listed but never open from Vimma, nor
  does anything but `http`, `https`, `file` and `about:` ([bookmarks](specs/bookmarks.md),
  decision 6).
- A `/` inside a folder or bookmark name is typed `\/` in a path; a top-level folder named
  `toolbar`, `other` or `mobile` is reached by Firefox's root of that name instead
  ([bookmarks](specs/bookmarks.md), decision 2).
- The panel's `a` adds the page even when it is bookmarked already (Firefox allows several);
  only `ctrl+b a` and `:bookmark` offer to move the existing one. The filter lists bookmarks,
  not folders ([bookmarks](specs/bookmarks.md), decisions 7 and 10).

## Add-ons

- Installing stays Firefox's: an add-on's page on addons.mozilla.org and the permission prompt.
  The picker's `u` only checks for an update; Firefox installs it (in the background, or from
  about:addons), so an update asking for new permissions still gets Firefox's prompt
  ([addon-manager](specs/addon-manager.md), decision 9).
- A key cannot open one particular add-on's popup from `config.toml`: keymap actions carry no
  argument. Bind `addon_popup` (it opens `:addon `) or set the add-on's own shortcut in
  about:addons → Manage Extension Shortcuts ([addon-manager](specs/addon-manager.md),
  decision 12).
- An extension's own shortcut on a key Vimma binds never reaches the add-on: Vimma's wins.
- Keys inside an add-on's popup are the popup's (no Vim keys there), as on other extension
  pages; `Esc` closes it.
- Only browser-action (toolbar button) popups open from Vimma; page actions (the address bar's
  buttons), sidebar actions and an add-on's context-menu entries need Firefox's own UI
  ([addon-manager](specs/addon-manager.md), Out of scope).
- An inline options page (`open_in_tab: false`) opens in a tab of its own, not inside
  about:addons ([addon-manager](specs/addon-manager.md), decision 6).

## Panes

- Panes are resized from the keyboard only (resize mode); dividers cannot be dragged with the
  mouse, and tabs cannot be dropped onto a pane
  ([m4-split-panes](specs/m4-split-panes.md), Out of scope).
- A pinned tab cannot be shown in a pane; Firefox's split view refuses pinned
  tabs, so Vimma unpins a tab before it joins a split
  ([ADR-013](adr/013-split-on-firefox-split-view.md)).
- Firefox's own split-view UI is off: the tab and link context-menu items and alt-click
  (`browser.tabs.splitView.enabled` false), the URL bar's split button and the tab-group items of
  a split (hidden by `split.css`); splits come from Vimma's keys
  ([ADR-013](adr/013-split-on-firefox-split-view.md)).
- At most `[panes] max` panes (default 4, up to 16) in a workspace: a further split is refused with
  "at most N panes". Every visible pane's page stays live, so each one costs memory and CPU;
  a zoomed-away pane is paused (its docshell inactive) until unzoom
  ([m4-split-panes](specs/m4-split-panes.md), sub-spec 2).
- A tab whose pane is closed stays open in its workspace; it is not hidden.
- One split per workspace: a split made outside Vimma (Firefox's split-view command, an
  extension, a restored Firefox session) is adopted as a row of panes; a second one in the same
  workspace, or one whose tabs are in different workspaces, is separated with a notice. Firefox's
  `about:opentabs` tab in such a split closes when Vimma separates it, as in Firefox
  ([m4-split-panes](specs/m4-split-panes.md), sub-spec 6).
- The accessible name of the third pane on ("<title>, pane 3 of 4") is English only; Firefox
  names the first two panes "left" and "right" whatever the layout
  ([m4-split-panes](specs/m4-split-panes.md), sub-spec 2).
- With three or more panes, extensions that move a split tab (`tabs.move`) and
  the all-tabs list's drag targets assume two tabs per split and may misplace them
  ([ADR-013](adr/013-split-on-firefox-split-view.md)).
- A split's tabs become adjacent in Firefox's own tab order; Vimma's tab numbers
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
  `goog-downloadwhite-proto`) and its remote download check only to Mozilla's key, so Vimma asks
  for neither, and "Block dangerous downloads" in Settings adds nothing beyond the site lists
  ([m0-safebrowsing-key](specs/m0-safebrowsing-key.md), Settled).
- Safe Browsing's `goog-harmful-proto` list is requested but did not arrive in the smoke run
  with our key (phishing, malware and unwanted did); treat it as unavailable. See
  [m0-safebrowsing-key](specs/m0-safebrowsing-key.md).
- No update mechanism of our own and no update manifest until M6a
  ([m0-app-version](specs/m0-app-version.md), Out of scope).
- No crash reporting: builds have no crash reporter, so crashes leave only a local core dump.
  Opt-in reporting to our own server is M6 ([m0-mozilla-services](specs/m0-mozilla-services.md)).
- Once Vimma writes its `false` for sponsored address-bar suggestions, that value looks like the
  user's own, and an `about:config` reset is undone at the next window
  ([m0-mozilla-services](specs/m0-mozilla-services.md), Settled).
- The ASRouter `cfr` provider pref is a copy of upstream's value. The bump PR's suites fail when
  it is stale, but the refreshed line is pasted by hand ([runbook](runbook.md), Upstream bumps;
  [#259](https://github.com/vimma-browser/vimma/issues/259)).

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
- `vimma --full-version` keeps Firefox's `<vendor> <name> <version>` format, `Vimma Vimma 0.1.0`
  and the build IDs; only `--version` prints `Vimma 0.1.0 · Firefox 158.0`
  ([firefox-versions](specs/firefox-versions.md), decision 1).

## Files and profiles

- `~/.config/vimma/` holds both `config.toml` and the profiles (`vimma/`). The config loader
  reads only `config.toml` and never scans the folder ([m5-config-load](specs/m5-config-load.md);
  [m0-branding](specs/m0-branding.md), Settled).

## Branding

- The about dialog's wordmark (`about-wordmark.svg`) is still the placeholder "VIMMA" in plain
  strokes; the logo and app icon are the real window+V mark ([m0-branding](specs/m0-branding.md)).
- Windows and macOS assets (installer bitmaps, `.icns`, MSIX) are still Surfer's `unofficial`
  copies until those platforms are built ([m0-branding](specs/m0-branding.md), Out of scope).
- The default bookmarks are still Mozilla's links ([m0-branding](specs/m0-branding.md)).
- `--screenshot` on a brand-new profile logs a bookmarks import error, and `--screenshot about:home`
  hangs. Both are upstream headless quirks ([m0-branding](specs/m0-branding.md), Settled).

## Platforms and packaging

- Only Linux x86_64 is built and tested. aarch64 and macOS come later
  ([plan.md](../plan.md) §6, [macos-build](specs/macos-build.md)); Windows is not planned.
- No binaries, packages or releases: build from source. Tarball, AppImage, `.deb` and AUR are M6
  ([plan.md](../plan.md) §6).
- The Arch Linux package (the release's `PKGBUILD`) writes `/opt/vimma/is-packaged-app`, the
  file Firefox reads as "installed by a package manager". With it, Firefox skips the warning bar
  it otherwise shows in the first window when the kernel does not allow unprivileged user
  namespaces (`security/sandbox/common/SandboxUtils.sys.mjs:25`, pref
  `security.sandbox.warn_unprivileged_namespaces`), and about:support does not flag them as
  missing (`toolkit/content/aboutSupport.js:1551`; Firefox 158.0). The content sandbox is then
  weaker without saying so. The tarball, the AppImage and the `.deb` do not write the file and still warn
  ([m6-packaging](specs/m6-packaging.md), "Arch Linux without the AUR", decision 4).
- `vimma-ctl` checks the discovery file's permissions on Unix only; on Windows `check_mode`
  does nothing (ACLs, not mode bits)
  ([m0-control-protocol-and-vimma-ctl](specs/m0-control-protocol-and-vimma-ctl.md)).

## Build and CI

- PR CI runs the mochitests on an artifact build, which cannot see compiled-in config: the C++
  `--version` string, `MOZ_APP_NAME` and the crash-reporter flag
  ([ADR-010](adr/010-pr-artifact-builds.md), Known gaps).
- The nightly full build is not live: `nightly.yml` and `release.yml` build on GitHub-hosted
  runners (about 2 hours each), but stay switched off until `NIGHTLY_ENABLED` and
  `RELEASE_ENABLED` are set ([runbook](runbook.md), "Full builds"). Until then
  `skip-if = ["artifact"]` tests run only on local full builds. PRs that touch patches, `configs/`,
  `moz.configure` or branding must report a full-build run
  ([ADR-010](adr/010-pr-artifact-builds.md), [runbook](runbook.md)).
- Nightly builds are not published as a release before the release gate: each one is a workflow
  artifact of its run, kept 7 days, with no release page or stable link. It is not private: the
  repository is public, so anyone signed in to GitHub can download it for those 7 days
  ([runbook](runbook.md), "Full builds";
  [build-supply-chain](specs/build-supply-chain.md), decision 23).
- Artifact builds depend on Mozilla's Taskcluster index for the pinned release, which expires
  after a year ([ADR-010](adr/010-pr-artifact-builds.md)).
- PRs opened by `GITHUB_TOKEN` (upstream bumps, Claude, release-please) do not trigger CI by
  themselves ([runbook](runbook.md)).
- Firefox bumps are meant to need no manual step (plan §6, M7): the upstream autopilot detects a
  release, dry-runs every patch, runs the suites and opens the bump PR
  ([rebase playbook](rebase.md), [m7-upstream-autopilot](specs/m7-upstream-autopilot.md)). Gaps
  that still need a person: merging a green bump PR, pasting a refreshed pref copy that
  `upstream-prefs.mjs` reports, and re-exporting a patch that no longer applies
  ([#259](https://github.com/vimma-browser/vimma/issues/259)); releasing the merged bump
  ([#220](https://github.com/vimma-browser/vimma/issues/220), [#224](https://github.com/vimma-browser/vimma/issues/224)).
- Mozilla's signature on `SHA512SUMS` proves Mozilla built and signed the tarball, not that it is
  the release: a superseded build candidate (`candidates/X-candidates/buildN/`) lists the same
  file name in a `SHA512SUMS` signed by the same key, so someone who controls the connection to
  archive.mozilla.org could serve an abandoned respin of the version `surfer.json` names
  ([ADR-021](adr/021-mozilla-release-key.md)).
- `surfer import` stops at the first patch that fails, and `git apply` has no fuzz: a hunk whose
  context drifted fails like one whose code is gone. `tools/upstream/patch-check.py` reports
  every patch and hunk, and tells the two apart ([m0-rebase-playbook](specs/m0-rebase-playbook.md)).
- A change to build config needs a full rebuild of 15–30 min on 16 threads: 927 s
  ([m0-app-version](specs/m0-app-version.md)), 977 s ([m0-branding](specs/m0-branding.md)),
  1763 s ([m0-mozilla-services](specs/m0-mozilla-services.md)) and 1805 s (`m0-updater`, PR #15),
  all Settled. The first full build took 39 min ([runbook](runbook.md)).
