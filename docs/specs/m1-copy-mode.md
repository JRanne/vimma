# Spec: m1-copy-mode

Status: implemented, awaiting review · Milestone: M1 · Area: actors
(`src/browser/base/content/vimma/actors/`), host (`host/`). Builds on
[m1-actor-insert-scroll](m1-actor-insert-scroll.md) (the actor pair, focused-frame messages),
[m1-core-logic](m1-core-logic.md) (`visual` mode, `escape.mjs`) and [m1-hints](m1-hints.md)
(strict checks of content replies). Completes plan §6's M1 row.

## User story

As a user, `v` (or `ctrl+b [`, tmux's copy mode) puts a caret at the top of what I see, or at
the selection if one is on screen, and the badge says `VISUAL`. `h j k l w b 0 $ gg G` move it
and the page scrolls to follow. `v` starts a selection at the caret that the motions extend
(`v` again drops it). `y` copies the selection as plain text, says "yanked N chars" and I am
back in normal mode. `Esc` drops the selection and leaves. The page sees none of these keys.

## Bindings (plan §2, actions.mjs, defaults.mjs)

Plan §2 binds copy mode to `prefix+[` and `v`; `[modal.visual]` had `h j k l w b y` and `Esc`.
This spec adds `0` / `$` (line start / end), `gg` / `G` (top / bottom of the page) and `v`
(`selection.toggle`) to `[modal.visual]`, with their actions in the "Copy mode" group. Plan §2
lists no other yank key: `yy` (yank the URL) is not bound, so in normal mode `y` reaches the
page as any unbound key.

## Scope

- `actors/caret.mjs`: one frame's copy mode (`Caret`) and `isCaretMessage`, the strict check.
- `actors/VimmaChild.sys.mjs`: `Vimma:Caret` (`{ op, count? }`), refused unless the frame's
  document has focus.
- `actors/VimmaActors.sys.mjs`: `caret(browser, op, count)`, sent to the focused frame only
  (`framesFor(browser)[0]`); a reply of the wrong type is a failure.
- `host/copy-mode.mjs`: the runners (`mode.visual`, `caret.*`, `selection.toggle`,
  `selection.yank`), spread into `CONTENT_RUNNERS`; the clipboard write
  (`nsIClipboardHelper.copyString`, plain text) is in the parent.
- `host/VimmaHost.sys.mjs` (small, additive): page mode `visual`; `mode.normal` asks the frame
  to leave first; plain keys that pass in `visual` are consumed; a focus report keeps `visual`
  unless a text field takes focus (insert).

## Tests (written first)

`tests/browser/browser_vimma_copy_mode.js`, fixtures `file_vimma_copy.html` (known lines at the
top, a cross-origin frame, a last line 3000 px down) and `file_vimma_copy_frame.html`:

- `v` places an enabled caret (`nsISelectionController.getCaretEnabled`) at offset 0 of the
  first line; the status mode is `visual`.
- `l h w $ 0 j k` move the selection's focus (offsets and nodes asserted); `G` reaches the last
  line and scrolls the page; `gg` comes back.
- `v w l` selects exactly `"alpha "`; `y` puts it on the clipboard
  (`SimpleTest.promiseClipboardChange`), returns to normal and says "yanked 6 chars".
- `v` again collapses the selection, motions move a bare caret; `ctrl+b [` enters too; `Esc`
  clears the selection and disables the caret; `y` with nothing selected leaves the clipboard
  and says "nothing to yank".
- Plain keys in copy mode (`l x z q`) never reach the page; after `Esc` they do.
- In a focused cross-origin iframe the caret, selection and yank work in that frame and leave
  the top frame's selection alone.
- Malformed `Vimma:Caret` messages (`null`, a string, `constructor`, `__proto__`, count `0`,
  `1.5`, `"2"`) and an `enter` to an unfocused frame are refused.

Core: `dispatcher.test.mjs` "copy mode keys" (`v 0 $ gg G y` in visual, a count on `w`).
Mutation check: dropping the consume of passing keys in `visual` fails "the page gets no keys"
(`["x","z","q","z"]` vs `["z"]`); reverted.

## Settled (2026-10-09, from the engine tree)

- **Caret API.** Firefox's caret browsing (F7) sets `accessibility.browsewithcaret`, and
  `nsFocusManager::UpdateCaret` then enables the PresShell caret on focus changes. Copy mode
  leaves the pref alone and calls the same `nsISelectionController` (the frame's docShell, as
  `ViewSourcePageChild` gets it): `setCaretEnabled`, `setCaretVisibilityDuringSelection`,
  `characterMove`, `wordMove`, `lineMove`, `intraLineMove`, `completeMove`, with `extend` while
  selecting. A focus change turns the caret off (`UpdateCaret` with the pref off), so each motion
  enables it again.
- **Scrolling.** The moves scroll their nearest scrollable; after each, the focus region is
  scrolled into view (`scrollSelectionIntoView`, `SELECTION_FOCUS_REGION`, synchronous).
- **`w` / `b`** are Firefox's word motions (`layout.word_select.*`): on Linux `w` stops at the
  end of a word, not at the start of the next one as Vim's does.
- **Leaving** (`Esc`, `y`) collapses the selection to the caret, so a later `v` or `/` starts
  there, and disables the caret.
- **Keys.** Plain keys are consumed in copy mode; chords with `ctrl`, `alt` or `meta` stay
  Firefox's (`ctrl+c` copies the selection, `ctrl+t` opens a tab).
- **A page that navigated** has a new actor with copy mode off: the next motion is refused and
  the tab goes back to normal (that key does nothing).
- **Counts** repeat a motion, at most 1000 steps.

## Limits

- Copy mode works in the frame that has focus. A cross-origin frame needs focus first (a click,
  or a hint on something in it); the caret does not move from one frame into another.
- `w` is Firefox's word motion, not Vim's (above); no `e`, `W`, `B`, `{`, `}`, `o` (swap ends)
  or line-wise `V`.
- The text inside `<input>` and `<textarea>` is not part of the page's selection (a text control
  is its own editor): to copy from a field, focus it (insert mode) and use `ctrl+c`.
- `y` copies plain text only; no HTML flavour.
- Clicking into a text field during copy mode enters insert, as in normal mode.

## Out of scope

Yank shortcuts not in plan §2 (`yy` URL, `yf` link), line-wise visual, registers, search
inside copy mode (`/` there is unbound), copy mode in pages without our actor.
