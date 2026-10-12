# Spec: macos-build

Status: proposed (research done; not implemented; open questions below) · Milestone: "Later:
More platforms" (plan §6), split by this spec into sub-PRs that need no Mac and no money and
sub-PRs that wait (open question 3) · Area: `configs/macos/mozconfig`, `configs/branding/vimma/`,
`tools/artifact-build/`, `tools/e2e/`, `tools/mochitest.mjs`, `tools/start.mjs`,
`tools/vimma-ctl/src/discovery.rs`, `.github/workflows/{ci,e2e,nightly}.yml` and a new
`macos.yml`; small platform checks in `src/browser/base/content/vimma/` (config, theme, keys).
No upstream patch in the unsigned sub-PRs (decision 6). ADR: a new ADR-018 "macOS: cross-compiled
on Linux, arm64 first" with sub-PR 3.

Engine paths are relative to `engine/` (Firefox 157.0.1). Surfer paths (`S/`) are relative to
`node_modules/@zen-browser/surfer` (1.14.9). Zen references are `zen-browser/desktop`, branch
`dev`, read 2026-10-12. GitHub and Apple facts were read from their documentation on 2026-10-12;
anything not confirmed from a primary source is marked **unverified**.

## The user's words

2026-10-12: "do we have spec for first mac build?", and then: "we could write spec for macOS
build, i don't think Windows users are our target."

So: macOS is the second platform, and **Windows is not planned**. This PR changes plan.md's
"More platforms" row to say so (it said "Windows when cheap") and the matching line in
`docs/limits.md`.

Earlier decisions this spec keeps:

- **Release gate** (user, 2026-10-09): "we should not aim for publishing it before we have been
  daily driving it by ourselves." It matches the M6 gate (plan.md:249, "Firefox (stock)
  uninstalled for a week"). A macOS build therefore produces **CI workflow artifacts and, once
  the Linux nightly is switched on, a nightly `.dmg` only**. No GitHub Release, no Homebrew cask,
  no download link on vimma.dev until the user opens the gate.
- **Roadmap order** (plan.md:237): "M7's security work first, then M6 once Vimma has been
  daily-driven; macOS and Windows come later." M6a, the updater, is the top-priority next
  milestone (plan.md:248, user 2026-10-10: "it is very important feature"). This spec does not
  reorder anything; open question 3 proposes how the cheap parts could run earlier.
