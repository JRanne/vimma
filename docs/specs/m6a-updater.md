# Spec: m6a-updater

Status: proposed (research done, design chosen; not implemented; one decision open: where the
signing key lives) · Milestone: M6a (top priority, plan §6) · Area: build config
(`configs/common/mozconfig`), three upstream patches (ADR-016), `src/browser/base/content/vimma/updates/`
(new), `packages/vimma-core/src/updates.mjs` (new), `config.mjs`, `actions.mjs`, `cmdline.mjs`,
`statusbar.mjs`; `tools/package/`, `tools/update/` (new), `.github/workflows/{release,nightly,upstream}.yml`;
`tests/browser/`, `tests/e2e/`; the `JRanne/vimma-site` repository (`static/updates/`).
Prerequisites: m0-updater (what this undoes), m6-packaging (the artifacts), m7-upstream-autopilot
(the security bumps).

Engine paths are relative to `engine/` (Firefox 157.0.1). Zen references are from
`zen-browser/desktop` (branch `dev`) and `zen-browser/updates-server` on GitHub, read 2026-10-11.

## User story

As a Vimma user who installed the tarball, my browser updates itself the way Firefox does: it
checks Vimma's own server, downloads a signed update in the background and applies it the next
time I start it, with my workspaces, tabs and panes intact. I never see Mozilla's update server.
When Firefox ships a security fix, the Vimma update that carries it reaches me within days with
nobody pressing a button, and the status bar tells me it is a security update and that a restart
applies it; Vimma never restarts on its own. If I installed the AppImage, the same happens to the
AppImage file. If I installed the `.deb` or the AUR package, Vimma does not touch its files: the
status bar tells me a newer version exists and how to get it. I can turn update checks off in
`config.toml`.

As the maintainer, merging a release (or an upstream security bump, once auto-merge is on)
builds, signs and publishes the update and its manifest with no manual step.

## Short answer

- **Firefox's own updater comes back** (`--enable-updater`) in release and nightly builds,
  pointed at `https://vimma.dev/updates/browser/%BUILD_TARGET%/%CHANNEL%/update.xml`, with
  Vimma's certificates compiled into the `updater` binary in place of Mozilla's. It downloads
  complete MARs from GitHub Releases.
- **The manifest is a standard Firefox update XML** (Zen serves the same format from GitHub
  Pages), static, one file per channel, committed to `vimma-site/static/updates/` by the release
  workflow. Vimma signs it (a trailing XML comment) with the same key as the MARs, and a small
  hook in Firefox's update checker hands it to Vimma's verifier before Firefox parses it. That
  hook also refuses downgrades and replays, which Firefox's own logic lets through (Findings).
- **Install type** is Mozilla's own switch: a file named `is-packaged-app` next to the binary
  turns Firefox's updater off (`Services.sysinfo.isPackagedApp`). The `.deb`, the AUR package and
  the AppImage carry it; the tarball does not. Vimma's own module then fetches the same signed
  manifest: the AppImage replaces its own file; `.deb` and AUR get a status-bar hint.
- **Urgent** = the release carries a Firefox security fix (the autopilot's classification). It
  changes the notice and adds a once-per-session `y/N` restart question; never an automatic
  restart.

## Research

### How Firefox finds, checks and applies an update

- **URL.** `CheckerService.getUpdateURL` (`toolkit/mozapps/update/UpdateService.sys.mjs`)
  reads `Services.appinfo.updateURL`, which is `[AppUpdate] URL` in `application.ini`
  (`toolkit/xre/CreateAppData.cpp`), then the `AppUpdateURL` policy if any, and fills it with
  `UpdateUtils.formatUpdateURL` (`toolkit/modules/UpdateUtils.sys.mjs`). The template is fixed in
  `build/application.ini.in`: `https://@MOZ_APPUPDATE_HOST@/updates/browser/%BUILD_TARGET%/%CHANNEL%/update.xml`,
  and `build/moz.build` substitutes `aus5.mozilla.org` unless `CONFIG["MOZ_APPUPDATE_HOST"]` is
  set. No configure option sets it (m0-updater); Surfer's `export MOZ_APPUPDATE_HOST=localhost:7648`
  in the generated `engine/mozconfig` never reaches it. There is no `app.update.url` pref any
  more (removed in bug 1568994, `browser/app/profile/firefox.js`).
- **Channel.** `%CHANNEL%` is the default-branch pref `app.update.channel`
  (`UpdateUtils.getUpdateChannel`), which ships in `defaults/pref/channel-prefs.js` in the install
  directory (`browser/app/profile/channel-prefs.js`, `@MOZ_UPDATE_CHANNEL@`). Surfer configures
  `--enable-update-channel=vimma` and `MAR_CHANNEL_ID=ACCEPTED_MAR_CHANNEL_IDS=vimma`.
  `%BUILD_TARGET%` is `Linux_x86_64-gcc3`. Measured in m0-updater:
  `…/updates/browser/Linux_x86_64-gcc3/vimma/update.xml`.
- **The request** (`#updateCheck`): an `XMLHttpRequest` from the system principal, cache bypassed
  and inhibited, `beConservative`, `Cache-Control: no-cache`; `force=1` appended for a check the
  user starts. No version, build ID, locale or ID in our URL: the template uses only
  `%BUILD_TARGET%` and `%CHANNEL%`. It does not set `LOAD_ANONYMOUS`, so cookies the profile holds
  for the update host would be sent.
- **Selection** (`#selectUpdate`): an `<update>` is skipped when `updateIsAtLeastAsOldAs` holds:
  `appVersion` lower than `Services.appinfo.version`, **or equal with the same `buildID`**. An
  equal `appVersion` with any other build ID, older included, is offered.
- **XML format** (`Update` constructor, `#parseUpdates`): `<updates><update type appVersion
displayVersion buildID platformVersion detailsURL …><patch type="complete" URL hashFunction
hashValue size/></update></updates>`. Unknown attributes are kept in the property bag; unknown
  child elements are skipped; comments are ignored by the parser.
- **Download** (`Downloader`, `nsIIncrementalDownload`, `netwerk/base/nsIncrementalDownload.cpp`):
  a system-principal channel with normal load flags (cookies for the MAR host are sent); the
  file's `hashValue` is checked; then it is staged in the background
  (`app.update.staging.enabled` true) and swapped in at the next start.
- **The updater** (`toolkit/mozapps/update/updater/`) checks, before touching a file:
  - the MAR signature, RSA PKCS#1 v1.5 with SHA-384 (`modules/libmar/sign/mar_sign.c`,
    `verify/cryptox.c`), against `primaryCert.h` **or** `secondaryCert.h`
    (`ArchiveReader::VerifySignature`, `archivereader.cpp`); one valid signature is enough, a MAR
    may carry up to 8 (`MAX_SIGNATURES`);
  - the MAR's channel ID against `ACCEPTED_MAR_CHANNEL_IDS` in `update-settings.ini` in the
    install directory (`PopulategMARStrings`, `updater.cpp`), else `MAR_CHANNEL_MISMATCH_ERROR`
    (22);
  - the MAR's product version against the updater's compiled `MOZ_APP_VERSION`: older is
    `VERSION_DOWNGRADE_ERROR` (23), **equal passes** (`VerifyProductInformation`). For Vimma that
    version is Firefox's (spec m0-app-version), so the updater blocks going back to an older
    Firefox but not to an older Vimma on the same Firefox.
  - a bad signature is `CERT_VERIFY_ERROR` (19).
