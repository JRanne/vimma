# Spec: m0-key-capture

Status: ready · Milestone: M0 · Area: host (`src/browser/base/content/vimma/host/`)
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
- `src/browser/base/content/browser.xhtml.patch`: one hunk that loads the host script
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

## Open questions to settle here

- Is a `browser.js.patch` needed at all, or is the `browser.xhtml` script tag enough?
- Where do mochitests live inside the engine tree for `./mach test` to find them (`browser.toml`)?
