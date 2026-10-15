# Spec: m0-key-capture

Status: implemented · Milestone: M0 · Area: host (`src/browser/base/content/vimma/host/`)
Prerequisite: Surfer project set up and `npx surfer build` succeeded once (plan §10 step 3).

## User story

As the vimma developer, I can see every chrome-window keydown, including keys in `about:preferences`,
the URL bar and the PDF viewer, logged with the chord vimma-core would see, so the dispatcher can
be wired in next.

## Scope

- `src/browser/base/content/vimma/host/VimmaHost.sys.mjs`: `VimmaHost.init(window)` installs
  `window.addEventListener("keydown", handler, true)`; `uninit(window)` removes it.
  The handler converts the event with `chordFromEvent` (vimma-core, synced into
  `src/browser/base/content/vimma/core/` by `npm run sync-core`) and logs
  `{ key: formatKey(chord), mods, mode: "normal" }` via `console.debug` when pref `vimma.debug.keys` is true.
  It never calls `preventDefault` in this spec.
- `src/browser/base/content/browser-xhtml.patch`: one hunk that loads the host script
  and calls `VimmaHost.init(window)`. Record the patch in ADR-003's patch register.
- `npm run sync-core` script: copies `packages/vimma-core/src/*.mjs` into `src/.../vimma/core/`.
  Check how Surfer/`jar.mn` registers new chrome files before choosing paths; do not guess from
  memory (grep the engine and Zen's `zen-components`).

## Tests (write first)

- `tests/browser/browser_vimma_key_capture.js` (mochitest browser-chrome):
  - Given a new tab with `about:preferences`, when `EventUtils.synthesizeKey("b", { ctrlKey: true })`,
    then the host's test hook records `ctrl+b`.
  - Given a tab with `https://example.com`, when `j` is pressed with focus in content, then `j` is
    recorded and the page still receives it (no `preventDefault`).
  - Given the URL bar is focused, when `ctrl+b` is pressed, then it is recorded.
- Expose a test hook (`VimmaHost._lastChords`, test-only) rather than scraping the console.

## Out of scope

Dispatching actions, consuming keys, modes other than `normal`.

## Settled (2026-10-09, from the engine tree and Surfer's source)

- **No `browser.js.patch`.** `browser.xhtml` loads `browser-main.js` as a classic `<script>`; one more
  `<script src="chrome://browser/content/vimma/vimma.js">` after it is enough. That script calls
  `ChromeUtils.importESModule` on the host (chrome:// URLs work, as `browser-main.js` does for
  `tabgroup.mjs`) and `VimmaHost.init(window)`.
- **Patch names follow `surfer export`**: dots become dashes, so `browser-xhtml.patch`, not
  `browser.xhtml.patch`.
- **Registration: our own `moz.build`.** `src/browser/base/content/vimma/moz.build` declares
  `JAR_MANIFESTS` (our `jar.mn`, `browser.jar` section, so files land under
  `chrome://browser/content/vimma/`) and `BROWSER_CHROME_MANIFESTS`. Upstream gets one line:
  `browser/base/moz-build.patch` adds `"content/vimma"` to `DIRS`. This avoids touching the
  long, churny `browser/base/jar.mn` and `BROWSER_CHROME_MANIFESTS` lists.
- **Mochitests live in `tests/browser/`.** `surfer import` symlinks every file under `tests/` into
  `engine/browser/base/zen-components/tests/` (path hard-coded in Surfer's `copy-patches.js`).
  Our `moz.build` points at it with a topsrcdir path
  (`/browser/base/zen-components/tests/browser/browser.toml`; mozbuild resolves `/`-prefixed
  `SourcePath`s against topsrcdir). `npm run mochitest -- tests/browser/x.js` maps the path and
  runs `./mach mochitest --headless` in `engine/`.
- **`src/.../vimma/core/` is generated** by `npm run sync-core` and git-ignored; `npm run import`
  runs `sync-core` then `surfer import`, so a fresh clone cannot build with stale copies.
- **First build after adding a `moz.build`** needs a plain `./mach build` (backend regen);
  `surfer build --ui` (`mach build faster`) is enough afterwards for JS/CSS edits.
