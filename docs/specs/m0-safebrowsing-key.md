# Spec: m0-safebrowsing-key

Status: draft · Milestone: M0 · Area: build config (`configs/common/mozconfig`), CI
(`.github/workflows/nightly.yml`), `MozillaServices.sys.mjs`, `tools/mochitest.mjs`,
`tools/safebrowsing-smoke`
Prerequisite: m0-mozilla-services merged (it lists Safe Browsing as a known gap pointing here).

## User story

As a Vimma user, Google Safe Browsing protects me from phishing and malware sites and dangerous
downloads exactly as in Firefox, on by default, and I can turn it off in Settings or
`about:config`. If I build Vimma myself without a Google API key, Settings tells me honestly that
the protection is off instead of showing it ticked.

## Scope

- **Key at build time.** `configs/common/mozconfig` passes
  `--with-google-safebrowsing-api-keyfile=<file>` only when the key file exists: the file named
  by `VIMMA_SAFEBROWSING_KEYFILE`, else `$HOME/.config/vimma/keys/safebrowsing`. Without one,
  the option is left out and configure uses its keyless default.
- **Honest keyless state.** `MozillaServices.applySafeBrowsingDefaults()` (our module, run from
  `vimma.js` at the first window) sets the **default branch** of
  `browser.safebrowsing.phishing.enabled`, `browser.safebrowsing.malware.enabled` and
  `browser.safebrowsing.downloads.remote.enabled` to false when `AppConstants` has no key. With a
  key it changes nothing (Firefox's defaults, all true).
- **CI.** `nightly.yml` writes the `SAFEBROWSING_API_KEY` secret to a mode-600 temp file, exports
  `VIMMA_SAFEBROWSING_KEYFILE` for the import and build steps, and deletes the file after the
  build, whatever the outcome. PR builds (`e2e.yml`) get no secret and build keyless.
  `release.yml` is not on `main` yet (PR #23); it must do the same (follow-up below).
- **Test expectation.** `tools/mochitest.mjs` passes `--setenv=VIMMA_EXPECT_SAFEBROWSING_KEY=1|0`
  to the browser: `1` when the key file exists, unless the environment already sets the variable
  (the nightly sets `1`, since its temp key file is gone by test time).
- **Smoke script** `tools/safebrowsing-smoke/safebrowsing-smoke.sh`: launches the real build
  headless on a temp profile and waits for Google's lists to land on disk.
- Docs: `docs/guide.md` (how to opt out; uBlock Origin with its malware and phishing lists),
  `docs/limits.md`, `docs/runbook.md` (providing and rotating the key), README status,
  m0-mozilla-services (Safe Browsing row).
- No upstream patch, no new dependency.

## How the key reaches the browser (Firefox 157.0.1 tree)

- `toolkit/moz.configure:1153` `simple_keyfile("Google Safebrowsing API")`, the template in
  `build/moz.configure/keyfiles.configure`, defines `--with-google-safebrowsing-api-keyfile`.
  With the option, configure reads the file and strips it; an empty file or an unreadable path is
  a `FatalCheckError` (the build stops). Without it, the value is the string
  `no-google-safebrowsing-api-key`. Either way `set_config("MOZ_GOOGLE_SAFEBROWSING_API_KEY")`.
  configure prints only "checking for the Google Safebrowsing API key... yes/no".
- `toolkit/modules/moz.build:299` passes it as a `DEFINE` into the preprocessed
  `AppConstants.sys.mjs:185` (`MOZ_GOOGLE_SAFEBROWSING_API_KEY: "@…@"`).
- `URLFormatter.sys.mjs:127` resolves `%GOOGLE_SAFEBROWSING_API_KEY%` from AppConstants;
  `all.js:3393–3430` use it in the `google`, `google4`, `google5` provider URLs and the download
  reputation URL. `trimSensitiveURLs` replaces the key in Safe Browsing's own log lines.
- `SafeBrowsing.sys.mjs:536` `checkGoogleSafeBrowsingKey` returns false for every `google*`
  provider when the formatted key is empty or the placeholder, and `updateProviderURLs` then
  clears that provider's update and gethash URLs: no Google list is ever fetched. `google5` is
  enabled (`all.js:3427`) and preferred over `google4` where a table exists in both.
- `UrlClassifierListManager.sys.mjs:459`: the first update runs 3 s plus up to 60 s after
  `SafeBrowsing.init`, which BrowserGlue runs as an early idle task (`BrowserGlue.sys.mjs:1084`).
- **Artifact builds pick the key up.** `AppConstants.sys.mjs` is an `EXTRA_PP_JS_MODULES` file,
  preprocessed in our objdir, not taken from Mozilla's binaries (`obj-artifact` has its own
  copy). `tools/artifact-build` copies `engine/mozconfig`, conditional included, so a local
  artifact build with the key file present is keyed; the PR CI artifact build is keyless.

## Options for the keyless state

| Option                                                                       | Settings                                                                                 | Network                                                                       | Verdict                                                                                       |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Leave Firefox's defaults                                                     | "Block dangerous and deceptive content" ticked, protects nothing                         | download reputation asks `sb-ssl.google.com` with the placeholder key (fails) | rejected: the checkbox lies                                                                   |
| Prefs file defaults false                                                    | honest keyless, but **keyed builds too** ship it off                                     | none                                                                          | rejected: the user chose on by default; the branding prefs file is not preprocessed, no `#if` |
| **Runtime default-branch false when `AppConstants` has no key** (our module) | unticked, the "Safe Browsing is off" security warning shows, download sub-options greyed | none                                                                          | **chosen**: keyed builds keep Firefox's defaults; no user value is written                    |
| Same, on the user branch                                                     | same                                                                                     | none                                                                          | rejected: would survive into a later keyed build and look like the user's choice              |

Default-branch values set at runtime are not saved, so a keyless build never leaves a trace in the
profile; the same profile in a keyed build gets Firefox's `true` back. SafeBrowsing observes
`browser.safebrowsing.*` and re-reads its prefs on change, and runs only at idle after our first
window anyway. `downloads.enabled` (local list checks, the "Block dangerous downloads" box) stays
on: it is greyed out under the unticked parent box, and keyless it only checks the empty lists.

## Tests (write first)

`tests/browser/browser_vimma_safebrowsing.js` (both builds). It never prints the key: only
booleans, lengths, URL hosts.

- Given `VIMMA_EXPECT_SAFEBROWSING_KEY` (`1` or `0`), then the build has a key exactly when
  expected (a nightly that lost its secret, or a PR build that gained one, fails here).
- Keyed: `AppConstants.MOZ_GOOGLE_SAFEBROWSING_API_KEY` has length > 0 and is not the
  placeholder; `checkGoogleSafeBrowsingKey("google4")` and `("google5")` are true; the
  default-branch `google4` and `google5` update URLs, formatted, are on
  `safebrowsing.googleapis.com`, contain no `%GOOGLE_SAFEBROWSING_API_KEY%`, and their `key`
  parameter is non-empty and not the placeholder; the running `SafeBrowsing` has a non-empty
  `google4` update URL (the harness points it at a local dummy); the three prefs keep Firefox's
  default true.
- Keyless: the three prefs' default branch is false, with no user value; the running
  `SafeBrowsing` has empty `google4`/`google5` update URLs; Settings > Privacy shows
  `#enableSafeBrowsing` unticked.
- Either build: `applySafeBrowsingDefaults("no-google-safebrowsing-api-key")` and `("")` set the
  three defaults false; `applySafeBrowsingDefaults("<a fake key>")` leaves them as they were.
- `browser_vimma_mozilla_services.js`: phishing and malware move out of the always-true "kept"
  list; they are checked here instead (true keyed, false keyless).

`tools/test/mochitest.test.mjs`: the expectation is passed as `--setenv`, from the key file's
presence or an explicit environment value.

**List updates need the network**, which mochitests block (non-local connections abort the
run). A mocked server would only test Firefox's list manager against our fake, not that our key
works with Google, which is the thing that can break (revoked key, API not enabled, quota). So:
`tools/safebrowsing-smoke/safebrowsing-smoke.sh [bin]`, documented in the runbook, launches the
real build headless on a temp profile, waits up to 180 s for `google4`/`google5` tables in the
profile's `safebrowsing/` directory, and prints only table file names and sizes. It exits 0 when
at least one Google table has data, 1 otherwise. Run before a release and after a key rotation;
not in CI (PR CI is keyless and the nightly is not live).

## Out of scope

- `release.yml` (PR #23): same keyfile steps as the nightly once it is on `main`.
- Google's other keys (location service, Bing); Mozilla's `shavar` lists (unchanged, keyless).
- Our own Safe Browsing proxy, or hiding the key from binaries (impossible client-side).

## Settled

## Open issues

- PR #23 (`release.yml`) must add the keyfile steps before the first release.
