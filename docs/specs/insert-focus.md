# Spec: insert-focus

Status: implemented · Area: `host/VimmaHost.sys.mjs`, `host/page-ops.mjs`,
`actors/VimmaActors.sys.mjs`, `actors/VimmaParent.sys.mjs`, `actors/VimmaChild.sys.mjs` · Upstream
patches: none · ADR: none

Issue: [#165](https://github.com/vimma-browser/vimma/issues/165)

## Summary

Insert mode entered with `i` or `gi` now lasts until `Esc`, whatever the page does with focus, so
keys typed into a page never turn into Vimma commands halfway through. `i` goes back to the text
field the user was last in on the page, and only falls back to the page's first field when there
is none. Insert entered by focusing a field keeps following the focus as before.

## Problem

Until this change, every focus report from the page decided the tab's mode, including after an
explicit `i` ([m1-actor-insert-scroll](m1-actor-insert-scroll.md), "Per-browser mode").

- A page that moves focus itself ends insert. GitHub's "Go to file" box moves focus to its result
  list while the user types; YouTube's consent dialog takes focus on load. The focus report then
  put the tab back in normal mode, and the keys that followed ran as Vimma commands: `t` opened a
  tab, `j` scrolled. The site-compat suite's shortcut probe opened stray tabs this way
  ([site-compat](site-compat.md), "Implementation log (sub-PR 1)").
- A page that blurs its field (to show a menu, or after a submit) ends insert the same way.
- `i` always focused the page's first text field. A user who was typing in a comment box, pressed
  `Esc` to scroll, and pressed `i` to continue was put in the search box at the top instead.

## Behaviour

1. **Explicit insert.** `i` (`mode.insert`) and `gi` (`page.focus_input`, when a field took
   focus) enter _explicit insert_. While the tab's top document is the one it was entered on, a
   focus change in the page **must not** end it: focus moving to a non-editable element, to the
   document body, or into another frame leaves the tab in insert, and every key reaches the page.
2. **Leaving it.** `Esc` ends explicit insert as it ends any insert (`mode.normal`: the field is
   blurred and the tab is in normal mode). A new top document in the tab (a navigation or a
   reload) ends its hold: the first focus report from the new document decides the mode by the
   usual rules. A same-document navigation (`history.pushState`) keeps it, and so does going
   back to the same document restored from the back-forward cache, since that keeps its inner
   window.
3. **`i` goes back to the last field.** `i` focuses the text field that last took focus in the
   tab, if its frame still shows the same document and the field is still connected, visible and
   editable,
   including a field in a cross-origin frame and a contenteditable editor. Otherwise it focuses
   the page's first visible text field, as before. With neither, it is the pass-through insert of
   [m1-actor-insert-scroll](m1-actor-insert-scroll.md).
4. **Focus insert is unchanged.** Insert entered by focusing a field (a click, `Tab`, a page's
   `autofocus`) follows the focus: a page moving focus from one field to another keeps insert,
   and focus moving to a button, a link or the body returns to normal.
5. `gi` keeps its count: `gi` focuses the first field, `3gi` the third
   ([m1-actor-insert-scroll](m1-actor-insert-scroll.md), "Follow-up: normal-mode extras").

## Research

- **Vim.** `gi` "Insert[s] text in the same position as where Insert mode was stopped last time in
  the current buffer" (`:help gi`, `runtime/doc/insert.txt:1953-1955`, Neovim 0.12.5, read
  locally). Insert mode in Vim ends only on `Esc` (or `ctrl+c`, `ctrl+[`); nothing in the buffer
  ends it for the user.
- **Vimium** (philc/vimium at `5aa29614bf`, after v2.4.2, read with `gh api`): `i` is
  `enterInsertMode`, "Enter insert mode" (`background_scripts/all_commands.js:150-154`), which
  focuses nothing and passes keys to the page; it exits on `Esc` and when a focusable element takes
  focus (`exitOnFocus: true`, `content_scripts/mode_normal.js:208-212`), after which the
  permanent, focus-tracking insert mode takes over (`content_scripts/mode_insert.js:8-10`). `gi`
  is `focusInput`, "Focus the first text input on the page" (`all_commands.js:182-186`).
- **Firefox.** A `WindowGlobalParent` is "a handle in the parent process to a specific
  nsGlobalWindowInner object" (`dom/ipc/WindowGlobalParent.h:70-72`, Firefox 158.0); its
  `innerWindowId` (`dom/chrome-webidl/WindowGlobalActors.webidl:19`) therefore changes with each
  new document in the browsing context and stays the same across `history.pushState`.
- **Vimma.** The child reports `focusin` for the focused element and `recheck` on a `focusout`
  with no related target (`actors/VimmaChild.sys.mjs`, `handleEvent`); the parent takes reports
  only from `Services.focus.focusedContentBrowsingContext` (`actors/VimmaParent.sys.mjs`).

## Design

The host keeps, per tab `<browser>`, the top document's `innerWindowId` at the moment explicit
insert began (`explicitInsert`, a `WeakMap`). `onFocusReport` returns early while the tab is in
insert and that ID is still the top's current one. Every change to a mode other than insert goes
through `setBrowserMode`, which drops the entry, so `Esc`, copy mode and any later normal mode end
it in one place.

