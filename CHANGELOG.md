# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer. From the first release on, release-please writes each release's entry from the Conventional Commits on `main` ([docs/runbook.md](docs/runbook.md), Releases).

## [Unreleased]

### Added

- The browser builds as Vimma: `vimma --version` prints `Vimma Vimma 0.1.0`, and the window title, brand strings, app name and vendor say Vimma. Placeholder "V" logo.
- `ctrl+b ?` opens a bindings overlay over any page, including `about:preferences` and the PDF viewer. `/` filters it, `Esc` or `q` closes it and focus returns to where it was. A bare `ctrl+b` waits for the next key without a timeout.
- Firefox's tab strip is hidden by default. Set `vimma.ui.tabstrip.hidden` to `false` in `about:config` to show it again, without a restart. Firefox's tab keys and the window controls keep working.
- Key capture across the whole window, including `about:` pages, the URL bar and the PDF viewer. Set `vimma.debug.keys` to log each key to the console.
- `vimma-core`: Herdr and Vim key notation, the closed action set, the default keymap, a keymap compiler with "did you mean" suggestions, and a dispatcher with counts, timeouts and replay. `docs/bindings.md` and `defaults.toml` are generated from it (`npm run gen-docs`).
- Help-text and `defaults.toml` snapshots recorded for the first time.
- `vimma-core`: `config.toml` schema v1 validation with `file:line` errors and suggestions, schema migrations, keeping the last good config on error, and theme tokens from Omarchy's `colors.toml`, `[theme.colors]` or the built-in Tokyo Night. The browser does not load `config.toml` yet.
- Artifact builds (`tools/artifact-build`, `npm run mochitest -- --artifact`): test the front end on Mozilla's binaries for the same release, locally and on every PR.

### Changed

- Project renamed from vimux to Vimma: `packages/vimma-core`, `src/browser/base/content/vimma/`, `~/.config/vimma/config.toml`. The `defaults.toml` snapshot changed only in its generator-path comment.
- `ctrl+b` no longer opens Firefox's bookmarks sidebar. It is Vimma's prefix key.
- `vimma-core` vendors smol-toml 1.9.0 (BSD-3-Clause) as its TOML parser: source in the repo, not an npm dependency ([ADR-012](docs/adr/012-toml-parser-smol-toml.md)).
- `defaults.toml` snapshot changed: it gains the commented `[workspaces]`, `[theme]` and `[theme.colors]` sections of schema v1; bindings unchanged.
- Help-text and `defaults.toml` snapshots changed: they gain the bookmark bindings (`ctrl+b a`, `ctrl+b shift+b`, `<leader>b` and the panel's neo-tree keys); no other row moved ([bookmarks](docs/specs/bookmarks.md)).
- The leader has no default bindings: `space n` and `space b` no longer open the side panel and the bookmarks panel (`ctrl+b b` and `ctrl+b shift+b` do). Help-text and `defaults.toml` snapshots changed: `toggle_sidebar` and `toggle_bookmarks` lose `<leader>n` and `<leader>b`; no other row moved. The leader itself stays, for bindings you add in `config.toml`.

### Fixed

- Sites see Firefox's user agent (`… Gecko/20100101 Firefox/157.0`), not `Vimma/0.1.0`.
- Everything that asks for the Firefox version (webcompat interventions, add-on updates, Remote Settings and Nimbus targeting, backups) gets Firefox's (157.0.1). `--version` and the About dialog still show Vimma's 0.1.0.
- Startup no longer throws in BrowserGlue, so `about:home` and `about:newtab` load again.
- The build stops with "run 'npm run import'" when the version files are missing, instead of silently building as 0.1.0 everywhere.

### Security

- Vimma does not join Mozilla's studies, experiments or rollouts (Normandy, Nimbus) and shows no sponsored stories, shortcuts or address-bar suggestions, remote recommendations or Mozilla promos. Each default can be turned back on in `about:config`.
- Builds have no crash reporter and no official telemetry, so nothing is sent to Mozilla. A crash leaves a local core dump.
- Remote Settings (CRLite certificate revocation, intermediates), the add-on blocklist, Sync and AMO add-on updates stay as in Firefox. Safe Browsing is not active yet ([docs/limits.md](docs/limits.md)).
