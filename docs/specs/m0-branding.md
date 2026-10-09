# Spec: m0-branding

Status: in progress · Milestone: M0 · Area: branding (`configs/branding/vimma/`, `src/browser/branding/vimma/`)
Prerequisite: Surfer project set up and `npx surfer build` succeeded once (plan §10 step 3).

## User story

As the vimma developer, the browser I build calls itself Vimma: `vimma --version`, the window
title, `about:` pages and the app's name and vendor say Vimma, not Mozilla or Nightly, and every
local or CI build picks this brand without anyone remembering a flag.

## Scope

- **Brand inputs** in `configs/branding/vimma/` (the directory Surfer's branding patch reads):
  `logo.png`, `logo-mac.png`, `firefox.ico`, `firefox64.ico`, `logo{16,22,24,32,48,64,128,256,512}.png`,
  and `content/` overrides for every image the Linux build packages into `chrome://branding/`
  (`about.png`, `about-logo.svg`, `about-logo-private*.png`, `about-wordmark.svg`,
  `firefox-wordmark.svg`, `document_pdf.svg`) plus `document.ico`.
- **Placeholder logo**: a plain "V" monogram on a dark rounded square, drawn as SVG paths
  (no font, no Mozilla artwork). Source `configs/branding/vimma/logo.svg` and
  `wordmark.svg`; `tools/branding/render.sh` renders every PNG/ICO with `rsvg-convert` and
  ImageMagick. Replace when real artwork exists.
- **Brand config** in `surfer.json`: `brands.vimma` with short/shorter/full name "Vimma",
  background colour and `release.displayVersion` (`0.1.0`, plan §7: `0.x` until M6).
- **Brand selection by default**: `npm run import` runs `surfer config brand vimma` before
  `surfer import` and regenerates `engine/mozconfig` (`SURFER_MOZCONFIG_ONLY=1 surfer build`)
  after it, so `npm run import && (cd engine && ./mach build)` and the nightly's
  `npm run import && npx surfer build` both build the Vimma brand.
- **App name**: `configs/common/mozconfig` sets `MOZ_APP_BASENAME` to the display name `Vimma`
  (Firefox's convention: basename `Firefox`, app name `firefox`).
- **Vendor**: `src/browser/moz-configure.patch`, one line, `imply_option("MOZ_APP_VENDOR", "Vimma")`.
- **Branding prefs**: `src/browser/branding/vimma/pref/firefox-branding.js` replaces the prefs
  file Surfer generates (which points the welcome/what's-new pages at zen-browser.app).
- `docs/runbook.md`: new `--version` output, the branding symptoms removed.

## Tests (write first)

- `tests/browser/browser_vimma_branding.js` (mochitest browser-chrome):
  - Given the built browser, when reading `Services.appinfo`, then `name` is `Vimma` and `vendor`
    is `Vimma`.
  - Given the branding Fluent bundle (`branding/brand.ftl`), when formatting
    `-brand-short-name`, `-brand-full-name`, `-brand-product-name` and `-vendor-short-name`
    (through a test message), then each is `Vimma`; `brand.properties` `brandShortName` is
    `Vimma`.
  - Given a browser window, when reading `document.title`, then it ends with `Vimma`, not
    `Nightly` or `Firefox`.
  - Given `chrome://branding/content/about-logo.svg`, when fetched, then it is our placeholder
    (contains `vimma-placeholder`).
  - Given an emptied bookmarks tree and `browser.bookmarks.restore_default_bookmarks`, when
    Places init is re-run, then `bookmarks-restore-success` fires, not `bookmarks-restore-failed`.
- `--version` smoke check (runbook): `engine/obj-*/dist/bin/vimma --version` prints
  `Vimma Vimma 0.1.0`.

## Out of scope

Real artwork; Windows/macOS-only assets (installer bitmaps, `.icns`, MSIX, `Assets.car`,
VisualElements stay Surfer's copies of `unofficial` until M7); the About dialog's
"Vimma 0.x · Firefox N" line (plan §7); update URLs and update channel hosting (M6); the content
of the default bookmarks (still Mozilla's links; see Settled).

## Settled (2026-10-09, from Surfer 1.14.9's source and the Firefox 157.0.1 tree)

- **Two directories, as Surfer forces.** Surfer's branding patch reads `configs/branding/<name>/`
  (hard-coded `BRANDING_DIR`) and writes `engine/browser/branding/<name>/`, filling in every file
  we do not supply from `browser/branding/unofficial`. The plan's `browser/branding/vimma/` is
  therefore `configs/branding/vimma/` for inputs; `src/browser/branding/vimma/` holds only files
  that must replace Surfer's generated output (Surfer applies folder patches after branding, and
  replaces existing files with symlinks to ours).
- **No subdirectories but `content/`** in `configs/branding/vimma/`: Surfer copies every top-level
  entry with `copyFileSync` (a directory throws) and requires `content/` to exist.
- **Brand selection** lives in `.surfer/dynamicConfig.brand.json` (git-ignored, default
  `unofficial`); `surfer build` turns it into `--with-branding`, the update channel and the MAR
  channel, and writes `release.displayVersion` into `browser/config/version{,_display}.txt`.
  `surfer package` reads `brands[brand].release` and fails for `unofficial`, so the brand is
  also what makes the nightly's packaging step work.
- **`MacOSInstaller.svg` is not needed**: Surfer only hashes it to decide whether to skip
  re-applying the brand, and it never stores that hash, so the brand is re-applied on every
  import either way (cheap; only the branding jars rebuild).
- **Vendor needs a patch.** `browser/moz.configure` does `imply_option("MOZ_APP_VENDOR", "Mozilla")`
  and mozbuild raises "implied by … conflicts with …" when a mozconfig sets another value, so
  the one line is patched. `MOZ_APP_ID` stays Firefox's (add-on compatibility).
- **`--version` is `<vendor> <name> <version>`** (`DumpVersion` in `nsAppRunner.cpp`), so with
  vendor and name both Vimma it prints `Vimma Vimma 0.1.0`. Accepted; Firefox prints
  `Mozilla Firefox …`.
- **Profile location moves.** Vendor and name form the Linux profile path, so profiles made by
  earlier `unofficial` builds are not picked up. Nothing to migrate before the first release.
- **The bookmarks error was not branding.** The `--screenshot` smoke run logs
  `Failed to import bookmarks … nsresult 0x8046001e`, which is `NS_ERROR_ILLEGAL_DURING_SHUTDOWN`:
  `--screenshot` quits while Places is still importing `default-bookmarks.html`. A fresh profile
  left running imports the default bookmarks without errors (checked with the `unofficial` build:
  4 bookmarks in `places.sqlite`, no console error). The mochitest guards the import itself; the
  runbook smoke check no longer uses `--screenshot` on a fresh profile.
- **Placeholder logo**: drawn by us, released under the repo's MPL-2.0 like the rest; no
  Mozilla/Firefox artwork in the files we supply.
