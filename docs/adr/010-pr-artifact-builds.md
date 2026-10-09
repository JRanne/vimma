# ADR-010: PRs run the mochitests on a Firefox artifact build, on hosted runners

- Status: Accepted
- Date: 2026-10-09

## Context

Plan §9 left open how PRs get a browser to test: `surfer build --ui` on a cached engine, or a
Firefox artifact build, and which works with the release source tarballs Surfer uses (ADR-002).
Until now `e2e.yml` was a no-op and every mochitest had run only on the maintainer's machine.
A full build is 22 GB of `engine/` and 39 min on 16 threads, far beyond a hosted runner (14 GB
disk). The repo becomes public (MPL-2.0); until then Actions minutes are limited.

## Decision

`e2e.yml` runs on `ubuntu-24.04` (GitHub-hosted) for PRs touching the browser or its tests:
`CI_SKIP_INIT=1 surfer download` (release tarball, no history) → `git init` of an empty
`engine/.git` → `npm run import` → `node tools/artifact-build/artifact-build.mjs` →
`npm run mochitest -- --artifact tests/browser/`.

`tools/artifact-build` derives `engine/mozconfig.artifact` from `engine/mozconfig` and builds in
`engine/obj-artifact`, with `MOZ_ARTIFACT_REVISION` read from the tarball's
`engine/sourcestamp.txt`. `mach` then fetches Mozilla's own shippable build of that release
(`gecko.v2.mozilla-release.shippable.revision.<rev>.firefox.linux64-opt`: `target.tar.xz`,
`target.common.tests.tar.zst`) and builds our front end on top.

Tests that only a full build can pass carry `skip-if = ["artifact"]` in `browser.toml`. The
nightly (full build, self-hosted) runs the whole suite, so they stay covered.

## Reasoning

Measured on Firefox 157.0.1 (docs/specs/m0-build-strategy.md has the numbers):

- **Artifact builds work from a release tarball.** `artifacts.py` normally walks VCS history to
  find pushheads, which a tarball lacks, but `MOZ_ARTIFACT_REVISION=<40-hex>` skips that, and
  `sourcestamp.txt` holds exactly the mozilla-release revision Mozilla's release build used.
  Our version display (0.x) selects the `mozilla-release` tree. Release tasks are indexed for a
  year, so the current release always resolves.
- **Fits a hosted runner.** 163 MB of artifacts; `obj-artifact` 0.6 GB; tree 4.7 GB unpacked.
  On `ubuntu-24.04` (2 CPU, private) the whole job is 5 min 27 s: unpack 66 s, artifact build
  198 s (CPU-bound front-end build), suite 27 s, with 6.3 GB disk left at the end. Locally a
  warm rebuild is 23 s.
- **Faithful for front-end code.** Everything we write (chrome JS, CSS, FTL, prefs, branding,
  patches to front-end files, `application.ini`, `AppConstants`) is built from our tree. 158 of
  159 assertions pass unchanged; the one left (`MOZ_CRASHREPORTER`) is compiled into libxul.
- **Safe once public.** Hosted runner, read-only token, no secrets, `pull_request` (not
  `pull_request_target`): a fork PR can run code only on GitHub's disposable VM.
- **Free once public.** Standard hosted runners are unlimited for public repos.

What an artifact build cannot carry, and how the tool adapts (each in `artifact-build.mjs`):

| Full-build setting                              | In an artifact build                                                                | Adaptation                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `--enable-optimize`, `--enable-hardening`       | configure: "not available in this configuration"                                    | dropped                                                                                       |
| `--disable-crashreporter`                       | configures, then Mozilla's libxul aborts at startup: missing `CrashService.sys.mjs` | dropped; `browser_vimma_crash_reporter.js` is `skip-if = ["artifact"]`                        |
| `--with-ccache`                                 | nothing to compile                                                                  | dropped                                                                                       |
| Binary `vimma`                                  | the launcher is `firefox`                                                           | `dist/bin/vimma` → `firefox` symlink                                                          |
| App data (`Name`, `Vendor`)                     | the launcher's compiled-in data is Mozilla's (`Firefox`, `Mozilla`)                 | tests run with `XUL_APP_FILE=dist/bin/browser/application.ini` (ours)                         |
| `MOZ_APP_UA_NAME=Firefox` (moz-configure.patch) | Mozilla's libxul has `""`, so the UA would end `Vimma/157.0.1`                      | that `application.ini` gets `UAName=Firefox`, the runtime field `nsHttpHandler` falls back to |

`MOZ_APP_VENDOR` and the version files are not compiled into libxul on Linux (they reach the
binary through `application.ini` and `AppConstants`), so they need nothing.

## Alternatives rejected

- **`surfer build --ui` on a cached engine (hosted).** The objdir is 20 GB, the repo cache limit
  10 GB, the runner disk 14 GB. A `--ui` build needs the whole objdir (backend, `dist/`, libxul);
  `dist/` alone cannot rebuild. Not possible.
- **Self-hosted runner for PR mochitests.** Runs PR code on the maintainer's machine. Acceptable
  only for same-repo PRs, never for forks once public; needs the machine online for every PR and
  a runner not yet registered; personal repos have no runner groups to fence it to one workflow.
  It would test the real build, but the artifact build already passes all but one compiled-in
  assertion, which the nightly covers.
- **Prebuilt package plus test package from the nightly.** A PR would have to overlay changed
  chrome files into `omni.ja`: our files go through `jar.mn`, the preprocessor, chrome manifests
  and the startup cache, i.e. the build system we would be re-implementing, plus a packaged
  `runtests.py` harness outside mach. It also depends on the nightly runner. More moving parts
  for the same fidelity as Mozilla's own artifact mode.
- **Artifact build with `MOZ_ARTIFACT_URL` to archive.mozilla.org.** The release directory has
  the package but no `common.tests` archive (the harness binaries: `certutil`, `xpcshell`,
  `ssltunnel`…); those exist only on Taskcluster, which the revision lookup reaches anyway.

## Consequences

- Every PR touching the browser runs the browser-chrome suite; PRs touching only docs or CI
  tooling skip it (paths filter), to save minutes while private.
- A test that needs a compiled-in define marks itself `skip-if = ["artifact"]` with a reason
  comment, and the nightly is where it runs. Keep that list short; review it in the patch audit.
- Depends on Mozilla's Taskcluster index for the release in `surfer.json`. Release tasks expire
  after a year, far longer than we stay on a release (ADR-002). If a lookup fails, the build
  fails loudly ("no built artifacts found"); it never falls back to a different revision.
- A patch to C++ or to compiled-in build config is not exercised by PRs, only by the nightly
  and local full builds. Such a patch needs an ADR line anyway (ADR-003).
- `engine/obj-artifact` also works locally, next to the full objdir: a front-end check in about
  half a minute instead of a full rebuild.