- **Which certificates.** `toolkit/mozapps/update/updater/moz.build` picks the DER files by
  `MOZ_UPDATE_CHANNEL`: `release`/`beta`/`esr` → Mozilla's release keys, `nightly*`/`aurora` →
  Mozilla's nightly keys, anything else (our `vimma`) → `dep1.der`/`dep2.der`, Mozilla's
  test-signing keys. `gen_cert_header.py` turns them into byte arrays. There is no certificate
  chain, expiry or revocation: the updater trusts exactly the embedded public keys. The test
  updater (`updater-xpcshell/`, `TEST_UPDATER`) embeds `xpcshellCertificate.der`, whose private
  key is in `modules/libmar/tests/unit/data` (`cert9.db`/`key4.db`, nickname `mycert`); Mozilla's
  own browser update tests copy it over `updater` (`tests/browser/head.js`, `copyTestUpdater`).
- **Making MARs.** `./mach repackage mar --input <tarball> --mar <host mar> --output <file>
--arch x86_64 --mar-channel-id vimma` (`python/mozbuild/mozbuild/repackaging/mar.py`) runs
  `tools/update-packaging/make_full_update.sh` with `MOZ_PRODUCT_VERSION` from the tarball's
  `application.ini`. The host `mar` is built with `NO_SIGN_VERIFY`; signing is `signmar`
  (`modules/libmar/tool/moz.build`, links NSS): `signmar -d <nssdb> -n <nickname> -s in out`,
  and `-X`/`-I` extract and import a detached signature. Complete MARs only; partials
  (`make_incremental_update.sh`, zucchini) need the previous build and are out of scope.
- **Channel files survive updates.** `tools/update-packaging/common.sh` and
  `make_incremental_zucchini.py` write `channel-prefs.js` and `update-settings.ini` as
  `add-if-not`: an update never changes an installed copy's channel. So a nightly install stays
  nightly by having these two files rewritten at packaging time.
- **Turning the updater off for a package.** `UpdateServiceStub.updateDisabled` is true when the
  `appUpdate` policy forbids it, when `app.update.disabledForTesting` is set **in automation
  only**, or when `Services.sysinfo.getProperty("isPackagedApp")` is true. On Linux that is
  Snap/Flatpak or a file named `is-packaged-app` in the GRE directory
  (`IsPackagedAppFileExists`, `widget/gtk/WidgetUtilsGtk.cpp`; `xpcom/base/nsSystemInfo.cpp`).
  Mozilla's own `.deb` and `.rpm` repackaging writes exactly that file
  (`python/mozbuild/mozbuild/repackaging/deb.py`, `rpm.py`). With it, the About dialog shows the
  `noUpdater` panel and Settings hides the update group (`AppUpdater.#updateDisabledByPackage`,
  `aboutDialog.js`, `about-firefox.mjs`); no request is made. No policy banner, no patch.
- **Installs Vimma cannot write.** `getCanApplyUpdates` tests write access to the update
  directory and `isAppBaseDirWritable` to the install directory; without it the service still
  checks but offers a manual download (`app.update.url.manual`). An AppImage's install directory is
  the read-only squashfs mount, so Firefox's updater can never apply there.
- **What the user sees.** `UpdateListener.sys.mjs` badges the app menu after
  `app.update.badgeWaitTime` (ours 0) and shows a "Restart to update" doorhanger after
  `app.update.promptWaitTime` (ours 24 h); restarting is `quit-application-requested` +
  `Services.startup.quit(eAttemptQuit | eRestart)`. Firefox auto-restarts with no windows open
  only on macOS (`app.update.noWindowAutoRestart.enabled`, `#ifdef XP_MACOSX`); on Linux it never
  restarts by itself. Observer topics: `update-downloading`, `update-downloaded`, `update-staged`,
  `update-error`, `update-swap`.
- **Timers.** `app.update.interval` is 86400 s in our `firefox-branding.js` (Mozilla's release
  branding uses 43200); `app.update.timerFirstInterval` 30 s; BrowserGlue's old-build check after
  `app.update.checkInstallTime.days` (2). No pref stops checks other than the interval; the
  enterprise policy `DisableAppUpdate` does, with the "managed by your organization" banner
  m0-updater rejected.
- **WebCrypto in chrome modules.** `crypto.subtle` is the global in `.sys.mjs` modules
  (`browser/components/backup/ArchiveEncryption.sys.mjs` imports keys and verifies), so Vimma can
  verify an RSA PKCS#1 v1.5 SHA-384 signature with the same public key the updater embeds.
- **`Cu.isInAutomation`** is true only when the process started with
  `MOZ_DISABLE_NONLOCAL_CONNECTIONS=1` and the pref
  `security.turn_off_all_security_so_that_viruses_can_take_over_this_computer` is set
  (`js/xpconnect/src/nsXPConnect.cpp`); it is how a test key can be honoured without being a
  switch any user has.

### Prior art

- **Zen** (`zen-browser/updates-server`, GitHub Pages at `updates.zen-browser.app`): one static
  `updates/browser/<target>/<channel>/update.xml` per target and channel (`release`, `twilight`),
  committed by a bot ("Update update manifests") on each release. The Linux file is one
  `<update type="minor" appVersion="1.23.2b" buildID=…>` with one complete MAR from the GitHub
  Release (`…/releases/download/1.23.2b/linux.mar`, 114 MB). Zen's `appVersion` is its own
  version because its `appinfo.version` is; ours is Firefox's (Findings, 2).