- **The updater is not settled** (spec PR #143, `docs/specs/m6a-updater.md`, open). It lists
  "macOS, Windows and aarch64 manifests" as out of scope. This spec says only where macOS plugs
  in (decision 9).

## User stories

- As a Vimma user on an Apple Silicon Mac, I can install a `.dmg` built by CI, open Vimma, and
  every Vimma key works as it does on Linux: `ctrl+b` is the prefix, the modal layer, hints,
  workspaces, panes, the side panel, the status bar, `prefix+?`.
- As a Mac user, `cmd+q` still quits (as `ctrl+q` does on Linux), and characters I type with
  Option (`{` is Option+shift+8 on a Finnish layout) match bindings for that character.
- As a Mac user without Omarchy, Vimma uses its built-in palette and follows the system's light
  or dark setting. Nothing complains that Omarchy or Hyprland is missing.
- As a Mac user, `vimma-ctl` finds my running Vimma the same way it does on Linux.
- As a Mac user, my `config.toml` lives where I expect a developer tool's config to live
  (open question 4).
- As the maintainer, a PR that breaks Vimma on macOS shows a red check, and I do not need a Mac
  to see it. A macOS build costs me nothing until I choose to sign it.
- As a tester before the release gate opens, I get an unsigned build from a CI run and a short
  note on how to open it past Gatekeeper.

## Research

### Surfer on macOS

- **Platform.** `process.surferPlatform` comes from `SURFER_PLATFORM`, else `process.platform`
  (`S/dist/index.js:5-11`); `darwin` maps to `macos` (`S/dist/commands/build.js:19-23`).
- **mozconfig.** `applyConfig` (`build.js:50-66`) concatenates `configs/common/mozconfig`,
  `configs/<os>/mozconfig`, an optional root `mozconfig` and Surfer's own block
  (`S/dist/constants/mozconfig.js:9-61`), whose only Mac line is
  `MOZ_MACBUNDLE_NAME="<brandShortName>.app"` (`mozconfig.js:55-60`).
- **Ours.** `configs/macos/mozconfig:1-9` is the Linux file plus `-j4`: no SDK, no `--target`,
  no signing. It has never been used. `configs/common/mozconfig` already has what a Mac build
  needs: `--enable-bootstrap` (line 20), `--disable-crashreporter` (24), `--disable-updater` (44).
  The Safe Browsing key default `$HOME/.config/vimma/keys/safebrowsing` (55) works on a Mac too.
- **`surfer build --ui`** is `./mach build faster` on every OS (`S/dist/cmds.js:42`,
  `build.js:88-90`).
- **Packaging.** `surfer package` runs `mach package` and `package-multi-locale`, and always
  builds a MAR (`S/dist/commands/package.js:40-155`). On macOS `mach package` makes a `.dmg`
  because `MOZ_PKG_FORMAT` defaults to `DMG` for cocoa (`toolkit/moz.configure:3748`). Our
  workflows already call `./mach package` directly (`nightly.yml:102-112`, `release.yml:131-135`).
- **No signing, no universal, no cross-compile in Surfer.** No `--target` option; `SURFER_COMPAT`
  only names Linux and Windows MARs (`S/dist/commands/updates/browser.js:44-60`).
- **Icons.** Surfer builds `firefox.icns` from `configs/branding/<brand>/logo-mac.png` with
  Apple's `iconutil`, **only when Surfer runs on a Mac** (`S/dist/commands/patches/branding-patch.js:68-80`).
  We have `logo-mac.png`; the `.icns` and the DMG background are still Surfer's `unofficial`
  copies (`docs/limits.md:335`). A Linux cross build needs the `.icns` committed.
- **Download.** `surfer download` needs GNU tar on a Mac (`S/dist/commands/download/firefox.js:46-52`,
  "brew install gnu-tar"). `surfer bootstrap` is `mach bootstrap` (`S/dist/commands/bootstrap.js:11-19`).

### Firefox's macOS build requirements

- **SDK 26.5 minimum** (`build/moz.configure/toolchain.configure:254-255`); configure stops on an
  older one (311). With `--enable-bootstrap` and no `--with-macos-sdk`, mach downloads
  `MacOSX26.5.sdk` from Mozilla's toolchain tasks (258-264;
  `taskcluster/kinds/toolchain/macos-sdk.yml:34-47`). Whether redistributing that SDK is allowed
  is **unverified**; we only fetch it, as every Firefox contributor does.
- **Deployment target** defaults to 11.0 for aarch64 and 10.15 for x86_64
  (`toolchain.configure:198-208`).
- **Mozilla builds macOS on Linux.** The build workers are `b-linux-docker-amd`
  (`taskcluster/kinds/build/macosx.yml:8`), with `build/macosx/cross-mozconfig.common:8-23`
  (cctools, clang, DMG tools, `--target=x86_64-apple-darwin`). Mozilla notarises on Linux with
  rcodesign (`taskcluster/docs/kinds.md:51-56`).
- **Building on a Mac** needs Xcode and "at least 30GB of free disk space"
  (firefox-source-docs, "Building Firefox On macOS").
