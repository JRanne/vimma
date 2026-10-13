# Spec: element-focus

Status: draft (spec only, not started) · Milestone: queued (plan §6, below the table) · Builds on
[m1-hints](m1-hints.md) (collection, labels, overlay, hint mode) and
[m1-copy-mode](m1-copy-mode.md) (caret, selection, yank). Area:
`packages/vimma-core/src/hints.mjs`, `blocks.mjs` (new), `actions.mjs`, `defaults.mjs`,
`modes.mjs`, `theme.mjs`; `actors/hint-collect.mjs`, `actors/block.mjs` (new),
`actors/VimmaChild.sys.mjs`, `actors/VimmaActors.sys.mjs`, `actors/caret.mjs`;
`host/VimmaHost.sys.mjs`, `host/copy-mode.mjs`; `ui/hint-overlay.mjs`;
`browser/themes/shared/vimma/hints.css`. No upstream patch.

**The start key is not decided in this spec.** The user picks it when implementation starts
(see [Key options](#key-options), the first item of the implementation session). Until then
this spec writes it as `<element-hint key>`.

## The user's words

"write a spec for element focus, this would mean selecting one paragraph or similar and then
using "v" to highlight it for yanking"

Follow-ups, same day (2026-10-13):

- "it should be quite similar to find "f"" (the user means link hints, `f`).
- "our find function has f for selecting links, i think it would make sense to have F for
  selecting elements?"
- "write spec otherwise but let me select key later on, when implementation starts"

## Short answer

`<element-hint key>` is a hint mode like `f`: the same labels, the same characters, the same
typing, `Backspace` and `Esc`, but on text blocks (paragraphs, headings, list items, quotes,
code blocks, table cells, captions) instead of links. Typing a label **focuses** that block:
Vimma draws an outline around it (in the browser, as it draws hint labels; the page cannot see
it) and the badge says `ELEMENT`. Then `v` selects the whole block and puts you in copy mode
with it highlighted, so `y` copies it, or the copy-mode motions adjust it first. `y` straight
from `ELEMENT` copies the block without selecting it. `+` and `-` grow the focus to the
surrounding block and back; `j` and `k` move it to the next and previous block. In copy mode,
`ip` and `ap` select the block around the caret, Vim's paragraph text objects.

## User stories

- As a user, `<element-hint key>` puts a label on every paragraph, heading, list item, quote,
  code block, table cell and caption on screen, with the same look and characters as `f`'s.
  Typing a label outlines that block, and the badge says `ELEMENT`. `Esc` instead of a label
  leaves with nothing changed; `Backspace` takes back a typed key.
- As a user, with a block focused, `v` highlights its whole text and I am in copy mode
  (`VISUAL`): `y` copies it and says "yanked N chars". Before `y`, `o` and the motions
  (`}`, `j`, `e`, …) change the selection as in any copy-mode selection.
- As a user, with a block focused, `y` copies its text at once and I am back in normal mode,
  for "copy this paragraph" in three keys.
- As a user, with a list item focused, `+` moves the outline to the whole list, `+` again to
  the section around it, and `-` back. `j` / `k` move it to the next / previous block, and the
  page scrolls to keep it in view.
- As a user, a code block copies exactly as it is shown: indentation, blank lines and line
  breaks kept, and a highlighter's line numbers (drawn with `user-select: none`) left out.
- As a user already in copy mode, `ip` selects the paragraph around the caret and `ap` the
  block around that, growing on each `ap`, as Vim's `vip` / `vap`.
- As a screen-reader user, focusing a block announces its kind and length ("paragraph, 412
  characters"), and copying announces "yanked N chars", as copy mode does.

## Research

### Vimma today

- **Link hints** ([m1-hints](m1-hints.md)):
  - Normal-mode `f` is `hint.follow` and `F` is `hint.follow_new_tab`
    (`packages/vimma-core/src/defaults.mjs:184-185`; `docs/bindings.md` "Hints"). The hint
    actions are a closed list, `HINT_ACTIONS` (`hints.mjs:47`), checked by `startHints`
    (`hints.mjs:128-149`).
  - Labels: `hintLabels(n, chars)` (`hints.mjs:71`), charset `[modal] hint_chars`, default
    `asdfghjkl` (`hints.mjs:44`, `defaults.mjs:157`). `orderTargets` orders by rows, top to
    bottom then left to right (`hints.mjs:105-120`). `hintKey` narrows, selects, cancels on
    `Esc`, takes back on `Backspace` and ignores chords (`hints.mjs:165-199`). A letter
    arrives lowercase with shift set, caps lock too (`hints.mjs:173`).
  - Collection in the child, per frame (`actors/hint-collect.mjs`): one `nodesFromRect` hit
    test over the viewport (`onScreenElements`, `hint-collect.mjs:160-166`) reaches every
    element with a box on screen, open and closed shadow roots included; `unoccluded` checks
    the centre and four inner corners with `elementFromPoint` on the element's own root
    (`hint-collect.mjs:174-191`); frames are reported as `{ bc, rect }` and asked in turn
    (`hint-collect.mjs:268-286`), with the parent's 150 ms per-subframe timeout.
  - Replies go through `parseHintReply` (`hints.mjs:242` on), whose `TARGET_KINDS` is `link`,
    `input`, `click` (`hints.mjs:210`), capped at 5,000 targets and 64 frames
    (`hints.mjs:202-206`).
  - The host: `hint.follow` / `hint.follow_new_tab` run `_startHints`
    (`host/VimmaHost.sys.mjs:781-782`); keys in hint mode go to `_hintKey`, whose `select`
    case cancels the labels and activates the target (`VimmaHost.sys.mjs:1851-1874`);
    `_cancelHints` (`VimmaHost.sys.mjs:1880-1887`). Focus leaving the page cancels hint mode
    (`VimmaHost.sys.mjs:1479-1480`); another binding leaves hint mode first (`:1578-1579`).
  - Drawing: `ui/hint-overlay.mjs` puts a `#vimma-hints` layer in the tab's `.browserStack`
    (`hint-overlay.mjs:13`, `:61`), scaled by the browser's `fullZoom` (`:46-55`). Colours
    `--vimma-hint-bg` / `--vimma-hint-fg` (`theme.mjs:258-259`), with a contrast pair
    (`theme.mjs:331`).
- **Copy mode** ([m1-copy-mode](m1-copy-mode.md)):
  - `v` in normal mode and `prefix+[` are `mode.visual` (`defaults.mjs:192`, `:150`).
    **`v` is taken in normal mode**, so "focus, then `v`" means `v` in the new `ELEMENT` mode,
    not in normal mode.
  - `Caret.run` `enter` keeps a selection that is on screen and starts copy mode selecting
    (`this.selecting = !sel.isCollapsed`, `actors/caret.mjs:180-193`). So a block selected
    first enters copy mode with that selection, without new caret code.
  - `y` is `sel.toString()` then `exit` (`caret.mjs:205-209`); the parent writes plain text
    with `nsIClipboardHelper.copyString` and says `yanked N chars` (`host/copy-mode.mjs:67-69`,
    `:104-105`).
  - `[modal.visual]` binds `iw` / `aw` (`defaults.mjs:254-255`), so `i` and `a` are already
    prefixes there; `ip` / `ap` fit beside them. The copy-mode spec lists "Vim's other text
    objects (`is`, `ip`, `i(`…)" as out of scope, so this spec takes `ip` / `ap` in.
  - The text model marks a block boundary where `display` is not `inline`, `contents` or
    `ruby*` (`actors/text-model.mjs:86-87`): the same notion of a block this spec uses.
  - Copy mode works in the focused frame only (m1-copy-mode Limits); `Vimma:Caret` is refused
    unless the frame's document has focus (`actors/VimmaChild.sys.mjs:389-392`).
- **Free keys in normal mode** (`defaults.mjs:160-223`, `docs/bindings.md`): bound are
  `j k h l d u gg G H L r f F / ? n N i I v : t x gt gT b yy p P gi gu gU gf ]w [w`, `Esc` and
  some chords. Free single keys include `V`, `;`, `,`, `z`, `m`, `s`, `e`, `o`, `a`, `c`, `w`,
  `q`, `Y`; free `g` forms include `gF`, `gv`, `gb`. `[` and `]` are prefixes (`[w`, `]w`).
  Open tab-search spec #181 proposes `prefix+f`, which does not touch normal mode.
- **Modes**: `MODES` in `modes.mjs:13`; the status bar's badge is `mode.toUpperCase()` with
  `--vimma-mode-<mode>` colours (`statusbar.mjs:165-168`), so a new mode needs two tokens.
- **Agent reads** already take the selection (`Vimma:Selection`, `VimmaChild.sys.mjs:369-375`):
  a block selected with `v` is what an MCP `agent-read` sees as `selection`.

### Firefox (engine/)

- **Caret browsing** is `accessibility.browsewithcaret` (`StaticPrefList.yaml:256`); copy mode
  leaves it alone and drives `nsISelectionController` (m1-copy-mode, Settled).
- **Selecting from the actor**: `Range.selectNodeContents` (`dom/base/nsRange.h:300`, `:317`)
  and `Selection.setBaseAndExtent` (`dom/webidl/Selection.webidl:76-77`).
  - Adding a range to a collapsed selection dispatches a trusted, cancelable `selectstart` to
    the page (`dom/base/Selection.cpp:1277-1300`). A page can therefore see, and cancel, `v`'s
    selection, as it can a mouse selection. Copy mode's motions already do this; `y` from
    `ELEMENT` should not (decision 9).
  - `user-select: none` content: with `dom.selection.exclude_non_selectable_nodes` (default
    false, `StaticPrefList.yaml:6051-6054`) the range is not split
    (`Selection.cpp:1192-1206`), but `Selection.toString()` uses the plain-text encoder with
    `SkipInvisibleContent` (`Selection.cpp:582`), which skips non-selectable frames
    (`dom/serializers/nsDocumentEncoder.cpp:947-952`). A highlighter's line-number gutter is
    left out of a copy; a block that is wholly `user-select: none` copies as "".
  - The same encoder serves a range without touching the selection:
    `Cu.createDocumentEncoder("text/plain")`, `init`, `setContainerNode` / `setRange`,
    `encodeToString` (`browser/actors/ContextMenuChild.sys.mjs:418-423`, the context menu's
    `_gatherTextUnder`; flag `SkipInvisibleContent` is `nsIDocumentEncoder.idl:183`).
  - Shadow DOM: a range inside one shadow tree is an ordinary range there; selections across
    the boundary are what `getComposedRanges` exists for (`Selection.webidl:64`). A block is
    always inside one tree, so `v` never needs to cross.
- **Reader mode's block notion**: Readability scores `section,h2,h3,h4,h5,h6,p,td,pre`
  (`toolkit/components/reader/readability/Readability.js:128`) and checks visibility with
  `display`, `visibility`, `hidden` and `aria-hidden` (`Readability.js:2694-2707`). Prior art
  for which elements are "text blocks"; Readability itself works on a cloned document, too
  slow and too lossy for a screenful of hints.
- **Accessibility roles** for blocks exist (`accessible/interfaces/nsIAccessibleRole.idl`:
  `ROLE_CELL` 149, `ROLE_LISTITEM` 168, `ROLE_PARAGRAPH` 352, `ROLE_CAPTION` 362,
  `ROLE_HEADING` 375, `ROLE_SECTION` 381, `ROLE_FIGURE` 451, `ROLE_BLOCKQUOTE` 713,
  `ROLE_CODE` 753). Asking for them from content means starting the accessibility service in
  the content process, for every page, which costs memory and time for every user. Rejected;
  the classifier uses tags and ARIA `role` attributes, which map to the same roles.
- **pdf.js**: the viewer puts each page's text in a `div.textLayer` of positioned spans
  (`toolkit/components/pdfjs/content/web/viewer.mjs:12237`, layer order `:12408`). There are
  no paragraphs, only lines; m1-find already notes pdf.js as its own world.

### Prior art (fetched 2026-10-13)

- **Vimium** (`README.md`, Keyboard Bindings): "v enter visual mode; use p/P to paste-and-go,
  use y to yank", "V enter visual line mode", "yf copy a link url to the clipboard". No
  element mode.
- **Tridactyl** (`src/lib/config.ts`, default `nmaps`): a `;` hint family: `;y` `hint -y`
  (yank link), `;p` `hint -p` (yank an element's text), `;k` `hint -k` (kill an element),
  `;;` `hint -; *` (focus an element), `;#` `hint -#` (yank an anchor), `;b` `hint -b`
  (background tab), `;V` `hint -V`. Element text and element focus are hint modes there, like
  this spec.
- **Surfingkeys** (`src/content_scripts/common/default.js`): `zv` "Enter visual mode, and
  select whole element", `yv` "Yank text of an element", `ymv` "Yank text of multiple
  elements", `yq` "Copy pre text", `v` "Toggle visual mode". `zv` is this spec's
  `<element-hint key>` then `v`.
- **qutebrowser** (`doc/help/settings.asciidoc`, `bindings.default`): `;y` `hint links yank`,
  `;Y` `hint links yank-primary`, `;h` `hint all hover`; `hints.selectors` groups `all, links,
images, media, url, inputs`. No text-block group.
- **Vim**: `ip` / `ap` (`:help ip`) select a paragraph, `ap` with its trailing blank lines;
  repeating `ap` in visual mode extends by paragraphs.

## Decisions

1. **It is a hint mode, a sibling of `f`** (user: "it should be quite similar to find "f"").
   `<element-hint key>` runs `hint.element` ("Focus a text block: v selects it, y copies it",
   config name `focus_element`, group "Hints"). It reuses the hint machinery whole:
   - the same collection pass (`collectTargets` with `{ mode: "blocks" }`), frames, frame
     timeout, occlusion check and caps;
   - the same `startHints` / `hintKey` / `orderTargets` with `hint.element` added to
     `HINT_ACTIONS`; the same `hint_chars`, labels, `Backspace`, `Esc` and buffered keys;
   - the same overlay (`HintOverlay.show`), tokens and look;
   - the same mode (`hint`, badge `HINT`) until a label is chosen.

   Only the selection result differs: `_hintKey`'s `select` case runs `_focusElement` instead
   of `activateHint`. No second hint mechanism.

2. **The start key is chosen by the user when implementation starts** ("let me select key
   later on, when implementation starts"). The user leans to `F` ("i think it would make sense
   to have F for selecting elements?"), which would move today's background-tab link hints.
   The options and their costs are under [Key options](#key-options); the implementation
   session asks first and records the answer here.
3. **What a text block is** (core `blocks.mjs`, pure: `classifyBlock(descriptor)` and
   `pickBlocks(descriptors)`; the child sends descriptors, core decides):
   - **Blocks by tag**: `p`, `h1`–`h6`, `li`, `dt`, `dd`, `blockquote`, `pre`, `figcaption`,
     `caption`, `td`, `th`, `summary`, `address`; and `[role]` `paragraph`, `heading`,
     `listitem`, `blockquote`, `code` (when not inline), `cell`, `gridcell`, `rowheader`,
     `columnheader`, `caption`, `note`.
   - **Generic leaf blocks**: any other element whose `display` is block-level (the text
     model's rule, `text-model.mjs:86-87`) and that has a direct text child with a visible
     character, and no block candidate inside it. This catches the `div`-per-paragraph sites
     (chat logs, comment threads, many SPAs). `display` is read only for elements that pass
     the cheap text-child check.
   - **Never**: `html`, `body`, `script`, `style`, `template`, `textarea`, `input`, `select`,
     `button`, `option`, `svg`, `canvas`, `iframe` (its document is asked as a frame),
     contenteditable hosts and anything inside them (a field's text is its own; insert mode
     and `ctrl+c` cover it, as in copy mode's Limits), `[aria-hidden=true]`, `[hidden]`, and
     blocks with no visible text.
   - **Innermost wins**: a candidate with a candidate inside it gets no label (an `li`
     holding two `p` gets two labels, not three). Its parent is reached with `+`
     (decision 7).
   - **Atomic blocks**: `pre`, block `code`, `[role=code]` and `table` captions suppress the
     candidates inside them, so a highlighter's per-line `div`s give one label for the code
     block, not one per line.
   - **Table rows** get no label of their own (one per cell is already a lot); `+` from a cell
     reaches the row, then the table.
4. **Where the label sits**: at the top-left of the block's first visible line box (the first
   client rect that meets the viewport, as for links), so a long paragraph partly scrolled
   off still gets a label where you are looking. Order is `orderTargets`', so labels read
   like the page.
5. **Focus: the `ELEMENT` mode.** Choosing a label:
   - leaves hint mode, then enters a new page mode `element` (core `MODES`; badge `ELEMENT`,
     tokens `--vimma-mode-element` / `-fg`, default from the theme's `magenta`);
   - the child keeps the block (`Vimma:Block` `focus`, by the collection's `gen` and id, as
     `Vimma:ActivateHint` does) and replies its rect, kind (`paragraph`, `heading`,
     `list item`, `quote`, `code`, `cell`, `caption`, `block`) and text length;
   - the parent draws the outline (decision 6); the status bar shows the kind and length
     (`paragraph · 412 chars`) beside the badge;
   - nothing in the page changes: no selection, no DOM focus, no attribute, no style. A
     MutationObserver sees nothing (tested as for hints).
6. **The outline is drawn by the browser**, in the same `.browserStack` layer as hint labels
   (`#vimma-element`, `pointer-events: none`, `contain: strict`), scaled by `fullZoom`:
   - a 2 px `--vimma-element-outline` ring (new token, default from `accent`) with a 1 px
     `--vimma-bg` halo outside it, so it shows on light and dark pages alike;
   - 2 px outside the block's border box, clipped to the browser;
   - it follows the block: the child reports a new rect on `scroll` and `resize` of the
     block's window, at most once per animation frame, through a system-group listener
     (`Services.els.addSystemEventListener`), so the page cannot see it;
   - in a frame, the rect is offset by the frame chain as hint rects are;
   - a block that scrolls fully out of view keeps its focus (the outline is clipped away;
     `j` / `k` or `v` still work).
7. **Keys in `ELEMENT` mode** (`[modal.element]`, all rebindable; every other plain key is
   consumed, as in hint and copy mode; chords stay Firefox's):

   | Key                  | Action                          | Does                                                                                  |
   | -------------------- | ------------------------------- | ------------------------------------------------------------------------------------- |
   | `v`                  | `element.visual`                | selects the block's text and enters copy mode with it selected (decision 8)           |
   | `V`                  | `element.visual_line`           | the same, line-wise (copy mode's `V` state), so `j` / `k` extend by lines             |
   | `y`                  | `element.yank`                  | copies the block's text and goes back to normal (decision 9)                          |
   | `+`                  | `element.parent`                | focus the nearest block-level ancestor that holds more text (up to `body`, exclusive) |
   | `-`                  | `element.child`                 | back down the way `+` came; otherwise the first candidate inside                      |
   | `j` / `k`            | `element.next` / `element.prev` | the next / previous candidate in document order, scrolled into view (`nearest`)       |
   | `<element-hint key>` | `hint.element`                  | labels again, to pick another block                                                   |
   | `Esc`                | `mode.normal`                   | removes the outline; nothing selected                                                 |

   Counts work on `+`, `-`, `j`, `k`. A tab switch, a navigation, focus leaving the page, or
   another binding (a `ctrl+b` sequence) leaves `ELEMENT` mode, as hint mode does.

8. **`v` enters copy mode with the block selected** (recommended answer to open question 2;
   the user's "using "v" to highlight it for yanking"):
   - the child sets the selection from the block's first to its last visible text position
     (a range from `selectNodeContents`, trimmed to text that is rendered, so the caret does
     not sit in trailing white space), anchor at the start, focus at the end, without
     scrolling;
   - the host then runs the existing `mode.visual` path: `Caret.run` `enter` keeps an
     on-screen selection and sets `selecting` (`caret.mjs:180-193`), so copy mode starts with
     the highlight, `VISUAL` in the badge, and every motion, `o`, `V` and `y` work on it;
   - in a frame, the frame is focused first (the block's window `focus()` from the child),
     since copy mode lives in the focused frame;
   - rejected: "`v` selects and stays in `ELEMENT`". It would need a second set of selection
     keys and a second yank; copy mode already has both.
9. **`y` from `ELEMENT` copies without selecting.** The child serializes the block with the
   plain-text document encoder (`Cu.createDocumentEncoder("text/plain")`, `setContainerNode`,
   flags `SkipInvisibleContent | OutputLFLineBreak`), the same serializer `Selection.toString`
   uses, so the text is what `v` then `y` would give, but the page sees no `selectstart` and
   its selection is untouched. The parent writes it with `copyString` and says "yanked N
   chars" (or "nothing to yank").
   - `pre` / code: the encoder keeps preformatted white space as rendered; no trimming inside
     the block, only one trailing newline dropped. Tested against a fixture with tabs,
     leading spaces and blank lines.
   - `user-select: none` parts are left out (`nsDocumentEncoder.cpp:947-952`): line-number
     gutters, copy buttons.
   - A block whose text is entirely `user-select: none` copies its rendered text anyway
     (`innerText`), and the notice says "yanked N chars (the page marks it unselectable)".
     Keyboard-first means the user decides what to copy; but `v` on such a block shows no
     highlight (Firefox paints none), and the notice says so.
10. **Plain text only** in this spec (open question 3 asks about Markdown). The yank path is
    one function (`blockText(range, format)`), so a Markdown flavour later is one argument.
11. **`ip` / `ap` in copy mode** (recommended answer to open question 4):
    - `ip` (`selection.inner_block`): selects the innermost text block (decision 3's
      classifier, run in the child on the caret's ancestors) around the selection's focus,
      exactly as `v` from `ELEMENT` would;
    - `ap` (`selection.a_block`): the same, then each further `ap` grows to the parent block
      (decision 7's `+`), Vim's "repeat `ap` to extend";
    - not Vim's blank-line rule: web pages have no blank lines between paragraphs, so the
      block boundary is the element's.
    - The two entries meet in one state: copy mode with a whole block selected. Element focus
      is "go there", `ip` / `ap` is "where I already am".
12. **Frames**: blocks are collected in every frame as links are (same caps and timeouts).
    Focusing one in a frame keeps the outline there; `v` focuses that frame (decision 8);
    `y` needs no focus. `+` stops at the frame's `body`: it never climbs into the parent
    document.
13. **Shadow DOM**: the hit test reaches open and closed shadow roots; the classifier walks
    ancestors with `parentOf` (`hint-collect.mjs:141-146`), crossing a shadow host for `+`
    only when the host itself is a block. The range for `v` and `y` stays within the block's
    own tree.
14. **PDFs (pdf.js)**: the text layer has spans per line and no paragraphs. In this spec the
    pdf.js viewer gets **no** element hints: `<element-hint key>` there says "no text blocks
    here (PDF: use v)", and copy mode remains the way to copy from a PDF. A line-grouping
    heuristic for `.textLayer` is out of scope (Limits).
15. **Performance**: only elements on screen are considered (the same `nodesFromRect`
    pass); the cheap checks (tag, role, `hidden`, a direct text child) come before
    `getComputedStyle`; innermost-wins is one ancestor walk per candidate with a visited set.
    Budget as hints: under 50 ms child time for a screenful of a long article, asserted
    generously (< 1,000 ms) against a 2,000-paragraph fixture, as m1-hints' many-links test.
16. **Accessibility** (m7-a11y): labels are the hint labels (same contrast pair). On focus
    the polite live region says "<kind>, N characters"; `j`/`k`/`+`/`-` say the new kind and
    length. The outline is not colour alone: it is a ring with a halo, and the status bar says
    the kind in text. `y` announces "yanked N chars". Nothing moves DOM focus until `v`.
17. **Theming**: new tokens `--vimma-element-outline` (from `accent`), `--vimma-mode-element`
    (from `magenta`) and `--vimma-mode-element-fg` (`textOn`), in `theme.mjs`'s table with a
    contrast pair for the badge; Omarchy's adapter fills them like the others.
18. **Security**: the child replies only rects, a kind from a closed list, a length and, for
    `y`, text the user asked for. `parseHintReply` gains `kind: "block"` with a `blockKind`
    from that list; `Vimma:Block` replies get a strict check in core (`parseBlockReply`) like
    `parseHintReply`. The child acts only for the current `gen` and only on the frame that was
    asked. Text from `y` goes to the clipboard and nowhere else.

## Key options

**First item for the implementation session: ask the user which key, record it in decision 2,
then replace `<element-hint key>` everywhere.** Normal-mode keys only; any of them is a keymap
change, so the keymap sub-PR lands alone (one keymap PR at a time).

| Option                    | Start key                                 | Background-tab link hints                    | For                                                                                                       | Against                                                                                                |
| ------------------------- | ----------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A (the user's suggestion) | `F`                                       | move to `gF`                                 | `f` links, `F` elements: one letter, the pair the user named                                              | Changes `F` for everyone; Vimium's `F` muscle memory breaks                                            |
| A2                        | `F`                                       | shift on the label's last key (Vimium-style) | No new key                                                                                                | Caps lock sends shift (`hints.mjs:173`), so caps-lock users would always get background tabs           |
| A3                        | `F`                                       | `;b` (Tridactyl's)                           | Starts a `;` family                                                                                       | Two keys for a common action; `;` alone becomes a prefix                                               |
| B                         | `V`                                       | `F` stays                                    | Leaves `F`; Vim's `V` is "visual on a whole line", this is "visual on a whole block"; free in normal mode | Not `f`-shaped; `V` in copy mode means line-wise, a different thing in another mode                    |
| C                         | `;v` (and `;y` to yank a block in one go) | `F` stays                                    | Tridactyl / qutebrowser's `;` hint prefix; room for `;y`, `;k` later                                      | Two keys; `;` is `caret.find_repeat` in copy mode (different mode, but the same key reads differently) |
| D                         | `zv`                                      | `F` stays                                    | Surfingkeys' exact key for this                                                                           | `z` is otherwise unused in Vimma; little mnemonic                                                      |

If `F` is chosen (A, A2, A3):

- `hint.follow_new_tab` keeps its name and config name (`follow_link_new_tab`), only its
  default key moves; `docs/bindings.md` (gen-docs), the help overlay snapshot
  (`help.test.mjs.snap`), `defaults.test.mjs.snap` and `defaults.toml` change.
- A `config.toml` that binds `F` explicitly (`[modal.normal] F = "hint.follow_new_tab"`)
  keeps it: user bindings win over defaults (m5-config-load), and the element hint is then
  on its other key or unbound.
- The guide's Hints section, the README feature list and m1-hints' user story change, and the
  CHANGELOG gets a "Changed:" line (below). Existing users learn it from the changelog and
  `ctrl+b ?`.

Recommendation, for the user to accept or not: **A with `gF`** if `F` is wanted (the user's
own pairing, one-letter start, and `gF` is free and next to `gf`); otherwise **B (`V`)**, which
changes nothing existing.

## Test plan

Written first; red pasted, then green (CLAUDE.md).

- **Vitest (core)**:
  - `blocks.test.mjs`: `classifyBlock` for each tag and role in decision 3, generic leaf
    `div`s with and without a direct text child, the "never" list, `aria-hidden`; innermost
    wins (`li > p, p`: two); atomic `pre` with per-line `div`s (one); rows unlabelled; a
    contenteditable host and its children excluded; `parentBlock` / `childBlock` walks over a
    descriptor tree, including a shadow host that is and is not a block, and stopping at
    `body`.
  - `hints.test.mjs`: `hint.element` accepted by `startHints`; ordering of blocks with tall,
    overlapping rects (a long paragraph's first visible line decides its row);
    `parseHintReply` takes `kind: "block"` with each `blockKind` and refuses an unknown one;
    `parseBlockReply` refuses malformed replies (non-finite rects, negative lengths, unknown
    kinds, extra fields dropped).
  - `dispatcher.test.mjs`: `[modal.element]` keys (`v V y + - j k Esc`, counts on `+ - j k`),
    plain keys consumed, chords passed; `ip` / `ap` in `visual` beside `iw` / `aw`.
  - `actions.test.mjs` / `defaults.test.mjs`: the new actions exist and are grouped; in the
    keymap PR, `<element-hint key>` reaches `hint.element` and no default collides.
  - `statusbar.test.mjs`: the `ELEMENT` badge and the kind · length segment; `theme.test.mjs`:
    the new tokens and contrast pairs.
- **Mochitests** (`tests/browser/browser_vimma_element.js`; fixtures
  `file_vimma_element.html`, `file_vimma_element_frame.html`, `file_vimma_element_many.html`):
  1. Labels: on a fixture with three paragraphs, an `h2`, a `ul` of `li > p` items, a
     `blockquote`, a `pre` highlighted with per-line `div`s and a `user-select: none` gutter,
     a 2×2 table, a `figure > figcaption`, a `div` chat line, a hidden and an `aria-hidden`
     paragraph, a contenteditable `div`, and a paragraph under a fixed header: exactly the
     expected labels (innermost, one for the `pre`, none for the hidden, covered or editable
     ones), drawn in chrome with the hint charset.
  2. Same feel as `f`: `Backspace`, narrowing, `Esc` (mode normal, page saw no key), keys
     typed before the labels show are replayed.
  3. Focus: a label gives mode `element`, the outline's chrome rect matches the block's
     content rect times `fullZoom` (150 % too), the status bar says the kind and length, and a
     page MutationObserver plus `selectstart`, `focus` and `selectionchange` listeners record
     nothing.
  4. `v`: mode `visual`, `getSelection().toString()` equals the block's text, the caret is
     enabled; then `y` copies it (`promiseClipboardChange`) and says "yanked N chars". `o`
     then `}` extends to the next paragraph.
  5. `y` from `ELEMENT`: the clipboard has the block's text; the page's selection is
     unchanged and no `selectstart` fired.
  6. Code: `y` on the `pre` gives the exact text with tabs, leading spaces and blank lines,
     and without the gutter's numbers; `v` then `y` gives the same string.
  7. `user-select: none` paragraph: `y` copies its rendered text with the "unselectable"
     notice.
  8. `+` from an `li > p` focuses the `li`, then the `ul`; `-` returns; `j`/`k` walk the
     blocks in document order and scroll the focused one into view; counts.
  9. Outline follows: scrolling the page by 200 px moves the outline by 200 px within a frame
     tick; a `resize` too.
  10. Shadow DOM: blocks in an open and a closed shadow root get labels; `v` selects the
      text inside the shadow tree; `y` copies it.
  11. Cross-origin iframe: its blocks get labels; `y` works without focusing it; `v` focuses
      the frame and copy mode runs there; `+` stops at the frame's `body`.
  12. Leaving: a tab switch, navigation, a click in chrome and `ctrl+b c` each leave
      `ELEMENT` and remove the outline.
  13. `ip` / `ap`: in copy mode inside the second paragraph, `ip` selects it, `ap` the
      `section`, `ap` again its parent.
  14. PDF: `<element-hint key>` in the pdf.js viewer gives the "no text blocks" notice and stays
      in normal mode.
  15. Malformed `Vimma:Block` messages (`null`, a string, unknown `op`, stale `gen`, a frame
      that was not asked) are refused.
  16. Performance: the 2,000-paragraph fixture collects under 1,000 ms all on screen and
      250 ms down the page (generous, as m1-hints).
- **e2e** (`tests/e2e/scenarios/element-focus.json`, the real Omarchy theme in the
  screenshot-verify run): open a fixture article, `<element-hint key>` → baseline
  `element-hints.png` (labels on blocks); a label → baseline `element-focus.png` (outline,
  `ELEMENT` badge, kind segment); `v` → baseline `element-visual.png` (block highlighted,
  `VISUAL`); `y`. New baselines need their changelog line.
- Mutation checks to run and paste: innermost-wins off (labels on `ul` and `li` too), the
  system-group listener swapped for a page listener (the observer test fails), and the encoder
  without `SkipInvisibleContent` (the gutter appears in the code yank).

## Sub-PRs

One at a time, after the open questions are answered. Only sub-PR 4 changes the default keymap.

| #   | PR                                                                | Contents                                                                                                                                                                                                                                                                                                                                                 | Size                      |
| --- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | `feat(hints): text blocks as hint targets`                        | Core `blocks.mjs` (classifier, innermost, atomic, parent/child walks) with Vitest; `hint-collect.mjs` `{ mode: "blocks" }`; `parseHintReply` `kind: "block"`; `hint.element` in `HINT_ACTIONS` and `actions.mjs`, **unbound** (reachable by `:` and config); labels only, choosing one just outlines it and `Esc`s. Mochitests 1, 2, 10–11 (labels), 16. | M (~700 lines with tests) |
| 2   | `feat(element): focus a block, then v selects it and y copies it` | `ELEMENT` mode, `[modal.element]`, `actors/block.mjs`, `Vimma:Block`, `parseBlockReply`, the outline layer and its tracking, `v` / `V` / `y` / `+` / `-` / `j` / `k`, theme tokens, status segment, live-region text. Mochitests 3–12, 14–15.                                                                                                            | L (~1,200)                |
| 3   | `feat(copy): ip and ap select the block around the caret`         | `selection.inner_block` / `selection.a_block` in `[modal.visual]`, reusing sub-PR 2's walks. Mochitest 13.                                                                                                                                                                                                                                               | S (~250)                  |
| 4   | `feat(keys): <element-hint key> starts element focus` (keymap PR) | The key the user chose; if `F`, the move of `hint.follow_new_tab`; gen-docs, help and defaults snapshots, `defaults.toml`; e2e scenario and three baselines; guide and README.                                                                                                                                                                           | S (~200 plus baselines)   |

## Docs and changelog the implementation must update

- `docs/guide.md`: a "Copying a paragraph (element focus)" section: the key, labels, the
  `ELEMENT` keys table, `v` into copy mode, `y`, code blocks, `user-select: none`, frames,
  PDFs; copy mode's section gains `ip` / `ap`. If `F` moves, the Hints section says where
  background-tab hints went.
- `docs/bindings.md`, `defaults.toml`: `npm run gen-docs`.
- `docs/limits.md`: the Limits below.
- README feature list: "Copy a paragraph, list item or code block in three keys: hint it,
  then `y` (or `v` to adjust first)."
- CHANGELOG `[Unreleased]` (the maintainer adds at merge), suggested:
  - "Added: element focus: `<element-hint key>` labels the paragraphs, headings, list items,
    code blocks and cells on screen; a label outlines one, `v` selects it in copy mode and `y`
    copies it. Copy mode gains `ip` and `ap`."
  - If `F` moves: "Changed: `F` now starts element focus; background-tab link hints moved to
    `gF` (a `config.toml` that binds `F` keeps it)."
  - "Added: e2e baselines `element-hints.png`, `element-focus.png` and `element-visual.png`."

## Limits

- Blocks are what the page's elements say they are: a page that draws paragraphs as one
  `div` with `<br>`s gets one label for all of them; copy mode's motions then refine.
- Canvas-drawn text (Google Docs, Figma) has no elements to label.
- pdf.js pages get no element hints (decision 14).
- The outline follows scrolling of the block's own window; a block inside an inner scroller
  that scrolls without a window `scroll` updates on the next key.
- One block at a time; several blocks are a copy-mode selection (`v`, then `}`).
- Like link hints, labels are for the layout at the time of the key.

## Out of scope

- Markdown or HTML yank formats (open question 3).
- Multi-block marks (Surfingkeys' `ymv`), killing elements (Tridactyl's `;k`), yanking anchors
  (`;#`).
- A paragraph heuristic for pdf.js's text layer.
- Element focus in pages without our actor (extension pages, `data:`), as for hints.

## Open questions for the user

1. **The key that starts element focus.** Left to the user at implementation start ("let me
   select key later on"); the options are under [Key options](#key-options).
   Recommendation: `F`, with background-tab link hints moving to `gF`; if `F` should keep its
   meaning, `V`.
2. **`v` after focusing: select the whole block and stay in `ELEMENT`, or enter copy mode
   with the block selected?** Recommendation: enter copy mode with the block selected
   (decision 8). Copy mode already has the motions, `o`, `V` and `y`, so the highlight can be
   adjusted before copying, and nothing new has to be learned.
3. **Yank as plain text or Markdown?** Recommendation: plain text now (what `ctrl+c` and
   copy mode's `y` give, code blocks exact), and Markdown later as a separate key (e.g. `Y`
   in `ELEMENT`: links as `[text](url)`, `pre` fenced, lists with `-`) if you want it, rather
   than a config switch that changes what `y` means.
4. **Include `ip` / `ap` in copy mode?** Recommendation: yes (decision 11, sub-PR 3): they
   reuse the same block rules, cost little, and cover "the paragraph I am already in" without
   hints.
