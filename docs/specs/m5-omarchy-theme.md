# Spec: m5-omarchy-theme

Status: implemented, awaiting review · Area: UI (`src/browser/base/content/vimma/ui/theme-host.mjs`,
`vimma.js`, `ui/statusbar.mjs`, `start/start.mjs`)

The theme half of M5. `config.toml` loading and its `[theme]` table: [m5-config-load](m5-config-load.md).

## User story

As an Omarchy user, Vimma's chrome UI (status bar, command line, pickers, hints, notices, pane
borders, start page) has my current Omarchy theme's colours, and when I switch theme with
`omarchy-theme-set` every open window and start page follows within 2 seconds, with no restart.
Without Omarchy I get the built-in Tokyo Night, and I can force it.

## Scope

- **One theme host per app:** `ui/theme-host.mjs`, imported with `ChromeUtils.importESModule`
  (one module instance for all windows) and started from `vimma.js` with `ThemeHost.init(window)`
  before `VimmaHost.init`. It replaces the status bar's one-off Tokyo Night sheet (the only
  injection point): each window gets ONE author sheet (`windowUtils.loadSheetUsingURIString`, a
  `data:text/css` URI of `tokensToCss(tokens, ":root")`); on a change the new sheet is loaded and
  then the old one removed, so no frame lacks tokens. The status bar still loads `statusbar.css`.
- **Start page:** `start.mjs` (parent process, system principal) imports the same module and calls
  `ThemeHost.attachDocument(document)`: a `<style>` in the page's head, kept in a `WeakRef` set
  and rewritten on every change. `start.css`'s fallbacks cover the first paint.
- **Read:** `colors.toml` with `IOUtils.readUTF8` from the directory in `vimma.theme.omarchyPath`
  (default `~/.local/state/omarchy/current/theme`; `~` is `Services.dirsvc` `Home`), and whether
  `light.mode` exists; then core's `resolveTheme({ theme: { source: "omarchy", font: "monospace",
colors: {} }, omarchy, omarchyLightMode })` and `tokensToCss` (strict validation; nothing else
  reaches the sheet).
- **Startup never waits:** the module starts with Tokyo Night's CSS (computed synchronously from
  core, no I/O); the first check runs async and swaps when it completes.
- **Poll:** every `vimma.theme.pollMs` (default 2000, a test knob) an async `IOUtils.stat` of
  `colors.toml` plus `IOUtils.exists(light.mode)`. The signature is the path, `lastModified`,
  `creationTime`, `size` and the light flag; the file is read only when it changes. The stat
  describes the file the path resolves to now, so `omarchy-theme-set`'s swap of `current/theme`
  (Omarchy 4 replaces the directory with `mv`; older setups use a symlink) changes it: no sync
  `realpath` on the main thread. One check at a time; a tick during a check is skipped. The
  timer stops when the last window closes.
- **Errors:** a file `resolveTheme` rejects keeps the last good theme; one `console.warn` listing
  each error with its line, and `vimma-theme-error` is notified. The signature is kept, so the
  same broken file is not re-read or re-logged. Contrast warnings go to `console.info`.
- **Missing theme:** no `colors.toml` means Tokyo Night, unless an Omarchy theme was applied since
  startup or the last `vimma.theme.*` change: then the theme stays (omarchy-theme-set's `rm -rf`
  before its `mv` would otherwise flash Tokyo Night for one poll).
- **Prefs:** `vimma.theme.source` = `omarchy` (default) or `builtin`; `vimma.theme.omarchyPath`.
  A change to either re-checks at once. `vimma-theme-changed` is notified after new tokens apply.
- **Hermetic tests:** `tests/browser/browser.toml` sets `vimma.theme.source=builtin` for the
  directory, so a developer's own Omarchy theme never reaches other tests' colour assertions;
  `browser_vimma_theme.js` turns it back on. The e2e harness already gives the browser a `HOME`
  inside its temp profile, so its baselines stay Tokyo Night.

## Tests (written first)

`tests/browser/browser_vimma_theme.js` (Linux only: `ln -s`), with hand-written Omarchy 4
`colors.toml` fixtures in a temp dir, `current/theme` a symlink, `vimma.theme.pollMs` = 100:

- the status bar's computed background is the fixture's `dark_background` (the
  `--vimma-statusbar-bg` source) and `--vimma-bg` its `background`;
- an open start page has the fixture's background and follows a rewrite;
- rewriting the file updates the bar within a few polls;
- a broken file (`dark_background = "not a colour"`) keeps the previous colours, also after more
  polls;
- `ln -sfn` of `current/theme` to another theme dir updates;
- a theme without a `mode` key and with `light.mode` gives `--vimma-color-scheme: light`;
- a path with no Omarchy theme gives Tokyo Night (`#13141c`), and back; `builtin` forces it.

Red (before the host existed): 4 of 5 tasks failed (`timed out` waiting for the fixture's
colours). Green: 11/11. Mutation check: dropping the `return` after a rejected file made
`broken_file_keeps_the_previous_colours` fail (`rgb(19, 20, 28)` instead of `rgb(24, 48, 24)`);
reverted. Full `tests/browser/` in a lane: 1843 expected, 0 unexpected.

Follow-up (2026-10-10, M5 polish): the `ctrl+b ?` overlay was the one surface still on system
colours. `help-overlay.css` now uses the picker's tokens (`--vimma-bg-dark` surface and sticky
header, `--vimma-fg` text, `--vimma-muted` border, `--vimma-accent` headings and focused filter,
`--vimma-color-scheme`), each with the old system colour as fallback. Two tasks,
`overlays_and_prompts_follow_a_{dark,light}_theme`, open the overlay, the `ctrl+b g` picker, the
`:` line and the `ctrl+b T` rename prompt under a dark and a light fixture and compare their
computed background and text with `--vimma-bg-dark` and `--vimma-fg`. Red: 8 failures, all the
overlay's (`rgb(255, 255, 255)` instead of `rgb(48, 16, 48)`; the picker, line and prompt already
passed). Green: 37/37. Mutation: the overlay's `color` back to `CanvasText` failed both text
assertions (`rgb(251, 251, 254)` vs `rgb(169, 177, 214)`); reverted. The e2e help baseline is
re-recorded from CI's image (the overlay is now Tokyo Night).

## Limits

- Up to 2 s latency per theme change (polling). A `~/.config/omarchy/hooks/theme-set.d/` hook that
  pokes the control socket could make it instant; not done (docs/notes/omarchy-theming.md).
- Font, `[theme.colors]` overrides and `[theme] source = "file"` come with `config.toml` loading.
- Not covered: Hyprland's gaps, rounding and borders (docs/notes/omarchy-theming.md).
- Issue #66 (2026-10-10): a check still reading the old path when the path or source changed
  applied that theme afterwards; `recheck()` now bumps a generation and a stale check drops
  what it read (test `a_path_change_during_a_check_is_not_undone_by_it`; m5-config-load).

## Settled

- `.mjs` in `ui/`, not a `.sys.mjs`: it is only ever imported through `importESModule`, like
  `split/PaneView.mjs`, and relative imports of `../core/*.mjs` work there.
- No change to `VimmaHost.sys.mjs` (another spec owned it at the time).
