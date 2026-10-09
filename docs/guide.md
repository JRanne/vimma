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

Start Vimma with a profile of its own, so it never touches your Firefox profile and two builds
never share one:

```sh
mkdir -p ~/.cache/vimma-dev-profile
engine/obj-x86_64-pc-linux-gnu/dist/bin/vimma --no-remote --profile ~/.cache/vimma-dev-profile
```

Without `--profile`, Vimma keeps its profiles apart from Firefox's. `npx surfer run` launches
with a scratch profile in the build directory.

Where Vimma keeps its files on Linux:

| Path                          | What                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `~/.config/vimma/config.toml` | Your config (planned, M5). Vimma reads only this file there and never scans the folder.                    |
| `~/.config/vimma/vimma/`      | Profiles and `profiles.ini`. If `~/.vimma/vimma/` already exists, Firefox's legacy rule uses that instead. |

On first launch you see Firefox's interface without the tab strip: the window starts with the
navigation bar and URL bar at the top, and Vimma's status bar at the bottom. Press `ctrl+b`, then
`?`, to see the bindings.

## The two layers

Vimma has two key layers and one dispatcher, which sees every key before Firefox does, including
in the URL bar, `about:` pages and the PDF viewer.

- **The prefix layer (Herdr).** `ctrl+b` is the prefix. The next key is a command: `ctrl+b ?`
  shows the bindings, `ctrl+b c` opens a tab, and later `ctrl+b v` splits the pane, and so on.
  The prefix works in every mode and waits for the next key with no timeout. `Esc` cancels it.
- **The modal layer (Neovim).** Bare keys act on the page depending on the mode: `j`/`k` scroll
  in `normal` mode, while in `insert` mode (focus in a text field) keys go to the page. Planned
  modes: `visual`/copy (caret and selection), `command` (`:` line), `hint` (link hints) and
  `panel` (the side panel); `help` is the bindings overlay.

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
belong to that field; only `ctrl+b` sequences are Vimma's there.

**`Esc` in a text field is Vimma's.** It leaves insert, so the page does not see that `Esc`: a
site's own `Esc` (closing an autocomplete list or a dialog) does not fire from the field. Press
`Esc` again: in normal mode `Esc` has no binding, so it reaches the page (the field no longer
has focus, so the page's document gets it, not the field).

**A key that starts a sequence passes when nothing in that sequence works yet.** `ctrl+w`
starts the planned `ctrl+w h/j/k/l` pane keys (M4), but until they work `ctrl+w` still closes
the tab. `g` starts `gg`, which works, so `g` is Vimma's: the page does not see it, and `Esc`
cancels it.

**A binding that does not work yet is never silent once it is Vimma's.** A `ctrl+b` sequence, or
a count followed by a key (`3H`), whose command is not built yet shows "… not implemented yet"
in the bottom-right corner for 1.5 s (not while a video or page is fullscreen). A single key
that is not built yet (`f`, `/`, `ctrl+i`, …) is not Vimma's yet: it reaches the page or
Firefox, with no message. The `ctrl+b ?` overlay dims the bindings that do not work yet.

## Status bar and which-key

The status bar is the window's last line, always there (it hides only while a page is in
fullscreen, such as a video; browser fullscreen with `F11` keeps it). From the left:

- the **mode** badge in the mode's colour: `NORMAL` on a page, `INSERT` while a text field has
  focus (or after `i`), `HELP` while the `ctrl+b ?` overlay is open, and later `VISUAL`, …;
- the **pending keys**, e.g. `prefix` after `ctrl+b`;
- `tab 2/5`: the selected tab and how many there are;
- the page **title** (your rename, once tab rename lands);
- on the right, `loading` while the page loads, then its **URL** without `https://`.

On a narrow window the least important parts give way first: the URL is shortened in the middle,
then dropped, then the title is shortened, and so on. The mode badge always stays. Screen
readers announce the mode when it changes, including when focus moves into or out of a text
field, but not every title change.

After `ctrl+b` (or any key that starts a longer sequence) a **which-key strip** opens above the
bar, listing every key you can press next with what it does, grouped like the `ctrl+b ?`
overlay. Keys whose action is not built yet are greyed. The strip closes when the sequence
completes, or on `Esc`.

Colours are Tokyo Night until theming arrives (M5), which will follow your Omarchy theme.

## Keys

[bindings.md](bindings.md) lists the full default keymap. It is generated from the same table
the dispatcher and the `ctrl+b ?` overlay use, so the three cannot disagree.

**What works today:**

