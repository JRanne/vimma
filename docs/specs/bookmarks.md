# Spec: bookmarks

Status: implemented · Area: core (`packages/vimma-core/src/bookmarks.mjs`), UI
(`ui/bookmarks-panel.mjs`, `side-panel.css`), host (`host/bookmark-ops.mjs`, `VimmaHost`)

## User story

As a Vimma user I open my bookmarks the way I open the side panel, with a keybind variation
(`ctrl+b shift+b`, `<leader>b`), and work them like neo-tree in my Neovim (`<space>n`): `j`/`k`,
`h`/`l` to fold, `a` to add with `/` for folders. From any page `ctrl+b a` bookmarks it: I type
`work/docs/My page` and it is filed under `work/docs`, the folders made as needed.

## Decisions

1. **Storage: Firefox's Places** (`PlacesUtils.bookmarks`, `PlacesUtils.promiseBookmarksTree`,
   `PlacesUtils.observers`; grepped in `toolkit/components/places/`). Existing bookmarks,
   import/export, the Library and Sync keep working; Vimma keeps no bookmark store of its own.
2. **One tree, rooted at the Bookmarks Menu.** Its top level lists, in this order, the folders
   `toolbar` (Bookmarks Toolbar), `other` (Other Bookmarks), `mobile` (only when it has
   something), then the Menu's own children. A path is relative to the Menu, and its first
   segment may name `toolbar`, `other` or `mobile` (an alias wins over a Menu folder of that
   name). The four roots cannot be renamed, moved or deleted. Separators are not listed. Tags
   are not shown.
3. **Same slot as the side panel, the same modal mode.** The bookmarks panel is its own box
   (`#vimma-bookmarks`) built by the side panel's helpers, styled by `side-panel.css` and the
   theme tokens, first child of `#browser`. Opening one panel closes the other. Both run in
   `panel` mode: `j`, `k`, `Enter`, `Esc` (`panel.*`) go to whichever is open, and the bookmark
   keys are `[modal.panel]` bindings to `bookmarks.*` actions, which do nothing in the tabs
   panel. Deviation from "reuse where you can": no new mode, so `<leader>` bindings, the
   status-bar badge, `Esc` handling and the help overlay's `[panel]` tag need no change.
4. **Prompts reuse the rename prompt** (`ui/rename-prompt.mjs`): it gains a general
   `prompt({ label, value, caret, complete, submit })` with Tab completion; `d` uses its y/N
   `ask`. While the prompt is open the host is in `insert` (it checks the prompt before the
   panel), so keys type into it even with a panel open.
5. **Paths** (core `parseBookmarkPath`): segments split on `/`, trimmed, empty ones dropped; `\/` is a
   slash inside a name, `\\` a backslash. No `..`. A trailing `/` means "folders only":
   - panel `a` follows neo-tree: `foo/bar/` creates folders and no bookmark;
   - quick add (`ctrl+b a`, `:bookmark`) files the page in that folder under its title.
     Folder names match exactly, else case-insensitively when one folder matches.
6. **Opening.** Only `http:`, `https:`, `file:` and `about:` URLs open (core `isOpenable`).
   `javascript:`, `data:` and anything else are listed but refuse with a notice: a bookmarklet
   would run with the page's rights from a key in chrome. Loads go through
   `openTrustedLinkIn` in the panel's own window: a new tab takes the current workspace's
   container (the m3 routing patch), a current-tab load stays in the tab's container, and a
   private window's load is private (no history). `Enter` / `l` open in this tab and close the
   panel; `t` opens a background tab and keeps the panel open, so several can be opened;
   `s` / `S` split through `PaneView.split` (refused at `[panes] max`, 4 by default) and load the
   bookmark in the new pane, closing the panel.
