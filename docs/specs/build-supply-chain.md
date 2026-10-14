# Spec: build-supply-chain

Status: draft · Area: `package.json`, `package-lock.json`, `.npmrc` (new),
`.github/dependabot.yml`, `.github/workflows/dependabot-automerge.yml`,
`.github/workflows/release.yml`, `.github/workflows/nightly.yml`, `.github/workflows/e2e.yml`,
`.github/workflows/sites.yml`, `.github/workflows/upstream.yml`,
`tools/upstream/verify-sha512.py`, `tools/upstream/source-check.sh`,
`tools/upstream/firefox-source.sh` (new), `tools/upstream/mozilla-release-key.asc` (new),
`tools/upstream/mozilla-key-check.py` (new), `tools/deps/release-path.mjs` (new),
`docs/security.md`, `docs/runbook.md`, `docs/rebase.md`, `CONTRIBUTING.md` · Upstream patches:
none · ADR: ADR-021 (new, "Mozilla's release key is the trust anchor for the Firefox source");
[ADR-001](../adr/001-engine-firefox-surfer.md) gains one paragraph on how Surfer is pinned

## Summary

Vimma's binaries are built from three inputs: Mozilla's Firefox source tarball, Vimma's own
repository, and the npm packages that drive the build, chiefly Surfer. This spec closes the gaps
between those inputs and the binaries `release.yml` and `nightly.yml` publish. The Firefox source
is accepted only when its hash is listed in a `SHA512SUMS` signed by Mozilla's release key; every
build starts from a source tree it extracted and verified itself; Surfer and every other package
that runs in the release build are pinned exactly, reviewed by a person on every change, and
installed without install scripts; and the self-hosted build machine, its secret and its trust
boundary are written down as tested rules in `docs/security.md`.

## Problem

The release build runs on one self-hosted machine. What it uploads is packaged, signed with
cosign and given an SBOM by GitHub-hosted jobs, but those jobs sign whatever the build job
produced: a signature proves that `release.yml` at the release tag published the file, not that
the file was built from Mozilla's source and Vimma's code alone. Once security releases ship with
no person in the loop ([firefox-versions](firefox-versions.md), ADR-020), nothing but the build
pipeline stands between a tampered input and every user. Today:

1. **The release and nightly builds do not verify the Firefox source.** `release.yml` (lines
   82–89) and `nightly.yml` (lines 44–52) run `npx surfer download --force` and nothing else.
   Surfer checks no hash (Research, R3). Only `upstream.yml`, `e2e.yml` and `sites.yml` compare
   the tarball with Mozilla's `SHA512SUMS`, and none of them checks the signature on
   `SHA512SUMS`: `tools/upstream/verify-sha512.py`'s docstring and `docs/rebase.md` ("We do not
   check the GPG signature on `SHA512SUMS`: HTTPS from archive.mozilla.org is the trust anchor")
   say so.
2. **A cached engine is trusted by its label.** Both workflows check out with `clean: false` and
   skip the download when `engine/.vimma-firefox-version` matches `surfer.json`. Anything that
   changed a file under `engine/` or `.surfer/` between runs is built into the next nightly and
   release. Surfer itself reuses `.surfer/engine/firefox-<version>.source.tar.xz` whenever that
   file exists (R3).
3. **Surfer is a floating, auto-mergeable dependency of the build.** `package.json` has
   `"@zen-browser/surfer": "^1.14.9"`. `dependabot-automerge.yml` holds back Surfer's own
   version updates, but auto-merges a security update to Surfer and any version or security
   update to one of the packages Surfer runs (`axios`, `sharp`, `execa` and the rest of its
   closure, R5). Both build workflows then run `npm ci` with install scripts enabled.
4. **`npx surfer` can install a different package.** When `node_modules/.bin/surfer` is missing,
   `npx` installs the package named on the command line, and in CI it does so without asking
   (R4). The npm package `surfer` is an unrelated 2022 package by another publisher.
5. **The build machine's boundary is not written down.** The runbook says a self-hosted runner
   must never be attached to a public repository that takes fork pull requests, and the
   repository is now public. The Safe Browsing key is a repository secret that any workflow file
   on any pushed branch can read; only `if:` conditions inside the workflow files keep it in the
   two build jobs. No test stops a future workflow from running pull request code on the build
   machine.

The build machine is not live yet: no runner is registered and neither `NIGHTLY_ENABLED` nor
`RELEASE_ENABLED` is set (GitHub API, read 2026-10-14). This spec is meant to land before it is.

## Behaviour

The change is to CI; its observable behaviour is what the workflows accept, refuse and run.

1. **The Firefox source is verified before use.** A nightly or release build must fail,
   before `engine/` is created, when the source tarball's SHA-512 is not the one listed for it in
   that version's `SHA512SUMS`, or when `SHA512SUMS.asc` is not a good signature by a valid
   signing subkey of Mozilla's release key `14F26682D0916CDD81E37B6D61B7B526D98F0353`. A
   signature by a revoked or expired subkey, by another key, or no signature at all, fails.
2. **Every build verifies.** `e2e.yml`, `sites.yml`, `upstream.yml`, the Beta canary,
   `nightly.yml` and `release.yml` all obtain Firefox source through the same two scripts, so the
   same check (behaviour 1) applies to every one of them. No workflow calls `surfer download`
   directly.
3. **No build reuses a source tree.** The nightly and the release build delete `engine/` and
   extract it again, in the same job, from the tarball that job verified.
   `engine/.vimma-firefox-version` is no longer written or read.