| Keys                        | What it does                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `j` / `k`, `h` / `l`        | Normal mode: scroll down / up, left / right by a step. A count repeats: `3j`.                                                                                 |
| `d` / `u`                   | Normal mode: scroll half a page down / up (`ctrl+u` is reserved for workspaces).                                                                              |
| `gg` / `G`                  | Normal mode: go to the top / bottom of the page.                                                                                                              |
| `i`                         | Normal mode: focus the first text field and enter insert mode.                                                                                                |
| `Esc`                       | Insert mode: leave the text field, back to normal mode. In normal mode the page gets `Esc`.                                                                   |
| `ctrl+b ?`                  | Opens the bindings overlay over any page, including `about:preferences` and the PDF viewer. Press it again to close.                                          |
| `/` (in the overlay)        | Filters the list as you type.                                                                                                                                 |
| `Esc` or `q` (overlay)      | Closes the overlay. Focus returns to where it was.                                                                                                            |
| `ctrl+b c`, `t`             | Opens a new tab (Firefox's new-tab page, URL bar focused), as `ctrl+t` does. `t` in normal mode.                                                              |
| `ctrl+b n` / `ctrl+b p`     | Next / previous tab, wrapping around at the ends. Hidden tabs are skipped. `gt` / `gT` in normal mode; `3gt` goes to tab 3.                                   |
| `ctrl+b 1..9`               | Tab 1 to 9, counting visible tabs (pinned tabs first). With fewer tabs than N, nothing happens.                                                               |
| `ctrl+b shift+x`, `x`       | Closes the tab, as `ctrl+w` does: on a pinned tab it selects the first unpinned tab instead; the last tab closes the window. `x` in normal mode.              |
| `ctrl+b` then anything else | Never leaks to the page. A binding that does not run yet shows "… not implemented yet" for 1.5 s; an unbound key does nothing. No more bookmarks sidebar.     |
| Firefox's own keys          | Unchanged: `ctrl+t`, `ctrl+w`, `ctrl+tab`, `ctrl+shift+tab`, `ctrl+pagedown`, `alt+1..9` (tab N on Linux), `ctrl+l`, `ctrl+f`, `ctrl+u`, `ctrl+i`, and so on. |

While the overlay is open it takes every key, so `ctrl+w` cannot close the tab behind it. Rows
for bindings that do not run yet are dimmed, under a legend that says so. In normal mode bare
digits start a count (`3j`), so a page's own digit shortcuts need `i` first.

**Planned:**

- **M1, the rest of the modal page layer:** back and forward (`H`/`L`), reload (`r`), link
  hints (`f`/`F`), find (`/ ? n N`), the `:` command line and copy mode (`v`, `ctrl+b [`). Until
  then these keys reach the page as before.
- **M2, the rest of tabs:** `ctrl+b shift+t` rename (kept across restarts; an empty name
  restores the page title), the `ctrl+b g` picker (`j`/`k` to move, `/` to search titles, URLs,
  workspaces and renames, `Enter` to go, `Esc` to back out).
- **M3, workspaces and the side panel:** `ctrl+i`/`ctrl+u` next/previous workspace, the
  `ctrl+b w` picker, new/rename/close workspace, and `ctrl+b b` or `<leader>n` for the side panel.
  Until then `ctrl+i` and `ctrl+u` keep Firefox's meaning (page info, view source).
- **M4, split panes:** `ctrl+b v`/`-`, `ctrl+b h j k l`, swap, zoom, resize, close pane.
- **M5, config and theme:** rebinding in `~/.config/vimma/config.toml`, `:source`, Omarchy
  colours.

## Settings (about:config)

Vimma's own preferences today:

| Preference                 | Default | What it does                                                                                                                                               |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vimma.ui.tabstrip.hidden` | `true`  | Hides Firefox's tab strip (horizontal, and the vertical tab list). Set `false` to show it again; it applies at once, no restart.                           |
| `vimma.debug.keys`         | unset   | Create it as a boolean set to `true` to log every key Vimma sees (`{ key, mods, mode }`) to the Browser Console (`ctrl+shift+j`; enable its Debug filter). |

**Planned:** `~/.config/vimma/config.toml` (M5) for keys, workspaces and theme. Its validator
already exists, but the browser does not read the file yet. The control socket and `vimma-ctl`
(off by default) are also planned.

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

**Planned for M3** (workspaces, [m3-workspaces](specs/m3-workspaces.md)); each is a default you
can change in `about:config`:

- **Restart restores your session**: tabs, workspaces and scroll positions come back
  (`browser.startup.page` = `3`; Firefox's default `1` opens the home page).
- **Closing the last tab keeps the window** and opens a new tab, so a window never closes with
  other workspaces' tabs in it (`browser.tabs.closeWindowWithLastTab` = `false`).
- **No preloaded new-tab page** (`browser.newtab.preload` = `false`): Firefox only uses it for
  tabs without a container, and every Vimma tab is in one.
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
strip, or move the "List all tabs" button to the toolbar in customize mode. Vimma's `ctrl+b g`
picker replaces it in M2.

**I don't see window controls.** On tiling window managers such as Hyprland there are none, as in
Firefox. On GNOME or KDE with client-side decorations they move to the navigation bar.

**Did `ctrl+b` stop opening bookmarks?** Yes, it is Vimma's prefix. Use `ctrl+shift+o` for the
bookmarks library.

**A binding says "not implemented yet".** Only the keys under [Keys](#keys) run today; the
overlay dims the rest. See [Keys](#keys) for when each binding arrives.

**Where are crash reports?** Nothing is sent anywhere. Use `coredumpctl list vimma`, then
`coredumpctl info` on the entry.
