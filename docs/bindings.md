# Default bindings

Generated from `packages/vimma-core/src/actions.mjs` and `defaults.mjs` by `npm run gen-docs`; do not edit.

Keys as you press them, with the default prefix and leader (`prefix = ctrl+b · leader = space`).
A `[mode]` after a key means it works only in that mode. In `config.toml` the same bindings
are written in notation: `ctrl+b b` is `prefix+b`, `space n` is `<leader>n`
([guide](guide.md#configtoml)).

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

| Action                                   | Config name        | Bindings                                                 |
| ---------------------------------------- | ------------------ | -------------------------------------------------------- |
| Split right                              | `split_vertical`   | `ctrl+b v`                                               |
| Split down                               | `split_horizontal` | `ctrl+b -`                                               |
| Focus pane to the left                   | `focus_pane_left`  | `ctrl+b h`, `ctrl+w h`                                   |
| Focus pane below                         | `focus_pane_down`  | `ctrl+b j`, `ctrl+w j`                                   |
| Focus pane above                         | `focus_pane_up`    | `ctrl+b k`, `ctrl+w k`                                   |
| Focus pane to the right                  | `focus_pane_right` | `ctrl+b l`, `ctrl+w l`                                   |
| Swap with pane to the left               | `swap_pane_left`   | `ctrl+b shift+h`, `ctrl+w H`                             |
| Swap with pane below                     | `swap_pane_down`   | `ctrl+b shift+j`, `ctrl+w J`                             |
| Swap with pane above                     | `swap_pane_up`     | `ctrl+b shift+k`, `ctrl+w K`                             |
| Swap with pane to the right              | `swap_pane_right`  | `ctrl+b shift+l`, `ctrl+w L`                             |
| Zoom pane                                | `zoom`             | `ctrl+b z`, `ctrl+w o`                                   |
| Close pane; the last pane closes the tab | `close_pane`       | `ctrl+b x`                                               |
| Resize mode                              | `resize_mode`      | `ctrl+b r`                                               |
| Leave resize mode                        | `resize_exit`      | `esc [resize]`, `enter [resize]`, `q [resize]`           |
| Make pane narrower                       | `resize_narrower`  | `ctrl+w <`, `h [resize]`, `left [resize]`, `< [resize]`  |
| Make pane wider                          | `resize_wider`     | `ctrl+w >`, `l [resize]`, `right [resize]`, `> [resize]` |
| Make pane taller                         | `resize_taller`    | `ctrl+w +`, `j [resize]`, `down [resize]`, `+ [resize]`  |
| Make pane shorter                        | `resize_shorter`   | `ctrl+w -`, `k [resize]`, `up [resize]`, `- [resize]`    |

## Workspaces

| Action                                               | Config name          | Bindings         |
| ---------------------------------------------------- | -------------------- | ---------------- |
| Next workspace                                       | `next_workspace`     | `ctrl+i`         |
| Previous workspace                                   | `previous_workspace` | `ctrl+u`         |
| Switch to a workspace by name or number              | `switch_workspace`   | —                |
| Workspace picker                                     | `workspace_picker`   | `ctrl+b w`       |
| New workspace                                        | `new_workspace`      | `ctrl+b shift+n` |
| Rename workspace                                     | `rename_workspace`   | `ctrl+b shift+w` |
| Close workspace                                      | `close_workspace`    | `ctrl+b shift+d` |
| Move the tab to another workspace (reopens it there) | `move_to_workspace`  | —                |

## Navigation

| Action                                    | Config name        | Bindings              |
| ----------------------------------------- | ------------------ | --------------------- |
| Goto picker: every tab in every workspace | `goto_picker`      | `ctrl+b g`, `b`       |
| Open / close the side panel               | `toggle_sidebar`   | `ctrl+b b`, `space n` |
| Scroll down                               | `scroll_down`      | `j`                   |
| Scroll up                                 | `scroll_up`        | `k`                   |
| Scroll left                               | `scroll_left`      | `h`                   |
| Scroll right                              | `scroll_right`     | `l`                   |
| Scroll half a page down                   | `scroll_half_down` | `d`                   |
| Scroll half a page up                     | `scroll_half_up`   | `u`                   |
| Scroll to top                             | `scroll_top`       | `gg`                  |
| Scroll to bottom                          | `scroll_bottom`    | `G`                   |
| Go back                                   | `history_back`     | `H`                   |
| Go forward                                | `history_forward`  | `L`                   |
| Reload page                               | `reload`           | `r`                   |
| Open a URL or search in this tab          | `open_url`         | —                     |

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

| Action                                 | Config name           | Bindings      |
| -------------------------------------- | --------------------- | ------------- |
| Move caret left                        | `caret_left`          | `h [visual]`  |
| Move caret down                        | `caret_down`          | `j [visual]`  |
| Move caret up                          | `caret_up`            | `k [visual]`  |
| Move caret right                       | `caret_right`         | `l [visual]`  |
| Move caret a word forward              | `caret_word_forward`  | `w [visual]`  |
| Move caret a word back                 | `caret_word_backward` | `b [visual]`  |
| Move caret to the start of the line    | `caret_line_start`    | `0 [visual]`  |
| Move caret to the end of the line      | `caret_line_end`      | `$ [visual]`  |
| Move caret to the top of the page      | `caret_top`           | `gg [visual]` |
| Move caret to the bottom of the page   | `caret_bottom`        | `G [visual]`  |
| Start or drop a selection at the caret | `toggle_selection`    | `v [visual]`  |
| Copy selection and leave copy mode     | `yank_selection`      | `y [visual]`  |

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
| Open the selected row | `panel_open`     | `enter [panel]` |
| Close the side panel  | `panel_close`    | `esc [panel]`   |

## Config

| Action                    | Config name     | Bindings |
| ------------------------- | --------------- | -------- |
| Reload config             | `reload_config` | —        |
| Open config.toml in a tab | `edit_config`   | —        |