4. **Builds start from a clean workspace.** The nightly and the release build start from a
   workspace in which every untracked and ignored file is deleted, except the cached source
   tarball, which is verified before use (behaviour 1). They then install a fresh
   `node_modules` and extract a fresh `engine/`. The release also builds in a fresh objdir with
   an empty compiler cache.
5. **Surfer is pinned exactly.** `package.json` names one Surfer version, with no range, and
   `package-lock.json` pins it and every package it depends on by integrity hash.
6. **No release-path package merges without a person.** A Dependabot pull request that
   changes Surfer, `ajv`, or any package either of them depends on, by a version update or a
   security update, is never set to auto-merge. Its CI shows the diff between the published
   packages of the old and the new version.
7. **No install scripts.** No `npm ci` or `npm install` in the repository runs package
   install scripts; `release.yml` and `nightly.yml` also pass `--ignore-scripts` explicitly.
   They run Surfer only from `node_modules` and fail if it is missing.
8. **Only the two build jobs use the build machine.** Only the `build` jobs of `nightly.yml`
   and `release.yml` run on the self-hosted runner. No workflow that a pull request, a push or
   another workflow can start uses it.
9. **The Safe Browsing key is confined.** The key is an environment secret of the `build`
   environment, which only `main` and `v*` tags may use. Only the two build jobs name that
   environment.
10. **Mozilla's key changes are noticed.** When Mozilla's published key has a subkey or a
    revocation that Vimma's pinned copy lacks, or the pinned signing subkey expires within 60
    days, `upstream.yml` opens an issue labelled `security`.
11. **Surfer fetches nothing unverified.** `surfer.json` lists no add-ons, so
    `surfer download` never fetches an add-on from addons.mozilla.org or GitHub, which it would
    do with no hash check.

## Research

**R1. Mozilla's release signing key.** Mozilla's security blog, "Updated GPG key for signing
Firefox and Thunderbird Releases" (2026-08-10,
`https://blog.mozilla.org/security/2026/08/10/updated-gpg-key-for-signing-firefox-and-thunderbird-releases/`),
gives the primary key fingerprint `14F2 6682 D091 6CDD 81E3 7B6D 61B7 B526 D98F 0353` and a new
signing subkey `827E 6586 0867 9618 CD34 9F93 678E 455D 7676 7AA3`, expiring 2028-08-05. The
previous subkey was revoked after an unencrypted copy of it was committed to a private GitHub
repository; the key signs Linux tarballs, RPM packages and checksum files. The blog names two
places to obtain the key: the `KEY` file of the latest Nightly
(`https://archive.mozilla.org/pub/firefox/nightly/latest-mozilla-central/`) and
keys.openpgp.org. Checked with GnuPG 2.4.9 on 2026-10-14, importing
`https://archive.mozilla.org/pub/firefox/releases/158.0/KEY` (31,916 bytes):

- Primary `rsa4096/61B7B526D98F0353`, created 2015-07-17, uid
  `Mozilla Software Releases <release@mozilla.com>`, fingerprint as above.
- Eight signing subkeys: six expired (2015 to 2023 generations);
  `09BEED63F3462A2DFFAB3B875ECB6497C1A20256` (created 2025-03-13), revoked on 2026-08-06 with
  reason code 2, "Key has been compromised", comment "We no longer trust this key."; and
  `827E658608679618CD349F93678E455D76767AA3` (created 2026-08-06, expires 2028-08-05).
- The `KEY` files of 156.0, 157.0.1 and 158.0 are byte-identical.

**R2. `SHA512SUMS.asc` and what `gpgv` reports.** Each release directory has `SHA512SUMS` and a
detached signature `SHA512SUMS.asc` beside it (158.0: 630,944 and 833 bytes); the source tarball
also has its own `.asc`. Verified with `gpgv` (GnuPG 2.4.9) against a keyring exported from R1:

| Release | Signed     | Subkey             | `gpgv` exit | Status lines                       |
| ------- | ---------- | ------------------ | ----------- | ---------------------------------- |
| 158.0   | 2026-10-08 | `827E…7AA3`        | 0           | `GOODSIG`, `VALIDSIG`              |
| 157.0.1 | 2026-10-05 | `827E…7AA3`        | 0           | `GOODSIG`, `VALIDSIG`              |
| 156.0   | 2026-09-10 | `827E…7AA3`        | 0           | `GOODSIG`, `VALIDSIG`              |
| 159.0b1 | (Beta)     | `827E…7AA3`        | 0           | `GOODSIG`, `VALIDSIG`              |
| 153.0   | 2026-07-16 | `09BE…0256` (rev.) | **0**       | `REVKEYSIG`, `VALIDSIG`, no `GOOD` |

The last row is the important one: for a signature by the revoked, compromised subkey, both
`gpgv` and `gpg --verify` print "Good signature" and exit 0. Only the machine-readable status
(`--status-fd`) tells the cases apart: `REVKEYSIG` instead of `GOODSIG`. A verifier that trusts
the exit status would accept a `SHA512SUMS` signed with the compromised subkey. `gpgv` does not
read ASCII-armoured keyrings ("Can't check signature: No public key" with Mozilla's armoured
`KEY` file, still exit 0), so the keyring it is given must be binary.

