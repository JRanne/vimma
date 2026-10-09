# Vimma

Vimma is a keyboard-first browser built as a Firefox fork. The plan: Neovim-style modal control
of the page, [Herdr](https://herdr.dev/)'s prefix keymap (`ctrl+b`) for tabs, panes and
workspaces, `ctrl+b ?` to show every binding, workspaces as isolated Firefox containers, an
on-demand side panel, an always-visible status bar, and an [Omarchy](https://omarchy.org/)-native
look. It is built with [Surfer](https://github.com/zen-browser/surfer), the toolchain behind Zen
Browser, on the Firefox release channel.

## Status

**Pre-alpha.** Milestone M0 ("fork boots + pipeline", [plan.md](plan.md) §6) is almost done.
There are no binaries yet: you build from source. Version `0.1.0`, on Firefox 157.0.1.

What works today:

- **Branding.** The browser calls itself Vimma (`vimma --version`, the window title, About), with
  a placeholder logo. Its profiles are separate from Firefox's.
- **`ctrl+b ?`** opens an overlay listing every binding, over any page, including
  `about:preferences` and the PDF viewer. `/` filters the list and `Esc` or `q` closes it.
- **Hidden tab strip.** Firefox's tab strip is hidden. Firefox's own tab keys (`ctrl+t`,
  `ctrl+w`, `ctrl+tab`, `alt+1..9`, …) still work. Set `vimma.ui.tabstrip.hidden` to `false` in
  `about:config` to bring the strip back.
- **Privacy defaults.** Mozilla studies, experiments and rollouts (Normandy, Nimbus) are off, and
  so are sponsored new-tab content, sponsored suggestions and Mozilla promos. The build has no
  crash reporter and no official telemetry, so nothing is uploaded. Remote Settings, CRLite,
  the add-on blocklist, Sync and AMO work as in Firefox. Each default can be turned back on in
  `about:config`.
- **Firefox-compatible.** Sites see Firefox 157's user agent, byte for byte. Add-ons, webcompat
  fixes and Remote Settings see Firefox's version number.

What does not work yet: every other binding in the overlay. The overlay lists the full planned
keymap, but only `ctrl+b ?` runs today. Other `ctrl+b` sequences do nothing. The modal page
layer (scrolling, link hints, find, `:` command line, copy mode) is M1. Vimma's own tab keys, the
status bar, the which-key strip and the `ctrl+b g` picker are M2. Workspaces, split panes,
`config.toml` and theming come later. The parser and validator for `config.toml` exist in
`vimma-core`, but the browser does not read the file yet. See [docs/guide.md](docs/guide.md) and
[docs/limits.md](docs/limits.md).

## Requirements

- Linux x86_64 (the only platform built and tested so far).
- About 25 GB of free disk space: `engine/` is 22 GB after a full build, plus the Firefox source
  download and toolchains in `~/.mozbuild`.
- Node.js 20 or later, Python 3, git.
- Time: the first full build took 39 min on a 16-thread Ryzen with 58 GB RAM. The Firefox source
  download took 12.5 min. See [docs/runbook.md](docs/runbook.md).

## Build and run

```sh
npm ci                  # dev tools, including Surfer
npx surfer download     # Firefox source for the version in surfer.json, into engine/
npx surfer bootstrap    # Mozilla's toolchains into ~/.mozbuild (once)
npm run import          # apply Vimma's files and patches, select the vimma brand
npx surfer build        # full build
```

Run it with its own profile, so it never touches your Firefox profile:

```sh
mkdir -p ~/.cache/vimma-dev-profile
engine/obj-x86_64-pc-linux-gnu/dist/bin/vimma --no-remote --profile ~/.cache/vimma-dev-profile
```

`npx surfer run` also works. It launches through `mach run`, which uses a scratch profile in the
build directory.

After editing JavaScript or CSS under `src/`, run `npm run import && npx surfer build --ui`. That
rebuilds only the front end. Changes to branding, `configs/` or `moz.configure` need a full
`npx surfer build`.

## Testing

```sh
npm test                 # Vitest: vimma-core and tools (fast, no browser)
npm run typecheck        # tsc --checkJs
npm run lint             # eslint + prettier --check
npm run mochitest -- tests/browser/                       # browser tests on your full build
npm run mochitest -- tests/browser/browser_vimma_tabstrip.js
```

You can also test the front end without a full build. An artifact build puts our front end on
top of Mozilla's compiled binaries for the same release, and is what PR CI uses
([ADR-010](docs/adr/010-pr-artifact-builds.md)):

```sh
npm run import
node tools/artifact-build/artifact-build.mjs    # ~25 s warm; first run downloads 163 MB
npm run mochitest -- --artifact tests/browser/
```

An artifact build cannot check compiled-in settings (the `--version` string, the crash reporter
flag). A PR that touches patches, `configs/`, `moz.configure` or branding must report a
mochitest run on a full build.

## Project layout

| Path                              | What                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `packages/vimma-core/`            | Pure ES modules with no Firefox imports: key notation, actions, keymap, dispatcher, config and theme. Tested with Vitest.     |
| `src/browser/base/content/vimma/` | Our browser code: the key host, UI (help overlay, tab strip) and services. `core/` is copied in by `npm run sync-core`.       |
| `src/**/*.patch`                  | The small upstream patches, each listed in [ADR-003](docs/adr/003-own-files-minimal-patches.md).                              |
| `configs/`                        | mozconfigs and branding inputs.                                                                                               |
| `tests/browser/`                  | Mochitests (`browser_vimma_*.js`).                                                                                            |
| `tools/`                          | Build, upstream-bump, licence and commitlint helpers.                                                                         |
| `docs/`                           | [User guide](docs/guide.md), [bindings](docs/bindings.md), [limits](docs/limits.md), specs, ADRs, [runbook](docs/runbook.md). |

## Contributing

Vimma follows a spec-first, test-first loop ([plan.md](plan.md) §4–§5):

- **Specs.** Every feature starts as `docs/specs/<milestone>-<feature>.md`, with acceptance
  criteria written as Given/When/Then. Boundary changes and new upstream patches need an ADR in
  `docs/adr/`.
- **TDD.** Write the failing test and run it, then implement until it passes. Never loosen a test.
- **Commits.** Use Conventional Commits with a body: the body is the changelog line.
  `npx commitlint --from origin/main` checks this, and CI rejects `feat` and `fix` commits
  without a body.
- **Docs.** A user-visible change updates [docs/guide.md](docs/guide.md), and this README's
  status if it changes what works. See [docs/review-checklist.md](docs/review-checklist.md).
- **Agents.** [CLAUDE.md](CLAUDE.md) sets the rules for AI coding agents. They apply to human
  contributors too.

Before pushing, run `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:py`,
`npm run license-check` and `npx surfer license-check`.

## Licence

[MPL-2.0](LICENSE), like Firefox. The vendored TOML parser
[smol-toml](https://github.com/squirrelchat/smol-toml) (`packages/vimma-core/src/vendor/smol-toml/`)
is BSD-3-Clause ([ADR-012](docs/adr/012-toml-parser-smol-toml.md)).

## Acknowledgements

- [Firefox](https://www.mozilla.org/firefox/) and Mozilla, for the browser underneath.
- [Surfer](https://github.com/zen-browser/surfer) and [Zen Browser](https://zen-browser.app/),
  for the build toolchain and for showing how to run a Firefox fork this way.
- [Herdr](https://herdr.dev/), whose keymap is the prefix layer.
- [Omarchy](https://omarchy.org/), whose themes Vimma will follow.
- [Tridactyl](https://github.com/tridactyl/tridactyl), the planned reference for link hints.