7. **Quick add.** Only a page whose URL is openable can be bookmarked (not the start page).
   Already bookmarked (Places' most recently changed bookmark for the URL): the notice says
   `already bookmarked: <path>` and the prompt becomes `move/rename:` prefilled with that path;
   `Enter` moves and renames that bookmark (no duplicate), `Esc` leaves it. `:bookmark path`
   skips the prompt for a new bookmark. The panel's `a` is an explicit "add here" and does not
   check (Firefox allows several bookmarks of one page).
8. **Live updates.** While open, the panel listens to `bookmark-added`, `-removed`, `-moved`,
   `-title-changed`, `-url-changed` and reloads the tree once per burst (one refresh tick);
   expanded folders, the filter and the highlighted item (by guid) survive. The listener is
   removed on close.
9. **Rendering.** Text only (`textContent`); a title is never parsed as HTML. At most
   `RENDER_CAP` (100) rows are in the DOM: a window that slides with the highlight, with
   "… N more" rows above and below. Moving within the window only flips `aria-selected`.
10. **Filter** (`/`): an input in the panel's head. Typing filters every bookmark (not folders)
    by title, URL and folder path with the pickers' fuzzy matcher (core `scoreField`), best
    first, as a flat list showing each folder path. `Enter` keeps the filter and returns the
    keys to the list; `Esc` clears it. With a filter in force, `Esc` in the list clears it
    first, and a second `Esc` closes.

## Keys

| Key                           | Action                                                       |
| ----------------------------- | ------------------------------------------------------------ |
| `ctrl+b shift+b`, `<leader>b` | open / close the bookmarks panel (`:bookmarks`)              |
| `ctrl+b a`                    | bookmark this page (`:bookmark [path]`)                      |
| `j` / `k`                     | move                                                         |
| `h`                           | close the folder, or go to the parent folder and close it    |
| `l`                           | open the folder (again: to its first item); a bookmark opens |
| `Enter`                       | open in this tab; on a folder, open / close it               |
| `t`                           | open in a new background tab, panel stays                    |
| `s` / `S`                     | open in a split right / below                                |
| `a`                           | add the current page here, as a path (neo-tree `a`)          |
| `A`                           | add a folder here                                            |
| `r`                           | rename                                                       |
| `m`                           | move to a folder (prompt with completion)                    |
| `d`                           | delete after `y/N` (a folder says how many items go)         |
| `y`                           | copy the URL                                                 |
| `/`                           | filter                                                       |
| `Esc`, the toggle keys        | close (`Esc` clears a filter first)                          |

"Here" is the highlighted folder, or the highlighted bookmark's folder; at the top level, the
Menu. Digits (`panel.select`) do nothing in the bookmarks panel.

## Edge cases

- Empty path, or only slashes, refuses (`bookmark: empty name`). A missing title falls back to
  the URL.
- Moving a folder into itself or below itself refuses. Renaming to an empty name refuses.
- A bookmark deleted elsewhere while highlighted: the highlight goes to the row now at its
  place. A folder deleted elsewhere drops from the expanded set.
- A window with no workspaces (private) still has bookmarks; nothing there depends on them.
- Prompts closed by focus moving elsewhere cancel, as the rename prompt does.

## Tests (written first)

- Vitest `packages/vimma-core/test/bookmarks.test.mjs`: path parsing and formatting, the Places
  tree to ours, flattening with expansion, filtering, folder resolution and completion,
  `isOpenable`, the key machine, the render window.
- Mochitest `tests/browser/browser_vimma_bookmarks.js`: toggling (both keys, one panel at a
  time, Esc), quick add with nested folders and Tab completion, already-bookmarked, every panel
  key, opening into the workspace's container, refusing `javascript:`, live updates and the
  observer removed on close, a private window's load leaving no history, text-only rendering,
  and 2,000 bookmarks (DOM rows capped, open and move timed).

## Out of scope

Tags, keywords, separators, drag and drop, sorting, the bookmarks toolbar's visibility,
multi-select, opening a whole folder, undo (Firefox's Library has it), editing a URL.

## Settled

- **Red** (2026-10-10): Vitest `Failed to load url ../src/bookmarks.mjs` (no tests ran); the
  mochitest, 13 failures, e.g. `ctrl+b shift+b opens the bookmarks panel - timed out after 100
tries` and `ctrl+b a opens the prompt - timed out`.
- **Green:** Vitest 47/47 in `bookmarks.test.mjs` (1793 in all); the mochitest 112/112, and 14
  repeats on two busy CPUs 1568/1568 (the first repeat run found only that the panel's
  remembered folders leaked into the next run; the cleanup now resets them). Measured on the
  2,000 bookmarks: open 52 ms, expand 4 ms, 150 × `j` 28 ms, typing a 9-letter filter 279 ms
  (idle); at most 100 rows in the DOM.
- **Mutation check:** without the `isOpenable` check in core `openEffect`, Vitest fails
  (`a javascript: bookmark is listed but refuses to open`) and so does the mochitest
  (`KEY_Enter refuses - timed out`); reverted.
- The `help.test.mjs` and `defaults.toml` snapshots gain the Bookmarks rows only; the action
  names stay within the old column width so no other row moved.
- **Leader default removed** (2026-10-10): by maintainer decision the leader has no default bindings,
  so `toggle_bookmarks` is `ctrl+b shift+b` only and `space b` does nothing by default. The leader
  option and `<leader>` bindings in `[keys]` stay for users to add. The bookmarks tests press
  `ctrl+b shift+b` where they pressed `space b`; the assertions are unchanged.