**R3. Surfer's download.** In Surfer 1.14.9 (`node_modules/@zen-browser/surfer/dist/`):
`downloadFirefoxSource` (`commands/download/firefox.js:88-114`) returns early with "Using cached
download" when `.surfer/engine/firefox-<version>.source.tar.xz` exists, and otherwise downloads
it; nothing in the command reads `SHA512SUMS` or a signature. `downloadInternals`
(`firefox.js:115-155`) deletes `engine/` only with `--force`, extracts only when `engine/` is
absent, and then downloads every add-on in `surfer.json` from addons.mozilla.org or the GitHub
API (`commands/download/addon.js:30,41`), again with no hash check. Vimma's `surfer.json` has
`"addons": {}`. Unpacking runs `tar --strip-components=1 -xf`; without `CI_SKIP_INIT` Surfer then
makes `engine/` a git repository and commits the whole tree (`firefox.js:30-32`), which accounts
for most of the 12.5 minutes `docs/runbook.md` records for `surfer download`; with
`CI_SKIP_INIT=1` spec m0-build-strategy measured 71 s (4 s download, 66 s unpack) on a hosted
runner.

**R4. npm behaviour (npm 10.9.4, Node 22.21.0).** From npm's documentation for v10:

- `npm ci`: "If a `node_modules` is already present, it will be automatically removed before
  `npm ci` begins its install." So both build jobs already get a fresh `node_modules`.
- `--ignore-scripts` / `ignore-scripts`: "If true, npm does not run scripts specified in
  package.json files." Scripts run by name (`npm run x`) still run; their `pre`/`post` scripts do
  not. `package.json` has no `pre*` or `post*` scripts.
- `npm exec` (`npx`): packages not in the local project are installed into the npm cache, and
  "When standard input is not a TTY or a CI environment is detected, `--yes` is assumed."
  `--no` refuses instead. `npm view surfer` on 2026-10-14: version 0.0.2, maintainer
  `fractal`, last modified 2022-06-27.

**R5. What runs in the release build job, and whether it needs install scripts.** From
`package-lock.json` at `origin/main` (30bf67e):

- The build job runs `tools/package/package.mjs`, `tools/sync-core.mjs`,
  `tools/version-files/version-files.mjs`, `tools/import/restore-patched.mjs` and
  `tools/package/sbom.mjs` (Node built-ins only), `tools/package/validate-sbom.mjs` (imports
  `ajv`), and Surfer (`download`, `config brand`, `import`, `build`).
- **Surfer 1.14.9** has 22 direct dependencies: `@resvg/resvg-js` 1.4.0, `async-icns` 1.0.2,
  `axios` 1.20.0, `chalk` 4.1.2, `cli-progress` 3.12.0, `commander` 6.2.1, `execa` 5.1.1,
  `fast-extract` 1.14.11, `fs-extra` 10.1.0, `ini` 3.0.1, `is-apple-silicon` 1.0.1, `kleur`
  4.1.5, `modern-async` 1.1.5, `mount-dmg` 1.0.1, `picomatch` 2.3.2, `png-to-ico` 2.1.8,
  `prompts` 2.4.2, `rustic` 1.2.2, `semver` 7.8.5, `sharp` 0.35.5 (forced by the root
  `overrides`), `tiny-glob` 0.2.9, `xmlbuilder2` 4.0.3. Its closure is 175 packages without
  optional dependencies and 215 with them; 184 are installed on linux-x64.
- **`ajv` 8.20.0** adds `fast-deep-equal`, `fast-uri`, `json-schema-traverse` and
  `require-from-string`.
- Of all 510 installed packages, two declare install scripts: `core-js-pure` 3.50.0 (in Surfer's
  closure through `modern-async`; its `postinstall` prints a funding banner) and `fsevents` 2.3.3
  (macOS only, optional; it ships a prebuilt `fsevents.node`, so its `node-gyp rebuild` is not
  needed). The native code Surfer uses, `sharp` (libvips) and `@resvg/resvg-js`, arrives as
  prebuilt platform packages selected by `os` and `cpu`, not built by a script.
- Experiment: `npm ci --ignore-scripts` of the repository's `package.json` and lockfile
  installed the same 510 packages and the same `.node` binaries as an install with scripts;
  `sharp` resized a PNG rendered by `@resvg/resvg-js`, the operation Surfer's branding step
  performs (`commands/patches/branding-patch.js:88-91`), and `surfer --version` ran. With
  `ignore-scripts=true` in `.npmrc`, `npm run <script>` still ran the script.
- `is-apple-silicon` resolves to `git+ssh://git@github.com/trickypr/is-apple-silicon.git#5f75501…`,
  pinned by commit but without an `integrity` hash, and has no scripts. Nothing in Surfer's
  `dist/` requires it.

Conclusion: no package in the release path needs an install script.

**R6. Surfer's published package.** `@zen-browser/surfer` 1.14.9 (published 2026-08-31) is 80
files, 246 KB of `tsc` output, with one maintainer on npm, an npm registry signature and no
provenance attestation (`npm view … dist`), so the published tarball cannot be tied to a commit
of `github.com/zen-browser/surfer` by anything but trust in the publisher.
`npm diff --diff=@zen-browser/surfer@1.14.8 --diff=@zen-browser/surfer@1.14.9` printed 34 lines
touching three files (`dist/utils/version.js`, `package.json`, `dist/tsconfig.tsbuildinfo`): a
diff of the published package is small and is exactly the code that runs.

**R7. GitHub settings and limits.** Read through the REST API on 2026-10-14 and GitHub's
documentation:

- The repository owner is a user account, so runner groups (which can restrict a runner to named
  workflows) are not available; `docs/runbook.md` already notes this.
- Fork pull request workflow approval is `first_time_contributors`
  (`GET /repos/JRanne/vimma/actions/permissions/fork-pr-contributor-approval`): after one merged
  pull request, a contributor's later pull requests run workflows, including edited workflow
  files, without approval. GitHub's guidance: "Self-hosted runners should almost never be used
  for public repositories on GitHub, because any user can open pull requests against the
  repository and compromise the environment"; it recommends ephemeral just-in-time runners,
  which "perform at most one job before being automatically removed".
