# Spec: live-grep

Status: draft · Area: `packages/vimma-core/src/` (`grep.mjs` new, `actions.mjs`, `defaults.mjs`,
`cmdline.mjs`, `help.mjs`); `src/browser/base/content/vimma/` (`actors/text-model.mjs`,
`actors/VimmaChild.sys.mjs`, `actors/VimmaActors.sys.mjs`, `host/grep.mjs` new,
`host/VimmaHost.sys.mjs`, `ui/picker.mjs`, `ui/grep-preview.mjs` new);
`src/browser/themes/shared/vimma/picker.css` · Upstream patches: none · ADR: none. No new
dependency.

Issue: [#241](https://github.com/vimma-browser/vimma/issues/241)

Builds on [m1-find](m1-find.md) (`/`, smartcase), [m1-copy-mode](m1-copy-mode.md) (the caret
and `v`), [m2-picker-rename](m2-picker-rename.md) (the picker dialog and its core state
machine), [m3-workspaces](m3-workspaces.md), [m4-split-panes](m4-split-panes.md) (a selected
tab focuses its pane), [private-workspace](private-workspace.md) (the private workspace is its
own window), [vimma-mcp](vimma-mcp.md) (the agent workspace) and [tab-search](tab-search.md),
whose decision 13 leaves searching page content to a later spec; this is that spec. Vimma paths
are checked on main at 3397774 and are under `src/browser/base/content/vimma/` unless they start
with `packages/`, `src/browser/themes/`, `docs/`, `tests/` or `tools/`. Engine paths are
relative to `engine/` and checked against Firefox 158.0 (`engine/config/milestone.txt`).

## Summary

Live grep searches the text of every loaded tab in the current workspace as you type and lists
each match with its line of context, grouped by tab, beside a preview of the surrounding text.
`Enter` goes to the tab, scrolls to the match and selects it. It is modelled on Telescope's
`live_grep` in Neovim: a prompt, a results list, a preview, smart case and regular expressions,
and a result list to step through afterwards with `]q` and `[q`. A Vimma user with many tabs
open finds the page that said something without remembering which page it was.

## Problem

Vimma finds tabs by title and URL (the goto picker, and tab search once it is built), and finds
text inside one page (`/`). Nothing finds text across pages:

- Reading documentation in ten tabs, a user remembers a sentence about `max_tabs_undo` but not
  which tab it was in. Today they press `/max_tabs` in each tab in turn.
- A user comparing three pull requests wants every place `TODO` appears, across the three pages,
  in one list to step through.
- An error message seen in one of several CI log tabs has to be found again after switching
  away.

Firefox has no cross-tab text search either: the find bar works on one tab, and the URL bar's
`%` mode matches titles and URLs only (tab-search, Research).

## Behaviour

1. As a Vimma user with twelve tabs in `work`, `ctrl+b f g` and `retry budget` list every line
   containing those words in those tabs, grouped under each tab's number and title, and update
   as I type. The current tab's matches are among them.
2. As a Vimma user, `Enter` on a result selects that tab (switching to the pane that shows it,
   if the workspace is split), scrolls the match to the middle of the view and selects it with
   the find highlight. I am in normal mode, and `v` starts copy mode with the match selected.
3. As a Vimma user, an all lower-case query ignores case and a query with a capital letter
   matches case, as `/` and ripgrep's `--smart-case` do. `err(or)?s?\b` is a regular
   expression; a query that is not a valid expression, such as `c++(`, is searched literally and
   the prompt says `literal`.
4. As a Vimma user, the preview beside the list shows the selected match's surrounding text with
   the match marked; `ctrl+d` / `ctrl+u` scroll it.
5. As a Vimma user, after I jump to a result, `]q` and `[q` go to the next and previous result of
   that search, across tabs, without reopening the list; `:grep` with no text reopens the list
   with the last query.
6. As a Vimma user with tabs that have not loaded since a restart, those tabs are listed at the
   end as `not loaded`, and `Enter` on one opens it. Live grep never loads a tab by itself.
7. As a Vimma user, `ctrl+s` in the list widens the search from the workspace to every
   workspace of this window, or narrows it to the current tab, and the prompt shows the scope.
8. As a user of the private workspace, live grep in a normal window never searches or shows a
   private tab, and live grep in the private window searches only the private workspace.
9. As a Vimma user running an agent, the agent workspace's tabs are searched only when the
   scope includes them, and their results are marked `◇ agent`.
10. As a screen-reader user, the list is a listbox whose options name the line, the tab and its
    workspace, and the number of matches is announced as I type.

Keys and commands added:

| Key or command                 | Where       | Does                                                          |
| ------------------------------ | ----------- | ------------------------------------------------------------- |
| `ctrl+b f g`, `:grep [text]`   | everywhere  | `live_grep`: opens live grep (`:grep` alone resumes the last) |
| `]q` / `[q`                    | normal mode | `grep_next` / `grep_previous`: the next / previous result     |
| typing                         | in the list | edits the query (search mode, the mode it opens in)           |
| `ctrl+n` / `ctrl+p`, `↓` / `↑` | in the list | next / previous result                                        |
| `Tab` / `shift+tab`            | in the list | next / previous tab's group                                   |
| `Enter`                        | in the list | goes to the result                                            |
| `ctrl+d` / `ctrl+u`            | in the list | scrolls the preview down / up                                 |
| `ctrl+s`                       | in the list | cycles the scope: workspace → window → tab                    |
| `ctrl+space`                   | in the list | keeps these results and filters them fuzzily                  |
| `Esc`                          | in the list | search mode → browse mode (`j`/`k`, `gg`/`G`); again closes   |

No config key is added. `keys.live_grep`, `keys.grep_next` and `keys.grep_previous` are
configurable as every action is (firefox-keys).

## Research

### Telescope `live_grep` (the model)

The reference setup is a Neovim 0.12.5 configuration with telescope.nvim at tag `0.1.5`
(commit d909568, checked in an installed copy of the plugin), mapped as
`<leader>fg` to `builtin.live_grep` with no options and no `defaults` override, beside
`<C-p>` for `find_files`. Line numbers below are in that tag.

- **Separate pickers.** Finding files by name (`find_files`) and finding text in them
  (`live_grep`) are two pickers on two keys.
- **Layout.** The default `layout_strategy` is `horizontal` (`lua/telescope/config.lua:182-183`):
  80 % by 90 % of the editor, the prompt at the bottom, the results above it, the preview on the
  right (`:80-85`). The preview takes 40 % of the width below 150 columns, else 80 or 120
  columns (`lua/telescope/pickers/layout_strategies.lua:321-329`), and is hidden below 120
  columns (`preview_cutoff`). `sorting_strategy` is `descending` (`config.lua:145-146`), so the
  best result sits next to the prompt. The picker opens in insert mode (`initial_mode`,
  `:269-270`).
- **Matching.** Each keystroke runs `rg --color=never --no-heading --with-filename
--line-number --column --smart-case -- <prompt>` (`config.lua:622-623`;
  `lua/telescope/builtin/__files.lua:136-150`) and nothing for an empty prompt (`:137-139`). The
  prompt is a ripgrep regular expression. Smart case, in ripgrep 15.2.0's `rg --help`: case
  insensitive when the pattern has at least one literal character and none of its literals is
  upper case (`a\w` has the literal `a`; `\w` alone has none). The sorter is
  `highlighter_only` (`__files.lua:159`): results keep ripgrep's order, by file, and the match
  is highlighted.
- **Rows** are `path:line:column:text`, flat, one per matching line; the file name repeats on
  every row of that file. `max_results` and `grep_open_files` (search only the files open in
  buffers, `:98-101`) are options; the reference setup sets neither.
- **Fuzzy refine.** `ctrl+space` (`__files.lua:161`, `actions.to_fuzzy_refine` in
  `lua/telescope/actions/init.lua:1290`) freezes the current results and filters them with the
  fuzzy sorter.
- **Keys** (`lua/telescope/mappings.lua:135-199`). Insert mode: `ctrl+n`/`ctrl+p` and
  `↓`/`↑` move, `Enter` opens, `ctrl+x`/`ctrl+v`/`ctrl+t` open in a split or tab, `ctrl+u`/
  `ctrl+d` scroll the preview, `PageUp`/`PageDown` scroll the results, `Tab`/`shift+tab` toggle a
  multi-selection, `ctrl+q` sends every result to the quickfix list and opens it, `alt+q` sends
  the selected ones, `ctrl+c` closes. `Esc` leaves insert mode for the picker's normal mode,
  where `j`/`k`, `gg`/`G`, `H`/`M`/`L` move and `Esc` closes.
- **After the picker** Vim's quickfix list holds the results; `:cnext`/`:cprevious` step
  through them.

What Vimma takes: a picker of its own, opened ready to type; regular expressions with
ripgrep's smart case; results in source order with the match highlighted; a preview beside
the list, hidden when the window is narrow; the same moving, preview-scrolling, refine and
`Esc` keys; and a list of results to step through afterwards. What Vimma changes: rows are
grouped under a heading per tab instead of repeating a title on every row, because a page title
is far longer than a path; the prompt is at the top, as in every Vimma picker; and `Tab` jumps
between tab groups, as in tab search, instead of building a multi-selection (decision 9).

### Vimma today

- **Pickers.** The goto picker (`goto_picker`, `prefix+g`, `defaults.mjs:106`; `b` in normal
  mode) and the workspace picker (`prefix+w`) share one `<dialog>` in the chrome document
  (`ui/picker.mjs`, look `GOTO` at `:45`) and one core state machine
  (`packages/vimma-core/src/picker.mjs`: `openPicker` `:413`, `setPickerItems` `:433`, which keeps
  the selection when the items change, `pickerKey` `:506`). Search mode edits the query
  (`backspace`, `ctrl+u` clears, `ctrl+w` deletes a word, `:552-557`); `Esc` there goes to browse
  mode, where `j`/`k`, `left`/`right` (sections), `/` and `Esc`/`q` (close, `:538`) work. Matches
  are highlighted with `<mark>` built from text (`ui/picker.mjs:224`). The list is a
  `role=listbox` with `role=option` rows (`:214-215`). Core matching is fuzzy over item fields
  and runs in the parent; it is not a text search.
- **Tab search** ([tab-search](tab-search.md), issue #215, draft) grows the goto picker into one
  list of every tab, every window and recently closed, matched on title, URL and rename, opened
  with `prefix+f f` and `:tabsearch`. Its decision 13 puts page content out of scope, because
  Firefox has no index of it and loading lazy tabs to search them breaks its decision 9.
- **Find** (`/`, `?`, `n`, `N`; `defaults.mjs:186-189`) drives Firefox's find bar and finder
  (m1-find), with smartcase from `isCaseSensitive` (`packages/vimma-core/src/find.mjs:24`:
  `query !== query.toLowerCase()`). It searches one tab.
- **Page text with positions.** `actors/text-model.mjs` flattens a document's rendered text into
  one string, node by node in document order, so that a string index maps back to a DOM point
  (`pointAt`); a block boundary adds `BLOCK` and a `<br>` adds `"\n"`, and `script`, `style`,
  `noscript`, `template`, `select`, `textarea` and `head` are skipped (`SKIP`, `:20`), as are
  elements that fail `checkVisibility()`. Copy mode builds it around the caret with a reach
  limit (`textAround`, `:74`). It uses a `TreeWalker`, which does not enter shadow roots.
- **Actors.** `VimmaChild` is registered with `allFrames: true` and
  `matches: ["http://*/*", "https://*/*", "file:///*", "about:*", <start page>]`
  (`actors/VimmaActors.sys.mjs:114-133`), so every same- and cross-origin frame of those pages
  has its own child. Messages are handled in `VimmaChild.receiveMessage`
  (`actors/VimmaChild.sys.mjs:344`).
- **The agent read path.** `agent-read` reads a page with Firefox's `PageExtractor` actor
  (`ctl/agent-commands.mjs:316-345`; vimma-mcp, Research), and loads a lazy tab first with
  `gBrowser.insertBrowser` and `browser.loadURI` (`loadedPage`, `:241-255`), which is acceptable
  for an agent's own tabs but replaces a restored tab's pending session.
- **Copy mode.** `v` / `prefix+[` (`defaults.mjs:150`, `:192`) enter it; the caret's `enter`
  keeps a selection that is on screen and starts selecting from it (`actors/caret.mjs:180-193`).
  So a selected match becomes copy mode's selection with no extra code.
- **Hints** use the label characters `asdfghjkl` (`packages/vimma-core/src/hints.mjs:44`). In a
  picker those letters type into the query, so pickers number their rows instead; the tab
  number in the goto picker is the same number as `ctrl+b 1..9` and the status bar.
- **Splits.** Selecting a tab that is in a pane focuses that pane, whatever selected it
  (m4-split-panes decision 1 and 4; guide "Picking a tab during a split").
- **Keys.** Prefix keys in use (`defaults.mjs`):
  `( ) ? [ ^ a b c ctrl+6 e enter g h j k l minus n p r space v w x z` and
  `shift+a b d h j k l n p t w x`; the find group `f` (tab search's `f f` and live grep's `f g`,
  decision 2) and toolbar-toggle's `u` claim two more. `prefix+/` is free, and no spec, open
  pull request or open issue claims it. In normal mode `]w`/`[w` step workspaces
  (`:202-203`); `]q` and `[q` are free. No `:grep` command exists (`cmdline.mjs:60-150`). tmux
  3.7c's default `prefix` table has no `/` (its `f` is `find-window`, `man tmux`).
- **Three-key sequences.** `compileKeymap` builds one trie per mode and walks every chord of a
  binding, however many (`packages/vimma-core/src/keymap.mjs:263-277`), so `prefix+f g` is a
  three-chord path `ctrl+b`, `f`, `g`. A node may have children and no action: normal mode's `y`
  is one today (`packages/vimma-core/test/keymap.test.mjs:139-143`). The dispatcher returns
  pending at such a node (`dispatcher.mjs:138-141`), arms no timeout because the node has no
  action of its own (`ambiguous`, `:174`), and cancels on a key with no child (`:123-136`).
  Checked on main at 7280cd5 by compiling `prefix+f f` and `prefix+f g` as user keys:
  `ctrl+b f f` and `ctrl+b f g` ran their actions, `ctrl+b f x` cancelled and `ctrl+b g` still
  ran `goto_picker`. No default binding has three chords yet, so no test covers one.
- **Telescope's keys.** telescope.nvim's README (v0.2.1) suggests `<leader>ff` for
  `find_files`, `<leader>fg` for `live_grep`, `<leader>fb` for `buffers` and `<leader>fh` for
  `help_tags`: one `f` group for its finders.

### Firefox (checked against 158.0)

- **`PageExtractor`** (`toolkit/components/pageextractor/`) returns a page's text for Firefox's
  AI features, including open and closed shadow roots (`DOMExtractor.sys.mjs:763-765`,
  `openOrClosedShadowRoot`) and PDFs through pdf.js (`PageExtractorParent.sys.mjs:155-170`). It
  returns a string only (`PageExtractor.d.ts`, `ExtractionResult`), with no way back to DOM
  positions, its actor matches http, https, file, `moz-extension`, `data:text/html` and
  `about:reader` but no other `about:` page (`toolkit/modules/ActorManagerParent.sys.mjs:496-512`),
  and `removeBoilerplate` drops page parts on purpose.
- **The finder.** `nsIFind` (`@mozilla.org/embedcomp/rangefind;1`) finds a literal string and
  returns DOM ranges; `FinderIterator._iterateDocument` wraps it
  (`toolkit/modules/FinderIterator.sys.mjs:730-770`) with case, whole-word and diacritics
  options and no regular expressions. `Finder.requestMatchesCount(word, { contextRange })`
  returns per-match context snippets (`FinderIterator.sys.mjs:382-450`, `_extractSnippet`;
  `Finder.sys.mjs:626-660`); Firefox's page assistant uses it with `contextRange: 30`
  (`browser/components/genai/content/page-assist.mjs:269-280`). It takes its case setting from
  the tab's shared `nsITypeAheadFind` (`Finder.sys.mjs:627`) and reports to the tab's find-bar
  listeners, so using it for grep would change and depend on that tab's find bar.
- **Frames.** `FinderParent.gatherBrowsingContexts` walks a browser's browsing contexts and
  skips those under a hidden embedder (`toolkit/modules/FinderParent.sys.mjs:138-150`;
  `BrowsingContext.isUnderHiddenEmbedderElement`, `dom/chrome-webidl/BrowsingContext.webidl:498`).
  `getAllBrowsingContextsInSubtree()` (`:92`) lists them in one call.
- **Selecting and scrolling to a match** as find does: find sets the selection, switches the
  display to `SELECTION_ATTENTION` (the find colour) and scrolls the selection to the vertical
  centre (`toolkit/components/typeaheadfind/nsTypeAheadFind.cpp:518-545`). From script the same
  is `nsISelectionController.setDisplaySelection(SELECTION_ATTENTION)` and
  `scrollSelectionIntoView(SELECTION_NORMAL, SELECTION_WHOLE_SELECTION, SCROLL_VERTICAL_CENTER)`
  (`dom/base/nsISelectionController.idl:82`, `:128-154`). Find also opens closed `<details>` and
  `hidden=until-found` ancestors (`AncestorRevealingAlgorithm`, same lines), which has no script
  API.
- **Lazy, pending and discarded tabs.** A tab restored by SessionStore starts with a lazy
  browser and no `linkedPanel` (`browser/components/tabbrowser/Tabbrowser.sys.mjs:3136`,
  `#createLazyBrowser`; `browser.sessionstore.restore_tabs_lazily` true,
  `browser/app/profile/firefox.js:3001`). `discardBrowser` resets a tab to the same lazy state
  and removes `linkedpanel` (`Tabbrowser.sys.mjs:3400-3470`). A tab with a browser that has not
  restored carries `pending` (`browser/components/sessionstore/SessionStore.sys.mjs:3016`).
  SessionStore restores a pending tab when it is selected (`#onTabSelect` →
  `#maybeRestoreTabContent`, `SessionStore.sys.mjs:3228-3255`; `restore_on_demand` true,
  `firefox.js:1616`); `#restoreTabContent` (`:6674`) is private. `gBrowser.insertBrowser`
  (`Tabbrowser.sys.mjs:3245`) creates the browser but does not restore its content. Firefox
  therefore has no public way to load a pending background tab with its session history short
  of selecting it. SessionStore keeps no page text: it saves history entries, form data and
  scroll positions, and no module in `browser/components/sessionstore/` reads `textContent` or `innerText`.
- **PDFs.** pdf.js renders a text layer only for pages near the view; its whole text comes from
  `PdfJsParent.getTextContent()` (`toolkit/components/pdfjs/content/PdfJsParent.sys.mjs:400`),
  which `PageExtractor` uses. Find in a PDF is pdf.js's own, through the find bar's events
  (m1-find, Research).
- **`about:` pages** that load in the parent process (`about:preferences`, `about:addons`) are
  matched by Vimma's actor (`about:*`) and searchable the same way. `view-source:` and
  `moz-extension:` pages are not matched.

## Design

Data flow: `ctrl+b f g` opens the grep picker (`ui/picker.mjs`, look `GREP`). Each query change,
debounced, goes to the host (`host/grep.mjs`), which sends `Vimma:Grep { gen, query, caps }` to
every frame of every loaded tab in scope. Each frame's `VimmaChild` builds (or reuses) the
frame's text model, matches the query with the pure `grep.mjs` from core, and returns the
matches with their line of context. The host merges replies into tab groups in tab order and
hands them to the picker as they arrive; stale generations are dropped. `Enter` selects the tab
and sends `Vimma:GrepJump { gen, match }` to the frame, which selects and scrolls to the match.

Decisions 1, 3, 5, 6, 7, 8 and 10 are the recommended answers to the open questions below and
change if those are answered otherwise.

1. **A picker of its own, next to tab search.** Live grep is a second picker on its own key,
   not a mode of tab search. Telescope keeps `find_files` and `live_grep` apart for the same
   reason: one finds a thing by its name and answers at once from memory; the other reads
   content, answers in a stream, has a preview and leaves a result list. Mixing them would make
   tab search slower and its rows ambiguous. It reuses the picker dialog, its styles and core
   state machine (selection, modes, query editing), with its own items and keys. (Open
   question 1.)
2. **Keys: `ctrl+b f` is the find group.** `prefix+f` is a group: a prefix with no action of
   its own that waits for a third key, as `y` waits in normal mode. `live_grep` (`grep.open`) is
   `prefix+f g` and `:grep [text]`; tab search's `tab_search` is `prefix+f f` (tab-search
   decision 2). The pair mirrors Telescope's suggested `<leader>fg` and `<leader>ff`, so a
   Neovim user's habit carries over unchanged, and one group keeps every finder under one key
   with room for more (`f h`, `f b`) without spending further prefix keys. The keymap already
   supports it: bindings may have three chords and a node may have no action (Research, "Three-key
   sequences"). The alternatives were weaker: `prefix+/` pairs with `/` but leaves the two
   finders on unrelated keys; `prefix+shift+f` is slower to press and reads as a variant of tab
   search; no default key hides the feature. `prefix+/` stays unbound, kept for a later use.
   `ctrl+b g` keeps opening tab search's list in browse mode. `:grep` is Vim's command for the
   same job; with text it opens with that query, alone it reopens the last query and its results
   (Telescope's `resume`). `grep_next` and `grep_previous` (`grep.next`, `grep.previous`) are
   `]q` and `[q`, Vim-unimpaired's quickfix keys, next to Vimma's `]w`/`[w`.
3. **Matching: ripgrep's rules.** The query is a JavaScript regular expression with the `u`
   flag, matched per line. Smart case follows ripgrep: case is ignored when the query has at
   least one literal character and no upper-case literal, so `\w+Error` matches case and
   `a\w` does not; this differs from `/`'s rule only for queries with escapes. A query that does
   not compile is matched literally and the prompt shows `literal`, so `c++(` and `what?(`
   find what they say rather than an error. An empty query lists nothing. `ctrl+space` keeps
   the current results and switches the prompt to filtering them with the core picker's fuzzy
   matcher, as Telescope's `to_fuzzy_refine` does; `Esc` there goes back to the grep query.
   JavaScript's syntax covers what ripgrep users type (classes, `\b`, `\d`, `\w`, alternation,
   groups, quantifiers); ripgrep's own flags syntax was not checked against it, and the guide
   says the syntax is JavaScript's. (Open question 2.)
4. **Lines.** A page has no lines, so a line is a run of the text model between block
   boundaries and `<br>` (a paragraph, list item, table cell or heading), and `pre` text keeps
   its own line breaks. Matching per line keeps a match from spanning two paragraphs and bounds
   a regular expression's work to one line. A row shows the line cut to 160 characters around
   the match (up to 60 before it), with an ellipsis where cut.
5. **Layout.** The dialog has the prompt at the top, as every Vimma picker, then the list and,
   when the dialog is at least 900 CSS pixels wide, the preview on the right taking 40 % of it
   (Telescope's proportions and its narrow-window cutoff). The prompt line reads
   `grep [workspace] ›`, with `literal` or `fuzzy` after the scope when they apply, and the
   match count right-aligned (`37 in 6 tabs`). The list is:
   - a heading row per tab: the tab's number in its workspace (the number `ctrl+b 1..9` and the
     status bar use), title, host and match count, `role=presentation`, so `j`/`k` skip it;
   - under it a row per match: the line with the match in `<mark>`, prefixed `↳ host` when the
     match is in a frame from another site.

   Ordering is stable as replies arrive: groups in the workspace's tab order (in a window
   scope, workspace by workspace, the agent workspace last), matches in document order, the
   top frame before its subframes. The selection stays on its row when groups arrive
   (`setPickerItems`). Tabs with no match get no group. (Open questions 3 and 4.)

6. **The preview** shows the selected match's line with the ten lines before and after it,
   from the frame's text model (`Vimma:GrepPreview`), with the match marked and scrolled to the
   middle. `ctrl+d`/`ctrl+u` scroll it half a pane, as Telescope's insert-mode keys do; with the
   preview, clearing the query is `ctrl+w` word by word or `backspace`, and without it (a narrow
   dialog) `ctrl+u` clears as in other pickers. It is text, not a picture of the page: a
   background tab is not painted (vimma-mcp, Research), and text is enough to recognise the
   place. (Open question 4.)
7. **Jump.** `Enter` closes the picker, selects the tab (`gBrowser.selectedTab`, which switches
   workspace and focuses the tab's pane, m4-split-panes decision 4), then asks the frame to
   select the match range, set the display to `SELECTION_ATTENTION` and scroll it to the
   vertical centre, as find does. Focus goes to the page and the mode is normal. `v` then enters
   copy mode with the match selected (`caret.mjs:180-193`); `y` copies it. If the page changed
   since the search (the frame's model is stale), the frame matches the query again and takes
   the match with the same ordinal, else the nearest one with the same text; if none is left,
   the tab is selected and the status bar says `match no longer on the page`. In a PDF the jump
   runs Vimma's find for the matched text, literally and matching case, stepping to its
   ordinal among identical strings. `n`/`N` keep stepping through the `/` query; they do not
   take the grep query, as in Vim. (Open question 5.)
8. **The result list.** Jumping from the picker keeps that search's results in the window as
   its grep list (Vim's `:grep` fills the quickfix list the same way). `]q`/`[q` go to the
   next/previous result, across tabs, wrapping at the ends, and the status bar says
   `grep 4/37`. A result whose tab has closed is skipped. `:grep` alone reopens the picker with
   that query, re-run. The list lives in memory for the window and is dropped when the window
   closes; it is not saved with the session. (Open question 6.)
9. **Keys in the picker.** Search mode (the mode it opens in) types into the query; browse mode
   comes with `Esc`, as in Telescope and every Vimma picker. In both modes: `ctrl+n`/`ctrl+p`,
   `↓`/`↑`, `Enter`, `ctrl+d`/`ctrl+u` (decision 6), `ctrl+s` (scope), `ctrl+space` (refine),
   `Tab`/`shift+tab` (next/previous tab group, as tab search's sections). Browse mode adds
   `j`/`k`, `gg`/`G`, `/` or `i` back to typing, and `Esc`/`q` to close. Telescope's
   `Tab` multi-selection and `ctrl+q` are not taken, because every result goes to the grep list
   (decision 8). `ctrl+v`/`ctrl+x` (open in a split) are not taken either: the result is an
   existing tab, and showing it beside another changes the workspace's split, which "Show
   together" in the side panel already does deliberately. These are picker keys, not keymap
   bindings, as `j` and `/` in the goto picker are.
10. **Scope.** The current workspace by default, because a workspace is a task and the tabs of
    that task are where the text is expected. `ctrl+s` cycles to `window` (every workspace of
    this window, the agent workspace last) and `tab` (the current tab, Telescope's
    `current_buffer_fuzzy_find` with a regular expression), then back. The scope resets to
    `workspace` each time the picker opens. Other windows are never searched: tab membership
    is per window (m3-workspaces decision 10), each window has its own grep, and the private
    workspace is a window of its own (decision 13). (Open question 7.)
11. **Not-loaded tabs are listed, not loaded.** A tab with no `linkedPanel` (lazy or discarded)
    or with `pending` has no content to search. They form one last group, `not loaded · 5`,
    with a row per tab (number, title, host); `Enter` on one selects it, which loads it, and the
    user can grep again. Loading them for the search was rejected: Firefox restores a pending
    tab only when it is selected (Research), so loading means selecting every tab in turn or
    replacing its pending session with a fresh load that drops its back history, and either
    costs memory and network for a query. SessionStore has no saved text to search instead.
12. **What is searched in a frame.** The rendered text the text model collects: text nodes in
    document order, skipping `SKIP` elements and elements that fail `checkVisibility()`, now
    also inside open and closed shadow roots (`openOrClosedShadowRoot`, as `PageExtractor`
    does), through a new `textOfDocument(win, cap)` beside `textAround`. Not searched: form
    field values, text drawn on a canvas, images, closed `<details>` and `hidden=until-found`
    content (not rendered, and Vimma cannot reveal them as find does), and pages Vimma's actor
    does not match (`view-source:`, `moz-extension:`), which appear in the not-loaded group as
    `cannot search`. Every frame is asked separately through
    `getAllBrowsingContextsInSubtree()`, skipping those under a hidden embedder as
    `FinderParent` does, so cross-site frames in other processes are searched by their own
    child. A PDF tab's text comes from `PdfJsParent.getTextContent()` in the parent and is
    matched there with the same core function.
13. **Private and agent workspaces.** Live grep searches only the window it is opened in. In a
    normal window it never sees the private workspace, which is its own private window
    (private-workspace); in the private window it searches only private tabs. The agent
    workspace is searched only when the scope includes it (`window`, or `workspace` when the
    agent workspace is current); its groups are marked `◇ agent` in the agent's colour and sort
    last, as in tab search decision 6.
14. **Performance.**
    - A query is sent 80 ms after the last keystroke. Each send carries a generation number;
      replies for an older generation are dropped, and a frame drops older work in its queue.
    - Matching runs in the content processes, one per site, so tabs search in parallel and the
      parent only merges. At most 8 tabs are asked at a time; a tab that has not answered in
      2,000 ms shows `timed out` in its heading. Up to 200 tabs are searched; beyond that the
      last group says how many were not.
    - A frame's model is cut at 1,000,000 characters (the heading says `cut`). A tab lists at
      most 100 matches and counts to 1,000 (`100 of 412`); the list holds at most 2,000 match
      rows. Telescope has no such caps by default; a page can be far larger than a source file,
      and a rendered list of thousands of rows does not help a keyboard user, who narrows by
      typing.
    - The frame caches its text model while the picker is open and drops it when the picker
      closes (`Vimma:GrepEnd`). A `MutationObserver` on the document marks the model stale; it
      is rebuilt at the next query, not on each mutation. A navigation creates a new document
      and actor, so nothing survives it.
    - Budgets, measured in tests: building the model for a 1,000,000-character fixture page
      under 400 ms, matching a query against it under 50 ms, and first results for 30 loaded
      fixture tabs on screen under 500 ms after the debounce.
    - The parent holds only what it shows: a context line per listed match (at most 160
      characters) and the preview's lines. Page text is not written anywhere.
15. **Accessibility.** As tab search: a `role=listbox` with option rows, heading rows
    `role=presentation`, each option's accessible name holding the line, the tab's title and its
    workspace (`"retry budget is 3, Retries – docs, work"`), a polite live region announcing
    `37 matches in 6 tabs` or `no matches` after results settle, and the preview a
    `role=region` named "Preview". The `literal` and `fuzzy` flags are words, not colours.
16. **Theme.** Existing tokens only, as picker.css uses them: headings `--vimma-text-accent`,
    hosts and counts `--vimma-muted`, `<mark>` as in the goto picker, the agent marker
    `--vimma-text-cyan`, and in the preview the match with `--vimma-selection`. No new token.
17. **Out of scope.** Other windows; closed tabs (SessionStore keeps no text); history and
    bookmarks content; replacing text; Telescope's split and tab openers (decision 9); an
    agent or `vimma-ctl` command for grep; search inside form fields.

## Security and privacy

Live grep is chrome UI reading text the user's own pages already show. It adds no
control-socket command, so neither `vimma-ctl` nor an agent connection can run it or read its
results. Container isolation is unchanged: the parent sends a query to each tab's own content
process, which answers from its own document; no page sees another page's text or the query
of another tab. Page text is untrusted: rows and the preview are built from text nodes and
`<mark>` elements created in chrome, never from markup, so a page cannot inject content into the
picker. The private boundary holds by construction: grep searches only its own window, and the
private workspace is a separate private window (decision 13); a test pins both directions.
Agent tabs are marked so their content is never taken for the user's own. Nothing is written to
disk: the text model lives in the content process while the picker is open, the parent keeps
only context lines and the grep list in memory, and none of it goes into the session store. A
regular expression runs per line, which bounds the cost of a pathological pattern to the length
of one line in one content process.

## Tests

Written first and seen to fail.

### Vitest (`packages/vimma-core/test/`)

- `grep.test.mjs` (new, pure):
  - `parseQuery`: smart case per ripgrep (`foo` ignores case, `Foo` matches it, `a\w` ignores,
    `\w+Error` matches, `\pL` alone ignores); an invalid expression gives a literal query
    flagged `literal`; an empty query gives none.
  - `grepText(text, query, caps)`: lines split at `BLOCK` and `"\n"`; matches with start, end,
    line and ordinal; the context cut to 160 characters around the match; the per-tab cap of
    100 listed and 1,000 counted; zero-length matches (`^`, `\b`) do not loop and are not
    listed.
  - `occurrenceOf(text, match)`: the ordinal of a literal among identical strings (the PDF
    jump).
  - grouping and ordering: groups in tab order whatever order replies arrive in; the agent
    workspace's groups last; the not-loaded group last; the 2,000-row cap.
  - the grep list: `]q`/`[q` order across tabs, wrapping, skipping closed tabs; the status text
    `grep 4/37`.
  - picker keys: `ctrl+s` cycles the scope; `Tab`/`shift+tab` jump groups and skip headings;
    `ctrl+space` enters refine and `Esc` leaves it; `ctrl+u` scrolls with a preview and clears
    without one; `Esc` search → browse → close.
  - bench: `grepText` over 1,000,000 characters under 50 ms.
- `keymap.test.mjs`: the `prefix+f` node has no action and has the child `g` (and `f` once tab
  search's key exists); `ctrl+b f g` dispatches `live_grep` and `ctrl+b f` followed by an
  unbound key cancels.
- `actions.test.mjs`, `defaults.test.mjs`, `cmdline.test.mjs`, `help.test.mjs`: `live_grep` on
  `prefix+f g`, `grep_next`/`grep_previous` on `]q`/`[q`, `:grep [text]`; the help rows. Snapshots
  re-recorded with a changelog line each; `docs/bindings.md`, `bindings.json` and
  `defaults.toml` regenerated.

### Mochitests (`tests/browser/`)

- `browser_vimma_live_grep.js` (new):
  - Three fixture tabs in one workspace and one in another: `ctrl+b f g`, `needle` lists the
    matches of the three in tab order with headings; the fourth appears after `ctrl+s` (window
    scope) and the current tab alone after another `ctrl+s`.
  - `Enter` on the second tab's match selects that tab, the selection is the match text, the
    display is `SELECTION_ATTENTION`, the match is within the viewport's middle third, and the
    mode is normal; `v` then enters copy mode with that selection.
  - A match in a cross-site iframe (a second origin in the test server) is listed with `↳ host`
    and the jump selects it in the frame.
  - A match inside an open and inside a closed shadow root is listed and jumps there.
  - Smart case and the regular expression: `Needle` and `nee+dle` against fixture text; `c++(`
    shows `literal` and finds the literal text.
  - A pending tab (restored, never selected) is in the not-loaded group and is still pending
    after the search; `Enter` on it selects it.
  - The page changes after the search (a script removes the first match): the jump takes the
    remaining match; with none left the status bar says so.
  - `]q`/`[q` after a jump go to the next/previous result across tabs and wrap; closing a tab
    skips its results; `:grep` alone reopens with the query.
  - A split workspace: `Enter` on a result in a pane's tab focuses that pane.
  - A PDF fixture: its match is listed and the jump lands on it through find.
  - Stale generations: replies to an older query never appear after a newer query's results.
  - No page text in the parent after close: the host's grep state holds only the grep list.
- `browser_vimma_private_workspace.js`: grep in a normal window lists no private tab, and grep
  in the private window lists only private tabs.
- `browser_vimma_mcp_agent.js`: an agent tab's results only
  in window scope, marked `◇ agent`, last.
- `browser_vimma_a11y.js`: option names, headings not options, the live region text.
- Bench (mochitest, logged): the 1,000,000-character fixture page's model under 400 ms; 30
  loaded tabs to first results under 500 ms.

### e2e (`tests/e2e/scenarios/`, Xvfb) and screenshots

- New scenario `live-grep.json`: one workspace with four tabs from `tools/e2e/pages.mjs`
  fixtures (one with a cross-site frame), one pending tab; `ctrl+b f g`, type `needle`;
  screenshot `live-grep.png` with the preview, then `Enter` and screenshot `live-grep-jump.png`
  with the selected match. Checked first with the real Omarchy theme
  (`vimma.theme.source=omarchy`) and recorded in the default theme as new baselines, with the
  changelog line "baselines for live grep".

## Docs and changelog

- **`docs/guide.md`**: a new section "Live grep" after "Find": opening it, the query syntax
  (JavaScript regular expressions, ripgrep's smart case, the literal fallback, refine), the
  layout and preview, the keys, scope, the jump and copy mode, the grep list and `]q`/`[q`, what
  is not searched (not-loaded tabs, form fields, canvases, closed `<details>`), and the private
  and agent rules. Rows for `ctrl+b f g`, `]q`, `[q` in the keys table, and `:grep` in "The
  command line".
- **README**: a feature line, "live grep: search the text of every tab in your workspace and jump
  to the match, like Telescope's `live_grep`".
- **`docs/bindings.md`, `bindings.json`, `defaults.toml`**: regenerated with `npm run gen-docs`.
- **`CHANGELOG.md` [Unreleased]**, added by the maintainer at merge. Suggested lines: "Live grep:
  `ctrl+b f g` and `:grep` search the text of the tabs in your workspace and jump to a match"
  (sub-PR 3, when the feature pref goes); "`]q` and `[q` step through the last grep's results"
  (sub-PR 3); and the baseline line.

## Delivery

Sub-PRs 1 and 2 land behind the pref `vimma.feature.grep` (default false), as unfinished
features must (issue #219); sub-PR 3 removes it.

| #   | Title                                                                | Scope                                                                                                                                                                                                                                                                                                                                                                                  | Size     |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | `feat(grep): search the text of the workspace's tabs and jump`       | Core `grep.mjs` (query, smart case, literal fallback, lines, caps, grouping); `textOfDocument` with shadow roots; `Vimma:Grep`, `Vimma:GrepJump`, `Vimma:GrepEnd`; `host/grep.mjs` (frames, generations, concurrency, timeouts, not-loaded group); the picker look without preview; `:grep` behind the pref; mochitests for search, jump, frames, shadow roots, pending tabs, private. | L (~900) |
| 2   | `feat(grep): preview, scope and fuzzy refine in live grep`           | `ui/grep-preview.mjs` and `Vimma:GrepPreview`; `ctrl+d`/`ctrl+u`; `ctrl+s` scopes and the agent marker; `ctrl+space` refine; PDFs; a11y names and live region; benches.                                                                                                                                                                                                                | M (~600) |
| 3   | `feat(keys): ctrl+b f g opens live grep; ]q and [q step its results` | `live_grep`, `grep_next`, `grep_previous`; the grep list and status text; default keys; help rows; gen-docs and snapshots; the e2e scenario and baselines; guide and README; the pref removed.                                                                                                                                                                                         | M (~500) |

Sub-PR 3 adds default keys, so it is a keymap PR and waits its turn in the keymap queue (one
keymap PR at a time, after firefox-keys). Whichever of it and tab-search sub-PR 3 lands first
adds the first three-chord default binding and, with it, the keymap test that `prefix+f` is a
group with no action of its own. Each sub-PR is checked in e2e screenshots with the
Omarchy theme before review.

## Open questions

1. **A separate picker, or a mode of tab search?**
   - a. A separate grep picker on its own key (decision 1). The same split as Telescope's
     `find_files` and `live_grep`; tab search stays instant and its rows stay tabs.
   - b. A mode of tab search: one dialog, a key (`ctrl+g`) switches between matching titles and
     URLs and matching page text. One place to look, at the cost of a slower, mixed list and
     keys that mean different things per mode.

   Recommendation: a, because the two answer different questions at different speeds, and it
   matches the Neovim habit of two keys for two pickers.

2. **Query syntax?**
   - a. A regular expression with ripgrep's smart case, the literal fallback for an invalid
     expression, and `ctrl+space` fuzzy refine (decision 3). The same as Telescope's
     `live_grep`.
   - b. Literal text with smartcase, as `/` (Firefox's find); a key (`ctrl+r`) switches to a
     regular expression. Safer for text full of `(`, `?` and `+`, but differs from the Neovim
     picker.
   - c. Fuzzy matching of words across the line. Forgiving, but floods the list on large pages
     and cannot express an exact phrase.

   Recommendation: a; the literal fallback removes most of b's advantage.

3. **Prompt at the top or at the bottom?**
   - a. Top, results below, as every Vimma picker (decision 5).
   - b. Bottom, results above and best next to the prompt, as Telescope's `horizontal` layout.
     Matches the Neovim picker exactly, but Vimma's pickers would then disagree with each other.

   Recommendation: a, for one layout across Vimma's pickers; the keys are what muscle memory
   relies on, and they are the same.

4. **Preview pane?**
   - a. A text preview on the right, ten lines around the match, hidden below 900 pixels, with
     `ctrl+d`/`ctrl+u` (decisions 5 and 6).
   - b. No preview; the context line is enough. Simpler, and `ctrl+u` keeps clearing the query.
   - c. A picture of the page at the match. Closest to seeing the place, but a background tab
     is not painted, so it would mean switching tabs while browsing results.

   Recommendation: a.

5. **What does `Enter` leave you in?**
   - a. Normal mode with the match selected and highlighted; `v` enters copy mode on it
     (decision 7).
   - b. Copy mode directly, with the match selected. One key less to copy, but `j`/`k` then
     move the caret instead of scrolling, which surprises after a jump.
   - c. As a, and the grep query also becomes the `/` query, so `n`/`N` step through matches in
     that page. Useful for literal queries; a regular expression cannot be handed to Firefox's
     find.

   Recommendation: a; `]q`/`[q` already step through the results.

6. **A result list after the picker closes?**
   - a. Every jump keeps the search's results as the window's grep list; `]q`/`[q` step it and
     `:grep` alone resumes (decision 8). As Vim's `:grep` fills the quickfix list.
   - b. Only on request: `ctrl+q` in the picker sends the results to the list, as Telescope.
   - c. No list; reopen the picker to pick another result.

   Recommendation: a; `]q` and `[q` cost nothing until used, and the list is in memory only.

7. **Scope?**
   - a. The current workspace by default; `ctrl+s` cycles window and tab (decision 10).
   - b. The current workspace only.
   - c. Every workspace of the window by default, `ctrl+s` to narrow.

   Recommendation: a; a workspace is one task, and widening is one key away.