- **Zen's signing** (`scripts/mar_sign.sh`): one RSA-4096 key and a self-signed certificate,
  kept base64-encoded in GitHub Actions secrets, imported into an NSS DB at release time; the
  public DER is copied over `release_primary.der`, `release_secondary.der`, `dep1.der`,
  `dep2.der` **and** `xpcshellCertificate.der` in the engine tree. No secondary key, no rotation.
  Zen also patches `updater-common.build` to add `-Wl,-rpath=$ORIGIN` on Linux so the updater
  finds NSS next to it (`src/toolkit/mozapps/update/updater/updater-common-build.patch`).
- **Zen's AppImage** is not updated by the browser: its install script (`appimage.sh`) uses
  `zsync` against a published `.zsync` file. LibreWolf compiles the updater out
  (m0-updater, Settled). Mozilla's `.deb` uses `is-packaged-app` and its apt repository.
- **AppImage tools.** AppImageUpdate reads update information embedded in the image
  (`gh-releases-zsync|owner|repo|latest|*.AppImage.zsync`) and needs a separate tool or
  AppImageLauncher run by the user; nothing in the browser.

### Vimma today

- `configs/common/mozconfig` has `--disable-updater` (m0-updater); the artifact build drops it and
  keeps Mozilla's prebuilt updater and aus5 URL (ADR-010 gap). `firefox-branding.js` already sets
  `app.update.interval`, `promptWaitTime`, `badgeWaitTime` 0, `url.manual` and `url.details`.
- `release.yml` builds on the self-hosted `vimma-build` runner with a read-only token; `sign`
  (cosign keyless, the only `id-token: write`) and `publish` (the only `contents: write`) run on
  hosted runners; artifacts pass between jobs. `nightly.yml` builds, tests and publishes the
  rolling `nightly` release in one self-hosted job with `contents: write`.
- `upstream.yml` (m7) opens the bump PR, a draft unless clean and green; a human merges, then a
  human merges the release-please PR. Auto-merge is explicitly out of m7's scope.
- `vimma-site` deploys `main` to vimma.dev via Cloudflare Workers Builds in one or two minutes;
  `static/` is copied to the site root as is and skipped by the site checks. **vimma.dev is behind
  Cloudflare Access** until Vimma is published.

## Findings

1. **Firefox's update XML is not authenticated, and that matters.** TLS protects it in transit,
   but whoever controls vimma.dev (the Cloudflare account, a push to `vimma-site`) can serve any
   XML. The MAR signature stops them from running their own code. It does not stop a rollback: an
   older **signed** Vimma on the same Firefox version passes both Firefox's selection (equal
   `appVersion`, different `buildID`) and the updater (equal product version). Nor does it stop a
   freeze (serving the old XML forever). Vimma therefore signs the XML and checks it itself
   (Design §4).
2. **`appVersion` must be Firefox's version.** Selection compares it to
   `Services.appinfo.version`, which is Firefox's (m0-app-version), and the MAR's product version
   must not be below the updater's `MOZ_APP_VERSION`, also Firefox's. A Vimma-only release on the
   same Firefox is newer only by build ID. `displayVersion` carries Vimma's version for the UI.
3. **Mozilla's test keys are what a `vimma` channel build trusts today.** Re-enabling the updater
   without changing `moz.build` would embed `dep1.der`/`dep2.der`. The certificate choice must be
   ours before the first updater-enabled build ships.
4. **A `.deb` from a GitHub Release is not updated by apt.** There is no Vimma apt repository, so
   "left to apt" means the hint must say "download the new `.deb`" until one exists (open
   question 6). The AUR is updated by the user's AUR helper.
5. **The MAR download sends GitHub cookies.** The `<patch URL>` is
   `github.com/…/releases/download/…`, which redirects to a signed, expiring asset URL; the
   system-principal download sends the profile's `github.com` cookies on the first hop. Vimma
   strips them (Design §9, item 1).
6. **Getting a security fix out without a manual step needs auto-merge.** Today a Firefox
   security release stops twice for a human: the bump PR and the release PR. The exit test needs
   both merged automatically when green (Design §7), which m7 left out on purpose; this spec
   puts it behind a variable that stays off until the release gate lifts.
7. **vimma.dev is behind Cloudflare Access.** Clients cannot fetch `/updates/` until Access has a
   bypass rule for that path (or is removed at publication). Until Vimma is published there are no
   users, so this is a setup step, not a blocker.
8. **Cloudflare Workers static assets** cap a file at 25 MiB, so MARs (about 80 to 115 MB)
   cannot live on vimma.dev; they stay on GitHub Releases, as Zen's do.

## Design

### 1. Channels and URLs

| Channel | `app.update.channel` | MAR channel ID  | Manifest                                                                       | Built by      |
| ------- | -------------------- | --------------- | ------------------------------------------------------------------------------ | ------------- |
| release | `vimma`              | `vimma`         | `https://vimma.dev/updates/browser/Linux_x86_64-gcc3/vimma/update.xml`         | `release.yml` |
| nightly | `vimma-nightly`      | `vimma-nightly` | `https://vimma.dev/updates/browser/Linux_x86_64-gcc3/vimma-nightly/update.xml` | `nightly.yml` |

- The compile-time channel stays `vimma` for both (it also picks the certificates and, through
  `MOZ_APP_REMOTINGNAME`, the desktop file ID `vimma-vimma`; m6-packaging). The nightly tarball
  gets its channel at packaging time: `package.mjs --channel nightly` rewrites
  `defaults/pref/channel-prefs.js` and `update-settings.ini` inside it. Updates never touch those
  files, so a nightly install stays nightly and a release install can never accept a nightly MAR
  (channel ID 22).
- `MOZ_APPUPDATE_HOST` = `vimma.dev`, set by one `set_config` line in the existing
  `src/browser/moz-configure.patch` (ADR-016). The path is Firefox's fixed template.
- **Static**: everything on vimma.dev is a committed file; there is no server code. **Generated**:
  `update.xml` per channel, written and signed by the release workflow (§4).

### 2. The manifest

```xml
<?xml version="1.0"?>
<updates>
  <update type="minor" appVersion="157.0.2" platformVersion="157.0.2" buildID="20261020031500"
          displayVersion="0.3.1" detailsURL="https://github.com/JRanne/vimma/releases/tag/v0.3.1"
          vimmaChannel="vimma" vimmaTarget="Linux_x86_64-gcc3" vimmaSerial="20261020041207"
          vimmaUrgency="security" vimmaAdvisories="MFSA 2026-105">
    <patch type="complete" size="98113536" hashFunction="sha512" hashValue="…"
           URL="https://github.com/JRanne/vimma/releases/download/v0.3.1/vimma-0.3.1-linux-x86_64.complete.mar"/>
    <vimmaAppImage size="…" hashFunction="sha512" hashValue="…"
           URL="https://github.com/JRanne/vimma/releases/download/v0.3.1/vimma-0.3.1-x86_64.AppImage"/>
  </update>
</updates>
<!-- vimma-signature v1 key=3f2a91c0 sig=BASE64 -->
```