- No environments exist; `SAFEBROWSING_API_KEY` is the only repository secret. "Secrets stored in
  an environment are only available to workflow jobs that reference the environment", and
  environments are available to public repositories on every plan; an environment's deployment
  policy limits it to named branches and tags.
- `sha_pinning_required` is `false`; every workflow already pins actions by commit SHA.
- A job summary is limited to 1 MiB per step.
- Ubuntu 24.04's `apt` depends on `gpgv` (packages.ubuntu.com, noble, apt 2.7.14build2), so every
  Ubuntu runner has it.

**R8. Time cost of verifying and re-extracting.** Measured on the maintainer's machine (AMD Ryzen
AI 7 PRO 350, 16 threads, NVMe) with the cached 157.0.1 tarball (811,383,348 bytes):
`sha512sum` 1.2 s (the hash matched line 821 of `SHA512SUMS`), `gpgv` under 0.1 s,
`tar --strip-components=1 -xf` into an empty directory 17.5 s (4.7 GB), deleting that tree 5.1 s.
Not measured: how long a nightly takes from a freshly extracted `engine/` with a warm compiler
cache; the cold full build is 38.7 min (`docs/rebase.md`).

## Design

### Firefox source

1. **Mozilla's release key, pinned in the repository, is the trust anchor; HTTPS is not.** The
   repository carries `tools/upstream/mozilla-release-key.asc`: the primary key
   `14F26682D0916CDD81E37B6D61B7B526D98F0353` with all its subkeys, binding signatures and
   revocations, exported from Mozilla's `KEY` file (R1) and checked against the fingerprints in
   Mozilla's announcement. `verify-sha512.py` holds the primary fingerprint as a constant. The
   key is stored armoured so a change to it is readable in review; the script de-armours it with
   the Python standard library into a temporary binary keyring for `gpgv` (R2). Reason: a
   signature check moves trust from "archive.mozilla.org and its CDN served these bytes" to
   "Mozilla's release key signed these hashes", which survives a compromised mirror, CDN or TLS
   interception. Rejected: fetching `KEY` at build time (an attacker who can serve a tarball can
   serve an old `KEY` without the revocation of the compromised subkey, R1); a keyserver (adds a
   third party and a network dependency to every build).
2. **The verdict comes from `gpgv`'s status lines, never its exit code.** `verify-sha512.py`
   gains a required `--signature` argument. It runs `gpgv --status-fd` with the pinned keyring
   and accepts only when the status has exactly one `NEWSIG`, one `GOODSIG` and one `VALIDSIG`
   whose primary-key fingerprint field is the pinned fingerprint, and none of `BADSIG`,
   `ERRSIG`, `EXPSIG`, `EXPKEYSIG`, `REVKEYSIG` or `NO_PUBKEY`. Only then does it compare the
   hash. Exit status: 0 match; 1 hash mismatch or a signature that is not good; 2 cannot check
   (no `gpgv`, no `.asc`, unreadable files). Every caller treats any non-zero status as failure.
   Reason: R2 shows `gpgv` exits 0 for a signature by the compromised subkey. Rejected:
   `gpg --verify` (same exit status, and it needs a writable `GNUPGHOME`); Sequoia's `sqv` (not
   installed on Ubuntu runners or the build machine; `gpgv` is, R7).