- **Signing tool.** `mach macos-sign` (`tools/signing/macos/mach_commands.py:24`) signs ad hoc by
  default, or with a p12 via rcodesign (`--use_rcodesign`, 106). It carries
  `conditions=[conditions.is_firefox]` (line 40), which Zen patches out. Ad hoc plus
  `-e production` is refused because library-loading entitlements need a team ID ("the bundle
  will not be launchable", 204-245): **an unsigned build must use the `developer` entitlements**
  (`security/mac/hardenedruntime/developer/*.xml`).
- **Production entitlements** (`security/mac/hardenedruntime/production/firefox.browser.xml`)
  name Mozilla's team ID in `com.apple.application-identifier` (31-32) and ask for passkeys
  (`web-browser.public-key-credential`, 35), which need a provisioning profile. A signed Vimma
  needs its own copy with its own team ID.
- **Universal binaries** are Mozilla's `toolkit/mozapps/installer/unify.py` over two `.app`s
  (also `python/mozbuild/mozpack/unify.py`), not plain `lipo`.

### Zen's macOS pipeline

Zen cross-compiles both architectures on Linux and uses Macs only to profile and to unify, sign
and notarise:

- **Cross build**: `.github/workflows/macos-release-build.yml:39` runs on
  `blacksmith-8vcpu-ubuntu-2404` (a paid third-party runner), matrix `[x86_64, aarch64]` (47).
  It fetches `linux64-cctools-port`, `linux64-libdmg`, `linux64-hfsplus` with
  `mach artifact toolchain` (105-113), caches them (96-103), adds the Rust Darwin target (115-123)
  and bootstraps with `SURFER_PLATFORM=darwin` (137-141). Its `configs/macos/mozconfig` sets the
  cctools paths and DMG tools (10-23), `--target=aarch64-apple-darwin` (47-56), ThinLTO (52-53)
  and `-mcpu=apple-m1` (63). sccache is opt-in and was off in the run read.
- **PGO**: an instrumented build is profiled on real Macs (`macos-profile-build.yml:26`,
  `macos-26` and `macos-15-intel`), ad hoc signed with `codesign --force --deep --sign -` (85).
- **Unify, sign, notarise**: `macos-universal-release-build.yml:18` on `macos-26`; unify (178);
  `cargo install apple-codesign` (63); the p12 decoded from a secret (159-164) and imported
  (182-185); `mach macos-sign -r -c release -e production` (197); `make_dmg` (202-207); the DMG
  signed (217); `xcrun notarytool submit --apple-id --team-id --password --wait` (218-223);
  `xcrun stapler staple` (224). Secrets: `macOS_CERTIFICATES_P12_For_App_BASE64`,
  `macOS_CERTIFICATES_P12_PASSWORD`, `macOS_PROVISIONING_PROFILE`, `macOS_AppleDeveloperId`,
  `macOS_AppleAccountId`, `macOS_AppleDeveloperIdTeamId`, `macOS_AppleDeveloperIdPassword`.
- **Measured times** (`gh api …/actions/runs/<id>/jobs`, runs 37900069684 and 37495693564):
  one arch's cross build 28-53 min on 8 vCPU (the compile step about 28 min of it); profiling
  32-56 min; the unify job 34-45 min, of which brew plus `cargo install apple-codesign` 8.5 min,
  Firefox source download 13 min, unify 27 s, signing 29 s, notarise plus staple 6.5 min. The
  whole chain with PGO and two arches: 2 h 33 min to 3 h 15 min.

### GitHub-hosted macOS runners

From docs.github.com, "GitHub-hosted runners" reference and "Actions limits":

- "Use of the standard GitHub-hosted runners is free and unlimited on public repositories."
  Vimma is public, so macOS minutes cost **$0** (private repos pay $0.062 per macOS minute).
- **arm64**: 3 vCPU (M1), 7 GB RAM, **14 GB SSD**: `macos-latest`, `macos-14` (deprecated),
  `macos-15`, `macos-26`.
- **x86_64**: 4 vCPU, 14 GB RAM, 14 GB SSD: `macos-15-intel`, `macos-26-intel`. GitHub says it
  "will no longer support this architecture on macOS after the macOS 15 runner image is retired
  in Fall 2027" (changelog 2025-09-19); `macos-26-intel` was added later with no end date.
- Limits: 6 hours per job; on the free plan at most 5 concurrent macOS jobs.
- **Conclusion**: a native Firefox build on a hosted Mac does not fit (14 GB disk against the
  30 GB Firefox asks for, 3 cores). The hosted Macs are for running a build, not making one.

### Apple: Developer ID, notarisation, unsigned builds

- **Apple Developer Program**: 99 USD per membership year (developer.apple.com/programs/enroll,
  read from the search snippet; the page itself is script-rendered). It gives the Developer ID
  Application certificate that notarisation needs.
- **Notarisation** needs Developer ID signing, the hardened runtime and a secure timestamp
  ("Notarizing macOS software before distribution"). `xcrun notarytool submit … --wait`, then
  `xcrun stapler staple`; with an Apple ID it needs an app-specific password
  ("Customizing the notarization workflow"). API-key authentication (`--key`, `--key-id`,
  `--issuer`) and rcodesign's notarisation from Linux are **unverified** from the docs read.
- **Apple Silicon runs nothing unsigned**: "any executable must be signed before it's allowed to
  run … a simple ad-hoc signature is sufficient", but ad hoc binaries "cannot pass through
  Gatekeeper" (macOS Big Sur 11.0.1 universal apps release notes).
- **What a tester sees with an ad hoc build** downloaded from GitHub: macOS refuses to open it.
  Since Sequoia, "users will no longer be able to Control-click to override Gatekeeper … They'll
  need to visit System Settings > Privacy & Security" (Apple developer news, 2024-08-06) and
  press **Open Anyway** once. The alternative is `xattr -dr com.apple.quarantine /Applications/Vimma.app`
  (standard practice; no Apple page quoted, **unverified** wording). Tahoe (26) is assumed to
  behave as Sequoia (**unverified**). A file fetched with `gh run download` or `curl` carries no
  quarantine flag, so CI and a tester using `gh` are not blocked.
- **Secrets in CI** (GitHub's "Sign Xcode applications" guide): the p12 as a base64 secret, its
  password, a throwaway keychain (`security create-keychain`, `set-keychain-settings -lut 21600`,
  `import -f pkcs12`, `set-key-partition-list -S apple-tool:,apple:`) deleted in an `always()`
  step. With rcodesign the p12 never needs a keychain.

### Homebrew

- Homebrew 5.0 (brew.sh, 2025-11-12): "Casks without codesigning are deprecated. We will disable
  all Homebrew/homebrew-cask casks that fail Gatekeeper checks in September 2026." The official
  cask also needs notability (75 stars, or 225 for a self-submission; Package-Acceptance-Policy).
- "You don't need to sign software to put it in your own tap" (Homebrew discussion 6334): a
  `JRanne/homebrew-vimma` tap could carry an unsigned build, but Gatekeeper still stops the app
  on first open.

### Vimma's Linux-specific parts, and each one's macOS fallback

| Part                              | Where                                                                                                                                                                                                               | On macOS today                                                                                                                                                                                                       | Needed                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Omarchy theme                     | `ui/theme-host.mjs:27-29` (`~/.local/state/omarchy/current/theme`), `check()` 134-153                                                                                                                               | The directory is missing, so the built-in palette applies (149-152); its light variant follows `prefers-color-scheme` (5-14), so the system appearance switches it live. It still `stat`s the missing path every 2 s | Nothing for correctness. Stop the poll on macOS when the directory is missing (sub-PR 2), one `stat` per 2 s is cheap but pointless                                                  |
| Omarchy hook                      | `omarchy/OmarchyHook.sys.mjs:99-108`, `165-167`                                                                                                                                                                     | `~/.config/omarchy/hooks` is missing: `sync` returns `"no-omarchy"` and writes nothing                                                                                                                               | Nothing                                                                                                                                                                              |
| Hyprland private swap (#151)      | `host/private-swap.mjs:101-107` gate; `host/hypr/HyprIpc.sys.mjs:109-110`                                                                                                                                           | `isWayland` is false, so the gate says "not on Wayland" and the private workspace opens as its own window (private-workspace.md behaviour), silently                                                                 | Nothing; a test that the gate holds on macOS                                                                                                                                         |
| Private window position           | `host/private-ops.mjs:153-154`                                                                                                                                                                                      | Not Wayland, so `screenX`/`screenY` are passed and the window opens over the normal one                                                                                                                              | Nothing                                                                                                                                                                              |
| Wayland wake lock (PR #153, open) | `services/WakeLock.sys.mjs:27-34` on `fix/wayland-idle-inhibit`                                                                                                                                                     | Returns unless `platform === "linux"`; macOS uses Firefox's own `IOPMAssertion` wake lock (`widget/cocoa/nsAppShell.mm`)                                                                                             | Nothing                                                                                                                                                                              |
| config.toml path                  | `config/ConfigHost.sys.mjs:6`, `57-65`                                                                                                                                                                              | `$XDG_CONFIG_HOME/vimma/config.toml`, else `~/.config/vimma/config.toml`. It works on macOS as is                                                                                                                    | Decide (open question 4)                                                                                                                                                             |
| Profile directory                 | Firefox, not Vimma: `toolkit/xre/nsXREDirProvider.cpp:1122-1135` (Application Support), `1587-1595` ("MacOS ignores the vendor")                                                                                    | Profiles live in `~/Library/Application Support/Vimma/` (with `profiles.ini`), not `~/.config/vimma/vimma`                                                                                                           | `vimma-ctl` must look there (next row)                                                                                                                                               |
| vimma-ctl discovery               | `tools/vimma-ctl/src/discovery.rs:57-72`                                                                                                                                                                            | Looks only in `$XDG_CONFIG_HOME/vimma/vimma` and `~/.vimma/vimma`, so on macOS **it cannot find the profile** without `--profile` or `VIMMA_PROFILE`                                                                 | Add the macOS root under `cfg(target_os = "macos")` (sub-PR 2)                                                                                                                       |
| vimma-ctl stale check             | `discovery.rs:214-229`                                                                                                                                                                                              | `/proc/<pid>` on Linux only; elsewhere every discovery file counts as live, and the handshake still protects the token (211-213)                                                                                     | `kill(pid, 0)` on every Unix (sub-PR 2)                                                                                                                                              |
| Control socket                    | `ctl/VimmaControl.sys.mjs:638-644`                                                                                                                                                                                  | TCP on 127.0.0.1 with a discovery file in the profile, not a Unix socket: portable as is                                                                                                                             | Nothing                                                                                                                                                                              |
| vimma-ctl in CI                   | `ci.yml:69-81`                                                                                                                                                                                                      | Built and tested on `ubuntu-latest` only                                                                                                                                                                             | A `macos-latest` cargo job (sub-PR 2)                                                                                                                                                |
| Keys: accel                       | `host/firefox-keys.mjs:50-52`, `core/firefox-keys.mjs:31, 59-70, 119-121`                                                                                                                                           | `accel` is meta; `disable = "all"` keeps `cmd+q`                                                                                                                                                                     | Nothing in core; the inventory (below)                                                                                                                                               |
| Keys: Option characters           | `core/keys.mjs:386-406`; `widget/cocoa/nsCocoaUtils.mm:662, 730` (Option sets AltGraph)                                                                                                                             | Option+shift+8 is `{` and matches a `{` binding (key-handling-batch.md §3)                                                                                                                                           | Consequence: an `alt+j` binding never fires on a Mac, because Option+j types `∆` and is folded to it. No default binding uses alt; a user's might. Documented limit, open question 6 |
| Keys: text bindings               | `host/VimmaHost.sys.mjs:135, 1426`; `widget/cocoa/NativeKeyBindings.mm:87`                                                                                                                                          | Cocoa already makes `ctrl+h` a backspace, so Vimma adds none (key-handling-batch.md:111-112)                                                                                                                         | Nothing                                                                                                                                                                              |
| Keys: native menu bar             | `widget/cocoa/nsMenuItemX.mm:318-354`                                                                                                                                                                               | The Mac menu bar takes each item's key equivalent from its `<key>` element. Whether turning a `<key>` off (firefox-keys) also clears the menu's equivalent is **unverified**                                         | Check by hand (test plan); the firefox-keys inventory (PR #138) lists Linux keys only ("Every key that does something in a Linux browser window today") and needs a macOS column     |
| Dev tools                         | `tools/start.mjs:40` (Linux objdir), `197` (`/proc/locks`); `tools/mochitest.mjs:53` (`dist/bin/browser/application.ini`)                                                                                           | Wrong paths on a Mac                                                                                                                                                                                                 | Platform paths (sub-PR 1)                                                                                                                                                            |
| Artifact builds                   | `tools/artifact-build/artifact-build.mjs:122` (`…firefox.linux64-opt`), `214` (`dist/bin` launcher symlink)                                                                                                         | mach itself supports a Mac host: `macosx64-aarch64` from `TARGET_CPU` (`python/mozbuild/mozbuild/artifacts.py:1436-1440`), `MacArtifactJob` fetching `target.dmg` (764-765, 1035)                                    | The namespace and the `.app` layout (sub-PR 1)                                                                                                                                       |
| e2e harness                       | `tools/e2e/launcher.mjs:29, 161-183` (Linux paths), `266-372` (Xvfb); `e2e.mjs:128` (Xvfb when `DISPLAY` is unset, which is always on a Mac); screenshots from Xvfb's XWD framebuffer (`screenshot.mjs`, `xwd.mjs`) | Would try to start Xvfb                                                                                                                                                                                              | `MOZ_HEADLESS=1` on macOS (Firefox's headless widget, `widget/headless/`), the `.app` binary path, screenshots off (sub-PR 4)                                                        |
| Packaging                         | `tools/package/` (tarball, AppImage, `.deb`, AUR)                                                                                                                                                                   | Linux only                                                                                                                                                                                                           | The `.dmg` from `mach package` (sub-PR 3)                                                                                                                                            |

## Decisions

1. **arm64 first, Apple Silicon only** (open question 1). Every Mac sold since 2023 is Apple
   Silicon; GitHub retires Intel macOS images from Fall 2027; one architecture halves build time.
   x86_64 and a universal `.dmg` (via `unify.py`) come only if a tester needs one.
2. **Cross-compile on Linux; never build on a hosted Mac.** As Mozilla and Zen do. The hosted
   arm64 Mac has 14 GB of disk and 3 cores, and Firefox asks for 30 GB. `configs/macos/mozconfig`
   gains `--target=aarch64-apple-darwin` and Mozilla's cross tools via `--enable-bootstrap`
   (SDK 26.5, cctools, libdmg, hfsplus); it stays a Mac-host mozconfig too, so a contributor with
   a Mac can build natively. It runs on the **self-hosted `vimma-build` runner**, next to the Linux
   nightly (`nightly.yml:26`), with the same sccache. A hosted `ubuntu-24.04` runner (4 vCPU) is
   the fallback, at about two to three times Zen's 8-vCPU times (estimate).
3. **Hosted Macs run what was built.** A `macos-15` (arm64) job downloads the `.dmg` artifact,
   mounts it, launches Vimma headless and runs a smoke e2e through `vimma-ctl`. Free on a public
   repo.
4. **Front-end tests on a Mac without building Firefox.** `tools/artifact-build` learns the macOS
   namespace (`gecko.v2.mozilla-release.shippable.revision.<rev>.firefox.macosx64-aarch64-opt`,
   to confirm in sub-PR 1) and the `.app` layout, so a `macos-15` runner gets Mozilla's own build
   of the same release with our chrome on top, as ADR-010 does on Linux. That runs the Vitest
   suite and the mochitests (headless) on a real Mac on every PR, with no Apple account.
5. **Unsigned (ad hoc) until the user buys a Developer ID** (open question 2). The build is ad
   hoc signed with the `developer` entitlements (research: `mach macos-sign` refuses ad hoc with
   `production`), which is enough to run on Apple Silicon. Testers are told about Open Anyway
   and `xattr` (Docs). Passkeys need the production entitlements and do not work in these builds.
6. **No upstream patch for signing.** Instead of patching `conditions.is_firefox` out of
   `mach macos-sign` (Zen's patch), the workflow runs `rcodesign sign` (ad hoc, then p12) with our
   own entitlements files in `configs/macos/entitlements/`. If that proves wrong in sub-PR 3, the
   patch needs its line in ADR-018 per CLAUDE.md.
7. **Release gate.** The macOS `.dmg` is a workflow artifact (90-day retention) on `macos.yml`
   runs. When the Linux nightly is switched on (`NIGHTLY_ENABLED`, the user's call) the `.dmg`
   joins the same rolling nightly. Nothing goes in a GitHub Release, a Homebrew cask, or
   vimma.dev until the user opens the gate. `release.yml` gets no macOS job in this spec.
8. **Linux-only features stay Linux-only and fail quietly**, as the table above lists: the
   built-in palette and the system appearance instead of Omarchy, a separate window instead of
   the Hyprland swap, Firefox's own wake lock. `about:vimma` already says why the swap is off;
   it should also say "Omarchy theme: not found" rather than nothing.
9. **Updater (M6a) on macOS: later, and only signed.** Firefox's updater on macOS uses the same
   `update.xml` and MAR format. M6a would add a `Darwin_aarch64-gcc3` manifest path (the
   `%BUILD_TARGET%` value is to be confirmed in M6a) and a `.app`-based MAR (Surfer already
   names one `macos.mar`, `S/dist/commands/updates/browser.js:53-54`). An update rewrites files
   inside the signed bundle, so updating an ad hoc or unsigned app breaks its signature (to be
   confirmed in M6a). **Recommendation**: no updater for unsigned macOS builds; testers reinstall
   the `.dmg`. M6a decides the rest.
10. **Branding**: commit `configs/branding/vimma/firefox.icns` generated from `logo-mac.png`
    (Surfer only makes it on a Mac host) and a Vimma DMG background, replacing the `unofficial`
    copies.

## Sub-PRs

Each is its own spec-sized PR, in this order. 1 and 2 need no Mac, no money and no full build.

1. **`ci(macos): front-end tests on a mac runner`.** `artifact-build.mjs` picks the namespace and
   `.app` layout by platform; `mochitest.mjs` and `start.mjs` learn the macOS objdir paths and
   drop `/proc/locks` on macOS (`lsof` or the `lock` symlink only). New job in `e2e.yml` on
   `macos-15`: `npm ci`, Vitest, artifact build, the mochitest suite headless. Non-blocking at
   first (open question 7).
2. **`fix(macos): platform fallbacks`.** vimma-ctl's macOS profile root and `kill(pid, 0)`
   stale check, with tests; a `macos-latest` cargo job in `ci.yml`; the theme poll stops on macOS
   while Omarchy is absent; `about:vimma` lines; the config path per open question 4; a macOS
   test for the swap gate. TDD as usual.
3. **`build(macos): an arm64 cross build`.** ADR-018. `configs/macos/mozconfig` for the cross
   build; `macos.yml` (`workflow_dispatch` and a weekly schedule, then nightly with the Linux
   nightly): on `vimma-build`, `npm run import`, `surfer build`, `./mach package` → `.dmg`, ad hoc
   `rcodesign` with developer entitlements, upload as an artifact. Branding `.icns` and DMG
   background.
4. **`test(macos): smoke the dmg on a mac`.** A `macos-15` job after sub-PR 3: mount the `.dmg`,
   `codesign --verify`, launch with `MOZ_HEADLESS=1`, run `m0-happy-path` and `m0-content-actor`
   through `vimma-ctl`. The e2e launcher learns `MOZ_HEADLESS` instead of Xvfb on macOS, the
   `.app` binary path and "no screenshots".
5. **`docs(macos): keys inventory`.** The macOS column of the firefox-keys inventory (with
   PR #138's spec), the native menu bar check, Option/alt limits in docs/guide.md.
6. **Gated: `build(macos): developer id and notarisation`.** Only after the user enrols. Developer
   ID p12 and an App Store Connect API key (or app-specific password) as secrets in a protected
   `macos-signing` environment with the user as required reviewer; `rcodesign sign` with Vimma's
   production entitlements (own team ID, provisioning profile for passkeys); `notarytool submit
--wait`; `stapler staple`. Release `.dmg` in `release.yml` only when the gate opens.
7. **Later, not specced here**: x86_64 or universal; the updater manifest (M6a); a Homebrew tap,
   then the official cask once signed and notable.

### Time and cost

| Item                                                            | Time per run                                                                                                                                   | Cost                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Sub-PR 1 job (Vitest + artifact build + mochitests, `macos-15`) | 20-30 min (estimate; the Linux job's limit is 45 min, `e2e.yml:46`)                                                                            | $0 (public repo)                       |
| Sub-PR 2 cargo job (`macos-latest`)                             | ~3 min                                                                                                                                         | $0                                     |
| Sub-PR 3 cross build, arm64, `vimma-build`                      | Cold 45-60 min, warm sccache 15-25 min (estimate from the 40-min Linux build on 16 threads, `docs/guide.md:35`, and Zen's 28-53 min on 8 vCPU) | $0, the maintainer's machine and power |
| Same on hosted `ubuntu-24.04` (fallback)                        | 1.5-2.5 h (estimate)                                                                                                                           | $0                                     |
| Sub-PR 4 smoke on `macos-15`                                    | ~10 min                                                                                                                                        | $0                                     |
| Sub-PR 6 signing + notarisation                                 | +7 min (Zen: sign 29 s, notarise and staple 6.5 min)                                                                                           | 99 USD a year                          |

Total until the user enrols: **$0**, about one hour of the self-hosted runner per macOS build.

## Test plan

Gate for calling a macOS build "working" (proposal): **unit tests, a build that launches, and a
smoke e2e**, all on a hosted Mac.

- **Vitest** on `macos-15` (sub-PR 1): the whole `vimma-core` suite, unchanged. Core is pure, so
  any failure is a test that assumes Linux.
- **New unit tests first** (sub-PR 2): `discovery.rs` finds `~/Library/Application Support/Vimma/profiles.ini`
  under `cfg(target_os = "macos")`; the stale check reports a dead pid on macOS; ConfigHost's path
  per question 4; the theme host stops polling when the Omarchy directory is missing on macOS;
  the swap gate returns "not on Wayland" on macOS.
- **Mochitests** on `macos-15`, headless, artifact build (sub-PR 1). Expected trouble: tests that
  synthesise `ctrl+…` and assume `accel` is ctrl; tests that depend on GTK. Each failure is fixed
  or marked `skip-if = os == "mac"` with an issue, never loosened.
- **Build launches** (sub-PR 4): `hdiutil attach`, `codesign --verify --deep`, the binary starts
  headless with the control socket, `vimma-ctl version` answers.
- **Smoke e2e** (sub-PR 4): `m0-happy-path` and `m0-content-actor` through `vimma-ctl` under
  `MOZ_HEADLESS=1`. No screenshot baselines on macOS.
- **Hand checks on a real Mac** (open question 5): Gatekeeper's Open Anyway flow on the current
  macOS; `ctrl+b` prefix and every `prefix+` key; Option-composed `{` `}` `[` `]` `@` `|` `~` on a
  Finnish layout; `cmd+q`, `cmd+w`, `cmd+t`, `cmd+l` with `[firefox] disable = "all"` and with the
  defaults; the native menu bar's key equivalents after firefox-keys turns keys off; fullscreen
  and split panes; system dark/light switching the built-in palette live; `vimma-ctl` with no
  flags.

## Docs

In this PR:

- `plan.md` §6: the "More platforms" row says "macOS build + notarisation (spec
  `docs/specs/macos-build.md`); aarch64; Windows: not planned (user, 2026-10-12)", and the
  order line drops Windows.
- `docs/limits.md` "Platforms and packaging": Windows is not planned.

With the sub-PRs:

- `docs/guide.md` "Getting started": a macOS section (where the `.dmg` comes from, Open Anyway,
  `xattr`, Apple Silicon only, unsigned so no passkeys); "Keys": Option and alt on a Mac, `cmd` as
  accel; "config.toml": the macOS path; "Scripting with vimma-ctl": the profile location.
- `docs/limits.md`: macOS limits (unsigned, no updater, no Omarchy, no Hyprland swap, Intel not
  built).
- README "Status": "Linux x86_64; macOS arm64 in CI" once sub-PR 4 is green; the feature list
  only if what works changes.
- `CONTRIBUTING.md`: building on a Mac (Xcode, `brew install gnu-tar`, 30 GB disk) and the cross
  build.
- `docs/runbook.md`: enabling `macos.yml`; later, enrolling, rotating the certificate, the
  signing environment.
- ADR-018 (sub-PR 3).

## Out of scope

- Windows (not planned, user 2026-10-12).
- A public macOS release, a cask, a vimma.dev download (release gate).
- PGO and LTO tuning, x86_64 and universal builds (decision 1).
- The macOS updater beyond decision 9 (M6a).
- Mac App Store distribution.
- Mac-native integrations: Handoff, Touch Bar, Services menu, a global hotkey.

## Open questions (the user's answers settle these; recommendation in bold)

1. **arm64 only, or universal?** **arm64 only.** Apple Silicon is every current Mac, GitHub
   retires Intel images from Fall 2027, and a universal build doubles the build and the download.
   Add x86_64 (and `unify.py`) if a real tester has an Intel Mac.
2. **Buy the Apple Developer ID (99 USD a year) now, or ship unsigned test builds first?**
   **Unsigned first.** Until the release gate opens, the only users are you and testers who can
   press Open Anyway once. Enrol when the gate is in sight, since a public Mac download without
   notarisation is a poor first impression and the Homebrew cask needs it. Enrolment can take
   days, so start it a few weeks before.
3. **Change the roadmap order?** **Keep M6a, then M6, then macOS, but let sub-PRs 1 and 2 run now
   as a parallel lane.** They cost nothing, need no full build, and find Linux assumptions while
   the code is fresh. Sub-PRs 3-4 (the self-hosted cross build) after M6a, so the updater's MAR
   and manifest work is designed with a second platform in view. Sub-PR 6 when the gate nears.
4. **config.toml on macOS: `~/.config/vimma/config.toml` or `~/Library/Application Support/Vimma/config.toml`?**
   **`~/.config/vimma/config.toml`**, honouring `XDG_CONFIG_HOME`, as on Linux. Vimma's users are
   keyboard-first developers whose Neovim, tmux, Ghostty and Alacritty configs already live in
   `~/.config` on a Mac, one dotfiles repo then works on both, and it needs no code change. The
   profile stays where Firefox puts it (`~/Library/Application Support/Vimma/`).
5. **Do you have a Mac to test on?** **If yes, an Apple Silicon one is enough** and the hand checks
   above run there. If not, CI covers launch and smoke, but keys, Gatekeeper and the menu bar
   need a person: borrow one, or ask one trusted tester, before a Mac build is called working.
   A rented cloud Mac is a last resort.
6. **`alt+<letter>` bindings on a Mac.** Option+j types `∆`, so a user's `alt+j` never fires
   there. **Document it for now** (Option is for characters on a Mac, as in every Mac terminal
   by default); a "Option as alt" setting, matching on the physical key, can follow if users ask.
7. **Is the macOS front-end job required for merging?** **Not at first.** Informational for two
   weeks, then required once it has been green and not flaky, like the Linux e2e job.
8. **Where does the cross build run?** **The self-hosted `vimma-build` runner**, with its sccache,
   as the Linux nightly does. The hosted `ubuntu-24.04` runner is free but slow and its disk is
   tight; a paid 8-vCPU runner (Zen uses Blacksmith) is not worth it for test builds.