- One `<update>`, the newest build of the channel; an empty `<updates/>` (still signed) means
  "nothing offered". Nightlies use `displayVersion="0.3.1-nightly.20261020"`.
- `vimmaSerial` is the UTC time the manifest was generated (`YYYYMMDDhhmmss`, the build-ID
  format). `vimmaUrgency` is `security` or `normal`.
- **Signature**: RSASSA-PKCS1-v1_5 with SHA-384 over the bytes `vimma-update-xml-v1\n` followed by
  the file up to and including the newline before the comment. The prefix separates it from MAR
  signatures (a MAR starts `MAR1`), so the one key cannot be tricked into signing across uses.
  `key=` names the key by the first 8 hex digits of its SPKI SHA-256; the comment may hold up to
  four `key=… sig=…` pairs (rotation, §6), and one that verifies under a pinned key is enough.
- Served with `Cache-Control: no-cache` (a `static/_headers` rule in vimma-site).

### 3. Install types and how each package sets its mode

| Install                | Updater                       | Set by                                                                                                                      | Vimma's module does                                                               |
| ---------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Tarball, writable dir  | Firefox's, on                 | nothing (no `is-packaged-app`)                                                                                              | notices, the urgent prompt, staleness warning                                     |
| Tarball, read-only dir | Firefox's checks, can't apply | (same tarball)                                                                                                              | hint: "Vimma can't write `/opt/vimma`; update it as its owner or reinstall"       |
| AppImage               | off                           | `usr/lib/vimma/is-packaged-app` in the AppDir, content `vimma-package=appimage`                                             | fetches the manifest, replaces `$APPIMAGE` itself (below)                         |
| `.deb`                 | off                           | `usr/lib/vimma/is-packaged-app`, content `vimma-package=deb`                                                                | fetches the manifest, hint: "download vimma_0.3.1_amd64.deb" (Finding 4)          |
| AUR `vimma-bin`        | off                           | `PKGBUILD` `package()` writes `/opt/vimma/is-packaged-app`, content `vimma-package=aur`                                     | fetches the manifest, hint: "update vimma-bin with your AUR helper"               |
| Source / dev build     | not built                     | `configs/common/mozconfig`: `--enable-updater` only when `VIMMA_UPDATES=1` (release and nightly jobs set it); else as today | nothing; about:vimma says "updates: not built in (source build)"                  |
| Artifact build (CI)    | Mozilla's prebuilt            | ADR-010 gap, unchanged                                                                                                      | the verifier hook is ours, so it still refuses aus5's unsigned XML; never shipped |

Firefox only tests that the file exists; the `vimma-package=` line is for Vimma's hint text.
Detection order in `VimmaUpdates.sys.mjs`: `AppConstants.MOZ_UPDATER` false → source build;
`isPackagedApp` and `$APPIMAGE` set → AppImage; `isPackagedApp` → read the file's package name;
else Firefox's updater, and `aus.canUsuallyApplyUpdates` tells writable from read-only.

**AppImage, chosen: Vimma replaces the file.** The squashfs is read-only, so MARs cannot apply.
Vimma's module, after a verified manifest offers a newer build, downloads `vimmaAppImage` to
`<dir of $APPIMAGE>/.vimma-update-<buildID>.AppImage.part` (anonymous request, §9 item 1),
checks size and SHA-512 against the signed manifest, `chmod 0755`, fsyncs and renames it over
`$APPIMAGE`. The running process keeps its mounted image (the old inode); the next start runs the
new one, with the same path, so the desktop entry and `MOZ_APP_LAUNCHER` stay right. A directory
it cannot write falls back to the hint. Rejected: AppImageUpdate/zsync (a tool the user has to
run; the "without noticing" goal fails) and MAR-patching an extracted copy (the AppImage would
stop being one file). The file keeps its old name (`vimma-0.1.0-x86_64.AppImage` now holding
0.3.1); the guide says so, and about:vimma shows the real version.

### 4. Client: verification, downgrade and replay

`UpdateVerifier` (pure logic in `packages/vimma-core/src/updates.mjs`, WebCrypto passed in) is
called from two places with the same rules:

- **Firefox's checker**, through `src/toolkit/mozapps/update/UpdateService-sys-mjs.patch`
  (ADR-016): before `request.send` it calls `VimmaUpdates.beforeCheck(request)` (adds
  `LOAD_ANONYMOUS`; with `[updates] check = false` it returns false and the check ends as
  checks-not-allowed); in the `try` before `#parseUpdates(request)` it awaits
  `VimmaUpdates.verify(request)`, which throws on any failure, so the check fails exactly as a
  malformed XML does (`#getCheckFailedObject(status, 200)`) and no update is offered. A patch, not
  an observer: if a rebase moves this code, `surfer import` fails instead of updates silently going
  unverified (the precedent is `tab-bar-visibility-js.patch`).
- **Vimma's own fetch** for AppImage, `.deb` and AUR (Firefox's checker is off there): `fetch`
  with `credentials: "omit"`, `cache: "no-store"`, same URL (`Services.appinfo.updateURL`
  formatted by `UpdateUtils.formatUpdateURL`), same timer interval, same verifier.

Rules, in order (each failure has a reason string for about:vimma and the status bar):

1. The trailing comment parses and the signature verifies under a pinned key: the primary or
   secondary slot. The public keys are the SPKI of the same DER certificates the updater embeds,
   generated into `vimma/updates/keys.mjs` at import time from `src/toolkit/mozapps/update/updater/vimma/`.
   A test key is accepted only from the pref `vimma.update.testKeys` and only when
   `Cu.isInAutomation`.
2. `vimmaChannel` equals `UpdateUtils.UpdateChannel` and `vimmaTarget` equals the build target
   (a nightly or other-target manifest served at the release path is refused).
3. **Replay**: `vimmaSerial` ≥ the highest serial this profile has accepted (`vimma.update.serial`,
   written after each success) and ≥ the running build's own build ID (so a fresh profile on a new
   build cannot be offered a manifest older than itself).
4. **Downgrade**: the offered `(appVersion, buildID)` must be strictly newer than
   `(Services.appinfo.version, Services.appinfo.appBuildID)`, versions compared with
   `Services.vc.compare` and build IDs as numbers. A manifest that passes 1 to 3 but offers an older
   or equal build is not an error: the verifier removes the `<update>` and the check finds nothing.