3. **Two scripts are the only ways to get Firefox source.**
   - `tools/upstream/source-check.sh VERSION` (from the Beta canary,
     [upstream-beta-canary](upstream-beta-canary.md), PR #192) streams the tarball through
     `sha512sum` and `patch-check.py` for `upstream.yml` and the canary. It now also downloads
     `SHA512SUMS.asc` and passes it to `verify-sha512.py`.
   - `tools/upstream/firefox-source.sh` (new) materialises a verified `engine/` for builds. It
     reads the version from `surfer.json`, downloads
     `.surfer/engine/firefox-<version>.source.tar.xz` with `curl` when absent, downloads
     `SHA512SUMS` and `SHA512SUMS.asc`, runs `verify-sha512.py` on the tarball, deletes `engine/`
     and only then runs `CI_SKIP_INIT=1 npx --no surfer download` (which finds the verified file
     and only extracts it, R3) and `git init -q engine`. `e2e.yml`, `sites.yml`, `nightly.yml` and
     `release.yml` call it. A test fails if any workflow calls `surfer download` itself.

   Reason: the hash and signature logic exists once, so the release path, PR CI, the autopilot
   and the canary cannot drift apart, as the canary spec already intends for `source-check.sh`.
   `MOZILLA_RELEASES` overrides the archive URL in both scripts so tests can use a `file://`
   directory.

4. **The tarball Vimma verifies is the one Surfer extracts.** Vimma downloads the tarball itself
   and verifies the file at the path Surfer reads (R3), in the same job, immediately before
   Surfer runs. Rejected: letting Surfer download and verifying afterwards (verification would
   then depend on Surfer's cache path never changing, and a failed check would come after
   extraction); verifying a stream and downloading again (two downloads that could differ).
5. **No build reuses `engine/`; nothing is trusted by label.** `firefox-source.sh` always deletes
   `engine/` and re-extracts from the verified tarball. `engine/.vimma-firefox-version` goes.
   Re-hashing and re-checking the cached tarball costs about 1.3 s; extracting it about 18 s on
   the maintainer's machine and about 66 s on a hosted runner (R8, R3). Rejected: verifying the
   existing `engine/` tree (it is modified by every import, so there is nothing to compare it
   with but a copy kept on the same machine, which is no anchor); keeping the old
   `.vimma-firefox-version` shortcut with a hash of the tarball (the tarball is not what is
   built; `engine/` is). Extracting with `CI_SKIP_INIT=1` skips Surfer's git commit of the whole
   tree (R3), which a build does not need: `e2e.yml` already builds from an empty `git init`, and
   `restore-patched.mjs` has nothing to restore in a fresh tree.
6. **The nightly keeps its compiler cache; the release does not.** Deleting `engine/` deletes the
   nightly's objdir (`engine/obj-x86_64-pc-linux-gnu`), so every nightly configures and builds
   from scratch, with sccache still warm. Sub-PR 4 measures the time; the job's 240-minute limit
   covers the 38.7-minute cold build in any case. A poisoned compiler cache can affect the
   nightly, which is an unsigned pre-release; the release already uses a fresh objdir and an
   empty cache of its own (`release.yml` lines 64–72), and keeps doing so.

### Build workspace

7. **Both build jobs start from a clean checkout plus the tarball cache.** After
   `actions/checkout` (still `clean: false`, so the 800 MB tarball is not downloaded on every
   run), a step runs `git clean -ffdx --exclude=/.surfer/` and `git status --porcelain` must be
   empty. Everything the previous run left (an untracked file under `src/` that `surfer import`
   would copy into the build, a stale generated file, `engine/`, `node_modules/`) is gone; the
   one thing kept, the tarball, is verified before use (decision 1). Reason: `clean: true` would
   also delete the tarball cache, and `actions/checkout`'s cleaning is not visible in the
   workflow file, so a test could not hold it.
8. **The release reuses the verified tarball rather than downloading it again.** A tarball that
   matches a signed `SHA512SUMS` is Mozilla's tarball byte for byte; a second download adds
   time and no assurance. So "a clean build per release" is: clean checkout (decision 7), fresh
   `node_modules` (`npm ci`, R4), fresh `engine/` from a verified tarball (decision 5), fresh
   objdir and empty compiler cache (existing).
9. **Firefox's toolchains stay outside this spec's guarantees, for now.** Both builds use the
   clang, Rust, cbindgen and sccache binaries `mach bootstrap` put in `~/.mozbuild` on the build
   machine. They are part of the machine's trusted base (decision 16). Whether a release should
   bootstrap them afresh is an open question below.

### npm packages

10. **Surfer is pinned exactly and stays a dependency; it is not vendored or forked.**
    `package.json` gets `"@zen-browser/surfer": "1.14.9"`. Reason: vendoring Surfer's `dist/`
    into `tools/` would still pull its 175-package closure from npm (R5), so it would remove one
    package from the review set and add a copy to maintain; the review of an update would be the
    same diff (R6). A fork that drops the dependencies Vimma never uses (`sharp`, `axios`,
    `mount-dmg`, `png-to-ico`, …) for the four commands it runs would shrink the closure, but is
    a port of the branding and import code with its own maintenance, and ADR-001 keeps that
    option for when Surfer stalls. With the source fetched and verified by Vimma (decision 3),
    Surfer no longer decides which Firefox bytes are built, only how they are extracted,
    patched and configured. ADR-001's consequences paragraph records this.
11. **The release path is computed, not listed by hand.** `tools/deps/release-path.mjs` reads
    `package-lock.json` and returns the dependency closure (non-optional and optional) of the
    release-path roots, `@zen-browser/surfer` and `ajv` (R5). A test checks the roots against the
    imports of the tools `release.yml`'s build job runs, so adding a package to that job without
    adding it as a root fails CI. Reason: Dependabot's security updates change transitive
    packages, and a hand-kept list of about 220 names would go stale.
12. **Dependabot never auto-merges a release-path change, security updates included.**
    `dependabot-automerge.yml` gets a `classify` job (`contents: read`, no secrets) that checks
    out the pull request's **base** commit, reads the head commit's `package-lock.json` with
    `git show` as data, and runs `release-path.mjs --diff <base lockfile> <head lockfile>`: if any
    package whose version, `resolved` or `integrity` changed is in the release path of either
    lockfile, the decision is `review`. The existing `automerge` job reads that decision; it
    keeps its own rules for majors and GitHub Actions. Reason: classifying by the lockfile
    diff, not by Dependabot's `dependency-names`, also catches a transitive package bumped by a
    grouped update. Base-branch code on head data means nothing from the pull request runs.
    Rejected: auto-merging release-path security updates for speed (Vimma ships no npm package
    code: `vimma-core` has no dependencies and `smol-toml` is vendored, ADR-012, so a
    vulnerability in a build tool is not in users' hands, while a malicious release is
    typically published as a routine update; a person's review is worth the days).
13. **The review shows the published code.** The same `classify` job runs
    `npm diff --diff=<name>@<old> --diff=<name>@<new>` for each changed release-path package and
    writes the result to the job summary, cut at 1 MiB with a pointer to the full diff in an
    artifact (`release-path-diff`, 30 days). `npm diff` downloads both tarballs and executes no
    package code. The comment the `automerge` job already posts on held pull requests links the run.
    Reason: Surfer has no provenance (R6), so the published tarball is the only artifact whose
    contents are certain to be what runs; for Surfer that diff is small.
14. **Dependabot groups the release path separately.** `.github/dependabot.yml` gets a
    `release-path` group (patterns `@zen-browser/surfer`, `ajv`) before `npm-minor-patch`, so a
    held Surfer update does not hold every other minor and patch update with it.
15. **No install scripts anywhere; Surfer only from `node_modules`.** A new `.npmrc` sets
    `ignore-scripts=true`, which covers every workflow, lane and developer machine. `release.yml`
    and `nightly.yml` also run `npm ci --ignore-scripts`, so the build does not depend on a file
    a future change could drop, and every Surfer call in them is `npx --no surfer …` (R4).
    Reason: R5 shows nothing needs a script, and an install script is the usual way a
    compromised package runs code. Rejected: `npm audit signatures` in the build (the lockfile's
    `integrity` hashes already pin the exact bytes, so a registry signature adds no check the
    install does not already make).

### The build machine

16. **The trust boundary.** The build machine is trusted: its operating system, the user account
    the runner runs as, its Node, `gpgv`, `~/.mozbuild` and the runner software. Everything that
    reaches it from outside is verified or pinned: Firefox source (decision 1), Vimma's code (the
    release tag or `main`, written only through pull requests under the `main` ruleset), npm
    packages (lockfile integrity, decisions 10–15). What leaves it is checked by hosted jobs
    (smoke tests, package checks) and then signed. A cosign signature therefore attests "built
    by `release.yml` at this tag on Vimma's build machine", and `docs/security.md` says exactly
    that. Making the binaries independently reproducible is out of scope.
17. **Only the two build jobs use the self-hosted runner, and nothing a pull request starts
    can.** A test (`tools/test/self-hosted-runner.test.mjs`) reads every workflow and fails when
    a job other than `nightly.yml`'s and `release.yml`'s `build` mentions `self-hosted` or
    `vimma-build` in `runs-on`, when either of those workflows gains a `pull_request`,
    `pull_request_target`, `push` or `workflow_call` trigger, or when either job loses its
    guard (`refs/heads/main`, or a release event). No such test exists today; `sites-workflow`
    checks only its own workflow.

    That test covers the workflow files on `main`. A fork's pull request runs the workflow
    files of its own head, so it could ask for `vimma-build` itself. Two repository settings,
    outside the code, close that, and `docs/runbook.md` makes them conditions for registering
    the runner: fork pull request approval set to `all_external_contributors` (R7), so no fork's
    workflow runs before the maintainer approves that run, and the runner online only for the
    nightly window (a timer) or a release (by hand), so a job that asks for it at any other time
    waits in the queue where it can be seen and cancelled. Whether the runner is also ephemeral
    is an open question below. `docs/security.md` marks the rule **⚠ setting** with the
    `gh api` command that shows the current value, because no test can read an admin setting
    with the workflow token.

18. **The Safe Browsing key moves to an environment.** A `build` environment holds
    `SAFEBROWSING_API_KEY`, with deployment allowed only from `main` and tags matching `v*`. The
    `build` jobs of `nightly.yml` and `release.yml` declare `environment: build`; the repository
    secret is deleted. Reason: today a branch's edited `nightly.yml` can drop the `if:` that keeps
    the key on `main`; an environment policy is enforced by GitHub, outside any workflow file. The
    nightly keeps the key because it publishes binaries people run and its mochitests assert
    the key is compiled in (`VIMMA_EXPECT_SAFEBROWSING_KEY`). The key ships inside every keyed
    binary (spec m0-safebrowsing-key), so this limits who can use it from CI, not who can read
    it.
19. **Action SHA pinning becomes a repository setting too.** Every workflow already pins actions
    by commit SHA and tests enforce it for several workflows; setting `sha_pinning_required` makes
    GitHub refuse an unpinned action in any workflow, a fork's included. A runbook step.

### Mozilla key rotation

20. **Key changes are reviewed, and noticed early.** The pinned keyring changes only through a
    pull request a person reviews. `tools/upstream/mozilla-key-check.py`, run by `upstream.yml`'s
    `detect` job (which runs every 4 hours), downloads
    `nightly/latest-mozilla-central/KEY` (the location Mozilla names, R1), compares it with the
    pinned key and reports: a new subkey or a new revocation (an issue, labelled `security`,
    "Mozilla's release key changed", with the fingerprints and the steps from `docs/runbook.md`),
    a different primary key (the same issue, saying the pinned fingerprint and ADR-021 must be
    reviewed, never updated by the check), or the pinned signing subkey expiring within 60 days.
    It never edits the keyring. Reason: Mozilla rotates the signing subkey every two years and, as
    in August 2026, at once after an incident; a build that cannot verify fails closed (rule B1), so
    the warning should come before the first failure. A new subkey is accepted by `gpgv` only
    with a binding signature from the pinned primary, so the update is a review of Mozilla's
    announcement, not of the cryptography.

## Security and privacy

This spec reduces surface: it removes trust in archive.mozilla.org's transport, in a reused
`engine/`, in floating npm versions and install scripts, and in workflow-file conditions for the
Safe Browsing key. New surface:

- `classify` in `dependabot-automerge.yml` runs on `pull_request` with `contents: read` and no
  secrets; it executes the base commit's code and only reads the head commit's lockfile as text
  and the registry's tarballs as data (`npm diff`). The job holding `contents: write` still
  checks out nothing.
- `mozilla-key-check.py` parses a file downloaded from archive.mozilla.org with
  `gpg --show-keys --with-colons` in a temporary `GNUPGHOME`; it imports nothing into a
  persistent keyring, and its only effect is an issue, written by the existing `publish` job.
- The pinned key file is security-relevant. `docs/review-checklist.md` gains a line: a change to
  `tools/upstream/mozilla-release-key.asc` or the fingerprint constant must cite Mozilla's
  announcement and keep every revocation.

New section for `docs/security.md`, **§13. Build and release supply chain** (`release.yml`,
`nightly.yml`), with **Reach:** Mozilla's archive, the npm registry, this repository, and the
self-hosted build machine. Each rule links its tests (Tests, below):

- B1. Nothing is **ever** built from a Firefox source tarball unless its SHA-512 is listed in a
  `SHA512SUMS` carrying a good signature by a valid signing subkey of Mozilla's release key
  `14F26682D0916CDD81E37B6D61B7B526D98F0353`; a revoked or expired subkey, another key or a
  missing signature fails.
- B2. A nightly or release build **never** builds from an `engine/` it did not extract in the
  same job from the tarball it verified, and a release **must** start from a clean checkout,
  a fresh `node_modules`, a fresh objdir and an empty compiler cache.
- B3. Surfer **must** be pinned to one exact version, and a change to any package in the release
  path **never** merges without a person, security updates included.
- B4. An npm install **never** runs install scripts, and the build **must** run Surfer only from
  `node_modules`.
- B5. Only the `build` jobs of `nightly.yml` and `release.yml` **must** run on the self-hosted
  runner, and no pull request, push or other workflow can start either.
  **⚠ setting:** fork pull request approval `all_external_contributors`; the runner is online
  only for a nightly or a release.
- B6. The Safe Browsing key **must** be available only to jobs in the `build` environment,
  deployable only from `main` and `v*` tags, and only the two build jobs use it.
- B7. A change to Mozilla's release key **must** open a `security` issue within 4 hours of
  appearing in Mozilla's `KEY` file, and 60 days before the pinned signing subkey expires.

§10's G4 changes to cite B1 ("whose SHA-512 differs from a signed `SHA512SUMS`, B1"). §11, "Out
of scope and trust boundaries", gains a **Build machine** entry with decision 16's boundary and
what a cosign signature does and does not attest. `docs/rebase.md` and
`verify-sha512.py`'s docstring drop "HTTPS from archive.mozilla.org is the trust anchor".

## Tests

Written first and seen to fail.

**Python, `tools/upstream/test_verify_sha512.py`** (real fixtures in
`tools/upstream/fixtures/sums/`: `SHA512SUMS` and `SHA512SUMS.asc` of 157.0.1 and 153.0, about
630 KB each; throwaway keys made with `gpg --quick-gen-key` in a temporary `GNUPGHOME` for the
synthetic cases):

- `test_good_signature_from_mozillas_current_subkey_passes` (157.0.1)
- `test_signature_by_the_revoked_compromised_subkey_fails` (153.0, `REVKEYSIG` with exit 0, R2)
- `test_signature_by_another_key_fails`
- `test_signature_by_an_expired_subkey_fails`
- `test_one_changed_byte_in_sha512sums_fails_the_signature`
- `test_good_signature_but_a_different_hash_fails_naming_expected_and_actual`
- `test_missing_signature_or_gpgv_cannot_check_and_exits_two`
- `test_signature_argument_is_required`
- `test_pinned_key_is_mozillas_primary_with_the_compromised_subkey_revoked`

**Python, `tools/upstream/test_mozilla_key_check.py`** (fixtures: Mozilla's `KEY` of 158.0 and the
same key without the 2026-08-06 subkey and revocation):

- `test_a_new_subkey_or_revocation_in_mozillas_key_is_reported`
- `test_a_different_primary_key_is_reported_and_never_adopted`
- `test_a_signing_subkey_expiring_within_60_days_is_reported`
- `test_an_unchanged_key_reports_nothing`

**vitest, `tools/upstream/test/firefox-source.test.mjs`** (runs the script with
`MOZILLA_RELEASES` pointing at a `file://` fixture directory and a stub `surfer` on `PATH`):

- `a tampered tarball fails before engine/ is touched`
- `a SHA512SUMS without a good signature fails before engine/ is touched`
- `a cached tarball is verified again and engine/ is extracted from it afresh`
- `a missing tarball is downloaded by the script, never by Surfer`

**vitest, `tools/upstream/test/source-check.test.mjs`** (extends the file from PR #192):

- `the source check fails on a SHA512SUMS whose signature is not good`

**vitest, `tools/deps/test/release-path.test.mjs`** (fixture lockfiles):

- `the release path is Surfer, ajv and everything they depend on`
- `the roots cover every package the release build job imports`
- `a changed release-path package needs review, security updates included`
- `a change only outside the release path may auto-merge`
- `a transitive release-path package bumped in a grouped update needs review`

**vitest, `tools/test/build-supply-chain.test.mjs`** (reads the workflow and config files):

- `release and nightly get Firefox source only through firefox-source.sh`
- `no workflow runs surfer download itself`
- `no workflow reads or writes engine/.vimma-firefox-version`
- `both build jobs clean everything but the tarball cache before building`
- `a release builds in a fresh objdir with an empty compiler cache`
- `release and nightly install with npm ci --ignore-scripts and run Surfer with npx --no`
- `.npmrc turns install scripts off for every install`
- `package.json pins Surfer to an exact version`
- `surfer.json lists no add-ons`
- `every verify-sha512.py call passes a signature`
- `the Safe Browsing key comes only from the build environment, in the two build jobs`
- `dependabot-automerge classifies on base-branch code with a read-only token`
- `the release-path group comes before the minor and patch group`

**vitest, `tools/test/self-hosted-runner.test.mjs`:**

- `only the build jobs of nightly.yml and release.yml use the self-hosted runner`
- `neither build workflow can be started by a pull request, a push or another workflow`
- `each build job runs only from main or for a release`

**Existing tests that change:** `tools/test/safebrowsing-workflows.test.mjs` (the key comes from
the `build` environment instead of a repository secret), `tools/test/upstream-workflow.test.mjs`
(G4 cites the signed check; the `detect` job runs the key check),
`tools/test/sites-workflow.test.mjs` (the SHA512SUMS check is `firefox-source.sh`).

No mochitest or e2e scenario: nothing in the browser changes.

## Docs and changelog

- `docs/security.md`: §13 with B1 to B7 and their test links; G4 amended; §11 gains "Build
  machine".
- `docs/runbook.md`: "Nightly build runner" rewritten for a public repository (fork approval
  `all_external_contributors`, ephemeral runner, timer, `sha_pinning_required`, `gpgv` in the
  prerequisites, the `build` environment and moving the secret into it); a new "Mozilla's
  release key" section (how to update the pinned key from Mozilla's announcement and `KEY` file,
  what the issue from decision 20 asks for); the `engine/.vimma-firefox-version` paragraph goes.
- `docs/rebase.md`: the source check verifies Mozilla's signature; the trust-anchor sentence goes.
- `CONTRIBUTING.md`, "Dependency updates": release-path packages, why they are never
  auto-merged, how to read the `release-path-diff` summary, and that install scripts are off.
- `docs/review-checklist.md`: the pinned-key line (Security and privacy).
- ADR-021 (new) and the ADR-001 paragraph (sub-PR 3 and sub-PR 1).
- No `docs/guide.md` or README change: nothing a user does or sees changes.
- `CHANGELOG.md`: one line, added at merge time: "Release and nightly builds verify Mozilla's
  signature on the Firefox source and never reuse a build tree."

## Delivery

Each sub-PR adds its `docs/security.md` rules together with the tests they link, so the link
check (`npm run security-links`) holds at every step.

1. **`build(deps): pin surfer, no install scripts, build machine guards`.** Exact Surfer pin;
   `.npmrc`; `npm ci --ignore-scripts` and `npx --no` in `release.yml` and `nightly.yml`; the
   `release-path` Dependabot group; `dependabot-automerge.yml` also holds Surfer's security
   updates (the name check it has today, extended); `self-hosted-runner.test.mjs`; the
   `surfer.json` add-on test; the ADR-001 paragraph; runbook settings (fork approval, ephemeral
   runner, `sha_pinning_required`). Rules B4, B5, the Surfer half of B3. Smallest change with the
   largest effect: it closes problems 3 to 5 for Surfer itself.
2. **`ci(deps): hold every release-path change for review, with the package diff`.**
   `release-path.mjs`, the `classify` job and `npm diff` summary. Completes B3.
3. **`ci(upstream): verify mozilla's signature on SHA512SUMS`.** Pinned key,
   `verify-sha512.py --signature`, `source-check.sh` and the `e2e.yml` and `sites.yml` checks
   use it; ADR-021; G4 amended; `docs/rebase.md`. Depends on PR #192 (which adds
   `source-check.sh`); if that is not merged first, this sub-PR changes `upstream.yml`'s inline
   step instead and #192 moves it. B1 for PR CI and the autopilot.
