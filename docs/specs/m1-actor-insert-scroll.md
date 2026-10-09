# Spec: m1-actor-insert-scroll

Status: implemented, awaiting review · Milestone: M1 · Area: actors
(`src/browser/base/content/vimma/actors/`), host (`host/VimmaHost.sys.mjs`)
Prototype slice of M1's modal page layer: the content actor, insert detection and scrolling.

## User story

As a user, Vim keys work on pages. In `normal` mode `j`/`k` scroll, `gg`/`G` go to the top and
bottom and `d`/`u` scroll half a page. Typing in any text field still works, because focusing
it enters `insert` mode. `Esc` leaves insert by blurring the field, and `i` enters insert
explicitly.

## Scope

- `actors/VimmaParent.sys.mjs`, `actors/VimmaChild.sys.mjs`: a JSWindowActor pair, registered
  at runtime by `actors/VimmaActors.sys.mjs` (called from `vimma.js`).
- The child reports focus changes with an `EditableDescriptor` (m1-core-logic) and runs scroll,
  blur and focus-first-input commands. The parent is the only thing that talks to it, and hands
  reports to the host.
- The host keeps a mode per `<browser>` (`normal` or `insert`) and runs `scroll.*`,
  `mode.normal` and `mode.insert` from `normal` and `insert` mode.
- Bindings are plan §2's: `j k h l`, `gg`, `G`, `d`/`u` (half page; `ctrl+u` is the previous
  workspace, so half-page scroll is not `ctrl+d`/`ctrl+u`), `i`, and `Esc` in insert. A count
  multiplies `j k h l d u` (`3j`).

## Tests (write first)

`tests/browser/browser_vimma_insert_scroll.js`, fixtures `file_vimma_insert_scroll.html` and
`file_vimma_frame.html` (served cross-origin from `example.org`), general.smoothScroll off:

- On a long page, `j` scrolls down and `k` up, `3j` three steps, `G` to the bottom, `gg` to the
  top, `d`/`u` half a viewport. The page receives none of these keydowns.
- Focusing an `<input>` enters insert: `j` types "j" and does not scroll. `Esc` blurs it and
  returns to normal, and `j` scrolls again.
- A textarea, a contenteditable, a `role="textbox"`, an input in an open shadow root, one in a
  closed shadow root and one in a cross-origin iframe all enter insert; `Esc` leaves.
- A focused checkbox or button leaves insert, and `j` scrolls.
- `i` focuses the first text input and enters insert.
- Insert is per tab: switching tabs gives each tab its own mode.
- Unbound bare keys in normal mode reach the page.
- The actor reaches Settings (search box focused: insert, `Esc`: normal) and the PDF viewer; a
  `data:` page has none and stays in insert.

Mutation check: dropping `isContentEditable` from the child's descriptor fails the
contenteditable case only (reverted). Stress: `--repeat=9` on two busy CPUs, 0 unexpected.

Existing tests: `pageKeysThenJ` in the help overlay test and the key-capture test used `j` as
"a key that is never ours"; `j` is ours in normal mode now, so they use `z`, which is unbound.

## Out of scope

Hints, find, the command line, copy mode, history and reload keys (other M1 specs); per-site
`[sites]` config (passed as `site = "auto"`); the status bar mode badge (M2); a notice for
actions that are not implemented yet (parallel spec).

## Settled (2026-10-09, from the engine tree)

- **Actor registration.** `ChromeUtils.registerWindowActor("Vimma", …)` from our own
  `actors/VimmaActors.sys.mjs`, as `PageDataService`, `Interactions` and `MigrationUtils` do at
  runtime; no upstream patch, no `ActorManagerParent` entry. Once per process (a module flag);
  `vimma.js` calls it before `VimmaHost.init`. `allFrames: true`; message manager group
  `browsers` (tabs only, not the sidebar or devtools); matches `http://*/*`, `https://*/*`,
  `file:///*` and `about:*` (`JSWindowActorProtocol` builds the patterns with
  `restrictSchemes = false`, so `about:` works). Modules live under
  `chrome://browser/content/vimma/actors/`; content processes load chrome:// modules
  (`NetErrorChild` imports one). `safeForUntrustedWebProcess: true` is required for web content
  processes (`JSActorProtocol::RemoteTypeMatches`); the parent takes only a well-formed
  `{ descriptor, trigger }` from the child, and a forged one can only flip that tab's mode.
  ESLint gets `JSWindowActorChild`/`JSWindowActorParent` as globals for `actors/` only.
  - `about:preferences` and other parent-process `about:` pages get the child in the parent
    process. Settings focuses its search box on load, so it opens in insert; `Esc` gives normal,
    where `j` scrolls it (tested).
  - The PDF viewer: the document's URI is the PDF's, so it matches; pdf.js scrolls
    `#viewerContainer`, found by the largest-scrollable fallback below.
  - `moz-extension:`, `data:`, `view-source:`, `blob:` and `chrome:` pages get no actor. With no
    actor the host treats the browser as `insert`: every key reaches the page as in M0.
    Extension pages are the extension's own UI, often with their own keys; a later spec can add
    them.