5. **Freeze**: a verified manifest whose serial is older than 45 days (release) or 7 days
   (nightly) still counts, but the status bar shows `updates: no news for N days` once a day; Firefox
   ships a release every four weeks, so a release manifest older than that means the feed or the
   pipeline is stuck.

Firefox then downloads, checks the hash, stages, and the updater checks the MAR's signature,
channel and Firefox version: the server or GitHub can withhold updates, but cannot install code
Vimma did not sign or roll a profile back.

### 5. UX: notices, urgent updates, restart

Core decides from plain data (`updateNotice(state)` in `updates.mjs`: install type, Firefox
updater state, offered and running versions, urgency, last check, now); the host renders it.

| State                                | Status bar (right side)                    | Colour               | Extra                                                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Downloading / staging                | nothing                                    |                      | silent                                                                                                                                                                                                                                              |
| Staged, normal                       | `⇡ 0.3.1 on restart`                       | dim                  | applies at the next start, whenever that is                                                                                                                                                                                                         |
| Staged, urgent                       | `⇡ 0.3.1 security: :restart`               | `--vimma-text-error` | once per session, at the next normal-mode idle: the command line asks `Security update 0.3.1 is ready. Restart now? Tabs come back. [y/N]` (as the add-on picker's `y/N`); `y` = `:restart`, anything else dismisses until the next session or 24 h |
| Package hint (`.deb`, AUR)           | `⇡ 0.3.1 available` (`security` if urgent) | dim / error          | `:update` shows the full hint text and the release link                                                                                                                                                                                             |
| AppImage replaced                    | `⇡ 0.3.1 on restart`                       | as above             | as above                                                                                                                                                                                                                                            |
| Verification or check failed 3 times | `updates: check failed`                    | warning              | reason in about:vimma                                                                                                                                                                                                                               |
| Stale feed (rule 5)                  | `updates: no news for N days`              | warning              | once a day                                                                                                                                                                                                                                          |

- **Never an automatic restart.** `:restart` (action `app.restart`, also bindable; no default
  key) is Firefox's restart path: `quit-application-requested` (add-ons and unsaved-form prompts
  can cancel), then `eAttemptQuit | eRestart`; the session comes back through SessionStore as on
  any restart (workspaces, panes, scroll). If the private workspace has tabs, the question says
  `Private tabs will close.` before `[y/N]`.
- `:update` (action `app.update_check`): checks now (Firefox's foreground check, or Vimma's fetch)
  and reports in the command line: up to date, offered, staged, failed (why), off.
- Firefox's own badge and doorhanger stay as Firefox has them (`badgeWaitTime` 0,
  `promptWaitTime` 24 h); they are the mouse path to the same restart.
- about:vimma's Version block gains: install type, channel, last check and result, offered
  version, urgency, the manifest serial and the key that signed it.