4. **`ci(release): build only from verified, freshly extracted firefox source`.**
   `firefox-source.sh`; `nightly.yml` and `release.yml` use it and clean the workspace; the
   `.vimma-firefox-version` shortcut goes; one manual nightly run on the build machine records
   the time from a fresh `engine/` in `docs/runbook.md`. B1 for builds, B2.
5. **`ci(release): the safe browsing key in a build environment; key rotation watch`.** The
   `build` environment (created and the secret moved by the maintainer, steps in the runbook,
   before merging), `environment: build` in both jobs, `mozilla-key-check.py` in `upstream.yml`,
   §11 "Build machine". B6, B7.

## Open questions

1. **Fresh Firefox toolchains for each release?** The release compiles with whatever is in
   `~/.mozbuild` on the build machine (decision 9). Options: (a) keep them as part of the trusted
   machine; (b) point the release job at a fresh `MOZBUILD_STATE_PATH` in `$RUNNER_TEMP` and let
   `mach` fetch the toolchains from Mozilla's Taskcluster index for every release, which removes
   them from the machine's persistent state but adds a download of unmeasured size and time, and
   relies on `mach`'s own integrity checks of the toolchain artifacts (not yet read). Recommended:
   (b), once sub-PR 4 has measured it and the toolchain fetch path has been read in the engine
   tree; until then (a), stated as part of the trust boundary in §11.
2. **Ephemeral runner, or a persistent runner kept offline outside the nightly window?** Both
   need the timer. An ephemeral registration gets a fresh runner identity per job and cannot pick
   up a second, queued job, but registration tokens expire after an hour, so the wrapper that
   re-registers it needs a long-lived token with the repository's Administration permission
   stored on the build machine, which is itself a new secret worth protecting. A persistent
   runner needs no such token, but while it is online it takes any queued job that asked for
   `vimma-build`. Recommended: ephemeral, with a fine-grained token limited to this repository's
   self-hosted runner administration, stored mode 0600 outside the runner's work directory,
   because the queue check before every start is a manual step that will eventually be skipped.
3. **Should the nightly also build with an empty compiler cache?** It would make the nightly a
   rehearsal of the release in every respect, at the cost of a cold build (about 39 minutes)
   every night. Recommended: no; the nightly is an unsigned pre-release and the release path
   already isolates its cache (decision 6). Revisit if nightlies become an update channel.
