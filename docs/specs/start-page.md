# Spec: start-page

Status: implemented · Area: UI (`src/browser/base/content/vimma/start/`,
`src/browser/themes/shared/vimma/start.css`)

## User story

As a Vimma user, a new window and a new tab show a Vimma start page: the mint brushstroke logo
centred, and one line under it with the keys to start from (`ctrl+b ?` keys · `:` commands ·
`f` hints). The URL bar is empty and focused, so I can type an address at once; and from the page
itself `:` and `ctrl+b ?` work as on any page. It renders at once and has nothing to scroll.

## Scope

- **Asset.** The user's logo (`Mint Brushstroke V Browser Logo.png`, 1254×1254), resized to 512 px
  and stripped of metadata with ImageMagick (`magick … -strip -resize 512x512`), 201 KB, at
  `vimma/start/vimma-logo.png`. `docs/assets/vimma-logo.png` (the README's) stays.
- **The page:** `chrome://browser/content/vimma/start/start.html`, registered in our `jar.mn`.
  Mechanism chosen after grepping the engine: Firefox's own blank new tab and blank home page are
  the chrome page `chrome://browser/content/blanktab.html` (`AboutNewTabRedirector`,
  `HomePage.get`, `home-startup.mjs`), so a chrome page in a tab is a supported path. An
  `about:vimma-start` would need an `AboutRedirector` patch or a runtime `nsIAboutModule`
  registration, and a `resource:` page cannot use our chrome theme module. It loads in the parent
  process, with a CSP that allows only `chrome:` scripts, styles and images. Its one script
  (`start.mjs`) sets the theme tokens from `core/theme.mjs` as the status bar does;
  `start.css` (`chrome://browser/skin/vimma/start.css`) falls back to the same built-in values,
  so the first paint has them. Logo `40vmin`, `object-fit: contain`; hint in `--vimma-muted` with
  the keys in `--vimma-fg`; background `--vimma-bg`. No animation.
- **Home page:** default pref `browser.startup.homepage` in `firefox-branding.js`. New windows
  open it while `browser.startup.page` is 1 (Firefox's default) or 3 (M3's session restore,
  `BrowserContentHandler.getNewWindowArgs`); at startup it shows with 1, or when nothing is
  restored. Settings → Home changes it, and "Restore Defaults" brings ours back.
- **New tab:** `AboutNewTab.newTabURL` is in memory only, so `start/StartPage.sys.mjs` sets it
  once per app (from `vimma.js`) while the pref `vimma.startpage.newtab` (default `true`) is on,
  and resets it live when the pref goes `false`. It never replaces an extension's override
  (`newTabURLOverridden` with another URL); when that extension goes, `newtab-url-changed`
  brings ours back. Private windows get it too (Firefox uses an overridden new-tab URL there).
- **URL bar:** the page is `BROWSER_NEW_TAB_URL`, so `isInitialPage` and `isBlankPageURL` treat
  it as Firefox's new tab: empty URL bar, focused on open. `StartPage.init` also adds it to each
  window's `gInitialPages` for a home page opened with the new-tab override off.
- **Vimma keys:** the content actor's `matches` include the page's URL, so it is in normal mode
  (without the actor the host keeps a page in insert, and `:` would not open the command line).
  `f` finds nothing to label; `j`/`k` have nothing to scroll.
- **No upstream patch.**

## Tests (written first)

`tests/browser/browser_vimma_start_page.js`:

- A new tab (`BrowserCommands.openTab`) loads the start page; the logo decodes
  (`naturalWidth > 0`, alt `Vimma`); the hint is there; the URL bar is focused and empty; typing
  a URL and Enter navigates.
- The default home page is the start page, and with `browser.startup.page` = 1 a new window
  opens it with an empty URL bar.
- On the page, normal mode: `:` opens the command line, `ctrl+b ?` the help overlay.

Red before the implementation: `"about:newtab" == "chrome://browser/content/vimma/start/start.html"`
and a timeout waiting for the new tab. Mutation check: without the actor match, the keys task fails
(`"insert" == "normal"`, `: opens the command line`); reverted.

## Settled

- `browser.startup.page` stays Firefox's 1 until M3 sets 3.
- Settings → Home's "New tabs" menu (`browser.newtabpage.enabled`) does not change our override;
  `vimma.startpage.newtab` = `false` gives Firefox's new tab back (guide).
