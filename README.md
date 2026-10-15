<p align="center">
  <img src="docs/assets/vimma-logo-wide.jpg" alt="Vimma: Vim and Tmux inspired" width="640">
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-MPL--2.0-666666?labelColor=333333" alt="MPL-2.0 licence" /></a>
  <a href="https://github.com/vimma-browser/vimma/stargazers"><img src="https://img.shields.io/github/stars/vimma-browser/vimma?labelColor=333333&color=666666&logo=github" alt="GitHub stars" /></a>
  <a href="https://github.com/vimma-browser/vimma/actions/workflows/ci.yml?query=branch%3Amain"><img src="https://img.shields.io/github/actions/workflow/status/vimma-browser/vimma/ci.yml?branch=main&label=ci&labelColor=333333&color=666666" alt="CI status on main" /></a>
  <a href="surfer.json"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fvimma-browser%2Fvimma%2Fmain%2Fsurfer.json&query=%24.version.version&label=firefox&labelColor=333333&color=666666&logo=firefoxbrowser" alt="Firefox version Vimma is built on" /></a>
</p>

# Vimma

**A keyboard-first browser for people who live in Vim and tmux.** You already have the muscle
memory; Vimma puts it to work on the web. Bare keys drive the page, `ctrl+b` drives tabs, panes
and workspaces, and your hands never leave the keyboard.

- **Vim on the page:** `j`/`k` to scroll, `f` for link hints, `/` to find, `:` for commands, and
  `Esc` to get back to normal mode.
- **tmux for the window:** `ctrl+b`, tmux's default prefix, then `c` for a new tab, `v` to split,
  `w` to switch workspace. If your fingers know tmux, they already know Vimma.
- **Every key is yours:** every binding, the prefix and the leader can be remapped in
  `config.toml`, Firefox's own keys too: `ctrl+t`, `alt+left` and `F12` are Vimma bindings
  with Firefox's meaning, listed in `ctrl+b ?`.

## Why

The browser is the one daily tool that ignores Vim and tmux habits. Vimma brings them to a Firefox
base you can trust: sites and add-ons work as they do in Firefox, with quieter privacy defaults.
Each workspace is a container of its own, so work logins stay out of personal ones, and the
window can follow your desktop theme. [See everything it does](docs/guide.md#features-at-a-glance).

## The name

_Vimma_ is Finnish for a burst of eager, focused energy, as in _työvimma_, a spell of work where
the hours slip by. It also happens to start with _Vim_.

## Status

Pre-release, Linux x86_64 (macOS next), no published release yet: [build it from source](CONTRIBUTING.md#build-and-run).

AI coding agents working on this repository follow [CLAUDE.md](CLAUDE.md); contributors read
[CONTRIBUTING.md](CONTRIBUTING.md) before opening issues or pull requests.

## Licence

[MPL-2.0](LICENSE), like Firefox; the vendored [smol-toml](https://github.com/squirrelchat/smol-toml) parser is BSD-3-Clause ([ADR-012](docs/adr/012-toml-parser-smol-toml.md)).

## Acknowledgements

[Vim](https://www.vim.org/) and [tmux](https://github.com/tmux/tmux), the models; [Firefox](https://www.mozilla.org/firefox/), underneath; [Surfer](https://github.com/zen-browser/surfer) and [Zen Browser](https://zen-browser.app/), the toolchain; [Herdr](https://herdr.dev/), the `[keys]` syntax; [Omarchy](https://omarchy.org/), the themes; [Tridactyl](https://github.com/tridactyl/tridactyl) and [Vimium](https://github.com/philc/vimium), prior art.
