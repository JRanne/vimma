# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer. Maintained by release-please from Conventional Commits.

## [Unreleased]

### Changed

- Project renamed from vimux to Vimma: `packages/vimma-core`, `src/browser/base/content/vimma/`, `~/.config/vimma/config.toml`. The `defaults.toml` snapshot changed only in its generator-path comment.

### Changed

- Project renamed from vimux to Vimma: `packages/vimma-core`, `src/browser/base/content/vimma/`, `~/.config/vimma/config.toml`. The `defaults.toml` snapshot changed only in its generator-path comment.

### Added

- `vimma-core`: key notation (Herdr `prefix+shift+t` and Vim `<leader>ff` / `<C-w>h`), closed action set, default keymap, keymap compiler with config validation and suggestions, dispatcher with counts, timeouts and replay, and the `prefix+?` binding table.
- Generated `packages/vimma-core/defaults.toml` and `docs/bindings.md` (`npm run gen-docs`).
- Help-text and `defaults.toml` snapshots recorded for the first time.
