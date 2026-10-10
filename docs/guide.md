# Vimma user guide

Vimma is pre-alpha. This guide says what works **today** on `main` and marks everything else as
**planned**, with the milestone that brings it ([plan.md](../plan.md) §6). Known gaps are listed
in [limits.md](limits.md).

## Getting started

### Install

There are no packages or binaries yet. Tarballs, an AppImage, a `.deb` and AUR `vimma-bin` are
planned for M6. Until then, build from source as the [README](../README.md#build-and-run)
describes: `npm ci`, `npx surfer download`, `npx surfer bootstrap`, `npm run import`,
`npx surfer build`. The first build takes about 40 minutes on a 16-thread machine and needs
about 35 GB of disk space (`engine/` 27 GB, the sccache compiler cache 6.8 GB, `~/.mozbuild`
3.1 GB, `.surfer/` 0.8 GB).

### Installing (planned, not yet released)

**Planned for M6; no release has these files yet.** Each GitHub Release will carry, for Linux
x86_64 (`X.Y.Z` is the Vimma version):

| File                              | Install                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `vimma_X.Y.Z_amd64.deb`           | `sudo apt install ./vimma_X.Y.Z_amd64.deb` (Debian 12+, Ubuntu 22.04+)                   |
| `vimma-X.Y.Z-x86_64.AppImage`     | `chmod +x vimma-X.Y.Z-x86_64.AppImage && ./vimma-X.Y.Z-x86_64.AppImage`                  |
| `vimma-X.Y.Z-linux-x86_64.tar.xz` | `tar -xJf vimma-X.Y.Z-linux-x86_64.tar.xz && ./vimma/vimma`                              |
| AUR `vimma-bin`                   | `yay -S vimma-bin` or `git clone https://aur.archlinux.org/vimma-bin.git && makepkg -si` |

The `.deb` and the AUR package add Vimma to your application menu and offer it for web links,
but never make it your default browser on their own: `xdg-settings set default-web-browser
vimma-vimma.desktop` does that. Vimma has no in-app updater: update through apt, your AUR helper, or by
downloading the next AppImage or tarball. Next to the files are `SHA256SUMS`, a CycloneDX SBOM
(`vimma-X.Y.Z.cdx.json`) and cosign signatures (`*.sigstore.json`); how to check them is in
[runbook.md](runbook.md#release-packages-releaseyml-spec-m6-packaging) ("Verify a release").

### First launch, with its own profile

Start Vimma from the checkout with `npm start`. It runs your build with a profile of its own,
`~/.cache/vimma-dev-profile`, so it never touches your Firefox profile:

```sh
npm start                   # the full build, or the artifact build if that is all there is
npm start -- --fresh        # a throwaway profile, deleted when Vimma quits
npm start -- --profile DIR  # another persistent profile
```

It refuses to start a second Vimma on a profile that is already open; switch to that window
instead. The profile's `user.js` gets one line Vimma needs when run from a source checkout
(read access for web pages' sandbox to the checkout's `src/`); your own lines there are kept.

Where Vimma keeps its files on Linux:

| Path                          | What                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `~/.config/vimma/config.toml` | Your config (see [config.toml](#configtoml)). Vimma reads only this file there and never scans the folder. |
| `~/.config/vimma/vimma/`      | Profiles and `profiles.ini`. If `~/.vimma/vimma/` already exists, Firefox's legacy rule uses that instead. |

On first launch you see Firefox's interface without the tab strip: the window starts with the
navigation bar and URL bar at the top, and Vimma's status bar at the bottom. Press `ctrl+b`, then
`?`, to see the bindings.

### The start page

New windows and new tabs open Vimma's start page: the logo, and under it the keys to start from
(`ctrl+b ?` keys, `:` commands, `f` hints). The URL bar is empty and focused, so you can type an
address straight away; click the page to use `:` and the other keys there. It is a local page
(`chrome://browser/content/vimma/start/start.html`); nothing loads from the network.

To change it back:

- **Home page and new windows:** Settings (`about:preferences#home`) → "Homepage and new
  windows", or set `browser.startup.homepage` in `about:config`. "Restore Defaults" there brings
  the start page back.
- **New tabs:** set `vimma.startpage.newtab` to `false` in `about:config` (applies at once) for
  Firefox's new tab page. Settings' "New tabs" menu does not change Vimma's start page. An
  extension that sets its own new tab page takes precedence.

## The two layers

Vimma has two key layers and one dispatcher, which sees every key before Firefox does, including
in the URL bar, `about:` pages and the PDF viewer.

- **The prefix layer (Herdr).** `ctrl+b` is the prefix. The next key is a command: `ctrl+b ?`
  shows the bindings, `ctrl+b c` opens a tab, and later `ctrl+b v` splits the pane, and so on.
  The prefix works in every mode and waits for the next key with no timeout. `Esc` cancels it.
- **The modal layer (Neovim).** Bare keys act on the page depending on the mode: `j`/`k` scroll
  in `normal` mode, while in `insert` mode (focus in a text field) keys go to the page.
  `visual` is copy mode (caret and selection), `hint` is link hints, `help` the bindings overlay
  and `command` the `:` line, `resize` is resize mode for panes (`ctrl+b r`); `panel` (the side
  panel) is planned.

### Normal and insert mode

Every tab starts in **normal** mode: Vimma's bare keys (the table below) act on the page, and
the page never sees them. Keys Vimma has no binding for, such as `z` or a site's own `s` or `m`,
still reach the page.

Focusing a text field puts the tab in **insert** mode, so typing works as in Firefox: inputs,
text areas, editable regions (`contenteditable`), ARIA text boxes, code editors (Monaco,
CodeMirror, Ace, ProseMirror, Quill), fields inside web components and inside frames from
other sites. Focusing a checkbox, button or link does not. `Esc` leaves insert: it takes focus
out of the field and the tab is back in normal. `i` enters insert explicitly: it focuses the
first text field on the page, or, on a page without one (a game), lets every key through until
`Esc`.

Clicking into a page that is editable as a whole (a `designMode` document, such as some rich
text editors' frames) also enters insert.

Each tab keeps its own mode. Settings (`about:preferences`) and the PDF viewer work the same
way, but Settings focuses its search box when it opens, so it starts in insert: press `Esc`
before `j`/`k`. Pages Vimma does not reach (extension pages, `data:` and `view-source:` pages)
stay in insert, so their keys are untouched. With focus in the URL bar or the find bar, keys
belong to that field; only `ctrl+b` sequences are Vimma's there (and, in a `/` search,
`Enter` and `Esc`).

**`Esc` in a text field is Vimma's.** It leaves insert, so the page does not see that `Esc`: a
site's own `Esc` (closing an autocomplete list or a dialog) does not fire from the field. Press
`Esc` again: in normal mode `Esc` has no binding, so it reaches the page (the field no longer
has focus, so the page's document gets it, not the field).

**A key that starts a sequence passes when nothing in that sequence works yet.** `ctrl+w`
starts the `ctrl+w h/j/k/l`, `H/J/K/L`, `o` and `< > + -` pane keys, which do something only with two panes or
more, so in a window with one pane `ctrl+w` still closes the tab. With a split, `ctrl+w` in
normal mode waits for the pane key (`Esc` cancels); close the tab with `x` or `ctrl+b shift+x`. `g` starts `gg`, which works, so `g` is Vimma's: the page does not see it, and `Esc`
cancels it.

**Every default binding runs.** Should a future binding land before its command, it is never
silent once it is Vimma's: a `ctrl+b` sequence, or a count followed by a key (`3H`), whose
command is not built yet shows "… not implemented yet" in the bottom-right corner for 1.5 s
(not while a video or page is fullscreen); a single key whose command is not built yet reaches
the page or Firefox, with no message; and the `ctrl+b ?` overlay dims it.

### Link hints

`f` puts a yellow label on everything you could click on screen: links, buttons, form fields,
and elements the page made clickable (ARIA buttons and tabs, elements with a click handler),
also inside web components and in frames from other sites. Things off screen, hidden or covered
by something else (a fixed header, a cookie banner) get no label. Type a label to pick its
target: a link is followed, a button is pressed, a text field gets focus and the tab is in
insert mode. Labels use the home row (`a s d f g h j k l`), in reading order: targets near the
top get the shortest. As you type, labels that no longer match disappear. `Backspace` takes
back a key and `Esc` leaves hints without doing anything.

`F` labels links only and opens the one you pick in a new tab in the background, so you stay
on the page and can pick more.

The labels are drawn by the browser, over the page, not inside it: the page cannot see them,
restyle them or hide them. Apps that draw their own controls on a canvas (Google Docs, Figma,
maps, games) have nothing to label.

### Find

`/` opens Firefox's find bar at the foot of the page, empty, and searches as you type, in frames
from other sites, inside web components and in the PDF viewer too. Matches are highlighted and
counted as in Firefox. The search starts at the top of what you see (or at the selection, if it
is on screen), as Vim's starts at the cursor.

- **Case:** smartcase. An all lower-case search ignores case (`word` finds `Word`); one capital
  letter makes it match case (`Word` finds only `Word`). `ctrl+f` uses the same rule.
- **`Enter`** keeps the match selected and closes the bar; you are back in normal mode. A search
  that found nothing goes back to where you were, and the status bar says `not found`.
- **`Esc`** cancels: the bar closes, nothing stays selected and the page scrolls back to where
  it was when you pressed `/`.
- **`n` / `N`** jump to the next / previous match without opening the bar, wrapping at the ends.
  After a search that found nothing they do nothing.
- **`?`** searches backward: it shows matches as you type, as `/` does, and `Enter` lands on the
  last match before where you were. After `?`, `n` goes on backward and `N` forward.

`ctrl+f` still opens Firefox's own find bar, where `Enter` goes to the next match.

### Copy mode

`v` (or `ctrl+b [`, as in tmux) enters copy mode: a caret appears at the start of the first text
you see, or at the selection if one is on screen, and the badge says `VISUAL`. It is Firefox's
caret browsing (`F7`), for this page only, driven by Vim keys:

- **`h` / `l`** move the caret a character, **`j` / `k`** a line, **`w` / `b`** a word (Firefox's
  word steps: `w` stops at the end of a word), **`0` / `$`** to the start / end of the line,
  **`gg` / `G`** to the top / bottom of the page. A count repeats: `3w`. The page scrolls to
  keep the caret in view.
- **`v`** starts a selection at the caret; the motions then extend it. `v` again drops it and
  the caret moves on its own.
- **`y`** copies the selection to the clipboard as plain text, says "yanked 12 chars" and goes
  back to normal mode. With nothing selected it says "nothing to yank".
- **`Esc`** drops the selection and goes back to normal mode.

The page gets none of these keys, nor any other plain key while copy mode is on; chords such as
`ctrl+c` or `ctrl+t` still work. In a frame (an embedded video page, a comment widget) copy mode
works once the frame has focus (click it first). Text inside a text field is not reachable: focus
the field and use its own selection.

## Status bar

The status bar is the window's last line, always there (it hides only while a page is in
fullscreen, such as a video; browser fullscreen with `F11` keeps it). From the left:

- the **mode** badge in the mode's colour: `NORMAL` on a page, `INSERT` while a text field has
  focus (or after `i`), `COMMAND` while you type a `:` command or a `/` search, `HELP` while
  the `ctrl+b ?` overlay or the `ctrl+b g` picker is open, `HINT` while link hints are up,
  `VISUAL` in copy mode;
- the **pending keys**, e.g. `prefix` after `ctrl+b`;
- the **workspace**: `● 2:work`, its number in `ctrl+i` order and its name;
- `tab 2/5`: the selected tab and how many the workspace shows;
- the page **title**, or your rename (`ctrl+b shift+t`);
- on the right, the **search** in this page: `/word [2/5]` (match 2 of 5), or
  `/zzz not found` in red;
- `loading` while the page loads, then its **URL** without `https://`.

On a narrow window the least important parts give way first: the URL is shortened in the middle,
then dropped, then the title is shortened, and so on. The mode badge always stays. Screen
readers announce the mode when it changes, including when focus moves into or out of a text
field, but not every title change.

After `ctrl+b` (or any key that starts a longer sequence) only the pending keys show in the bar;
no list of next keys pops up. To see the bindings, press `ctrl+b ?` (`ctrl+b shift+?` on a
layout where `?` is shifted): the overlay is the one place that lists them.

### Colours: your Omarchy theme

The status bar, the command line, the `ctrl+b ?` overlay, the pickers and prompts, link hints,
notices, pane borders and the start page take their colours from your current [Omarchy](https://omarchy.org) theme, with nothing to
set up: Vimma reads `~/.local/state/omarchy/current/theme/colors.toml` (and `light.mode`, for a
light theme) and checks it every 2 seconds, so `omarchy-theme-set` (or picking a theme from the
Omarchy menu) recolours every open window and start page within 2 seconds, without a restart.
Without Omarchy, or with `vimma.theme.source` set to `builtin`, the colours are Vimma's built-in
Tokyo Night. A `colors.toml` Vimma cannot read (a value that is not a `#rrggbb` colour, a
missing key) is ignored: the colours stay as they were, and the Browser Console
(`ctrl+shift+j`) says which line is wrong.

**Instant theme changes.** On Omarchy, Vimma recolours as soon as `omarchy-theme-set` finishes,
not within 2 seconds, with nothing to set up. When Vimma starts and finds
`~/.config/omarchy/hooks/`, it writes its hook, `vimma-theme-reload.sh`, into
`~/.config/omarchy/hooks/theme-set.d/` (mode 0644). Omarchy runs that hook after every theme
change; it tells each running Vimma to read the theme again, through the same channel a second
`vimma` command uses to reach the running one (no control socket, no `vimma-ctl`). With Vimma
not running, the hook does nothing and starts nothing. Omarchy runs its hooks after it has
restarted the terminals and retinted the other apps, so Vimma changes together with them.

- **Your edits stay yours.** The hook's last line is a checksum. As long as it matches, Vimma
  keeps the file up to date; once you edit the file, Vimma never writes or removes it again.
- **Deleting it sticks.** Vimma writes the hook once; if you delete it, it does not come back.
- **To opt out**, set `vimma.theme.omarchyHook` to `false` in `about:config`: Vimma removes its
  own, unedited hook at once and writes no new one. Set it back to `true` to have it written
  again.
- **By hand:** `vimma -vimma-reload-theme` makes the running Vimma read its theme now. Only use
  it while Vimma runs: with none running it starts Vimma (the hook checks first, so it never
  does).
- Without D-Bus, the hook falls back to `vimma-ctl reload-theme` when `vimma-ctl` is on your
  `PATH` and the [control socket](#scripting-with-vimma-ctl) is on.

The 2-second check keeps working in every case.

## Keys

[bindings.md](bindings.md) lists the full default keymap. It is generated from the same table
the dispatcher and the `ctrl+b ?` overlay use, so the three cannot disagree.

**What works today:**

| Keys                        | What it does                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `j` / `k`, `h` / `l`        | Normal mode: scroll down / up, left / right by a step. A count repeats: `3j`.                                                                                 |
| `d` / `u`                   | Normal mode: scroll half a page down / up (`ctrl+u` is reserved for workspaces).                                                                              |
| `gg` / `G`                  | Normal mode: go to the top / bottom of the page.                                                                                                              |
| `H` / `L`                   | Normal mode: back / forward in the page's history (in a split, the focused pane's). A count moves that many pages, stopping at the first or last: `3H`.       |
| `r`                         | Normal mode: reloads the page (in a split, the focused pane's). In insert mode `H`, `L` and `r` are typed into the field.                                     |
| `i`                         | Normal mode: focus the first text field and enter insert mode.                                                                                                |
| `f` / `F`                   | Normal mode: link hints. Type a label to follow it, or, with `F`, to open the link in a background tab. `Backspace` undoes a key, `Esc` cancels.              |
| `/` / `?`                   | Normal mode: find in the page (below). `Enter` stays on the match, `Esc` goes back to where you were.                                                         |
| `n` / `N`                   | Normal mode: next / previous match of the last search (`?` reverses them), wrapping around the page.                                                          |
| `v`, `ctrl+b [`             | Normal mode: copy mode ([above](#copy-mode)): `h j k l w b 0 $ gg G` move the caret, `v` selects, `y` copies and leaves, `Esc` leaves.                        |
| `Esc`                       | Insert mode: leave the text field, back to normal mode. In normal mode the page gets `Esc`.                                                                   |
| `ctrl+b ?`                  | Opens the bindings overlay over any page, including `about:preferences` and the PDF viewer. Press it again to close.                                          |
| `/` (in the overlay)        | Filters the list as you type.                                                                                                                                 |
| `Esc` or `q` (overlay)      | Closes the overlay. Focus returns to where it was.                                                                                                            |
| `ctrl+b c`, `t`             | Opens a new tab (Firefox's new-tab page, URL bar focused), as `ctrl+t` does. `t` in normal mode.                                                              |
| `ctrl+b n` / `ctrl+b p`     | Next / previous tab, wrapping around at the ends. Hidden tabs are skipped. `gt` / `gT` in normal mode; `3gt` goes to tab 3.                                   |
| `ctrl+b 1..9`               | Tab 1 to 9, counting visible tabs (pinned tabs first). With fewer tabs than N, nothing happens.                                                               |
| `:`                         | Normal mode: opens the command line at the bottom of the window ([below](#the-command-line)). In a text field `:` is typed.                                   |
| `ctrl+b g`, `b`             | Opens the goto picker over the page (`b` in normal mode): every tab of the window ([below](#goto-picker-and-tab-rename)).                                     |
| `ctrl+b shift+t`            | Renames the tab ([below](#goto-picker-and-tab-rename)); an empty name restores the page title.                                                                |
| `ctrl+b v` / `ctrl+b -`     | Splits the pane right / down. The new pane opens a new tab (the start page, URL bar focused). At most 4 panes (`[panes] max`); a refused split says why.      |
| `ctrl+b h j k l`            | Focuses the pane left / below / above / right; when several touch, the one used last. `ctrl+w h j k l` in normal mode. The page of that pane gets focus.      |
| `ctrl+b z`, `ctrl+w o`      | Zooms the pane to the whole window, or back. The other panes' pages pause. A pane focus key unzooms when it moves.                                            |
| `ctrl+b x`                  | Closes the pane; its tab stays open. With one pane it closes the tab, as `ctrl+b shift+x`.                                                                    |
| `ctrl+b shift+h j k l`      | Swaps the pane with the one left / below / above / right; it keeps focus and its page. `ctrl+w H J K L` in normal mode.                                       |
| `ctrl+b r`                  | Resize mode ([below](#resize-mode)): `h j k l` move the pane's divider, `Esc` leaves. `ctrl+w < > + -` resize directly in normal mode.                        |
| `ctrl+b shift+x`, `x`       | Closes the tab, as `ctrl+w` does: on a pinned tab it selects the first unpinned tab instead; the last tab closes the window. `x` in normal mode.              |
| `ctrl+b` then anything else | Never leaks to the page. A binding that does not run yet shows "… not implemented yet" for 1.5 s; an unbound key does nothing. No more bookmarks sidebar.     |
| Firefox's own keys          | Unchanged: `ctrl+t`, `ctrl+w`, `ctrl+tab`, `ctrl+shift+tab`, `ctrl+pagedown`, `alt+1..9` (tab N on Linux), `ctrl+l`, `ctrl+f`, `ctrl+u`, `ctrl+i`, and so on. |

Clicking into a pane focuses it, as `ctrl+b h/j/k/l` would. So does selecting a pane's tab any
other way (the `ctrl+b g` picker, `ctrl+tab`, `alt+1..9`): the status bar's `pane n/m` and the
URL bar follow, and a zoom ends, as it does when a pane key moves. Selecting a tab that no pane
shows (the picker, `ctrl+tab`, `alt+1..9`, `ctrl+t`, a link opened in a new foreground tab)
shows it in the focused pane: the split stays, and the tab that pane showed stays open in the
workspace. A pinned tab shows alone; selecting a pane's tab brings the split back.

A split made outside Vimma (Firefox's own split-view command, an extension, or a restored
Firefox session) becomes the workspace's panes: its tabs side by side in its order, at the
widths Firefox gave them, with the selected tab's pane focused. The pane keys then work on it,
and the workspace keeps it like any other split. If such a split's tabs are in different
workspaces, or the workspace already has a split, Vimma separates its tabs again and the
status bar says why; the tabs stay in their workspaces. Separating a split outside Vimma closes
its panes.

While the overlay is open it takes every key, so `ctrl+w` cannot close the tab behind it. Rows
for bindings that do not run yet are dimmed, under a legend that says so; actions your
`config.toml` rebinds are marked `*`. In normal mode bare
digits start a count (`3j`), so a page's own digit shortcuts need `i` first.

### Resize mode

With two panes or more, `ctrl+b r` enters resize mode and the status bar says `RESIZE`. Each
key moves the focused pane's nearest divider by 5 % of its split: `l` (or `→`, `>`) makes the
pane wider, `h` (`←`, `<`) narrower, `j` (`↓`, `+`) taller, `k` (`↑`, `-`) shorter. A count
repeats the step: `4l` is 20 %. Growing borrows from the nearest neighbour first, then the next
one; no pane gets smaller than 10 % of its split. `Esc`, `Enter` or `q` leave the mode. The
mode is modal like the bindings overlay: the page sees none of its keys, and other keys do
nothing. `ctrl+b` keys still work in it. With one pane, `ctrl+b r` says so and does nothing.

Without the mode, `ctrl+w >`, `ctrl+w <`, `ctrl+w +` and `ctrl+w -` resize by one step in
normal mode (`3 ctrl+w >` by three), as in Vim. A config can rebind the mode's keys in
`[modal.resize]`.

## Workspaces

Every tab lives in a workspace, and every workspace is a Firefox container of its own: a site
you are signed in to in one workspace sees none of its cookies or storage in another. A new
profile has one workspace, `main`; you make more as you need them (see
[Managing workspaces](#managing-workspaces)).

- `ctrl+i` / `ctrl+u` (or `:wsnext` / `:wsprev`) go to the next / previous workspace, wrapping
  around; `:workspace work` or `:workspace 2` goes to one by name or number. The status bar
  shows where you are (`● 2:work`).
- `ctrl+b w` (or `:workspace` with no name) opens the [workspace picker](#workspace-picker).
- `<leader>n` (space, then `n`), `ctrl+b b` or `:sidebar` opens the [side panel](#side-panel):
  the current workspace's tabs down the left of the window.
- A window shows **one workspace at a time**: the other workspaces' tabs are hidden, not closed.
  Coming back selects the tab you left, and a split comes back with its panes laid out as
  before, the same pane focused and its page ready for keys. Each workspace keeps its own split:
  splitting in one leaves the others' layouts alone. A workspace with no tabs gets a start-page tab when you switch to it.
- `ctrl+b 1..9`, `ctrl+b n` / `p`, `gt`, `ctrl+tab` and closing a tab stay within the
  workspace. The goto picker (`ctrl+b g`) is the exception: it lists every workspace's tabs, and
  picking one from another workspace switches there.
- **New tabs** (`ctrl+b c`, `t`, `ctrl+t`, a bookmark, a link from another app) open in the
  current workspace and its container. A link opened from a page keeps that page's container
  and so its workspace: opened in the background into another workspace, it waits there, hidden,
  and the status bar says where it went (`opened in "work"`).
- A tab in a container that belongs to no workspace (Firefox's own containers, "no container",
  an extension's) joins the workspace you are in as a `foreign` tab: it does not share that
  workspace's cookies and logins. The workspace picker counts it (`3 tabs, 1 foreign`).
- **A restart restores them.** Each window comes back with its workspaces, their tabs, the
  workspace you were in, the tab you had selected in each, every workspace's split panes laid
  out as you left them with the same pane focused, your tab names and each page's scroll position. Tabs of other workspaces are not loaded
  until you first go to them; their scroll position comes back then. The same happens with
  "Restore previous session" and reopening a closed window.
- **Pinned tabs** belong to no workspace and show in every one. Vimma has no key to pin; an
  extension or an old session can still pin.
- Each window has its own current workspace; the workspaces themselves are shared by all
  windows.

### Managing workspaces

| Keys             | Command                        | What it does                                                        |
| ---------------- | ------------------------------ | ------------------------------------------------------------------- |
| `ctrl+b shift+n` | `:wsnew shop`                  | New workspace, with a container of its own; you switch to it.       |
| `ctrl+b shift+w` | `:wsrename market`             | Rename the current workspace (and its container).                   |
| `ctrl+b shift+d` | `:wsdelete` / `:wsdelete shop` | Close the current (or the named) workspace, after a `y/N` question. |
|                  | `:wsmove work` / `:wsmove 2`   | Move the current tab to another workspace, by name or number.       |

- The keys open the command line with the command typed for you (`ctrl+b shift+w` with the
  current name to edit).
- **Closing asks first**, at the foot of the window: `y` closes, any other key (`n`, `Esc`,
  `Enter`) keeps it. Closing a workspace you made **deletes its container, and with it its
  cookies, logins and site data**; the question says so. A workspace from `[workspaces]` in
  `config.toml` cannot go while it is there: closing it closes its tabs only, and it keeps its
  logins. Renaming one is done in `config.toml` too. The last workspace cannot be closed.
  If the workspace changes between the question and your `y` (say `config.toml` was reloaded),
  nothing is closed. If you renamed its container in Firefox's Settings, its tabs and site data
  are kept, and the status bar says so.
- A workspace name cannot be only digits: in `:wsmove 2` and `:workspace 2` a number means the
  workspace's place in `ctrl+i` order. `config.toml` can still name one `2` in `[workspaces]`;
  then `2` means that workspace, by name, and the workspace at place 2 is reached by its name.
- **Moving a tab reopens it** in the other workspace's container, as Firefox's "Reopen in
  Container" does: its address, name and mute come along, but not its back/forward history,
  what you typed into forms, its scroll position, or a form submission (the page is loaded
  again, signed in as that workspace). A tab in a split leaves the split first. You stay in the
  workspace you were in.
- **A workspace's container deleted outside Vimma** (Firefox's Settings → Containers, or an
  extension) is replaced at once by a new, empty one: the workspace stays, its new tabs open in
  the new container, and the status bar says so. Its cookies and logins went with the old
  container, so its sites need a new sign-in. Tabs an extension left open in the deleted
  container stay in the workspace, marked `foreign`.
- **Containers turned off** (`privacy.userContext.enabled` = `false` in `about:config`) at
  startup: the status bar shows a lasting error, and Vimma runs without workspaces (tabs open as
  in Firefox, without containers) until you set it back to `true` and restart. Vimma does not
  turn it back on for you.

### Workspace picker

`ctrl+b w` lists the window's workspaces over the page, in `ctrl+i` order: each with its number,
its name and how many tabs it has here; the one you are in says `current` and is selected.

| Key               | What it does                                                 |
| ----------------- | ------------------------------------------------------------ |
| `j` / `k`, arrows | Move down / up.                                              |
| `/`               | Search: type to filter by name; `Esc` goes back to `j`/`k`.  |
| `Enter`           | Switch to the selected workspace.                            |
| `m`               | Move the current tab to the selected workspace (asks first). |
| `Esc` / `q`       | Close the picker.                                            |

`m` asks `Move this tab to "work"? … y/N` at the foot of the window, because a moved tab is
reopened and loses its back/forward history and form data (see
[Managing workspaces](#managing-workspaces)): `y` moves it, any other key keeps it. If the tab or
the workspace changes before your `y` (another tab selected, the workspace renamed or closed),
nothing is moved. `m` on the workspace the tab is already in says so and asks nothing. To create,
rename or close a workspace, use `ctrl+b shift+n`, `shift+w` and `shift+d`.

### Side panel

`<leader>n`, `ctrl+b b` or `:sidebar` opens a panel on the left of the window. It is closed when
Vimma starts and stays out of the way until you ask for it. Its head shows the workspace you are
in (`● 2:work`, in the workspace's colour) and the ones `ctrl+u` and `ctrl+i` go to; below are
the workspace's tabs, numbered, each with its name (or title) and its site. The tab you are on is
highlighted and its number coloured; a tab playing sound shows `♪`, one from another container
`foreign`.

| Key                            | What it does                                               |
| ------------------------------ | ---------------------------------------------------------- |
| `j` / `k`                      | Move the highlight down / up.                              |
| `Enter`                        | Go to the highlighted tab and close the panel.             |
| `1` … `9`                      | Go to that row's tab and close the panel.                  |
| `ctrl+i` / `ctrl+u`            | Switch workspace; the panel stays open and lists that one. |
| `Esc`, `<leader>n`, `ctrl+b b` | Close the panel; the page has the keys again.              |

While it is open, every other plain key is the panel's and never reaches the page; `ctrl+b`
keys and `:` commands still work, and a tab you open meanwhile shows up in the list. The panel
follows your Omarchy theme as the status bar does. Change its keys under `[modal.panel]` in
`config.toml`; `[keys] toggle_sidebar` changes the keys that open it, and a `<leader>` binding
there closes it too.

## Goto picker and tab rename

`ctrl+b g` (or `b` in normal mode, or `:ls`) opens a list of the window's tabs over the page: the tab number (the
one `ctrl+b 1..9` uses), the title or your rename, and the site. The current tab is selected.
Like the bindings overlay it takes every key while open, so nothing reaches the page.

- `j` / `k`, `Down` / `Up`, `ctrl+n` / `ctrl+p` move; `Enter` goes to the selected tab.
- `/` starts a search: type a few letters of the title, URL or rename. Matches are highlighted,
  best first: the start of a title beats a word inside it, which beats letters spread out.
  Letters with diacritics count as their own letters first (`kä` puts "Käyttäjät" on top), and
  still match without them, lower down (`ka` finds it after "Kalenteri"). `Backspace`,
  `ctrl+w` and `ctrl+u` delete a letter, a word, everything.
- `Esc` in a search goes back to moving through the filtered list; `Esc` or `q` then closes the
  picker and focus returns to the page.

The picker lists every tab of every workspace in the current window, workspace by workspace;
the number is the tab's place in its workspace. `Enter` on a tab of another workspace switches
to that workspace.

`ctrl+b shift+t` opens a one-line prompt at the foot of the window with the tab's current name.
Type a name and press `Enter`; `Esc` cancels. An empty name removes the rename, so the page title
shows again. `:tabrename name` does the same in one step (`:tabrename` alone opens the prompt).
The name replaces the title in the status bar and the picker and is saved with the session, so
it survives a restart (with Firefox's "Open previous windows and tabs") and undoing a closed tab.
Invisible and direction-changing characters are removed, runs of spaces become one, and a name
is cut at 100 characters.

## The command line

`:` in normal mode opens a Vim-style command line just above the status bar. Type a command
and press `Enter`; `Esc` closes it and puts focus back on the page. While it is open nothing you
type reaches the page, and `ctrl+b` sequences still work.

- **Completion.** A list of matching commands and actions, with what each does, follows what you
  type. `Tab` puts the next match on the line, `shift+Tab` the previous; both wrap around.
  Matching also takes letters in order (`scd` finds `scroll_down`).
- **History.** `Up` / `Down` walk the lines you ran before, newest first. With text typed, `Up`
  recalls only lines that start with it, as in Vim. History lasts until Vimma quits; a private
  window keeps its own, forgotten when it closes.
- `:open` and `:tabnew` refuse `javascript:` URLs, with a message. The line does not open over
  a fullscreen page.
- **Errors** show under the line, which stays open so you can fix it: `:tabnwe` says
  `not a command: "tabnwe"; did you mean :tabnew?`.
- A command name can be shortened while it stays unique (`:tabr`, `:wsn`), and leading colons
  are fine (`::q`).
- An argument is the rest of the line, as typed. Quotes are removed only when one pair wraps all
  of it: `:tabrename "my  tab"`.

| Command                           | What it does                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `:open text`                      | Opens `text` in this tab as the URL bar would: `example.com` becomes a web address, other words a web search.  |
| `:tabnew`, `:tabnew text`         | Opens a new tab; with text, opens it there (as `:open`).                                                       |
| `:q`, `:quit`                     | Closes the pane, as `ctrl+b x`; with one pane the tab, as `x`: a pinned tab is kept and the next one selected. |
| `:map`, `:help`, `:h`             | Shows every binding (the `ctrl+b ?` overlay).                                                                  |
| `:scroll_down`, `:tab.next`…      | Any action by its name in [bindings.md](bindings.md), or by its dotted id. Actions take no argument.           |
| `:tabrename [name]`               | Renames the tab; without a name, opens the rename prompt.                                                      |
| `:ls`, `:b`                       | Opens the goto picker.                                                                                         |
| `:vsplit`/`:vs`, `:split`/`:sp`   | Splits the pane right / down, as `ctrl+b v` / `ctrl+b -`.                                                      |
| `:wsnext`, `:wsprev`              | Next / previous workspace, as `ctrl+i` / `ctrl+u`.                                                             |
| `:workspace name`, `:workspace 2` | Switches to the workspace with that name, or that number in `ctrl+i` order.                                    |
| `:workspace`                      | Opens the workspace picker.                                                                                    |
| `:sidebar`                        | Opens or closes the side panel, as `<leader>n`.                                                                |
| `:source`                         | Reads `config.toml` now instead of within 2 seconds (see [config.toml](#configtoml)).                          |
| `:source path`                    | Loads that TOML file instead of `config.toml` until `config.toml` changes or a plain `:source`.                |
| `:config`                         | Opens `config.toml` in a new tab (read-only view); creates it from a commented template when it is missing.    |
| `:about`, `:vimma`                | Opens [about:vimma](#aboutvimma) in a new tab.                                                                 |
| `:bug`                            | Opens about:vimma and copies its redacted report to the clipboard, for a bug report.                           |

A command that is not built yet says so for a moment, as its keys do.

## about:vimma

`about:vimma` (or `:about`) shows what Vimma is doing, read when the page opens: press `r` or
Refresh for the current state. It is an ordinary page, so `j` / `k` scroll it.

- **Version:** Vimma's version, the Firefox release it is built on, the build ID and the update
  channel.
- **Upstream patches:** how many patches to Firefox's own files the build carries, each with its
  hunk count (the fewer, the easier a Firefox update).
- **Modes and keys:** each window's mode, and the last 20 keys Vimma saw with what each did
  (`j → scroll.down`, `pass` when the key went to the page). Letters typed into a text field or
  the command line show as `·`, so nothing you type is kept.
- **Config:** the `config.toml` path, whether it was read, its `schema`, every error with its
  line, and the full binding table with the keys your file changes marked `*`.
- **Theme:** the colour source, the Omarchy theme directory, the theme's name and its
  `colors.toml` time, and why the last theme file was rejected, if one was.
- **Workspaces:** how many there are, and this window's with their tab and pane counts.
- **Control socket:** on or off, and its port. The token is never shown.

**Copy redacted report** (or `:bug`) copies all of that as text, without the binding table's
defaults, with every URL replaced by `<url>` and your home directory by `~`. It never contains
page titles or addresses.

## Settings (about:config)

Vimma's own preferences today:

| Preference                 | Default                                | What it does                                                                                                                                               |
| -------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vimma.ui.tabstrip.hidden` | `true`                                 | Hides Firefox's tab strip (horizontal, and the vertical tab list). Set `false` to show it again; it applies at once, no restart.                           |
| `vimma.debug.keys`         | unset                                  | Create it as a boolean set to `true` to log every key Vimma sees (`{ key, mods, mode }`) to the Browser Console (`ctrl+shift+j`; enable its Debug filter). |
| `vimma.startpage.newtab`   | `true`                                 | New tabs open Vimma's start page (see [The start page](#the-start-page)). Set `false` for Firefox's new tab page; it applies at once, no restart.          |
| `vimma.control.enabled`    | `false`                                | Turns on the control socket for `vimma-ctl` and scripts (see [Scripting with vimma-ctl](#scripting-with-vimma-ctl)). Applies at once, no restart.          |
| `vimma.theme.source`       | `omarchy`                              | `omarchy` follows your Omarchy theme (see [Colours](#colours-your-omarchy-theme)); `builtin` forces the built-in Tokyo Night. Applies at once.             |
| `vimma.theme.omarchyPath`  | `~/.local/state/omarchy/current/theme` | The Omarchy theme directory to read `colors.toml` and `light.mode` from. Applies at once.                                                                  |
| `vimma.theme.omarchyHook`  | `true`                                 | Installs the Omarchy theme-set hook for instant theme changes (see [Colours](#colours-your-omarchy-theme)). `false` removes Vimma's unedited hook at once. |

| `vimma.config.path` | unset | A different config file than `$XDG_CONFIG_HOME/vimma/config.toml` (tests use it). Applies at once. |
| `vimma.config.pollMs` | `2000` | How often Vimma checks `config.toml` for a change, in milliseconds. Applies at once. |

## config.toml

Vimma reads `~/.config/vimma/config.toml` (`$XDG_CONFIG_HOME/vimma/config.toml` when that is
set), and nothing else in that folder. No file means the defaults. Vimma writes it only when you
type `:config` and it does not exist yet: it then creates it (and its folder) with every default
commented out, and opens it in a tab. An existing file is never written. A small example:

```toml
schema = 2

[keys]
new_tab = ["prefix+t"]        # replaces ctrl+b c

[modal.normal]
"<leader>ff" = "goto.picker"

[panes]
max = 2

[theme]
source = "file"               # Tokyo Night instead of your Omarchy theme
[theme.colors]
accent = "#ff9e64"
```

- **Reload:** save the file and Vimma picks it up within 2 seconds, in every window, without a
  restart. `:source` reads it at once.
- **Another file:** `:source work.toml` loads that file instead, the same way: whole, over the
  defaults, not merged into `config.toml` (a file is checked as a whole, so two half-configs
  could not be). A relative path is next to `config.toml`; `~`, `$HOME` and `$XDG_CONFIG_HOME`
  expand at its start. It stays in force until `config.toml` changes or you type a plain
  `:source`. A missing or broken file changes nothing and shows its error in the status bar
  under its own name (`work.toml: no such file`, `work.toml:3: …`).
- **Errors:** a file with a mistake is not applied at all: the config you had keeps working,
  and the status bar shows the first mistake in red on the right, with its line, e.g.
  `config.toml:3: keys.new_tabb: unknown action "new_tabb" (did you mean "new_tab"?)` (or
  `3 errors: …`). The Browser Console (`ctrl+shift+j`) lists them all. Fix the file and the
  message goes away at the next check.
- **What applies live:** `[keys]`, `[modal]` (leader, `timeout_ms`, per-mode keys, `hint_chars`)
  and `[unbind]`; `[panes] max` (most panes in a window, 1 to 16, default 4; it limits new
  splits); `[sites."<host>"] insert` (`auto`, `never` or `always`: whether a text field on that
  site and its subdomains takes insert mode); `[theme]` `source` (`omarchy` or `file`, the
  built-in Tokyo Night), `font` and `[theme.colors]` (single colours over either source);
  `[workspaces]` (a new one gets its container at once; one removed from the file stays, as a
  workspace you can close yourself).
- **Schema:** `schema = 2` at the top enables `[panes]`, `[sites]` and `hint_chars`; every key,
  its type and default are in [m5-core-config-and-theme](specs/m5-core-config-and-theme.md#schema-v1)
  and [m3-m4-core-prep](specs/m3-m4-core-prep.md#config-schema-2), and
  `packages/vimma-core/defaults.toml` lists them with their defaults.

## Scripting with vimma-ctl

`vimma-ctl` drives a running Vimma from a shell, a window-manager binding or a test: it sends
keys, reads the state and opens URLs. It talks to the browser over a local control socket, which
is **off by default**. Spec: [m0-control-server](specs/m0-control-server.md), protocol:
[m0-control-protocol-and-vimma-ctl](specs/m0-control-protocol-and-vimma-ctl.md).

1. Turn the socket on: in `about:config`, set `vimma.control.enabled` to `true`. It starts at
   once and writes `vimma-control.json` into your profile directory. Setting it back to `false`
   stops it and deletes the file.
2. Build the client (Rust, no dependencies): `cargo build --release` in `tools/vimma-ctl/`; the
   binary is `tools/vimma-ctl/target/release/vimma-ctl`. Packages will ship it later.
3. Use it:

   ```sh
   vimma-ctl state                    # mode, pending keys, workspace, tabs
   vimma-ctl state --json             # the same, as JSON
   vimma-ctl send-keys "ctrl+b ?"     # typed as if on the keyboard: opens the help overlay
   vimma-ctl send-keys esc
   vimma-ctl open https://example.com # a new tab; only http, https, file and about URLs
   vimma-ctl reload-theme             # read the Omarchy theme now (the hook's fallback)
   ```

   It finds your default profile itself; pass `--profile DIR` (or set `VIMMA_PROFILE`) for
   another one. In Hyprland: `bind = SUPER, slash, exec, vimma-ctl send-keys "ctrl+b ?"`.

`send-keys` presses the keys in the most recently focused Vimma window, exactly as typing them
would: Vimma's bindings, Firefox's shortcuts (`ctrl+t`, `ctrl+q`) and the page all see them. Keys
meant for the page reach it only while that window has focus, as with a real keyboard.

**Security.** Turning the socket on hands **full control of the browser** to whoever has the
token: they can type into any page (including your logged-in sites), open `about:config` and
change any setting, and quit Vimma. `open` loads with the system principal, like a URL given on
the command line, so it can open local files (`file:`) and privileged pages such as
`about:config`; only `javascript:` and `data:` are refused. Leave the pref off unless you use it.

What keeps others out:

- The socket listens on `127.0.0.1` only, on a random port. Web pages cannot speak to it (they
  cannot read the token, and an HTTP request is rejected).
- A client must send the token from `vimma-control.json`: 256 random bits, new at every start,
  compared in constant time. The file is readable by you alone (mode 0600), and `vimma-ctl`
  refuses a file anyone else can read. Other users on the machine cannot get it; anything
  running as you can, just as it can already read your profile's cookies and history.
- The browser proves it knows the token first: `vimma-ctl` sends only a random nonce, and sends
  the token only after the browser has answered with an HMAC of that nonce made with the token.
  If Vimma crashed and another program took its old port, that program gets the nonce and
  nothing else: no token and no command (`vimma-ctl` exits 4). It can still make `vimma-ctl`
  wait until its timeout.
- A stale file (Vimma crashed or was killed with `kill -9` or `SIGTERM`) is removed at Vimma's
  next start, whether or not the socket is on. Until then, on Linux, `vimma-ctl` sees that the
  process named in it has exited and says Vimma is not running; if that process number has been
  reused, the handshake above still protects you.

Limits against a local denial of service: at most 8 authenticated connections (the next is told
"busy"); at most 2 connections still authenticating, a new one pushing out the oldest, so idle
connections cannot lock `vimma-ctl` out; 5 s to authenticate; an idle connection closes after
60 s; lines over 1 MiB and clients that stop reading are disconnected. These are limits, not a
defence against an active attack: a program of any local user that connects fast enough keeps
pushing `vimma-ctl` out before it authenticates, and any program running as you can keep the 8
slots busy. Turn the pref off to stop either.

With the help overlay open, every key goes to the overlay, `ctrl+q` included, as when typing;
send `esc` first (`vimma-ctl send-keys "esc ctrl+q"`).

## Privacy defaults

Vimma changes Firefox's defaults, without locking them: each one can be changed back in
`about:config` (search for the name, then toggle or edit it). Spec:
[m0-mozilla-services](specs/m0-mozilla-services.md).

| Off in Vimma                             | Turn it back on                                                                                                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normandy studies and rollouts            | `app.normandy.enabled` = `true`, `app.normandy.api_url` = `https://normandy.cdn.mozilla.net/api/v1`                                                                                                   |
| Nimbus studies and rollouts              | `app.shield.optoutstudies.enabled`, `nimbus.rollouts.enabled` = `true` (studies also need `datareporting.healthreport.uploadEnabled`)                                                                 |
| Sponsored new-tab stories and shortcuts  | `browser.newtabpage.activity-stream.showSponsored`, `…system.showSponsored`, `…showSponsoredTopSites`, `browser.topsites.contile.enabled`; stories: `…feeds.section.topstories` (or New Tab settings) |
| Sponsored address-bar suggestions        | Settings: search for "sponsors" and tick "Suggestions from sponsors"                                                                                                                                  |
| Feature and add-on recommendations       | `browser.newtabpage.activity-stream.asrouter.providers.cfr`: change `"enabled":false` to `true` in its JSON value; then `…asrouter.userprefs.cfr.addons`, `…cfr.features` = `true`                    |
| Mozilla promos (VPN, Relay, Pin, mobile) | `browser.vpn_promo.enabled`, `browser.promo.relay.enabled`, `browser.promo.pin.enabled`, `browser.preferences.moreFromMozilla`                                                                        |
| Crash reporter                           | Not built in. A crash leaves a local core dump (`coredumpctl list vimma`). Opt-in reporting to Vimma's own server is planned for M6.                                                                  |
| Telemetry upload                         | Not built in (no official telemetry). The data-collection switches in Settings are off to match.                                                                                                      |

Kept as in Firefox: Remote Settings (CRLite certificate revocation, intermediate certificates),
the add-on blocklist, Firefox Sync, add-ons from addons.mozilla.org and Google Safe Browsing
(see below). Firefox's app updater and system add-on updates still contact Mozilla's update
server; see [limits.md](limits.md).

Sites see Firefox 157's user agent, with no Vimma token, and add-ons see Firefox's version
(`runtime.getBrowserInfo()`), so Vimma is treated like Firefox. `vimma --version` and the About
dialog show Vimma's own version (`0.1.0`).

### Safe Browsing

Google Safe Browsing is on by default, as in Firefox: Vimma downloads Google's lists of phishing,
malware and unwanted-software sites and warns before you open one. Your browsing stays local:
only when an address matches the local list does Vimma send Google a short hash prefix of it to
confirm. Spec: [m0-safebrowsing-key](specs/m0-safebrowsing-key.md).

Firefox's extra download checks (Google's lists of bad and known-good downloads, and its file
reputation service) are open only to Mozilla's own key, so Vimma does not use them: the "Block
dangerous downloads" box adds nothing beyond the site lists ([limits.md](limits.md)).

To turn Safe Browsing off: Settings → Privacy & Security → untick "Block dangerous
and deceptive content". In `about:config` that is `browser.safebrowsing.phishing.enabled` and
`browser.safebrowsing.malware.enabled` = `false`.

A Vimma you build yourself has Safe Browsing only if you build it with a Google API key
([runbook](runbook.md)). Without one it fetches no lists, and Settings shows the protection off.

Whether or not you use Safe Browsing, we recommend [uBlock Origin](https://ublockorigin.com/)
from addons.mozilla.org as a second line: in its dashboard → Filter lists, keep "uBlock filters
– Badware risks" on and tick the lists under "Malware protection, security" (Online Malicious URL
Blocklist, Phishing URL Blocklist). They block known malware and phishing sites without asking
any server about the pages you visit.

## Firefox behaviour Vimma changes

For workspaces ([m3-workspaces](specs/m3-workspaces.md)); each is a default you can change in
`about:config`:

- **Closing the last tab keeps the window** and opens a new tab in the workspace, so a window
  never closes with other workspaces' tabs in it (`browser.tabs.closeWindowWithLastTab` =
  `false`).
- **No preloaded new-tab page** (`browser.newtab.preload` = `false`): Firefox only uses it for
  tabs without a container, and every Vimma tab is in one.
- **Restart restores your session**: tabs, workspaces, pane layouts and scroll positions come
  back (`browser.startup.page` = `3`; Firefox's default `1` opens the home page).
- **Firefox Sync leaves two settings alone**: `browser.startup.page` and
  `privacy.userContext.enabled` (turning containers off deletes every workspace's data).

## FAQ and troubleshooting

**Vimma says the profile was used by a newer version and refuses to start.** Profiles remember
the version that last used them. Builds from before the app-version change report `0.1.0`
instead of `157.0.1`, so they treat any newer profile as a downgrade. Give each build its own
`--profile`, or start with `--allow-downgrade` if you accept the risk.

**Does Safe Browsing protect me?** Yes, in builds made with a Google API key, which are on by
default (see [Safe Browsing](#safe-browsing)). A build without a key fetches no phishing or
malware lists; Settings then shows "Block dangerous and deceptive content" unticked, and ticking
it does not help. Mozilla's tracking-protection lists update either way.

**Does Vimma update itself?** No. There are no releases yet, so build a newer `main` yourself.
Firefox's updater is still built in and asks Mozilla's update server (`aus5.mozilla.org`), which
has no Vimma builds and offers nothing. Removing it is in review ([limits.md](limits.md)).

**I want the tab strip back.** Set `vimma.ui.tabstrip.hidden` to `false` in `about:config`.

**"List all tabs" is missing.** Firefox shows it only when the tab strip is visible. Show the
strip, or move the "List all tabs" button to the toolbar in customize mode, or use Vimma's
`ctrl+b g` picker.

**I don't see window controls.** On tiling window managers such as Hyprland there are none, as in
Firefox. On GNOME or KDE with client-side decorations they move to the navigation bar.

**Did `ctrl+b` stop opening bookmarks?** Yes, it is Vimma's prefix. Use `ctrl+shift+o` for the
bookmarks library.

**A binding says "not implemented yet".** Every default binding runs now; the message is for
a binding whose command is not built yet, which the overlay also dims.

**Where are crash reports?** Nothing is sent anywhere. Use `coredumpctl list vimma`, then
`coredumpctl info` on the entry.