- **Interval**: `app.update.interval` 43200 (12 h, Firefox release's own) instead of 86400; urgent
  releases are therefore seen within 12 h of publication, plus the 30 s first-run timer. Vimma's own
  fetch (packaged installs) uses the same pref.

### 6. Signing and keys

**What is signed with what:**

| Artifact                           | Signature                                       | Verified by                                                       |
| ---------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| Complete MAR                       | update key (RSA-4096, PKCS#1 v1.5, SHA-384)     | the installed `updater` (embedded primary/secondary certificates) |
| `update.xml`                       | same update key, domain-separated (§2)          | Vimma's verifier (same public keys, WebCrypto)                    |
| AppImage file (in-app replacement) | its SHA-512 inside the signed `update.xml`      | Vimma's verifier                                                  |
| Every release asset, MAR included  | cosign keyless bundle (unchanged, m6-packaging) | people, with `cosign verify-blob`; not the browser                |

Cosign stays for humans and auditors: an installed browser cannot verify a Sigstore bundle offline
(it needs Fulcio roots and Rekor through TUF), and the updater only knows RSA keys it was built
with. One update key for MARs and the manifest keeps one ceremony and one rotation story; a
separate manifest key is possible (open question 3).

**Certificates in the build.** `src/toolkit/mozapps/update/updater/moz-build.patch` (ADR-016) adds
one branch to `moz.build`: channel `vimma` → `vimma/primary.der` and `vimma/secondary.der`
(our files, beside it). Mozilla's DER files stay untouched (Zen overwrites them, which hides the
change from a rebase). The `updater-xpcshell` test updater keeps Mozilla's test certificate.
Whether the Linux updater needs Zen's `-Wl,-rpath=$ORIGIN` hunk to find NSS is checked in
sub-spec 1 by running the built updater from an installed tarball; if it does, that hunk joins the
same patch.

**Primary and secondary.** The updater accepts either slot, so:

- **primary**: the online key every release is signed with;
- **secondary**: a cold recovery key, generated offline, kept off any network (paper or USB in a
  safe), used only to sign the one release that replaces a leaked or lost primary.

**Where the primary key lives: the decision the user makes before implementation.**

| Option                                                                   | Automation                                                                                            | If the CI or a workflow is compromised                                                                                                                 | If the key leaks                                               | Cost / setup                                                                                                                            |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **A. GitHub Actions secret** (Zen's way)                                 | full                                                                                                  | anything that runs in the signing job's environment can copy the key out, silently, once                                                               | it signs MARs until rotation, from anywhere, with no log       | none; an environment `update-signing` limited to `main` and `v*` tags                                                                   |
| **B. On the `vimma-build` runner** (file, or a YubiKey 5.7+ via PKCS#11) | full while the runner is online (it already must be, to build); touch-to-sign would add a manual step | any job that reaches the runner while it is online can sign (with a token: only while plugged in, cannot copy the key)                                 | file: as A; token: cannot leak, only be misused while attached | a token (≈ 75 €); the runner's exposure rules (runbook) start guarding a signing key, not only a build                                  |
| **C. Cloud KMS via GitHub OIDC** (GCP Cloud KMS or AWS KMS, HSM-backed)  | full                                                                                                  | can ask KMS to sign while the job runs, cannot copy the key; every signature is in the cloud audit log; IAM bound to `repo:JRanne/vimma` + environment | cannot leak (non-exportable); revoke the IAM binding           | a cloud account; ≈ 1–3 USD a month; NSS signs through the provider's PKCS#11 library or a digest-signing step (new tool: licence check) |
| D. Offline key + online subkey                                           | —                                                                                                     | —                                                                                                                                                      | —                                                              | **not possible for MARs**: the updater has no chain or expiry, only the two embedded keys; D becomes the cold secondary above           |

**Recommendation: C for the primary, a cold secondary in every case.** It matches how
m6-packaging chose cosign keyless ("no secret to leak"): the signing job holds a short-lived OIDC
token, never key material, and there is an audit trail. If no cloud account is wanted, A with the
cold secondary is the fallback: simplest, what Zen does, and recoverable. B is the weakest fit
here, because the self-hosted runner is the machine most exposed to untrusted workflow code.

**Key ceremony (any option).** RSA-4096, a self-signed certificate per slot (the updater only
reads its public key; the subject is `CN=Vimma update signing primary|secondary`, validity
irrelevant). The two public DERs are committed under `src/toolkit/mozapps/update/updater/vimma/`
with their SHA-256 in the runbook. The secondary's private half is never on a networked machine.

**Rotation (planned, e.g. every two years or on any doubt).** Release R carries an updater with
`primary = new`, `secondary = cold` and is signed with the **old** primary, which every client
still trusts. Releases after R carry **two** signatures, old and new primary (a MAR holds up to 8;
`signmar` adds several), for one 4-week cycle, so a client that had not yet installed R can still
take whatever is newest; after that, the new primary alone. The manifest carries both signatures
for the same cycle (§2), since a client before R verifies it with the old primary only.

**If the primary leaks:** revoke it (C: disable the key version; A: delete the secret), sign an
emergency release with the **cold secondary** that embeds a fresh primary and the same secondary,
publish it with `vimmaUrgency="security"`, and say so in a GitHub advisory. Until clients update,
the attacker can sign MARs, but also needs to serve a manifest: that is signed with the same key, so
they additionally need vimma.dev or a TLS interception; HTTPS and the separate site credentials are
the remaining wall. **If both leak:** no in-band recovery; the advisory tells users to reinstall
from a release whose updater carries new keys (checked with cosign).

### 7. Release pipeline (no manual step)

New gate: repository variable `UPDATES_ENABLED` (with `RELEASE_ENABLED`, and the key being
configured). Every job below also keeps m6-packaging's gate (`release` event or `main`).

**`release.yml`:**

| Job                    | Runner        | Permissions / secrets                                                                                  | Does                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `build` (changed)      | `vimma-build` | `contents: read`                                                                                       | `VIMMA_UPDATES=1`; after `./mach package`: `./mach repackage mar … --mar-channel-id vimma` → unsigned `vimma-V-linux-x86_64.complete.mar`; uploads it with `mar-tools` (`signmar` + its NSS libraries from `dist/bin`) and `update-meta.json` (build ID, Firefox version, display version) |
| `package` (changed)    | hosted        | `contents: read`                                                                                       | `is-packaged-app` into AppDir, `.deb`, PKGBUILD; checks that the tarball has none and that `update-settings.ini` says `vimma`                                                                                                                                                              |
| `update-sign` (new)    | hosted        | environment `update-signing`; C: `id-token: write`; A: the key secret                                  | signs the MAR (`signmar -s`), verifies it against the committed DERs (`signmar -v`), runs `tools/update/manifest.mjs` (XML from `update-meta.json`, MAR and AppImage size/SHA-512, urgency), signs the XML, verifies it with the core verifier                                             |
| `sign` (unchanged)     | hosted        | `id-token: write`                                                                                      | cosign bundles, now also for the signed MAR                                                                                                                                                                                                                                                |
| `publish` (changed)    | hosted        | `contents: write`                                                                                      | uploads the signed MAR with the other assets                                                                                                                                                                                                                                               |
| `update-publish` (new) | hosted        | environment `update-site`; `SITE_DEPLOY_KEY` (write deploy key for `vimma-site` only); no GitHub token | downloads the MAR and AppImage **from the release URLs** and checks size and hash against the signed XML, then commits `static/updates/browser/Linux_x86_64-gcc3/vimma/update.xml` to `vimma-site` `main` and pushes; polls vimma.dev until the new serial is served (10 min timeout)      |
| `failure` (changed)    | hosted        | `issues: write`                                                                                        | as today, also for the new jobs                                                                                                                                                                                                                                                            |

- **Urgency** is computed in `update-sign` by `tools/update/urgency.mjs`: the release is urgent
  when `surfer.json`'s Firefox version changed since the previous tag and `tools/upstream/releases.mjs`
  classifies any Firefox version in between as security or unknown (m7's G3: unknown counts as
  security). Advisory IDs go into `vimmaAdvisories`.
- **Direct push, not a PR**, to `vimma-site`: a PR would need a merge, a manual step. The deploy
  key can write only `vimma-site`; the commit touches only `static/updates/**` and a vimma-site CI
  check fails a bot commit that touches anything else. The site cannot forge an update (the XML is
  signed); its compromise can only withhold or replay, which rules 3 to 5 catch.
- **Release secrets stay isolated** (plan §8): the self-hosted runner never sees the key, the site
  key or a write token; Claude's workflows get none of them; each secret lives in a GitHub
  environment whose deployment rule allows only `main` and `v*` tags.
- A re-run is idempotent: the MAR upload uses `--clobber`, and `update-publish` commits nothing
  when the file is unchanged.

**`nightly.yml`** splits into `build` (self-hosted, `contents: read`, as today plus
`VIMMA_UPDATES=1`, `package.mjs --channel nightly`, the MAR with channel ID `vimma-nightly`), then
the same `update-sign` and `update-publish` jobs (shared as a reusable workflow
`update-publish.yml`) writing `…/vimma-nightly/update.xml`, and `publish` (hosted,
`contents: write`) for the rolling `nightly` release. Nightly MARs point at the `nightly` tag's
asset URL with a build-ID file name (`vimma-nightly-<buildID>-linux-x86_64.complete.mar`), because
the rolling release replaces its assets: the previous MAR is kept as an asset until the next build
so a client that just read the old manifest can still download it.

**`upstream.yml` and the security path** (Finding 6): with `AUTO_SECURITY_RELEASE=true`, a bump
PR that the autopilot marks ready (every patch clean, suites green) and classifies as security is
set to auto-merge (`gh pr merge --auto --squash`, needs `UPSTREAM_PR_TOKEN`); release-please then
updates its PR, and a new job in `release-please.yml` sets that PR to auto-merge when every
changelog entry in it is an `upstream:` line. Required checks still gate both merges. From there
`release.yml` and the jobs above publish. Each step comments on the m7 tracking issue, the last
with "reached vimma.dev at <time>, <hours> after the advisory".

### 8. Privacy

- **What a check sends**: `GET https://vimma.dev/updates/browser/Linux_x86_64-gcc3/<channel>/update.xml`
  (plus `?force=1` when the user asked), Firefox's standard user agent, no cookies
  (`LOAD_ANONYMOUS` from the hook; Vimma's fetch uses `credentials: "omit"`). No Vimma version,
  build ID, locale, OS version or any identifier: every install of a channel requests the same
  static file. Cloudflare sees the IP address and the time; vimma.dev has no analytics (site
  guarantee).
- **What a download sends**: GET to GitHub for the MAR (or AppImage) with the cookie header
  stripped (§9 item 1); GitHub sees the IP. A cookie-less mirror (an R2 bucket on a separate
  hostname) is possible later; not needed for the guarantee.
- **How often**: every 12 h, at startup if the last check is older, when about:preferences or the
  About dialog opens (Firefox's behaviour), and on `:update`.
- **Glean**: the update code records Glean metrics locally; Vimma builds never upload them
  (m0-mozilla-services). No new telemetry.
- **Off**: `config.toml` `[updates] check = false` (schema 2 key, added to `TOP_KEYS` and
  `SCHEMA_2_KEYS` like `[search]`; no migration). It stops background checks and Vimma's fetch
  (the hook answers checks-not-allowed), so no request leaves at all; the About dialog then says
  the check failed (Firefox has no "off by user" panel without a policy) and the status bar shows
  `updates: off` once per session. The same pref is `vimma.update.enabled` for people without a
  config file. `app.update.auto` = false (Settings: "Check for updates but let you choose to
  install them") keeps checks but stops downloads, as in Firefox.

### 9. Smaller decisions

1. **Downloads are anonymous**: `VimmaUpdates` observes `http-on-modify-request` for
   system-principal channels with no browsing context whose URL is the selected patch's URL or its
   redirect, and clears `Cookie` (a privacy measure; fail-open is acceptable, unlike verification).
2. **Complete MARs only**; partial MARs later (they need the previous build in the pipeline).
3. **`type="minor"`** always (Firefox's "major" UI is for unsupported OS cases).
4. **One manifest per channel and target**; aarch64 and macOS add files later.
5. **The m0-updater mochitests change**: on a build with `VIMMA_UPDATES=1`, `MOZ_UPDATER` is true
   and the URL is vimma.dev; "no request to aus5" stays a test in both builds.
6. **Settings' "Updates are managed by your operating system"** is accurate for `.deb` and AUR;
   for the AppImage it is not, and the guide says Vimma updates the file itself. No string patch.
7. **Auto-merge is off** (`AUTO_SECURITY_RELEASE` unset) until the user has daily-driven Vimma
   (release gate); the exit test is proven with it on.

## Upstream patches (ADR-016, needed before implementation)

| Patch                                                          | Change                                                                                  | Budget (hunks / lines) |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------- |
| `src/browser/moz-configure.patch` (existing, grows)            | `set_config("MOZ_APPUPDATE_HOST", "vimma.dev")`                                         | 1 / 6 (was 1 / 5)      |
| `src/toolkit/mozapps/update/updater/moz-build.patch` (new)     | channel `vimma` → our two DER files (+ the rpath line if sub-spec 1 shows it is needed) | 1 / 6                  |
| `src/toolkit/mozapps/update/UpdateService-sys-mjs.patch` (new) | `beforeCheck(request)` before `send`, `await verify(request)` before `#parseUpdates`    | 2 / 10                 |

Everything else is our files, prefs (`firefox-branding.js`), the mozconfig and packaging.
**ADR-016 "Vimma's own update channel"** records: the host and path; our keys replacing
Mozilla's for channel `vimma`; the signed XML and the verifier hook (and why a hook rather than an
observer); the `is-packaged-app` modes; the key location once decided; and the three register rows
in ADR-003's table.

## Sub-specs / acceptance

1. **Build and keys** (mozconfig, the three patches, `keys.mjs` generation, prefs, ADR-016): done
   when a `VIMMA_UPDATES=1` build has `[AppUpdate] URL=https://vimma.dev/…`, `update-settings.ini`
   says `vimma`, the `updater` binary contains our primary DER's bytes and not `dep1.der`'s, and the
   built updater applies a test-signed MAR from an installed tarball (rpath question answered).
2. **Core** (`updates.mjs`, `config.mjs`, `actions.mjs`, `cmdline.mjs`, `statusbar.mjs`): the
   Vitest cases below.
3. **Host** (`vimma/updates/VimmaUpdates.sys.mjs`, `UpdateVerifierHost`, AppImage replacement,
   status bar and prompt wiring, about:vimma, control `state` field): the mochitests below.
4. **Packaging and pipeline** (`package.mjs`, `tools/update/`, `release.yml`, `nightly.yml`,
   `update-publish.yml`, `release-please.yml`, `upstream.yml`): workflow tests and a dry run.
5. **e2e and the security rehearsal**: the scenarios below; the M6a gate.

## Tests (write first)

- **Vitest** `packages/vimma-core/test/updates.test.mjs` (WebCrypto from Node, keys generated in
  the test): signature split and verify (primary, secondary, wrong key, one flipped byte in the
  body, in the comment, a missing or second comment, the domain prefix absent → fails); channel and
  target mismatch; replay (serial below stored, below own build ID; equal accepted); downgrade
  (older `appVersion`; equal `appVersion` with older, equal and newer build ID; numeric not string
  build-ID order); freeze thresholds per channel; `updateNotice` for every row of the §5 table;
  the `y/N` prompt once per session and its 24 h re-ask; version display (`0.3.1-nightly.20261020`).
  `config.test.mjs`: `[updates] check`, wrong type, schema 1 → "is new in schema 2";
  `cmdline.test.mjs`: `:update`, `:restart`; snapshots (`defaults.toml`, help) re-recorded with a
  changelog line.
- **Tools** `tools/update/test/manifest.test.mjs`: XML from fixtures (attributes, sizes, hashes,
  nightly names, empty `<updates/>`), urgency from fixture feeds (security, unknown → security, none),
  signing round trip with a test key, the deploy commit touching only `static/updates/**`.
  `tools/package/test/package.test.mjs`: `is-packaged-app` and its content in AppDir, `.deb` and
  PKGBUILD, absent from the tarball; `--channel nightly` rewrites both channel files.
  `release-workflow.test.mjs` / a new `update-workflow.test.mjs`: gates, environments, that only
  `update-sign` gets the key or `id-token`, only `update-publish` the site key, the self-hosted
  job gets neither, no PR trigger.
- **Mochitest** `tests/browser/browser_vimma_update_verify.js` (full build with `VIMMA_UPDATES=1`;
  in automation, `vimma.update.testKeys` set; XML served by an `.sjs` on `mochi.test`, reached by
  swapping `Services.appinfo.updateURL` the way Mozilla's `setUpdateURL` does in
  `toolkit/mozapps/update/tests/data/shared.js`, so no policy is needed):
  - a valid signed XML → `checkForUpdates` offers it; the request had no `Cookie` header although
    the test set one for the host;
  - **bad signature**, unsigned XML, a nightly manifest on the release channel → check fails, no
    update, about:vimma shows the reason;
  - **replay**: serve serial S, then S−1 → refused; **downgrade**: same Firefox version, older
    build ID → no update offered; a MAR download URL request carries no `Cookie`;
  - `[updates] check = false` → no request at all (an `http-on-opening-request` watcher), status
    bar `updates: off`.
- **Mochitest** `browser_vimma_update_notice.js`: fake update states (an `nsIUpdate` from XML via
  the update manager's test hooks) → status bar text and colour per §5; urgent prompt appears once,
  `n` dismisses, `y` calls the restart path (stubbed `Services.startup.quit`), private tabs add the
  warning; `:update` messages. `browser_vimma_updater.js` (m0) is updated as §9 item 5 says.
- **Mochitest** `browser_vimma_update_packaged.js`: with the module's install type injected (the
  detection itself is a pure function tested in core) and a fake `$APPIMAGE` in a temp dir: the
  AppImage is downloaded from
  `mochi.test`, hash-checked, renamed over the file, mode 0755; a wrong hash leaves the file alone;
  an unwritable directory gives the hint; `.deb` and AUR show their hint texts.
- **e2e** `tests/e2e/scenarios/m6a-update-n-to-n1.json` (nightly runner, full build, Xvfb):
  1. extract the nightly tarball (N) into a temp install; copy the build's `updater-xpcshell` over
     `updater` (Mozilla's practice; it trusts the libmar test key `mycert`); point `[AppUpdate] URL`
     in the copy's `application.ini` at `http://127.0.0.1:<port>/…`; start with
     `MOZ_DISABLE_NONLOCAL_CONNECTIONS=1`, the automation pref and `vimma.update.testKeys`;
  2. N+1 = N's tarball with a later `BuildID` in `application.ini` and a marker file, made into a
     complete MAR with `./mach repackage mar` and signed with `mycert`; the XML is generated by
     `tools/update/manifest.mjs` and signed with the test manifest key; served by a local HTTP
     server;
  3. build a profile: two workspaces, tabs, a split, a scroll position; `:update`; wait (control
     `state.update`) until staged; status bar shows `⇡ … on restart`;
  4. quit, start again (the startup applies the staged update and relaunches; the harness follows
     the new process through the control file); assert `appBuildID` is N+1's, the marker exists,
     and workspaces, tabs, split and scroll equal step 3 (as `m3-restart-restore`).
  5. **Downgrade**: serve N's build ID again with a newer serial → no update; serve a MAR whose
     product version is an older Firefox → `update.status` `failed: 23`.
  6. **Bad signature**: the **shipped** `updater` (our certificates) given the `mycert`-signed MAR
     → `failed: 19`; the Vimma verifier given an XML signed by an unknown key → no download.
- **Security rehearsal (exit test 2)**: with `AUTO_SECURITY_RELEASE=true` and a real Firefox
  security dot release, the tracking issue shows advisory → bump PR merged → release → `update.xml`
  served → a nightly-runner check that an installed previous release (kept on the runner) offers and
  stages it, with no human action between. Proven twice, as M7's gate was.

## Docs

- `docs/guide.md`: a new "Updates" section (after "Privacy defaults"): how each install type
  updates, the status-bar notices, the urgent `y/N` prompt, `:update` and `:restart`, that Vimma
  never restarts on its own, `[updates] check`, what a check sends, the AppImage keeping its file
  name; "Installing" loses "Vimma has no in-app updater"; the FAQ "Does Vimma update itself?"
  changes; "Privacy defaults" says Firefox's updater is built in and asks vimma.dev only.
  "config.toml" gains `[updates]` in "What applies live" and "Schema".
- `docs/runbook.md`, "Releases": key ceremony and where the public DERs and their hashes are;
  the chosen key option's setup (environment, OIDC/IAM or secret); `UPDATES_ENABLED`,
  `AUTO_SECURITY_RELEASE`; `SITE_DEPLOY_KEY` (a deploy key with write on `vimma-site` only); the
  Cloudflare Access bypass for `vimma.dev/updates/*`; rotation and the leaked-key procedure; how to
  pull a bad update: publish a newer serial with an empty `<updates/>` through `workflow_dispatch`
  of `update-publish.yml` (committing the previous `update.xml` again does not work: the replay
  rule refuses its older serial).
- `docs/security.md`: the update trust chain (TLS, signed XML, signed MAR, two key slots) and what
  each compromise allows.
- `docs/limits.md`: no partial MARs; `.deb` has no apt repository; the AppImage keeps its file name.
- README: feature list "updates itself (tarball, AppImage), signed with Vimma's own key; package
  installs get a hint"; Status unchanged until the first release. The maintainer adds the CHANGELOG
  line.

## Out of scope

Partial MARs; macOS, Windows and aarch64 manifests; an apt repository (open question 6); Flatpak;
a cookie-less download mirror; changing the remoting name or compile-time channel; a "Vimma does
not update itself" Fluent patch (no longer needed for tarballs); background updates while Vimma is
closed (Linux has no update agent).

## Open questions (the user's answers settle these; proposed default in bold)

1. **Where does the primary signing key live?** A GitHub secret, B the build runner or a token
   on it, C cloud KMS via OIDC. **C (GCP Cloud KMS, HSM), with a cold offline secondary**; the
   fallback is A with the same secondary.
2. Who generates and keeps the cold secondary key, and where? **You, offline, once, printed or on
   a USB stick in a safe; only its public DER enters the repo.**
3. One key for MARs and the manifest, or two? **One** (domain-separated); a second costs another
   key and rotation for little gain.
4. Turn on `AUTO_SECURITY_RELEASE` (auto-merge clean security bumps and their release PR)?
   **Yes, but only when the release gate lifts**; until then the pipeline is built and tested with
   it off.
5. Check interval: **12 h** (Firefox release's own), or keep today's 24 h?
6. `.deb` users: hint only (**default: "download the new .deb" with a link**), or host an apt
   repository on vimma.dev later (signed `Release` file, another key)?
7. Urgent prompt: **once per session, re-asked after 24 h, `y/N` in the command line**; or only the
   red status-bar segment?
8. `[updates] check = false` also hides the stale-feed warning? **Yes** (off means silent apart from
   `updates: off`).
9. Cloudflare Access: **add a bypass rule for `/updates/*`** before the first updater-enabled
   build ships, or wait for publication (nightly testers would then get no updates)?
