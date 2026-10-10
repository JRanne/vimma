# Default bindings

Generated from `packages/vimma-core/src/actions.mjs` and `defaults.mjs` by `npm run gen-docs`; do not edit.

## Help

| Action                            | Config name     | Bindings                   |
| --------------------------------- | --------------- | -------------------------- |
| Show all bindings (filter with /) | `show_keybinds` | `prefix+?`                 |
| Close the bindings overlay        | `help_close`    | `<Esc> [help]`, `q [help]` |
| Filter the bindings overlay       | `help_filter`   | `/ [help]`                 |

## Tabs

| Action                               | Config name    | Bindings              |
| ------------------------------------ | -------------- | --------------------- |
| New tab                              | `new_tab`      | `prefix+c`, `t`       |
| Next tab (with a count: go to tab N) | `next_tab`     | `prefix+n`, `gt`      |
| Previous tab                         | `previous_tab` | `prefix+p`, `gT`      |
| Jump to tab 1 in this workspace      | `select_tab_1` | `prefix+1`            |
| Jump to tab 2 in this workspace      | `select_tab_2` | `prefix+2`            |
| Jump to tab 3 in this workspace      | `select_tab_3` | `prefix+3`            |
| Jump to tab 4 in this workspace      | `select_tab_4` | `prefix+4`            |
| Jump to tab 5 in this workspace      | `select_tab_5` | `prefix+5`            |
| Jump to tab 6 in this workspace      | `select_tab_6` | `prefix+6`            |
| Jump to tab 7 in this workspace      | `select_tab_7` | `prefix+7`            |
| Jump to tab 8 in this workspace      | `select_tab_8` | `prefix+8`            |
| Jump to tab 9 in this workspace      | `select_tab_9` | `prefix+9`            |
| Rename tab                           | `rename_tab`   | `prefix+shift+t`      |
| Close tab                            | `close_tab`    | `prefix+shift+x`, `x` |

## Panes

| Action                                   | Config name        | Bindings                                                   |
| ---------------------------------------- | ------------------ | ---------------------------------------------------------- |
| Split right                              | `split_vertical`   | `prefix+v`                                                 |
| Split down                               | `split_horizontal` | `prefix+minus`                                             |
| Focus pane to the left                   | `focus_pane_left`  | `prefix+h`, `<C-w>h`                                       |
| Focus pane below                         | `focus_pane_down`  | `prefix+j`, `<C-w>j`                                       |
| Focus pane above                         | `focus_pane_up`    | `prefix+k`, `<C-w>k`                                       |
| Focus pane to the right                  | `focus_pane_right` | `prefix+l`, `<C-w>l`                                       |
| Swap with pane to the left               | `swap_pane_left`   | `prefix+shift+h`, `<C-w>H`                                 |
| Swap with pane below                     | `swap_pane_down`   | `prefix+shift+j`, `<C-w>J`                                 |
| Swap with pane above                     | `swap_pane_up`     | `prefix+shift+k`, `<C-w>K`                                 |
| Swap with pane to the right              | `swap_pane_right`  | `prefix+shift+l`, `<C-w>L`                                 |
| Zoom pane                                | `zoom`             | `prefix+z`, `<C-w>o`                                       |
| Close pane; the last pane closes the tab | `close_pane`       | `prefix+x`                                                 |
| Resize mode                              | `resize_mode`      | `prefix+r`                                                 |
| Leave resize mode                        | `resize_exit`      | `<Esc> [resize]`, `<CR> [resize]`, `q [resize]`            |
| Make pane narrower                       | `resize_narrower`  | `<C-w><`, `h [resize]`, `<Left> [resize]`, `<lt> [resize]` |
| Make pane wider                          | `resize_wider`     | `<C-w>>`, `l [resize]`, `<Right> [resize]`, `> [resize]`   |
| Make pane taller                         | `resize_taller`    | `<C-w>+`, `j [resize]`, `<Down> [resize]`, `+ [resize]`    |
| Make pane shorter                        | `resize_shorter`   | `<C-w>-`, `k [resize]`, `<Up> [resize]`, `- [resize]`      |

## Workspaces

