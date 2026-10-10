# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer. From the first release on, release-please writes each release's entry from the Conventional Commits on `main` ([docs/runbook.md](docs/runbook.md), Releases).

## [Unreleased]

### Added

- `about:license` lists the smol-toml TOML parser's BSD-3-Clause notice under Vimma, so release builds carry it (#16).
- Bookmarks per workspace: each workspace has its own folder in the Bookmarks Toolbar, and the bookmarks panel shows only the current workspace's bookmarks, following you as you switch. `ctrl+b a` and `:bookmark` file there, `@name/` targets another workspace, and renaming or deleting a workspace renames its folder or asks what to do with its bookmarks. `[bookmarks] root = "workspace" | "toolbar" | "all"` picks the view.
- Accessibility: pickers and panels expose the selected row to screen readers, bookmarks are a tree, prompts are dialogs, notices are announced once, and panels give focus back when they close. Text colours meet WCAG AA in the built-in dark and light themes. The help-overlay screenshot baseline was re-recorded for the new colours.
- Tiling layouts: `ctrl+b enter` opens a pane split along the focused pane's longer side (dwindle), and `ctrl+b space` or `:layout` cycles tmux's presets (even-horizontal, even-vertical, main-vertical, main-horizontal, tiled) and dwindle without reloading any page. `[panes] layout` and `main_size` in `config.toml` set the defaults; each workspace keeps its layout across switches and restarts. The help-text and `defaults.toml` snapshots changed with the new keys and options.
- Workspaces work like Vim buffers: `ctrl+^` (or `ctrl+6`, since `^` is a dead key on Finnish layouts) and `ctrl+b ^` flip to the previous workspace, `]w` / `[w` step through them, and `:ws`, `:wn`, `:wp`, `:wd`, `:wa`, `:workspaces` and `:ws #` mirror the buffer commands. A command abbreviation now runs when it begins every other match (`:wor` is `:workspace`).
- `ctrl+b e` or `:addons` opens a keyboard add-on manager: `Enter` opens an add-on's popup with focus inside it, `o` its options, `x` turns it on or off, `d` removes it after y/N, `u` checks for updates and `shift+p` allows it in private windows; `:addon <name>` opens one popup directly. System and hidden add-ons are never listed.
- In text fields `ctrl+w` deletes the previous word, `ctrl+u` deletes to the start of the line and `ctrl+h` deletes a character, as in Vim, and `ctrl+z` undoes them (`[modal] insert_editing = false` turns this off).
- `x` in the side panel closes the selected tab and keeps the panel open; pinned tabs are left alone.
- The browser builds as Vimma: `vimma --version` prints `Vimma Vimma 0.1.0`, and the window title, brand strings, app name and vendor say Vimma. The app icon is the window-and-V mark from the Vimma logo, on a dark window that reads on light and dark desktops; the start page shows the full logo, transparent, with a dark tile under light themes.
- `ctrl+b ?` opens a bindings overlay over any page, including `about:preferences` and the PDF viewer. `/` filters it, `Esc` or `q` closes it and focus returns to where it was. A bare `ctrl+b` waits for the next key without a timeout.
- Firefox's tab strip is hidden by default. Set `vimma.ui.tabstrip.hidden` to `false` in `about:config` to show it again, without a restart. Firefox's tab keys and the window controls keep working.
- Key capture across the whole window, including `about:` pages, the URL bar and the PDF viewer. Set `vimma.debug.keys` to log each key to the console.
- `vimma-core`: tmux-style prefix and Vim key notation, the closed action set, the default keymap, a keymap compiler with "did you mean" suggestions, and a dispatcher with counts, timeouts and replay. `docs/bindings.md` and `defaults.toml` are generated from it (`npm run gen-docs`).
- Help-text and `defaults.toml` snapshots recorded for the first time.
- `vimma-core`: `config.toml` schema v1 validation with `file:line` errors and suggestions, schema migrations, keeping the last good config on error, and theme tokens from Omarchy's `colors.toml`, `[theme.colors]` or the built-in Tokyo Night.
- Artifact builds (`tools/artifact-build`, `npm run mochitest -- --artifact`): test the front end on Mozilla's binaries for the same release, locally and on every PR.
- A tmux-style prefix layer: `ctrl+b` (tmux's default prefix), then a key, works in every mode. `ctrl+b c`, `n`/`p`, `1`-`9` and `shift+x` open, cycle, pick and close tabs; `t`, `x`, `gt` and `gT` do the same in normal mode.
- Vim keys on pages: `j`/`k`/`h`/`l` with counts, `d`/`u` and `ctrl+d`/`ctrl+u` (half a page), `ctrl+e`/`ctrl+y`, `gg`/`G`; focusing a text field enters insert mode and `Esc` leaves it, `i` and `gi` focus the first field. Keys Vimma does not bind still reach the page.
- `H`/`L` (or Vim's `ctrl+o`/`ctrl+i`) go back and forward and `r` reloads, in the focused pane; `yy` copies the page URL, `p`/`P` open the clipboard here or in a new tab, `gu`/`gU` go up a level or to the site's root, and `gf` shows the page source.
- Link hints: `f` labels every link, button and field on screen, also in frames and web components, and `F` opens a link in a background tab. The labels are drawn by the browser, so pages cannot see or restyle them.
- Vim-style find: `/` and `?` search forward and backward with smartcase, `n`/`N` repeat, and the status bar shows the match count.
- Copy mode: `v` or `ctrl+b [` puts a caret on the page; Vim motions (`w`, `e`, `f`/`t`, `{`/`}`, counts), `v`/`V` selections, `iw`/`aw` and `y`/`Y` copy text. Selecting text with the mouse enters copy mode too.
- An always-visible status bar on the window's last line: mode, pending keys, workspace, `tab n/N`, panes, title or tab name, search, loading and URL.
- A Vim-style command line on `:`, with completion, history (a private window keeps its own), errors with "did you mean" and commands such as `:open`, `:tabnew`, `:q`, `:ls`, `:tabrename` and any action by name.
- `ctrl+b g` (or `b`) opens a fuzzy goto picker of the window's tabs, and `ctrl+b shift+t` names a tab; the name shows in the status bar and picker and survives a restart.
- Workspaces, each a Firefox container of its own, so a login in one is invisible in another: `ctrl+b (`/`ctrl+b )` switch (tmux's session keys, from every mode), `ctrl+b shift+n`/`shift+w`/`shift+d` (or `:wsnew`, `:wsrename`, `:wsdelete`) create, rename and delete, `:wsmove` moves a tab, and the `ctrl+b w` picker shows tab counts and moves tabs. New tabs and windows open in the current workspace, and a restart restores every workspace, its tabs, panes and tab names.
- `I` (shift+i) jumps to the address bar with the address selected, from normal and copy mode or with a panel open, for the focused pane; in a text field it still types `I`.
- An on-demand side panel (`ctrl+b b` or `:sidebar`) lists the current workspace's tabs; `j`/`k`, `Enter` or `1`-`9` pick one.
- Routing: `[[routes]]` in `config.toml` sends a domain, URL prefix or the app that opened a link (via `vimma-open`) to a workspace; `:route` lists, adds and moves.
- Split panes on Firefox's split view, up to 4 per workspace (`[panes] max`): `ctrl+b v`/`-` split, `ctrl+b h/j/k/l` (or `ctrl+w h/j/k/l`) move focus, `ctrl+b z` zooms, `ctrl+b x` closes a pane, `ctrl+b shift+h/j/k/l` swap and `ctrl+b r` enters a resize mode. Each workspace keeps its own split, and a split made outside Vimma becomes panes.
- Bookmarks: `ctrl+b a` (or `:bookmark`) files the page under a folder path from anywhere, and `ctrl+b shift+b` or `:bookmarks` opens a neo-tree style bookmarks panel to open, add, rename, move and delete.
- A Vimma start page for new windows and tabs, with the Vimma logo and a key hint, themed and local. `vimma.startpage.newtab` turns it off for new tabs.
- Vimma loads `~/.config/vimma/config.toml` and reloads it within 2 s in every window, without a restart. Every key, the prefix and the leader can be remapped there. A broken file keeps the last good config and shows `config.toml:LINE` in the status bar; `:source` reloads now, `:source <path>` loads another file and `:config` opens the file. On first run Vimma creates a commented `config.toml` (mode 0600) and never overwrites it.
- Vimma follows your current Omarchy theme live: the status bar, command line, overlay, pickers, hints, panes and start page take its colours, and a theme-set hook Vimma installs recolours them as soon as the theme changes. `vimma.theme.source = builtin` keeps Tokyo Night.
- `about:vimma` (or `:about`) shows versions, upstream patches, modes and recent keys (typed text masked), config errors, theme, workspaces and the control socket; `:bug` copies a redacted report.
- `vimma-ctl`, a Rust command-line client for a local control socket that is off by default (`vimma.control.enabled`): `send-keys`, `state`, `open` and `reload-theme`.
- `npm start` runs your build with its own dev profile, and a socket-driven end-to-end test suite runs under Xvfb.

### Changed

- Firefox's own shortcuts that overlap Vimma or Vim are off: `ctrl+w` (close tab), `ctrl+u` (page source), `ctrl+h` (history), `ctrl+d` (bookmark dialog), `ctrl+o` (open file), `ctrl+i` (page info), `ctrl+k` (web search) and `ctrl+b` (bookmarks sidebar). `[firefox] disable = "all" | [...]` and `enable = [...]` in `config.toml` change the set; `about:vimma` lists what is off. The help-text and `defaults.toml` snapshots changed with the new keys and options.
- Characters typed with AltGr (Linux, Windows) or Option (macOS), such as `{`, `}` and `$` on Finnish layouts, match their bindings.
- `ctrl+b ?`, `:map` and `about:vimma` list the keys you press (`ctrl+b b`, `ctrl+b shift+x`, `ctrl+w h`) instead of config notation (`prefix+b`), following a remapped prefix or leader; the legend names the leader only when a binding uses it. The help-text snapshot changed to match.
- Workspaces switch with `ctrl+b (` / `ctrl+b )` instead of `ctrl+u` / `ctrl+i`, which are Vim's half-page-up and jump-forward keys in normal mode now; `ctrl+o` there goes back instead of opening a file (the File menu and `:open` still do). The help-text and `defaults.toml` snapshots changed with the defaults: the workspace, scroll and history rows list the new keys.
- Project renamed from vimux to Vimma: `packages/vimma-core`, `src/browser/base/content/vimma/`, `~/.config/vimma/config.toml`. The `defaults.toml` snapshot changed only in its generator-path comment.
- `ctrl+b` no longer opens Firefox's bookmarks sidebar. It is Vimma's tmux-style prefix key; `ctrl+b shift+b` opens Vimma's bookmarks panel.
- `vimma-core` vendors smol-toml 1.9.0 (BSD-3-Clause) as its TOML parser: source in the repo, not an npm dependency ([ADR-012](docs/adr/012-toml-parser-smol-toml.md)).
- `defaults.toml` snapshot changed: it gains the commented `[workspaces]`, `[theme]` and `[theme.colors]` sections of schema v1; bindings unchanged.
- Help-text and `defaults.toml` snapshots changed: they gain the bookmark bindings (`ctrl+b a`, `ctrl+b shift+b`, `<leader>b` and the panel's neo-tree keys); no other row moved ([bookmarks](docs/specs/bookmarks.md)).
- The leader has no default bindings: `space n` and `space b` no longer open the side panel and the bookmarks panel (`ctrl+b b` and `ctrl+b shift+b` do). Help-text and `defaults.toml` snapshots changed: `toggle_sidebar` and `toggle_bookmarks` lose `<leader>n` and `<leader>b`; no other row moved. The leader itself stays, for bindings you add in `config.toml`.
- Closing the last tab keeps the window open with a new tab, startup restores the previous session, and the new-tab page is no longer preloaded. Each can be changed back in `about:config`.
- Config schema 2 adds `[panes] max`, `[modal] hint_chars`, `[sites."host"] insert` and `[[routes]]`; a schema 1 file migrates as is.

### Fixed

- `npm run import` no longer fails after a patch changes: it restores the Firefox files our patches touch before re-applying them. `tools/relocate-checkout.mjs` repairs a checkout that was moved.
- Switching workspaces with `ctrl+b (`, `ctrl+b )` or `:workspace` no longer shows "no workspaces in this window" after a successful switch.
- Sites see Firefox's user agent (`… Gecko/20100101 Firefox/157.0`), not `Vimma/0.1.0`.
- Everything that asks for the Firefox version (webcompat interventions, add-on updates, Remote Settings and Nimbus targeting, backups) gets Firefox's (157.0.1). `--version` and the About dialog still show Vimma's 0.1.0.
- Startup no longer throws in BrowserGlue, so `about:home` and `about:newtab` load again.
- The build stops with "run 'npm run import'" when the version files are missing, instead of silently building as 0.1.0 everywhere.
- The `ctrl+b ?` overlay takes the theme's colours instead of staying white under a dark theme.

### Security

- A quarterly audit checks every change to Firefox's own code against its register entry, size budget and review date, and opens an issue with the report.
- Firefox security updates on autopilot: every 4 hours CI checks Mozilla's releases and advisories, opens a tracking issue, verifies the source, checks the patches, runs every test suite and opens the update pull request. A security release left unshipped for 3 days fails CI and opens an issue.
- Every parser of outside input (control protocol, `config.toml`, routing rules, key notation, the command line, Omarchy theme files, `vimma-ctl`) is fuzzed in CI and nightly. Fuzzing found and fixed unbounded TOML nesting, `constructor`-named keys crashing a reload, a slow IPv6 pattern, an 8 s freeze on a huge `:` paste and a malformed control message wedging its connection.
- Vimma does not join Mozilla's studies, experiments or rollouts (Normandy, Nimbus) and shows no sponsored stories, shortcuts or address-bar suggestions, remote recommendations or Mozilla promos. Each default can be turned back on in `about:config`.
- Builds have no crash reporter and no official telemetry, so nothing is sent to Mozilla. A crash leaves a local core dump.
- Remote Settings (CRLite certificate revocation, intermediates), the add-on blocklist, Sync and AMO add-on updates stay as in Firefox. Safe Browsing's phishing, malware and unwanted-software lists are on in builds made with a Google API key (the nightly); a keyless build shows the protection as off ([docs/limits.md](docs/limits.md)).
- The control socket listens on `127.0.0.1` only and is off by default. Clients need a 256-bit token from a file only you can read, the browser proves it holds the token before the client sends it, and connection, size and idle limits apply. `open` refuses `javascript:` and `data:`.
- Routing never acts on a link a page opens or a page's own navigation, so a page cannot open a site with another workspace's logins.
- Every way Vimma opens a URL (`:open`, `:tabnew`, `p`/`P`, bookmarks, the control socket) refuses `javascript:` and `data:`, also behind `view-source:`.
- [docs/security.md](docs/security.md) states what each risky part may and must never do, every rule linked to the test that enforces it, and CI fails if a linked test disappears. [SECURITY.md](SECURITY.md) explains how to report a vulnerability privately.
- Deleting a workspace asks first and clears its container's site data; a container deleted outside Vimma is replaced at once, so new tabs never land in the default container.
- Semgrep and CodeQL scan every PR, and a PR that adds a high-severity CodeQL alert cannot merge. CodeQL's first scan found 15 alerts; 14 were fixed (regex backtracking replaced by linear scans, file races, Markdown escaping in generated docs) and one was a false positive.
- Dependencies are kept current: Dependabot proposes updates weekly, and security, patch and minor updates merge on their own once every required check passes. The build tools' outdated `sharp` and `qs` were lifted past their advisories.

### Removed

- Firefox's app updater: Vimma no longer asks Mozilla's update server for app or system add-on updates, and About and Settings show no update button. Add-on updates from addons.mozilla.org stay on.
