# Default bindings

Generated from `packages/vimma-core/src/actions.mjs` and `defaults.mjs` by `npm run gen-docs`; do not edit.

Keys as you press them, with the default keys filled in (`prefix = ctrl+b`).
A `[mode]` after a key means it works only in that mode. In `config.toml` the same bindings
are written in notation: `ctrl+b b` is `prefix+b`; a leader binding you add, `<leader>n`,
shows as `space n` ([guide](guide.md#configtoml)).

## Help

| Action                            | Config name     | Bindings                 |
| --------------------------------- | --------------- | ------------------------ |
| Show all bindings (filter with /) | `show_keybinds` | `ctrl+b ?`               |
| Close the bindings overlay        | `help_close`    | `esc [help]`, `q [help]` |
| Filter the bindings overlay       | `help_filter`   | `/ [help]`               |

## Tabs

| Action                               | Config name    | Bindings              |
| ------------------------------------ | -------------- | --------------------- |
| New tab                              | `new_tab`      | `ctrl+b c`, `t`       |
| Next tab (with a count: go to tab N) | `next_tab`     | `ctrl+b n`, `gt`      |
| Previous tab                         | `previous_tab` | `ctrl+b p`, `gT`      |
| Jump to tab 1 in this workspace      | `select_tab_1` | `ctrl+b 1`            |
| Jump to tab 2 in this workspace      | `select_tab_2` | `ctrl+b 2`            |
| Jump to tab 3 in this workspace      | `select_tab_3` | `ctrl+b 3`            |
| Jump to tab 4 in this workspace      | `select_tab_4` | `ctrl+b 4`            |
| Jump to tab 5 in this workspace      | `select_tab_5` | `ctrl+b 5`            |
| Jump to tab 6 in this workspace      | `select_tab_6` | `ctrl+b 6`            |
| Jump to tab 7 in this workspace      | `select_tab_7` | `ctrl+b 7`            |
| Jump to tab 8 in this workspace      | `select_tab_8` | `ctrl+b 8`            |
| Jump to tab 9 in this workspace      | `select_tab_9` | `ctrl+b 9`            |
| Rename tab                           | `rename_tab`   | `ctrl+b shift+t`      |
| Close tab                            | `close_tab`    | `ctrl+b shift+x`, `x` |

## Panes

| Action                                       | Config name              | Bindings                                                 |
| -------------------------------------------- | ------------------------ | -------------------------------------------------------- |
| Split right                                  | `split_vertical`         | `ctrl+b v`                                               |
| Split down                                   | `split_horizontal`       | `ctrl+b -`                                               |
| Focus pane to the left                       | `focus_pane_left`        | `ctrl+b h`, `ctrl+w h`                                   |
| Focus pane below                             | `focus_pane_down`        | `ctrl+b j`, `ctrl+w j`                                   |
| Focus pane above                             | `focus_pane_up`          | `ctrl+b k`, `ctrl+w k`                                   |
| Focus pane to the right                      | `focus_pane_right`       | `ctrl+b l`, `ctrl+w l`                                   |
| Swap with pane to the left                   | `swap_pane_left`         | `ctrl+b shift+h`, `ctrl+w H`                             |
| Swap with pane below                         | `swap_pane_down`         | `ctrl+b shift+j`, `ctrl+w J`                             |
| Swap with pane above                         | `swap_pane_up`           | `ctrl+b shift+k`, `ctrl+w K`                             |
| Swap with pane to the right                  | `swap_pane_right`        | `ctrl+b shift+l`, `ctrl+w L`                             |
| Zoom pane                                    | `zoom`                   | `ctrl+b z`, `ctrl+w o`                                   |
| Close pane; the last pane closes the tab     | `close_pane`             | `ctrl+b x`                                               |
| Resize mode                                  | `resize_mode`            | `ctrl+b r`                                               |
| Leave resize mode                            | `resize_exit`            | `esc [resize]`, `enter [resize]`, `q [resize]`           |
| Make pane narrower                           | `resize_narrower`        | `ctrl+w <`, `h [resize]`, `left [resize]`, `< [resize]`  |
| Make pane wider                              | `resize_wider`           | `ctrl+w >`, `l [resize]`, `right [resize]`, `> [resize]` |
| Make pane taller                             | `resize_taller`          | `ctrl+w +`, `j [resize]`, `down [resize]`, `+ [resize]`  |
| Make pane shorter                            | `resize_shorter`         | `ctrl+w -`, `k [resize]`, `up [resize]`, `- [resize]`    |
| New pane, along the longer side              | `new_pane`               | `ctrl+b enter`                                           |
| Next layout                                  | `next_layout`            | `ctrl+b space`                                           |
| Apply a layout preset by name (:layout name) | `select_layout`          | —                                                        |
| Layout: all side by side                     | `layout_even_horizontal` | —                                                        |
| Layout: all stacked                          | `layout_even_vertical`   | —                                                        |
| Layout: main pane left, rest stacked         | `layout_main_vertical`   | —                                                        |
| Layout: main pane on top, rest below         | `layout_main_horizontal` | —                                                        |
| Layout: a grid                               | `layout_tiled`           | —                                                        |
| Layout: a spiral (dwindle)                   | `layout_dwindle`         | —                                                        |

## Workspaces

| Action                                                            | Config name          | Bindings                                        |
| ----------------------------------------------------------------- | -------------------- | ----------------------------------------------- |
| Next workspace                                                    | `next_workspace`     | `ctrl+b )`, `]w`                                |
| Previous workspace                                                | `previous_workspace` | `ctrl+b (`, `[w`                                |
| Previous workspace you were in; again toggles back (Vim's ctrl+^) | `last_workspace`     | `ctrl+b ^`, `ctrl+b ctrl+6`, `ctrl+^`, `ctrl+6` |
| Switch to a workspace by name or number                           | `switch_workspace`   | —                                               |
| Workspace picker                                                  | `workspace_picker`   | `ctrl+b w`                                      |
| New workspace                                                     | `new_workspace`      | `ctrl+b shift+n`                                |
| Rename workspace                                                  | `rename_workspace`   | `ctrl+b shift+w`                                |
| Close workspace                                                   | `close_workspace`    | `ctrl+b shift+d`                                |
| Move the tab to another workspace (reopens it there)              | `move_to_workspace`  | —                                               |
| Routing rules: list them; :route add [workspace], :route move     | `route_rules`        | —                                               |

## Navigation

| Action                                    | Config name        | Bindings                       |
| ----------------------------------------- | ------------------ | ------------------------------ |
| Goto picker: every tab in every workspace | `goto_picker`      | `ctrl+b g`, `b`                |
| Open / close the side panel               | `toggle_sidebar`   | `ctrl+b b`                     |
| Scroll down                               | `scroll_down`      | `j`, `ctrl+e`                  |
| Scroll up                                 | `scroll_up`        | `k`, `ctrl+y`                  |
| Scroll left                               | `scroll_left`      | `h`                            |
| Scroll right                              | `scroll_right`     | `l`                            |
| Scroll half a page down                   | `scroll_half_down` | `d`, `ctrl+d`                  |
| Scroll half a page up                     | `scroll_half_up`   | `u`, `ctrl+u`                  |
| Scroll to top                             | `scroll_top`       | `gg`                           |
| Scroll to bottom                          | `scroll_bottom`    | `G`                            |
| Go back                                   | `history_back`     | `H`, `ctrl+o`                  |
| Go forward                                | `history_forward`  | `L`, `ctrl+i`                  |
| Reload page                               | `reload`           | `r`                            |
| Open a URL or search in this tab          | `open_url`         | —                              |
| Go up a level in the URL path             | `url_up`           | `gu`                           |
| Go to the site's root                     | `url_root`         | `gU`                           |
| Focus the address bar (as ctrl+l)         | `focus_urlbar`     | `I`, `I [visual]`, `I [panel]` |

## Page

| Action                                             | Config name          | Bindings |
| -------------------------------------------------- | -------------------- | -------- |
| Copy the page's URL                                | `yank_url`           | `yy`     |
| Open the clipboard's URL or search in this tab     | `open_clipboard`     | `p`      |
| Open the clipboard's URL or search in a new tab    | `open_clipboard_tab` | `P`      |
| Focus the first text field (with a count: the Nth) | `focus_input`        | `gi`     |
| View the page's source in a new tab                | `view_source`        | `gf`     |

## Hints

| Action                 | Config name           | Bindings     |
| ---------------------- | --------------------- | ------------ |
| Follow link            | `follow_link`         | `f`          |
| Follow link in new tab | `follow_link_new_tab` | `F`          |
| Leave hint mode        | `hint_cancel`         | `esc [hint]` |

## Find

| Action                   | Config name     | Bindings |
| ------------------------ | --------------- | -------- |
| Search in page           | `find_forward`  | `/`      |
| Search backwards in page | `find_backward` | `?`      |
| Next match               | `find_next`     | `n`      |
| Previous match           | `find_previous` | `N`      |

## Modes

| Action                                 | Config name      | Bindings                       |
| -------------------------------------- | ---------------- | ------------------------------ |
| Back to normal mode                    | `normal_mode`    | `esc [insert]`, `esc [visual]` |
| Insert mode: focus the first input     | `insert_mode`    | `i`                            |
| Copy mode (caret browsing + selection) | `copy_mode`      | `ctrl+b [`, `v`                |
| Command line                           | `command_line`   | `:`                            |
| Close the command line                 | `command_cancel` | `esc [command]`                |

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

| Action                                              | Config name       | Bindings               |
| --------------------------------------------------- | ----------------- | ---------------------- |
| Select row 1                                        | `panel_select_1`  | `1 [panel]`            |
| Select row 2                                        | `panel_select_2`  | `2 [panel]`            |
| Select row 3                                        | `panel_select_3`  | `3 [panel]`            |
| Select row 4                                        | `panel_select_4`  | `4 [panel]`            |
| Select row 5                                        | `panel_select_5`  | `5 [panel]`            |
| Select row 6                                        | `panel_select_6`  | `6 [panel]`            |
| Select row 7                                        | `panel_select_7`  | `7 [panel]`            |
| Select row 8                                        | `panel_select_8`  | `8 [panel]`            |
| Select row 9                                        | `panel_select_9`  | `9 [panel]`            |
| Next row                                            | `panel_down`      | `j [panel]`            |
| Previous row                                        | `panel_up`        | `k [panel]`            |
| Open the selected row                               | `panel_open`      | `enter [panel]`        |
| Close the side panel                                | `panel_close`     | `esc [panel]`          |
| Close the selected tab; the panel stays open        | `panel_close_tab` | `x [panel]`            |
| Reopen the last closed tab (Firefox's ctrl+shift+t) | `restore_tab`     | `ctrl+shift+t [panel]` |

## Bookmarks

| Action                                                 | Config name          | Bindings         |
| ------------------------------------------------------ | -------------------- | ---------------- |
| Open / close the bookmarks panel                       | `toggle_bookmarks`   | `ctrl+b shift+b` |
| Bookmark this page (folders/title files it in folders) | `add_bookmark`       | `ctrl+b a`       |
| Bookmarks: close the folder, or go to its parent       | `bookmarks_collapse` | `h [panel]`      |
| Bookmarks: open the folder or the bookmark             | `bookmarks_expand`   | `l [panel]`      |
| Bookmarks: open in a new background tab                | `bookmarks_open_tab` | `t [panel]`      |
| Bookmarks: open in a split right                       | `bookmarks_vsplit`   | `s [panel]`      |
| Bookmarks: open in a split below                       | `bookmarks_hsplit`   | `S [panel]`      |
| Bookmarks: add this page here (a/b/ makes folders)     | `bookmarks_add`      | `a [panel]`      |
| Bookmarks: add a folder here                           | `bookmarks_folder`   | `A [panel]`      |
| Bookmarks: rename                                      | `bookmarks_rename`   | `r [panel]`      |
| Bookmarks: move to a folder                            | `bookmarks_move`     | `m [panel]`      |
| Bookmarks: delete (asks y/N)                           | `bookmarks_delete`   | `d [panel]`      |
| Bookmarks: copy the URL                                | `bookmarks_yank`     | `y [panel]`      |
| Bookmarks: filter                                      | `bookmarks_filter`   | `/ [panel]`      |

## Config

| Action                    | Config name     | Bindings |
| ------------------------- | --------------- | -------- |
| Reload config             | `reload_config` | —        |
| Open config.toml in a tab | `edit_config`   | —        |

## Add-ons

| Action                                                | Config name    | Bindings   |
| ----------------------------------------------------- | -------------- | ---------- |
| Add-on picker: popup, options, on/off, remove, update | `addon_picker` | `ctrl+b e` |
| Open an add-on's popup by name (:addon name)          | `addon_popup`  | —          |