| Action                                                        | Config name          | Bindings         |
| ------------------------------------------------------------- | -------------------- | ---------------- |
| Next workspace                                                | `next_workspace`     | `ctrl+i`         |
| Previous workspace                                            | `previous_workspace` | `ctrl+u`         |
| Switch to a workspace by name or number                       | `switch_workspace`   | —                |
| Workspace picker                                              | `workspace_picker`   | `prefix+w`       |
| New workspace                                                 | `new_workspace`      | `prefix+shift+n` |
| Rename workspace                                              | `rename_workspace`   | `prefix+shift+w` |
| Close workspace                                               | `close_workspace`    | `prefix+shift+d` |
| Move the tab to another workspace (reopens it there)          | `move_to_workspace`  | —                |
| Routing rules: list them; :route add [workspace], :route move | `route_rules`        | —                |

## Navigation

| Action                                    | Config name        | Bindings                |
| ----------------------------------------- | ------------------ | ----------------------- |
| Goto picker: every tab in every workspace | `goto_picker`      | `prefix+g`, `b`         |
| Open / close the side panel               | `toggle_sidebar`   | `prefix+b`, `<leader>n` |
| Scroll down                               | `scroll_down`      | `j`                     |
| Scroll up                                 | `scroll_up`        | `k`                     |
| Scroll left                               | `scroll_left`      | `h`                     |
| Scroll right                              | `scroll_right`     | `l`                     |
| Scroll half a page down                   | `scroll_half_down` | `d`                     |
| Scroll half a page up                     | `scroll_half_up`   | `u`                     |
| Scroll to top                             | `scroll_top`       | `gg`                    |
| Scroll to bottom                          | `scroll_bottom`    | `G`                     |
| Go back                                   | `history_back`     | `H`                     |
| Go forward                                | `history_forward`  | `L`                     |
| Reload page                               | `reload`           | `r`                     |
| Open a URL or search in this tab          | `open_url`         | —                       |
| Go up a level in the URL path             | `url_up`           | `gu`                    |
| Go to the site's root                     | `url_root`         | `gU`                    |

## Page

| Action                                             | Config name          | Bindings |
| -------------------------------------------------- | -------------------- | -------- |
| Copy the page's URL                                | `yank_url`           | `yy`     |
| Open the clipboard's URL or search in this tab     | `open_clipboard`     | `p`      |
| Open the clipboard's URL or search in a new tab    | `open_clipboard_tab` | `P`      |
| Focus the first text field (with a count: the Nth) | `focus_input`        | `gi`     |
| View the page's source in a new tab                | `view_source`        | `gf`     |

## Hints

| Action                 | Config name           | Bindings       |
| ---------------------- | --------------------- | -------------- |
| Follow link            | `follow_link`         | `f`            |
| Follow link in new tab | `follow_link_new_tab` | `F`            |
| Leave hint mode        | `hint_cancel`         | `<Esc> [hint]` |

## Find

| Action                   | Config name     | Bindings |
| ------------------------ | --------------- | -------- |
| Search in page           | `find_forward`  | `/`      |
| Search backwards in page | `find_backward` | `?`      |
| Next match               | `find_next`     | `n`      |
| Previous match           | `find_previous` | `N`      |

## Modes

| Action                                 | Config name      | Bindings                           |
| -------------------------------------- | ---------------- | ---------------------------------- |
| Back to normal mode                    | `normal_mode`    | `<Esc> [insert]`, `<Esc> [visual]` |
| Insert mode: focus the first input     | `insert_mode`    | `i`                                |
| Copy mode (caret browsing + selection) | `copy_mode`      | `prefix+[`, `v`                    |
| Command line                           | `command_line`   | `:`                                |
| Close the command line                 | `command_cancel` | `<Esc> [command]`                  |

## Copy mode

