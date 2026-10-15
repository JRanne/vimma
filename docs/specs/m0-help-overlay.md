# Spec: m0-help-overlay

Status: implemented · Milestone: M0 · Area: UI (`src/browser/base/content/vimma/ui/`)

## User story

As a user, `ctrl+b ?` shows every binding over whatever is on screen, including `about:preferences`
and the PDF viewer; I can type `/` to filter and `Esc` to close.

## Scope

- Host wires `createDispatcher(compileKeymap())` into the keydown handler from m0-key-capture:
  `action` and `pending` and `cancel` call `preventDefault()` + `stopPropagation()`; `pass` does nothing.
  `flush()` runs on a `timeoutMs` timer only while `ambiguous()` (ADR-009; a bare prefix never
  times out); `replay: true` re-dispatches the same chord.
- `ui/help-overlay.mjs` + `browser/themes/shared/vimma/help-overlay.css`: a chrome-level panel
  (not in content) rendering `bindingTable(keymap)` grouped by `group`; overrides marked `*`.
- Mode `help` while open: `/` focuses a filter input (`filterBindings`), `Esc`/`q` closes.
- `help.show` while open closes it (toggle).

## Tests (write first)

- `browser_vimma_help_overlay.js`:
  - Given `about:preferences`, when `ctrl+b` `?`, then the overlay is visible and lists `new_tab`.
  - Given a PDF open in pdf.js, when `ctrl+b` `?`, then the overlay is visible.
  - Given the overlay is open, when `/` `rename`, then only rows matching "rename" are shown.
  - Given the overlay is open, when `Esc`, then it is hidden and focus returns to where it was.
  - Given content focused, when `ctrl+b` `?`, then the page receives no keydown for either key.
- Core already covers row content (`help.test.mjs` snapshot).

## Out of scope

Which-key strip (M2), styling beyond legible defaults (M5 theme tokens).

## Settled (2026-10-09, from the engine tree)

- **Base mode is `insert` until M1.** There is no content actor yet to report focus in editable
  elements, so outside the overlay the host dispatches every key as `insert`: only global chords
  (prefix sequences, ctrl/alt/meta bindings) are ours. Dispatching as `normal` would swallow `j`,
  `g` and digits typed into pages, the URL bar and about:preferences (and break m0-key-capture's
  "page still receives `j`"). Mode is `help` while the overlay is open. **Replaced** by
  [m1-actor-insert-scroll](m1-actor-insert-scroll.md): pages are `normal` unless a text field
  has focus; chrome focus (URL bar) is still `insert`.
- **Actions the host cannot run yet are left to Firefox when they are a single key**
  (`esc` → `mode.normal`, `ctrl+i`, `ctrl+u`), so M0 does not regress Esc or those shortcuts.
  Inside a sequence they are consumed: `ctrl+b <anything>` never leaks the second key. The
  runnable set is `RUNNERS` in `VimmaHost.sys.mjs` (`help.show` toggles, `help.close`,
  `help.filter`). `replay` runs the action, then re-dispatches the key, whose result decides
  whether it is consumed. A pending sequence is also reset on `TabSelect`.
- **Filter typing:** while the filter input has focus and nothing is pending, plain keys (no
  ctrl/alt/meta, not `esc`) bypass the dispatcher and go to the input, so `q` and `/` can be typed.
  `esc` from the filter closes the overlay (one press), as does `esc`/`q` outside it.
- **Overlay is an `html:dialog` opened with `showModal()`**, appended to the chrome document's
  body (same mechanism as `#window-modal-dialog` in browser.js): top layer above remote content,
  about:preferences and pdf.js, page inert while open. `dialog.close()` returns focus to the
  element focused before `showModal()` (verified for a remote `<browser>` and for the
  about:preferences search box), so the overlay keeps no focus bookkeeping of its own.
- **No new upstream patch.** Our `jar.mn` registers `ui/help-overlay.mjs` and the stylesheet with
  a topsrcdir path (`(/browser/themes/shared/vimma/help-overlay.css)` → `chrome://browser/skin/
vimma/help-overlay.css`); the overlay loads it with `windowUtils.loadSheetUsingURIString`
  (author sheet) on first open.
- **PDF test fixture:** `tests/browser/file_vimma_test.pdf` is a hand-written one-page PDF (no
  third-party licence); pdf.js tests' own fixtures are not installed when only our manifest runs.
- **Hardening:**
  - A bare prefix no longer times out: the timer is armed only when `dispatcher.ambiguous()`
    (new core API, ADR-009). `ctrl+b`, a pause, `?` still opens help.
  - Help mode is modal for keys too: every key that reaches the dispatcher while the overlay is
    open is consumed, handled or not (`ctrl+w` no longer closes the tab underneath). The filter
    input still gets plain keys. As a fallback, `TabSelect` closes the overlay and focuses the
    newly selected browser (a script closing the tab underneath).
  - `VimmaHost.uninit` removes the `<dialog>`; the stylesheet is loaded once per window.
  - `dialog.focus()` after `showModal()` stays: without it `showModal()` focuses the filter input,
    so `q` and `/` would be typed into it.
  - **Revisit in M1:** "an unrunnable single-key action passes through" is an M0 stopgap. Once
    `normal` mode and the content actor are real, decide per action whether it is consumed.
    Revisited in [m1-actor-insert-scroll](m1-actor-insert-scroll.md) (Settled): unbound keys
    pass; the first key of a sequence with nothing runnable under it passes too (`ctrl+w`).
