# Spec: m0-help-overlay

Status: ready (after m0-key-capture) · Milestone: M0 · Area: UI (`src/browser/base/content/vimma/ui/`)

## User story

As a user, `ctrl+b ?` shows every binding over whatever is on screen, including `about:preferences`
and the PDF viewer; I can type `/` to filter and `Esc` to close.

## Scope

- Host wires `createDispatcher(compileKeymap())` into the keydown handler from m0-key-capture:
  `action` and `pending` and `cancel` call `preventDefault()` + `stopPropagation()`; `pass` does nothing.
  `flush()` runs on a `timeoutMs` timer; `replay: true` re-dispatches the same chord.
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