| Action                                      | Config name           | Bindings      |
| ------------------------------------------- | --------------------- | ------------- |
| Move caret left                             | `caret_left`          | `h [visual]`  |
| Move caret down                             | `caret_down`          | `j [visual]`  |
| Move caret up                               | `caret_up`            | `k [visual]`  |
| Move caret right                            | `caret_right`         | `l [visual]`  |
| Move caret a word forward                   | `caret_word_forward`  | `w [visual]`  |
| Move caret a word back                      | `caret_word_backward` | `b [visual]`  |
| Move caret to the start of the line         | `caret_line_start`    | `0 [visual]`  |
| Move caret to the end of the line           | `caret_line_end`      | `$ [visual]`  |
| Move caret to the top of the page           | `caret_top`           | `gg [visual]` |
| Move caret to the bottom of the page        | `caret_bottom`        | `G [visual]`  |
| Move caret to the end of the word           | `caret_word_end`      | `e [visual]`  |
| Move caret to the previous word's end       | `caret_prev_word_end` | `ge [visual]` |
| Move caret to the next WORD (by spaces)     | `caret_bigword_next`  | `W [visual]`  |
| Move caret to the WORD's start              | `caret_bigword_back`  | `B [visual]`  |
| Move caret to the end of the WORD           | `caret_bigword_end`   | `E [visual]`  |
| Move caret to the line's first non-blank    | `caret_first_char`    | `^ [visual]`  |
| Move caret to the paragraph's start         | `caret_para_back`     | `{ [visual]`  |
| Move caret to the paragraph's end           | `caret_para_next`     | `} [visual]`  |
| Find a character forward on the line        | `caret_find_forward`  | `f [visual]`  |
| Find a character backward on the line       | `caret_find_backward` | `F [visual]`  |
| Till a character forward on the line        | `caret_till_forward`  | `t [visual]`  |
| Till a character backward on the line       | `caret_till_backward` | `T [visual]`  |
| Repeat the last f, F, t or T                | `caret_find_repeat`   | `; [visual]`  |
| Repeat the last find, reversed              | `caret_find_reverse`  | `, [visual]`  |
| Start or drop a selection at the caret      | `toggle_selection`    | `v [visual]`  |
| Start or drop a line-wise selection         | `line_selection`      | `V [visual]`  |
| Swap the selection's ends                   | `swap_selection_ends` | `o [visual]`  |
| Select the word at the caret                | `select_inner_word`   | `iw [visual]` |
| Select the word at the caret and its spaces | `select_a_word`       | `aw [visual]` |
| Copy selection and leave copy mode          | `yank_selection`      | `y [visual]`  |
| Copy the selection's whole lines and leave  | `yank_lines`          | `Y [visual]`  |

## Side panel

| Action                | Config name      | Bindings        |
| --------------------- | ---------------- | --------------- |
| Select row 1          | `panel_select_1` | `1 [panel]`     |
| Select row 2          | `panel_select_2` | `2 [panel]`     |
| Select row 3          | `panel_select_3` | `3 [panel]`     |
| Select row 4          | `panel_select_4` | `4 [panel]`     |
| Select row 5          | `panel_select_5` | `5 [panel]`     |
| Select row 6          | `panel_select_6` | `6 [panel]`     |
| Select row 7          | `panel_select_7` | `7 [panel]`     |
| Select row 8          | `panel_select_8` | `8 [panel]`     |
| Select row 9          | `panel_select_9` | `9 [panel]`     |
| Next row              | `panel_down`     | `j [panel]`     |
| Previous row          | `panel_up`       | `k [panel]`     |
| Open the selected row | `panel_open`     | `<CR> [panel]`  |
| Close the side panel  | `panel_close`    | `<Esc> [panel]` |

## Bookmarks

| Action                                                 | Config name          | Bindings                      |
| ------------------------------------------------------ | -------------------- | ----------------------------- |
| Open / close the bookmarks panel                       | `toggle_bookmarks`   | `prefix+shift+b`, `<leader>b` |
| Bookmark this page (folders/title files it in folders) | `add_bookmark`       | `prefix+a`                    |
| Bookmarks: close the folder, or go to its parent       | `bookmarks_collapse` | `h [panel]`                   |
| Bookmarks: open the folder or the bookmark             | `bookmarks_expand`   | `l [panel]`                   |
| Bookmarks: open in a new background tab                | `bookmarks_open_tab` | `t [panel]`                   |
| Bookmarks: open in a split right                       | `bookmarks_vsplit`   | `s [panel]`                   |
| Bookmarks: open in a split below                       | `bookmarks_hsplit`   | `S [panel]`                   |
| Bookmarks: add this page here (a/b/ makes folders)     | `bookmarks_add`      | `a [panel]`                   |
| Bookmarks: add a folder here                           | `bookmarks_folder`   | `A [panel]`                   |
| Bookmarks: rename                                      | `bookmarks_rename`   | `r [panel]`                   |
| Bookmarks: move to a folder                            | `bookmarks_move`     | `m [panel]`                   |
| Bookmarks: delete (asks y/N)                           | `bookmarks_delete`   | `d [panel]`                   |
| Bookmarks: copy the URL                                | `bookmarks_yank`     | `y [panel]`                   |
| Bookmarks: filter                                      | `bookmarks_filter`   | `/ [panel]`                   |

## Config

| Action                    | Config name     | Bindings |
| ------------------------- | --------------- | -------- |
| Reload config             | `reload_config` | —        |
| Open config.toml in a tab | `edit_config`   | —        |
