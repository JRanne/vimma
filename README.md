<p align="center">
  <img src="docs/assets/vimma-logo-wide.jpg" alt="Vimma: Vim and Tmux inspired" width="640">
</p>

# Vimma

**A keyboard-first browser, inspired by Vim and Tmux.** Browse the way you edit text and juggle
terminal sessions: modal keys for the page, a `ctrl+b` prefix for tabs, panes and workspaces, and
your hands never leave the keyboard.

- **Vim** brings the modal layer: `j`/`k` to scroll, `f` for link hints, `/` to find, `:` for
  commands, and `Esc` to get back to normal mode.
- **Tmux** brings the prefix layer: `ctrl+b c` for a new tab, `ctrl+b v` to split, `ctrl+b w` to
  switch workspace, the same muscle memory as in your terminal (via
  [Herdr](https://herdr.dev/)'s keymap).

### The name

_Vimma_ is a Finnish word for a burst of eager, focused energy: the state of being on a roll. You
hear it in _työvimma_, a spell of working when everything flows. It also happens to start with
_Vim_. That is how browsing should feel: fast, fluent and absorbed.

### What it is

Vimma is a Firefox fork for people who live in Vim and a terminal multiplexer. Pages get
Vim's modes, tabs and splits get tmux's `ctrl+b` prefix, workspaces keep their cookies and
logins apart, and the whole window takes its colours from your [Omarchy](https://omarchy.org/)
theme. Underneath it is Firefox (currently 157), so sites and add-ons work as they do there.

## Features

**Vim on the page**

- Normal mode: `j`/`k`/`h`/`l` scroll, `d`/`u` half a page, `gg`/`G` top and bottom,
  `H`/`L` back and forward, `r` reload.
- Link hints: `f` labels every link, button and field on screen; type a label to follow it,
  `F` opens it in a background tab.
- Find: `/` searches as you type (smartcase, frames and PDFs too), `n`/`N` jump between matches.
- Copy mode: `v` puts a caret on the page; move it with Vim motions, select and `y` to copy.
- Insert mode: focusing a text field types as usual; `Esc` leaves it.
- Command line: `:open`, `:tabnew`, `:q`, `:map`, `:source` and any action by name, with
  completion and history.

**Tmux-style tabs, panes and workspaces** (prefix `ctrl+b`)

- Tabs: `ctrl+b c` new, `ctrl+b n`/`p` next and previous, `ctrl+b 1..9` jump, `ctrl+b g` a
  fuzzy picker. Tabs can be renamed. Firefox's tab strip is hidden; the status bar shows where
  you are.
- Split panes: `ctrl+b v` and `ctrl+b -` split, `ctrl+b h/j/k/l` move, `ctrl+b z` zoom, plus
  swap, resize and close. Up to 4 panes, built on Firefox's own split view.
- Workspaces: each one is its own container, so logins and cookies stay apart. `ctrl+i` /
  `ctrl+u` switch, `ctrl+b w` picks one by name, and tabs move between them. Every workspace
  keeps its tabs and split layout across restarts.
- Side panel: `ctrl+b b` (or `space n`) lists the workspace's tabs; pick one with `j`/`k`.
- `ctrl+b ?` lists every binding, searchable.

**Yours to configure**

- `~/.config/vimma/config.toml` sets options, key bindings and workspaces, and applies on save.
  `about:vimma` shows the version and what is in force.
- Omarchy theming: the bars, pickers, hints and start page follow your current theme, and
  switch at once when you change it (Tokyo Night without Omarchy).

**Firefox underneath, with quieter defaults**

- Same user agent and add-on compatibility as Firefox, so sites and extensions just work.
- No studies, experiments, sponsored content or telemetry uploads. Safe Browsing stays on.
- Scriptable: an optional, token-protected control socket and the `vimma-ctl` CLI.

See the [user guide](docs/guide.md) for every key and option, and
[docs/limits.md](docs/limits.md) for what is known not to work.

## Status

**Pre-alpha.** The features above work and are being daily-driven before any release. There
are no packages or binaries yet: Vimma is built from source, on Linux x86_64 only. Version
`0.1.0`, on Firefox 157.0.1.

## Getting started

Building needs about 35 GB of disk and, the first time, under an hour:

```sh
npm ci && npx surfer download && npx surfer bootstrap
npm run import && npx surfer build
npm start
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the details: requirements, faster front-end-only
rebuilds, tests, the project layout and how changes are made.

## Licence

[MPL-2.0](LICENSE), like Firefox. The vendored TOML parser
[smol-toml](https://github.com/squirrelchat/smol-toml) (`packages/vimma-core/src/vendor/smol-toml/`)
is BSD-3-Clause ([ADR-012](docs/adr/012-toml-parser-smol-toml.md)).

## Acknowledgements

- [Firefox](https://www.mozilla.org/firefox/) and Mozilla, for the browser underneath.
- [Surfer](https://github.com/zen-browser/surfer) and [Zen Browser](https://zen-browser.app/),
  for the build toolchain and for showing how to run a Firefox fork this way.
- [Herdr](https://herdr.dev/), whose keymap is the prefix layer.
- [Omarchy](https://omarchy.org/), whose themes Vimma follows.
- [Tridactyl](https://github.com/tridactyl/tridactyl) and [Vimium](https://github.com/philc/vimium), prior art for Vim keys in a browser.
