# ADR-014: Resize mode is a dispatcher mode

- Status: Accepted
- Date: 2026-10-10

## Context

Plan §2 binds `prefix+r` to resize mode: after it, `h/j/k/l` (or `<` `>` `+` `-`) move the
focused pane's divider until `Esc` (m4-split-panes, sub-spec 5). The keys are bare letters that
mean scrolling in `normal` mode, so the mode needs its own key table. The dispatcher contract
(m0-core-dispatcher) is keyed by `Mode`, and `MODES` is a closed list shared with config
validation (`[modal.<mode>]`, `[unbind.<mode>]`), the status-bar badge, `resolveEscape` and the
control protocol's `state.mode` (vimma-ctl keeps a copy). m3-m4-core-models deferred the choice
to this ADR.

## Decision

`resize` joins `MODES`. Its default table (`[modal.resize]`): `h`/`<Left>`/`<` narrower,
`l`/`<Right>`/`>` wider, `j`/`<Down>`/`+` taller, `k`/`<Up>`/`-` shorter, each one step of 0.05;
`<Esc>`, `<CR>` and `q` run a new action, `resize_exit` (`pane.resize_exit`). `resize` is a
count mode, so `3l` is three steps; there are no shifted big-step keys. The host derives the
mode, as it does for `help`: a window flag set by `pane.resize_mode` (two panes or more), cleared
by `pane.resize_exit` or when the window is down to one pane. The mode is modal like `help` and
`hint`: every key is consumed, so the page sees none; global `[keys]` (the prefix layer) still
apply. `resolveEscape` exits it back to the mode it came from. The badge is
`--vimma-mode-resize` (from `brown`).

## Reasoning

A mode keeps the dispatcher's one rule (a mode selects a trie) and gives users `[modal.resize]`
for free, with help listing the keys as `l [resize]`. A count is Vim's way to take bigger steps
(`3<C-w>>`) and needs no extra actions.

## Alternatives rejected

- **A host-side key loop outside the dispatcher** (as the goto picker does): its keys would not
  be rebindable, help could not list them, and Esc handling would be duplicated.
- **A pending prefix that stays open** (`prefix+r` as a sticky prefix): the dispatcher resets a
  sequence after an action, so this needs a new "repeat" result kind, a bigger contract change.
- **Shift for big steps** (`H/J/K/L`): four more actions with an `arg`; counts already do it.

## Consequences

`MODES`, `COUNT_MODES`, `Mode` and the theme's `BADGES` gain `resize`; `[modal.resize]` and
`[unbind.resize]` validate; `docs/bindings.md` and the defaults/help snapshots change. The control
protocol's `state.mode` can be `"resize"`: an older `vimma-ctl` rejects that reply as invalid,
so vimma-ctl's `MODES` is updated in the same change.
