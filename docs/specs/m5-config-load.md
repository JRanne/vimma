# Spec: m5-config-load

Status: implemented, awaiting review · Milestone: M5 · Area: `src/browser/base/content/vimma/config/`
(new), `host/VimmaHost.sys.mjs`, `ui/theme-host.mjs`, `ui/help-overlay.mjs`, `ui/statusbar.mjs`,
`vimma.js`

The host half of M5's config, on top of core's `reloadConfig` and `formatConfigError`
([m5-core-config-and-theme](m5-core-config-and-theme.md), schema 2 in
[m3-m4-core-prep](m3-m4-core-prep.md)). Plan §6 M5 gate: "a broken config line shows file:line in
the status bar and the old config stays active". Plan §3: poll the file every 2 s; `:source`
forces a read.

## User stories

- As a user, I save `~/.config/vimma/config.toml` with `[keys] new_tab = "prefix+t"` and within
  2 seconds `ctrl+b t` opens a tab in every window, without a restart.
- As a user, a typo on line 3 shows `config.toml:3: keys.new_tabb: unknown action … (did you mean
"new_tab"?)` in red in the status bar; my previous config keeps working until I fix the line,
  and fixing it clears the message.
- As a user, `:source` reads the file at once.
- As a user, `[panes] max`, `[modal] hint_chars`, `[sites."<host>"] insert` and `[theme]`
  (source, font, colours) apply the same way.

## Design

`config/ConfigHost.sys.mjs`, one per app (a shared ES module), started by `vimma.js` for each
window after `VimmaHost` and `PaneViews`:

- **Path:** the pref `vimma.config.path` when set (`~/` expanded), else
  `$XDG_CONFIG_HOME/vimma/config.toml` when that variable is absolute, else
  `~/.config/vimma/config.toml`. Only that file is read; the folder is never listed (it also
  holds the profiles). Nothing is ever written to it.
- **Reads:** at the first window (not awaited: windows start on the built-in keymap), every
  `vimma.config.pollMs` (2000, minimum 50) when `IOUtils.stat`'s `lastModified|size` changed,
  on `:source`, and when the path pref changes. One read at a time; `:source` during a running
  read queues one more. A missing file (also: removed between stat and read) is `""`: the
  defaults, silently.
- **Parse:** core `reloadConfig(active, text)`: all or nothing; on errors the previous config stays
  (before the first good read: the defaults).
- **Apply** (only when the active config changed):
  - `VimmaHost.configure({ keymap, hintChars, sites })`: new in this spec, additive. Each window
    drops a pending sequence, gets a new dispatcher on the keymap, and its `ctrl+b ?` overlay is
    rebuilt from it (`HelpOverlay.setKeymap`). Windows opened later start on it. `hintChars` goes
    to `startHints`; `sites` to `insertModeAfterFocus` through `matchSiteRule` on the focused
    browser's `currentURI.host` (no host: `auto`).
  - `PaneView.max` for each window (`[panes] max`); a new window gets it in `ConfigHost.init`.
  - `ThemeHost.setConfig(theme)`: `source = "file"` stops following Omarchy, as the
    `vimma.theme.source = builtin` pref does (either one suffices); `font` and `[theme.colors]`
    overlay both sources. Unchanged settings cost nothing; a change rechecks at once.
- **Errors:** `VimmaHost.configure({ configErrors })` after every read; `status()` returns them and
  the status bar passes them to core's existing `error` segment (`config.toml:N: …`, `N errors:
…` for several). All of them are logged once per change with the full path
  (`console.error`). A successful read clears them.
- **`:source`:** `RUNNERS["config.reload"]` notifies `vimma-config-reload`; ConfigHost observes
  it, so the host does not import ConfigHost (no import cycle).
- **Hermetic tests:** `tests/browser/browser.toml` sets `vimma.config.path` to a path that does
  not exist, so a developer's own config never rebinds keys under other tests.

## Tests (written first)

`tests/browser/browser_vimma_config.js` (a temporary `vimma.config.path`, `pollMs` 100):

- `[keys] new_tab = "prefix+t"` takes effect after the poll: `ctrl+b t` opens a tab, `ctrl+b c`
  no longer does.
- A broken line keeps the old mapping (`ctrl+b t` still opens a tab, the broken file's
  `prefix+y` does not); the status bar shows `config.toml:3:` with the suggestion; fixing the
  file clears it.
- With a 10-minute poll, `:source` loads the file.
- `schema = 2`, `[panes] max = 2`: the third split is refused (`at most 2 panes`), no tab opened;
  without the file the maximum is 4 again.
- With an Omarchy fixture followed, `[theme] source = "file"` switches the status bar to Tokyo
  Night, `[theme.colors] dark_background` overrides it, and removing the file brings Omarchy back.

Red: the run before `ConfigHost.sys.mjs` existed crashed on `Missing chrome or resource URLs:
chrome://browser/content/vimma/config/ConfigHost.sys.mjs`. Green: 35 passed, 0 failed. Mutation:
not passing `[panes] max` to the pane view fails `panes_max_refuses_a_third_split`; reverted.

## Limits

- Up to 2 s latency (polling, plan §3). Two saves in the same millisecond with the same size
  are seen as one.
- `[workspaces]` applies live since M3 persistence (PR #59): `apply` passes it to
  `WorkspaceStore.setConfig`, which reconciles the definitions as `init()` does (a workspace
  removed from the file becomes runtime), creates containers, saves and notifies the windows.
- Only the first error is shown in the bar; `about:vimma` lists all of them and the theme's
  warnings ([m5-about-vimma](m5-about-vimma.md)).
- User overrides are not marked in `ctrl+b ?` (plan §2); `:source <path>` and `:config` (open the
  file in a tab) are not built.
- Not covered by a browser test: `[modal] hint_chars` and `[sites]` (core tests cover their
  logic; the host only passes them through).

## Handover

Next: `about:vimma` with
`ConfigHost.errors` and theme warnings.