For `i`, the child keeps a `WeakRef` to the editable element that last took focus in its document
(not one focused by Firefox's find, [m1-find](m1-find.md)). The host keeps, per tab, the
`BrowsingContext` whose report last named an editable element on `focusin`, with its document's
`innerWindowId`. `i` asks that frame,
if it is not discarded, belongs to the tab and still shows that document, to focus its field (`Vimma:FocusLast`, a query
that answers whether the field took focus); on `false` or an error it sends `Vimma:FocusInput`
to the top frame, as before.

1. **Explicit insert ends only on `Esc` or a new document.** Keys typed after `i` stay the page's,
   because pressing `i` means the next keys are meant for the page, and a page moving focus is the
   page's business, not a request to leave. Rejected: following the focus as Vimium's `i` does
   (exit when an element takes focus, then let the focus-tracking mode decide), because that is
   the behaviour that sent GitHub keystrokes to Vimma; it works in Vimium only because Vimium
   then re-enters insert for the new element when it is editable, which a result list is not.
2. **A new top document ends the hold.** The first focus report from a new document decides the
   mode by the usual rules, so that a search submitted from insert lands in normal mode on the
   result page, where `j` scrolls. The document's `innerWindowId` is the boundary, so a
   single-page app's own navigation, which keeps the document, keeps insert as typing continues.
3. **`gi` is explicit too,** because it is the same request (type into the page) with a choice
   of field, and a page moving focus after `gi` breaks it the same way.
4. **`i` returns to the last field.** The field the user last typed in is the one Vim's `gi`
   would return to and the one a user coming back from scrolling expects, so `i` resumes typing
   there; the first field remains the fallback, so `i` on a fresh page does what it did. The
   choice lives in the frame that owns the field, since only its child can reach the element,
   and in the parent, since only the parent knows which frame that was. Rejected: `i` as a pure
   pass-through that focuses nothing (Vimium's `i`), because on the common page with a search
   box or form it would need a second step to start typing; a per-site pass-through for sites
   with single-key shortcuts is site-compat's open question 3.
5. **Focus insert keeps following the focus,** because a user who clicked into a field and then
   lost it to the page (a submit, a dialog) expects Vimma's keys back without pressing `Esc`, as
   before this change.
6. **One place drops the hold.** `setBrowserMode` drops the explicit entry on any change to a mode
   other than insert, so that no path to normal mode (copy mode's exit, a key runner, a tab's
   mode reset) can leave a stale hold that would swallow a later focus report.

## Security and privacy

A page cannot enter explicit insert: only the parent's key handling runs `mode.insert` and
`page.focus_input`. A page cannot end it either, which is the point: before this change a page
could turn the user's next keys into Vimma commands by moving focus at the right moment. The new
`Vimma:FocusLast` message carries no data and goes only to a frame of the same tab that has
reported focus, and only while that frame still shows the document that reported it (the
host keeps the frame's inner window ID with it), so a frame that has since loaded another site's
page is not asked; the worst a compromised frame can do is focus an element of its own. The frame
check of [m1-actor-insert-scroll](m1-actor-insert-scroll.md) ("only the focused frame may
report") still guards which frame is remembered. Rules K2 and K3 in [security.md](../security.md)
hold this with tests.

## Tests

`tests/browser/browser_vimma_insert_focus.js`, fixtures `file_vimma_insert_focus.html` (a page
whose script focuses its result list when "go" is typed), `file_vimma_insert_autofocus.html` (a
login form with `autofocus` that moves to the password on `Enter`) and `file_vimma_frame.html`
(cross-origin):

- Behaviour 1: `after_i_the_page_moving_focus_off_the_field_keeps_insert` (the page gets `t` and
  `j`, no tab opens, nothing scrolls; `Esc` then `j` scrolls),
  `after_i_the_page_blurring_the_field_keeps_insert`,
  `after_i_on_a_page_with_no_field_a_page_focus_keeps_insert`,
  `after_gi_the_page_moving_focus_off_the_field_keeps_insert`.
- Behaviour 2: `explicit_insert_ends_with_the_page`.
- Behaviour 3: `i_focuses_the_field_last_used`, `i_focuses_the_editor_last_used`,
  `i_focuses_the_field_last_used_in_a_cross_origin_frame`,
  `i_falls_back_to_the_first_field_when_the_last_is_gone`,
  `i_falls_back_to_the_first_field_when_the_last_frame_navigated`; the first-field case stays in
  `browser_vimma_insert_scroll.js` (`i_focuses_the_first_input_and_enters_insert`).
- Behaviour 4: `an_autofocused_login_form_opens_in_insert_and_enter_keeps_it`,
  `a_page_moving_focus_from_a_field_to_a_button_leaves_insert`, and the focus cases of
  `browser_vimma_insert_scroll.js`.

The behaviour 1 and 3 tests failed before the change (the page lost `t` and `j`, `t` opened a tab,
`i` focused `#first`); the behaviour 2 and 4 tests guard what already held.

## Docs and changelog

- `docs/guide.md`, "Normal and insert mode" and the key table's `i` row: `i` returns to the last
  field; insert from `i` or `gi` lasts until `Esc`.
- `docs/security.md`: a section for page modes, rules K1 to K3.
- `CHANGELOG.md`: a Fixed line, added by the maintainer at merge time.

## Delivery

One pull request, closing #165.

## Open questions

None.