- **Child events.** `focusin` and `focusout` (capture), plus `focus` on the window (focus back
  from a subframe). The actor's listener sits on the chrome event handler and sees the event's
  `originalTarget`, unretargeted, so an input inside an open or a closed shadow root is seen.
  For rechecks the child walks `activeElement` through `openOrClosedShadowRoot` (privileged).
  Reports: `{ descriptor, trigger }` with `trigger` `focusin` or `recheck` (focusout, window
  focus). Not reported: a focus on an `<iframe>`/`<frame>` element (the frame's own child
  reports), and a recheck in a document that no longer has focus (tab switch, focus into
  another frame), so cross-process report order cannot undo the newer frame's report.
- **Descriptor, not verdict.** The child sends the plain `EditableDescriptor`; the parent host
  runs `insertModeAfterFocus` (core). Site rules (config, M1 host) and the mode transitions
  live in the parent, next to the dispatcher. The child imports only core's `editable.mjs`, to
  pick the field for `i` with the same `isEditable` rules.
- **Per-browser mode.** The host keeps `WeakMap<browser, "normal" | "insert">`; a report goes to
  `top.embedderElement`. Dispatch mode: `help` while the overlay is open; the focused browser's
  mode when chrome focus is on a `<browser>` (default `normal`; `insert` when the browser has no
  actor); `insert` when focus is in chrome (URL bar, find bar), so chrome text fields keep their
  keys. Insert is entered only by a `focusin` report or `i`; Esc in insert runs `mode.normal`
  (`resolveEscape`'s `blur`), which blurs the field; the `focusout` recheck stays normal.
- **`i` (`mode.insert`).** The child focuses the first visible, enabled, editable text field
  (`input` not in the excluded types, `textarea`, contenteditable) and the focusin enters
  insert. With none, the host enters insert anyway: an explicit pass-through for pages that
  capture keys (games), left with `Esc`.
- **Scrolling** runs in the focused frame's child (`Services.focus.focusedContentBrowsingContext`
  when it belongs to the browser, else the top frame); a frame with nothing to scroll answers
  false and the top frame scrolls instead. Target: the nearest scrollable ancestor of the
  focused element (through shadow hosts), else `document.scrollingElement` when it can scroll,
  else the largest visible scrollable element (app shells, pdf.js). Amounts: `j k h l` 60 px
  (Vimium's `scrollStepSize`) times the count; `d`/`u` half the target's client height, rounded
  to a whole pixel so `d` then `u` returns to the same place, times the count; `gg`/`G` to 0 and the end. `behavior` is `smooth` when `general.smoothScroll` is
  true, else `instant`.
- **"Pass if not runnable", revisited.** Unbound bare keys in normal mode pass to the page: plan
  §3 ("keys the dispatcher returns `pass` for continue untouched") and plan §2's `[unbind]`, which
  would be pointless if unbound keys were swallowed; sites' own single-key shortcuts (GitHub `s`,
  YouTube `m`) keep working wherever Vimma has no binding. Bound actions the host cannot run
  yet keep M0's rule (the first key passes, a later key in a sequence is consumed); the parallel
  "not implemented" spec owns that rule. One addition: the **first key of a normal-mode
  sequence passes when no action under it is runnable**. Without it `ctrl+w` (the `<C-w>h`
  pane family, M4) would wait forever and Firefox's `ctrl+w` would stop closing tabs, which plan
  §2 says it keeps by default. `ctrl+b` and `g` lead to runnable actions and stay ours.
- **Content-only actions in chrome.** `scroll.*`, `mode.normal` and `mode.insert` run only when a
  content browser has focus; elsewhere (URL bar) they count as not runnable, so `Esc` still
  reverts the URL bar.

## Limits

- Pages that capture keys outside an editable element (games, Google Docs' canvas, Figma) see
  their bare keys taken by normal mode; press `i` for pass-through insert. Editors are covered
  by the editable rules (`KNOWN_EDITORS`, contenteditable, ARIA roles).
- Digits are counts in normal mode, so a page's own digit shortcuts need insert.
- No actor on `moz-extension:`, `data:`, `view-source:` and `blob:` pages: they stay in insert.
- Focus moved by a page script from a subframe to the top document's `<body>` can leave insert
  on until `Esc` (no focusin fires on `<body>`; the window `focus` recheck covers most cases).
