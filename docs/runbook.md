# Runbook

## Machine

- Dev box: 16 cores, 58 GiB RAM, 475 GB disk (230 GB free on 2026-10-09), Linux (Omarchy), Node 22.21, Python 3.

## First Firefox build (plan §10 step 3)

| Step                   | Date       | Result                                                                                                                                                                                                         |
| ---------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surfer setup-project` | 2026-10-09 | Firefox stable 157.0.1; name Vimma, binary `vimma`, app id `dev.vimma.browser`. The prompts were scripted; Surfer crashed after writing the config (import cycle), so `binaryName`/`appId` were fixed by hand. |
| `surfer download`      | 2026-10-09 | 753 s (12.5 min) incl. unpack and `git init` of `engine/`. `.surfer/` 774 MB, `engine/` 7.6 GB.                                                                                                                |
| `surfer bootstrap`     | 2026-10-09 | toolchains into `~/.mozbuild` (clang, cbindgen, …); no errors                                                                                                                                                  |
| `surfer build`         | 2026-10-09 | 2321 s (38.7 min) wall, CPU 75 %, on Ryzen AI 7 PRO 350 (16 threads), 58 GB RAM. `engine/` 22 GB after build.                                                                                                  |

Repository: <https://github.com/JRanne/vimma> (private); `MOZ_SOURCE_REPO` in `configs/common/mozconfig` points at it.

```sh
npx surfer setup-project   # interactive: name vimma, Firefox release
npx surfer download
npx surfer bootstrap
npx surfer build
npx surfer run
```

## Smoke check

```sh
bin=engine/obj-x86_64-pc-linux-gnu/dist/bin/vimma
$bin --version   # "Vimma Vimma 0.1.0" (vendor, name, surfer.json brands.vimma.release.displayVersion)
grep '^Version=' engine/obj-x86_64-pc-linux-gnu/dist/bin/application.ini
                 # "Version=157.0.1": appinfo.version is the Firefox version (spec m0-app-version)
# navigator.userAgent stays Firefox's: "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101
# Firefox/157.0", no Vimma token (spec m0-user-agent; browser_vimma_user_agent.js checks it)
p=$(mktemp -d)
timeout 20 $bin --headless --no-remote --profile "$p" about:blank || true   # first run: profile + bookmarks; timeout exits 124
$bin --headless --no-remote --profile "$p" --screenshot /tmp/shot.png "data:text/html,<h1>ok</h1>"
```

The brand is `vimma` (spec m0-branding): `npm run import` selects it (`surfer config brand vimma`)
and rewrites `engine/mozconfig`, so `npm run import && (cd engine && ./mach build)` builds it.
Changing branding needs a full `./mach build`, not `--ui`. Profiles now live under the Vimma
vendor/name, so profiles from the old `unofficial` builds are not picked up.

Two versions (spec m0-app-version): `npm run import` writes `src/browser/config/vimma/version.txt`
(the Firefox version, `appinfo.version`) and `version_display.txt` (Vimma's, `--version` and the
About dialog) from `surfer.json`; the mozconfig points configure at them. Surfer still writes
`displayVersion` into the stock `browser/config/version*.txt`, which configure then ignores. After
editing the generated files by hand, run `./mach configure`; `npm run import` triggers it anyway.
If the files are missing (a fresh clone without `npm run import`, or after `git clean -fdX`), the
mozconfig stops the build with "browser/config/vimma/version.txt is missing; run 'npm run import'"
rather than letting configure fall back to Surfer's 0.1.0.

Profiles are stamped with the Firefox version (157.0.1), so a build from before m0-app-version
(appinfo.version 0.1.0) sees any profile opened by a newer build as a downgrade and refuses it
(`MOZ_BLOCK_PROFILE_DOWNGRADE`). When testing old and new builds side by side, give each its own
`--profile`, or pass `--allow-downgrade`.

`--screenshot` on a brand-new profile quits while Places is still importing the default
bookmarks and logs "Failed to import bookmarks … 0x8046001e" (`NS_ERROR_ILLEGAL_DURING_SHUTDOWN`).
That is an upstream shutdown race, not a broken import: hence the warm-up run above.
`tests/browser/browser_vimma_branding.js` checks the import itself.

Mozilla services (spec m0-mozilla-services): builds have no crash reporter
(`--disable-crashreporter` in `configs/common/mozconfig`), so a crash leaves a systemd-coredump
core (`coredumpctl list vimma`), not a minidump, and nothing is sent anywhere. Studies,
experiments, sponsored content and Mozilla promos are off by default in
`src/browser/branding/vimma/pref/firefox-branding.js`; `about:config` turns any back on. In a
local build `dist/bin` symlinks that file, so an edit to it applies at the next launch, no build
needed; the crash-reporter flag needs `npm run import && (cd engine && ./mach build)`.

Placeholder artwork: `configs/branding/vimma/*.svg`, rendered by `tools/branding/render.sh`
(`rsvg-convert`, ImageMagick). Replace the SVGs, re-run the script, commit the PNG/ICO outputs.

## Testing

### Mochitests that send keys to a page

Set up, await, then press (issues #14, #18). `tests/browser/head.js`, which the harness loads
before every test in the directory, has the helpers:

```js
await recordPageKeys(browser); // listener in place in the content process
await focusContent(browser); // chrome and content focus
EventUtils.synthesizeKey("j");
Assert.ok(await waitForPageKey(browser, ["j"]), "page received j, not default-prevented");
Assert.deepEqual(await pageKeys(browser), ["j"], "and nothing else");
```

Do not use `BrowserTestUtils.waitForContentEvent` followed by `synthesizeKey`: it installs its
listener through `sharedData.flush()`, which the content process picks up later, so the key can
beat the listener. Do not rely on `browser.focus()` either: it moves chrome focus; the content
process takes focus later. On a 2-CPU runner both race the key. Neither matters for keys that
only chrome handles (Vimma's chords, the help overlay, the URL bar).

To shake out a race, run a test repeatedly on two busy CPUs (what the hosted runner has):

```sh
for i in 1 2 3 4; do taskset -c 0,1 sh -c 'while :; do :; done' & done
taskset -c 0,1 npm run mochitest -- --repeat=49 tests/browser/browser_vimma_<name>.js
kill $(jobs -p)
```

Pass `--repeat=N` with `=`: `tools/mochitest.mjs` treats a bare `N` as a test path. Plan §5: no
retries in CI; a flaky test gets quarantined and an issue the same day.

## Parallel browser lanes

A lane is a git worktree (e.g. an agent's under `.claude/worktrees/`) with its own `engine/` and
artifact build, so several agents can run browser specs at once without sharing a tree. In the
worktree:

```sh
ln -s /home/juuso/repositories/VimHerdr/node_modules node_modules   # or npm ci
npm run lane:setup          # copy, reset, import, artifact build, verify
npm run mochitest -- --artifact tests/browser/
npm run lane:teardown       # when done: removes this worktree's engine/
```

`tools/lanes/lane-setup.mjs`:

1. reflink-copies the main checkout's `engine/` (`--source <checkout>` for another) without
   any `obj-*` dir, keeping the engine's own `.git` and modes (`cp -a --reflink=always`);
2. resets the copy to upstream as Surfer's `surfer reset` would, but scoped: unlinks the
   symlinks that lead into the source checkout (the source's `surfer import` made them, with
   absolute paths), `git checkout -- .` (undoes our `.patch` files and the lines import added
   to `engine/.gitignore`), `git clean -fd` (no `-x`: what import added, not upstream-ignored
   files) and removes `mozconfig*`;
3. runs this worktree's `npm run import` and `tools/artifact-build` into `engine/obj-artifact`;
4. checks that no symlink leads into the source checkout and some lead into the lane, runs
   `browser_vimma_branding.js`, and prints timings and disk (`btrfs filesystem du`).

Cost, measured 2026-10-09 (Firefox 157.0.1, 16 threads, Mozilla's artifacts already cached in
`~/.mozbuild/package-frontend`; a cold cache downloads 163 MB once, shared by all lanes):

| Phase          | Time   |
| -------------- | ------ |
| copy (reflink) | 4.8 s  |
| reset          | 23.2 s |
| import         | 1.0 s  |
| artifact build | 36.5 s |
| mochitest      | 8.6 s  |

About 75 s in all. Disk: 5.06 GB total but **0.59 GB exclusive** (the reflinked tree shares
its extents with the source; `obj-artifact` and rewritten files are the lane's own). The whole
`tests/browser/` suite then takes 22 s in the lane.

Protection of the main checkout: setup and teardown refuse to run in it (the first entry of
`git worktree list`), whatever path it is reached by; setup only reads the source `engine/` and
writes under the lane's; teardown refuses an `engine/` that is a symlink or resolves into the
main checkout's. Setup refuses an existing `engine/` unless `--force`, and refuses a non-reflink
copy (about 6 GB, minutes) unless `--allow-copy`: the lane must be on the same btrfs filesystem.

Limits:

- **Artifact builds only.** Specs that change build config, `moz.configure`, compiled-in
  defines or C++ (ADR-010 "Known gaps", `skip-if = ["artifact"]` tests) need the main
  checkout's full build; do them there, one at a time.
- **One lane per worktree** (its `engine/`). After changing `src/` or `tests/` paths, rerun
  `npm run import` there; after a Firefox bump, `npm run lane:setup -- --force` from a source
  checkout on the new release.
- **CPU:** an artifact build is CPU-bound (the front-end build). On this 16-thread box run at
  most about 3 artifact builds at once, and none while the main checkout runs a full build;
  mochitests are light, a few in parallel are fine.
- **Don't set up a lane while the source checkout is mid-import** (or mid-`git` in its
  `engine/`): the copy is a snapshot. Stray `*.lock` files copied from its `engine/.git` are
  removed in the lane (and logged), never in the source; a half-applied import is undone by
  the reset, but rerun setup with `--force` if anything looks off.
- With `--source <other worktree>`, links into both that worktree and the main checkout are
  removed and checked. All git (and import) children run without inherited `GIT_*`
  variables, and reset refuses an `engine/` that is not the top of its own git repo.
- mach keeps a small per-tree state dir in `~/.mozbuild/srcdirs/engine-<hash>` (about 2 MB
  per lane); teardown leaves it.

## CI and automation (spec m0-pipeline)

| Workflow             | Trigger                          | Runner                    | Needs from you                             |
| -------------------- | -------------------------------- | ------------------------- | ------------------------------------------ |
| `ci.yml`             | push to `main`, PRs, manual      | `ubuntu-latest`           | nothing                                    |
| `e2e.yml`            | PRs touching the browser, manual | `ubuntu-24.04`            | nothing (ADR-010)                          |
| `nightly.yml`        | 03:00 UTC, manual                | self-hosted `vimma-build` | register the runner, set `NIGHTLY_ENABLED` |
| `upstream.yml`       | every 6 h (`:17`), manual        | `ubuntu-latest`           | allow Actions to open PRs; optional token  |
| `claude.yml`         | `@claude`, `spec`+`claude:go`    | `ubuntu-latest`           | a secret, two labels, Actions may open PRs |
| `release-please.yml` | push to `main`, manual           | `ubuntu-latest`           | Actions may open PRs; optional token       |
| `release.yml`        | release published, manual        | `vimma-build` + hosted    | see "Release packages" (gated off)         |
| Renovate             | Mondays before 07:00 Helsinki    | Renovate's own            | install the Renovate app                   |

Locally, before pushing: `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:py`,
`npm run license-check`, `npx surfer license-check`, `npx commitlint --from main`.
Workflow YAML: `go run github.com/rhysd/actionlint/cmd/actionlint@latest` (reads
`.github/actionlint.yaml`; not a repo dependency).

### Merging and branch protection

Branch protection on `main` is **deliberately off**: the repo is private on the free plan, where
GitHub does not offer protection rules on private repositories (`gh api
repos/JRanne/vimma/branches/main/protection` → 403 "Upgrade to GitHub Pro"). A PR merges after
review and green checks, by hand; no approval count is configured. Revisit if the repo goes public
or moves to a paid plan (then: CI required, signed commits, one approval, via `gh api`).

**Residual risk:** any job token with `contents: write` (`spec-pr` in claude.yml, upstream.yml,
nightly.yml, release-please.yml) could push to `main`, since nothing protects it. Mitigations: those jobs run no
Claude-written code with that token (claude.yml's Claude job is read-only), Claude runs only for
the owner (`claude:go` added by the owner; `@claude` from owner/member/collaborator), and GitHub
Actions minutes and logs show every push. Check `git log origin/main` if anything looks off.

### PR mochitests (`e2e.yml`, ADR-010)

PRs run `tests/browser/` on an **artifact build**: our front end built on Mozilla's compiled
binaries for the release in `surfer.json`, on a GitHub-hosted runner. No runner, secret or
variable to set up. Same thing locally, next to the full build (≈ 0.6 GB, `engine/obj-artifact`):

```sh
npm run import
node tools/artifact-build/artifact-build.mjs     # ~25 s warm; first run downloads 163 MB
npm run mochitest -- --artifact tests/browser/
```

It runs only when a PR touches `src/`, `tests/browser/`, `packages/vimma-core/`, `configs/`,
`surfer.json`, `package*.json`, the tools it uses or `e2e.yml` (paths filter). For a PR opened
with `GITHUB_TOKEN`, mark it ready for review or `gh workflow run e2e.yml --ref <branch>`.

What it does not cover: compiled-in build config (C++ defines such as `--version`'s display
version and `MOZ_APP_NAME`, `--disable-crashreporter`; ADR-010 "Known gaps"). Tests of that carry
`skip-if = ["artifact"]` in `tests/browser/browser.toml`. **Until the nightly runner is live they
run only locally**, so a PR touching `*.patch`, `configs/`, `moz.configure` or branding must
report plain `npm run mochitest -- tests/browser/` on the full build (PR template checkbox).

The tool checks Mozilla's index first and prints how long the release build stays indexed. If it
fails, the message names the revision from `engine/sourcestamp.txt` and the expiry: check that
`surfer.json` points at a real release. It also refuses a display version ending in `aN`/`bN`
or containing `esr`, which would make mach search the wrong tree.

The job is path-filtered: it does not report on docs-only PRs. Do not make it a required status
check (once branch protection exists) without handling skipped runs, or those PRs hang.

Fork PRs (once public) run the same job with a read-only token and no secrets; GitHub asks you
to approve the first run of a first-time contributor (Settings → Actions → General).

### Actions minutes budget

The free plan has a limited monthly budget of minutes for private repos, billed per job and rounded
up to the minute. Rough use: CI ≈ 2 min per PR push, e2e ≈ 6 min per PR push that touches the
browser (5.5 min wall, ADR-010); upstream 4 × 1 min a day (≈ 120 min a month); claude.yml only
when triggered. `nightly.yml` uses the self-hosted runner, which costs no hosted minutes. Check usage in Settings → Billing → Usage. Once the repo is public,
standard hosted runners are free and unlimited; the e2e paths filter can then go.

### Nightly build runner (`nightly.yml`)

A full build does not fit a GitHub-hosted runner (22 GB `engine/`, 39 min on 16 threads), so it
runs on a self-hosted runner, e.g. this dev box or a dedicated machine. Only for this private
repo: never attach a self-hosted runner to a public repo that takes fork PRs.

**Keep the runner stopped outside the nightly window.** Any branch of this repo can add a
workflow with `runs-on: vimma-build` and run code on the machine while the runner is online.
Runner groups, which could restrict it to `nightly.yml`, exist only for organisations (extra
groups need the Team plan), not for a personal repo like this one. So: start the runner service
shortly before 03:00 UTC and stop it after the build (e.g. two systemd timers calling
`./svc.sh start` / `./svc.sh stop`), or keep it stopped and start it only for a manual run. Jobs
queued while it is offline wait (up to 24 h) and run when it comes back, so check the queue
(Actions → filter by "Queued") before starting it.

1. Prerequisites on the machine: Node 22, Python 3, git, `gh`, ~60 GB free disk, and the Firefox
   toolchains (`npx surfer bootstrap` once, as in "First Firefox build"; they live in
   `~/.mozbuild`).
2. Settings → Actions → Runners → New self-hosted runner → Linux x64; follow the download step,
   then configure it with the extra label:

   ```sh
   ./config.sh --url https://github.com/JRanne/vimma --token <token> --labels vimma-build
   ```

3. Run it as a service: `sudo ./svc.sh install && sudo ./svc.sh start` (or `./run.sh` to try).
4. Test once by hand: Actions → nightly → Run workflow (manual runs ignore the variable).
5. Enable the schedule: `gh variable set NIGHTLY_ENABLED --body true`
   (disable: `gh variable delete NIGHTLY_ENABLED`). Until then the 03:00 run is skipped at no cost.

The job keeps `engine/` between runs (`clean: false`) and re-downloads Firefox only when
`surfer.json` pins a new version (`engine/.vimma-firefox-version`). It publishes the rolling
`nightly` pre-release; on failure it uploads the log and opens (or comments on) an issue labelled
`nightly-failure`. Comment `@claude` on that issue to hand it to Claude Code.

### Google Safe Browsing key (spec m0-safebrowsing-key)

Safe Browsing's phishing, malware and download lists need a Google API key compiled into the
build. `configs/common/mozconfig` passes it to configure only when the key file exists:
`$VIMMA_SAFEBROWSING_KEYFILE` if set (it must then name a file), else
`~/.config/vimma/keys/safebrowsing`. Without one the build is keyless and Vimma defaults Safe
Browsing off, so Settings shows it unticked. The key is a secret: never echo, log or commit it.

Get a key: Google Cloud console → a project → enable the **Safe Browsing API** → Credentials →
Create API key → restrict it to that API. Its use is free but non-commercial; Google's quota is
per key (see [limits.md](limits.md)).

**Locally**, store it without it reaching the terminal or the shell history, then rebuild:

```sh
mkdir -p ~/.config/vimma/keys && chmod 700 ~/.config/vimma/keys
( umask 077; read -rs -p "Safe Browsing API key: " k; echo
  printf '%s' "$k" > ~/.config/vimma/keys/safebrowsing )
npm run import && (cd engine && ./mach build)   # the key is a configure input: full build
tools/safebrowsing-smoke/safebrowsing-smoke.sh   # needs the network; prints table names and sizes
```

The local artifact build copies the same mozconfig, so it is keyed too (rebuild it with
`node tools/artifact-build/artifact-build.mjs`). `npm run mochitest` passes
`VIMMA_EXPECT_SAFEBROWSING_KEY=1` when the key file exists, so a stale keyless build fails
`browser_vimma_safebrowsing.js`; set `VIMMA_EXPECT_SAFEBROWSING_KEY=0` to test a keyless build
on purpose.

**In CI**, the key is the repository secret `SAFEBROWSING_API_KEY` (`gh secret set
SAFEBROWSING_API_KEY < ~/.config/vimma/keys/safebrowsing`). `nightly.yml` writes it to a mode-600
file in `$RUNNER_TEMP` and deletes it after its last `mach` call. PR builds (`e2e.yml`) never get
it: they build keyless, which `browser_vimma_safebrowsing.js` checks. `release.yml`'s `build` job
does the same as the nightly, and its smoke check fails a release built without the key.

Debugging: `browser.safebrowsing.debug` = `true` logs list updates to stdout, with the key
replaced by `[trimmed-google-api-key]`. Still check before pasting a log anywhere.

**Forks:** the nightly and release builds fail closed without `SAFEBROWSING_API_KEY`. Set your
own key as that secret, or remove the key step (your builds then ship keyless, with Safe
Browsing honestly off).

**Rotate** (quota trouble or abuse; the key is extractable from every binary by design, so a
"leak" alone is no reason): create the new key in the console, replace the local file
(the `read -rs` line above) and the secret (`gh secret set` as above), rebuild and run the smoke
script, then delete the old key in the console. Builds already shipped keep the old key and
stop getting lists once it is deleted, so rotate before a release, not after.

### Upstream bumps (`upstream.yml`)

`tools/upstream/check-release.py` prints `LATEST_FIREFOX_VERSION` from product-details when it
is newer than `surfer.json`; `bump-surfer-json.py` rewrites only that version. The workflow then
opens a draft PR `upstream: update to Firefox X.Y` on branch `upstream/firefox-X.Y`. If a PR for
that branch is already open it does nothing; a branch left by a failed or closed run is rebuilt
from `main` and force-pushed, so a failed run is retried 6 h later.

Every bump PR: refresh the copy of `browser.newtabpage.activity-stream.asrouter.providers.cfr`
in `src/browser/branding/vimma/pref/firefox-branding.js` from `engine/browser/app/profile/firefox.js`,
keeping `"enabled":false` (spec m0-mozilla-services). A stale copy shadows upstream's provider.
Likewise `browser.safebrowsing.provider.google{4,5}.lists`: upstream's value from
`engine/modules/libpref/init/all.js` without `goog-badbinurl-proto` and `goog-downloadwhite-proto`
(spec m0-safebrowsing-key), then run `tools/safebrowsing-smoke/safebrowsing-smoke.sh`.

One-time setup:

1. Settings → Actions → General → Workflow permissions → tick "Allow GitHub Actions to create and
   approve pull requests" (`gh pr create` with the default token fails without it).
2. Optional: PRs opened with the default `GITHUB_TOKEN` do not trigger `ci.yml`. Either mark the
   draft ready for review (that event is yours, so CI runs) or `gh workflow run ci.yml --ref
<branch>`; or store a fine-grained token for this repo only (Contents + Pull requests:
   read/write) as `gh secret set UPSTREAM_PR_TOKEN`, which the workflow uses when present.

Before merging a bump: `npm run import && npx surfer build` on the build machine (the nightly does
this once merged), then `npm run mochitest -- tests/browser/` on the built engine (our patches
change upstream behaviour, e.g. `tab-bar-visibility-js.patch`), then mark the PR ready for review.

### Claude Code in GitHub (`claude.yml`)

Follows `anthropics/claude-code-action` v1. Until a secret exists every run is green and skips
all work with a notice.

1. Add one secret: `gh secret set ANTHROPIC_API_KEY`, or with a Pro/Max plan run
   `claude setup-token` and `gh secret set CLAUDE_CODE_OAUTH_TOKEN`. The Claude GitHub app is
   not needed: the workflow passes the job's own `GITHUB_TOKEN` (`github_token` input).
2. Create the labels: `gh label create spec`, `gh label create claude:go`
   (`bot`, `upstream`, `nightly-failure` are created by the workflows).
   Tick "Allow GitHub Actions to create and approve pull requests" (see Upstream bumps).
3. Use `@claude` in an issue, comment or review (only from the owner, members or collaborators).
   Claude answers, reviews and comments; it cannot push in this mode.
4. For code: add `claude:go` to a `spec` issue yourself (the job checks that the label was added
   by the repository owner, so a bot or a `@claude` request cannot chain into it). Claude
   implements and commits on a runner with a read-only token; a separate job without Claude
   applies the patch, pushes `claude/spec-<issue>` and opens a draft PR labelled `bot`.
5. CI does not start on that PR by itself (GITHUB_TOKEN PRs trigger no workflows): mark it ready
   for review, or `gh workflow run ci.yml --ref claude/spec-<issue>`. Claude Code never merges.

Tokens: because `github_token: github.token` is passed, each job's `permissions:` block is the
token Claude gets (without it the action would use the Claude app's installation token with
contents, pull-requests and issues write). `mention`: contents read, pull-requests and issues
write, actions read. `spec` (Claude): contents and issues read; tools limited to file edits,
`npm test`/`lint`/`typecheck`/`coverage`/`format`/`gen-docs`/`test:py`, `git add/commit/diff/
log/status` and `gh issue view`. Tests Claude writes still run as code on that runner, which is
why its token is read-only. `spec-pr` (no Claude): contents and pull-requests write;
GITHUB_TOKEN cannot change `.github/workflows`. No other secret is passed.

### Renovate

1. Install the Renovate GitHub app for this repo: <https://github.com/apps/renovate> → Configure →
   Only select repositories → `vimma`.
2. It opens an onboarding PR only when no config exists; `renovate.json` is already here, so the
   first run goes straight to the dependency dashboard issue and update PRs.

`renovate.json`: npm and GitHub Actions only, Mondays, releases at least 3 days old, actions kept
pinned to commit SHAs. npm patch/minor PRs automerge once all checks pass; Renovate merges them
itself (`platformAutomerge: false`, since there is no branch protection for GitHub auto-merge to
wait on). Majors, `@zen-browser/surfer` and every GitHub Actions update (workflows hold write
tokens and the Claude secret) stay open for review.

### Releases (`release-please.yml`)

Plan §4/§7: [release-please](https://github.com/googleapis/release-please-action) (v5.0.0, pinned
by SHA) keeps one release PR open, `chore(main): release X.Y.Z`, updated on every push to `main`.
It holds the next version and that release's `CHANGELOG.md` entry. **Merging it is the release**:
release-please tags `vX.Y.Z` and creates the GitHub Release with the same notes. Nothing is built
or uploaded by release-please itself; `release.yml` does that (below, "Release packages").

- **Version source:** `surfer.json` `brands.vimma.release.displayVersion`, the version
  `vimma --version` and the About dialog show (spec m0-app-version). The release PR bumps it
  through `extra-files` (jsonpath `$.brands.vimma.release.displayVersion`), plus
  `.release-please-manifest.json`, which must always match it. The Firefox pin
  `version.version` is never touched; `upstream.yml` owns it. Release type `simple`: there is no
  root `version.txt`, so nothing else is written.
- **Bumps** (`release-please-config.json`): `0.x` until M6 (plan §7), so `feat` bumps the minor
  version, `fix` the patch, and a breaking change (`!`, `BREAKING CHANGE:`) the minor
  (`bump-minor-pre-major`). Changelog sections: `feat` → Added, `fix` → Fixed; `perf`, `deps`,
  `upstream` and `revert` → Changed; `docs`, `test`, `build`, `ci`, `chore` and `refactor` are
  left out.
- **The changelog line is the commit subject; the body explains why** (CLAUDE.md). release-please
  writes subjects only. Firefox bumps are `upstream: update to Firefox X.Y` (upstream.yml), so a
  security dot release alone still produces a release PR (plan §4: release within 7 days).
- **First release (one-time).** No `v0.1.0` tag exists, and release-please would treat the
  manifest's `0.1.0` as already released and propose `0.2.0`. So `release-please-config.json`
  pins `"release-as": "0.1.0"`: the first release PR, `chore(main): release 0.1.0` on branch
  `release-please--branches--main`, lists every `feat`/`fix` since the first commit and puts its
  entry above the hand-written `## [Unreleased]` section. Just before merging it, edit
  `CHANGELOG.md` on that branch: replace the generated `0.1.0` list with the `[Unreleased]`
  sections and delete that heading. The generated list also has a false "BREAKING CHANGES" item
  (cd70146's body has a line starting `BREAKING CHANGE:`). release-please rewrites the branch on
  every push to `main`, so make the edit last. After the merge, **remove `release-as`** in a follow-up PR, or every
  later release PR proposes `0.1.0` again. From then on every entry is generated.
- **Names.** `include-component-in-tag` is off, so tags are `vX.Y.Z`, the branch is
  `release-please--branches--main` and the PR title `chore(main): release X.Y.Z`.

One-time setup:

1. Settings → Actions → General → Workflow permissions → tick "Allow GitHub Actions to create and
   approve pull requests" (the same setting as for upstream bumps).
2. Optional: the release PR, opened with `GITHUB_TOKEN`, triggers no CI. Run
   `gh workflow run ci.yml --ref release-please--branches--main` before merging, or store a
   fine-grained token for this repo only (Contents, Pull requests and Issues: read/write) as
   `gh secret set RELEASE_PLEASE_TOKEN`; the workflow uses it when present.
3. Tags and releases created with `GITHUB_TOKEN` trigger no workflows, so `release.yml`
   (on `release: published`) runs by itself only with `RELEASE_PLEASE_TOKEN` set; without it,
   start it by hand (see "Release packages").

The job's token has `contents`, `pull-requests` and `issues: write` (labels go through the issues
API). It runs no repository code.

### Release packages (`release.yml`, spec m6-packaging)

When a GitHub Release is published (release-please, above), `release.yml` builds Vimma on the
`vimma-build` runner, packages it on a hosted runner, signs, uploads to that release and pushes
AUR `vimma-bin`. **Every job is off until `RELEASE_ENABLED` is `true`**, manual runs included.

| Asset                             | What                                                            |
| --------------------------------- | --------------------------------------------------------------- |
| `vimma-X.Y.Z-linux-x86_64.tar.xz` | `./mach package`'s tarball, renamed (one `vimma/` directory)    |
| `vimma-X.Y.Z-x86_64.AppImage`     | AppImage (appimagetool 1.9.1, runtime 20251108, both pinned)    |
| `vimma_X.Y.Z_amd64.deb`           | `/usr/lib/vimma`, `/usr/bin/vimma`, desktop file, icons         |
| `vimma-X.Y.Z.cdx.json`            | CycloneDX 1.6 SBOM (`tools/package/sbom.mjs`)                   |
| `SHA256SUMS`                      | checksums of the four files above                               |
| `*.sigstore.json`                 | cosign keyless bundles, one per file above (when signing is on) |

Jobs: `build` (self-hosted, read-only token, no secrets) → `package` (AppImage, `.deb`, AUR
files, checksums; installs the `.deb` and starts it headless) → `sign` (only job with
`id-token: write`) → `publish` (only job with `contents: write`) → `aur` (no GitHub token; the
SSH key only) → `failure` (opens a `release-failure` issue). Locally, from a mach tarball:

```sh
tools/package/fetch-appimagetool.sh /tmp/ait
node tools/package/package.mjs --tarball engine/obj-x86_64-pc-linux-gnu/dist/vimma-*.tar.xz \
  --out dist --maintainer 'Name <email>' --appimagetool /tmp/ait/appimagetool \
  --runtime /tmp/ait/runtime-x86_64 --no-deb   # dpkg-deb only exists on Debian/Ubuntu
node tools/package/sbom.mjs --engine engine --out dist/vimma-$(node -p 'require("./surfer.json").brands.vimma.release.displayVersion').cdx.json
```

**Enable it (one time):**

1. Runner: the nightly's `vimma-build` runner ("Nightly build runner" above) must be online
   when a release is published. With the runner stopped outside the nightly window, start it
   before merging the release PR (the job waits up to 24 h in the queue).
2. Trigger: `gh secret set RELEASE_PLEASE_TOKEN` (fine-grained, this repo only: Contents, Pull
   requests and Issues read/write), so the release release-please creates starts `release.yml`.
   Without it, run it by hand after each release: `gh workflow run release.yml -f tag=vX.Y.Z`.
3. Safe Browsing key: the `SAFEBROWSING_API_KEY` secret ("Google Safe Browsing key" above);
   the `build` job fails without it, and its smoke check fails a build that lacks the key.
4. Maintainer line for the `.deb` and the PKGBUILD:
   `gh variable set PACKAGE_MAINTAINER --body 'Your Name <you@example.org>'` (public in every
   package; the `package` job fails without it).
5. Signing (recommended: keyless, no key to keep): `gh variable set SIGNING_ENABLED --body true`.
   Each signature records `JRanne/vimma`'s `release.yml` and the tag in the public Rekor log.
   Without the variable, `sign` is skipped and the assets go up unsigned.
6. AUR (optional; skipped with a notice until the secret exists):
   - Check the name is free: `curl -s 'https://aur.archlinux.org/rpc/v5/info?arg[]=vimma-bin'`
     must say `"resultcount":0` (and look at `vimma` too, which `vimma-bin` provides).
   - Create an account at <https://aur.archlinux.org/register>.
   - Make a key for the workflow only: `ssh-keygen -t ed25519 -N '' -C vimma-release -f aur_key`;
     paste `aur_key.pub` into My Account → SSH Public Key.
   - `gh secret set AUR_SSH_KEY < aur_key`, then delete `aur_key`. The first push creates
     `vimma-bin`; its maintainer is that account.
7. Enable: `gh variable set RELEASE_ENABLED --body true` (disable: `gh variable delete
RELEASE_ENABLED`). Try it on the next release, or re-run the last one with
   `gh workflow run release.yml -f tag=vX.Y.Z` (assets are replaced, `--clobber`).

**Runner rule:** until Settings → Actions → General has "Require approval for all outside
collaborators" set, the `vimma-build` runner must stay offline outside nightly and release
builds (fork PRs could add a workflow with `runs-on: vimma-build`). Release jobs themselves
cannot be started from a fork, and a manual run does nothing unless started from `main`. The
release build uses its own fresh objdir (`engine/obj-release`) and an empty sccache directory,
so nothing left on the runner by a nightly or another job reaches signed binaries.

**Verify a release** (the user guide's "Installing" points here):

```sh
v=0.1.0
gh release download "v$v" -R JRanne/vimma
sha256sum -c SHA256SUMS              # every file OK
cosign verify-blob --bundle SHA256SUMS.sigstore.json \
  --certificate-identity-regexp '^https://github\.com/JRanne/vimma/\.github/workflows/release\.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+)$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  SHA256SUMS                         # "Verified OK"
```

The identity accepts only this repository's `release.yml`, run for a `vX.Y.Z` tag (a published
release) or from `main` (a manual re-run); `release.yml` refuses to run from any other branch.
The issuer pins GitHub Actions' OIDC. Checking `SHA256SUMS`'s signature and then `sha256sum -c`
covers every file; each asset also has its own `<file>.sigstore.json`, verified the same way.
The regexp is `IDENTITY_REGEXP` in `tools/package/package.mjs`, and a test keeps the two equal.

**When it fails:** a `release-failure` issue links the run. Fix on `main`, then re-run for the
same tag. The tag is not deleted (plan §4 said so): release-please has already moved its
manifest and changelog past it, and the release notes stay valid. If the fix changes what is
built, release a patch version instead. To pull a bad release: `gh release edit vX.Y.Z --draft`
(hides it); the AUR package cannot go back a version without an `epoch`, so ship a fixed
release instead.

### Licences

`npm run license-check` checks every package in `package-lock.json` against MIT, ISC,
BSD-2/3-Clause, Apache-2.0, MPL-2.0. Reviewed exceptions live in
`tools/license-check/exceptions.json`, keyed by exact `name@version`, so an upgrade must be
re-reviewed; stale exceptions fail the check too.

`npm run license-check:crates` does the same for the Rust crates (`cargo metadata` on
`tools/vimma-ctl`, legacy `MIT/Apache-2.0` read as OR); exceptions would go in
`tools/license-check/cargo-exceptions.json`. vimma-ctl has no dependencies, so today it checks
only the crate itself (MPL-2.0).

## vimma-ctl (control socket client)

Spec m0-control-protocol-and-vimma-ctl, ADR-007, ADR-011. A std-only Rust binary in
`tools/vimma-ctl/`; the toolchain is pinned in its `rust-toolchain.toml` (rustup honours it;
Arch's system Rust 1.98.1 matches).

```sh
cd tools/vimma-ctl
cargo test                                    # unit (fixtures) + integration (fake server)
cargo fmt --check && cargo clippy --all-targets -- -D warnings
cargo build --release --locked                # → target/release/vimma-ctl, one file
install -Dm755 target/release/vimma-ctl ~/.local/bin/vimma-ctl
```

The control socket is **off by default**. Turn it on in `about:config`: `vimma.control.enabled`
= `true` (until the server spec lands, nothing listens; `vimma-ctl` then exits 3). The browser
writes `<profile>/vimma-control.json` (port, token, pid; mode 0600) while it runs.

```sh
vimma-ctl state                     # mode, pending keys, workspace, tabs (* = selected)
vimma-ctl state --json | jq .tabs   # the raw result; unknown fields pass through
vimma-ctl send-keys ctrl+b c        # chords in Herdr notation, space-separated
vimma-ctl open https://example.com  # new tab; prints its id
vimma-ctl --profile /tmp/p --timeout 2 state   # --timeout: seconds, at most 3600
```

Profile: `--profile DIR`, else `VIMMA_PROFILE`, else the default in
`~/.config/vimma/vimma/profiles.ini` (`$XDG_CONFIG_HOME` honoured; legacy `~/.vimma/vimma` if
present): the `[Install…]` section's `Default`, else the `[Profile…]` with `Default=1`.

| Exit | Meaning                                             | Typical fix                                                               |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| 1    | server answered with an error (`code: msg`)         | fix the arguments (e.g. `invalid-args` for a `javascript:` URL)           |
| 2    | usage                                               | `vimma-ctl --help`                                                        |
| 3    | not reachable: no profile/file, stale, unsafe, busy | start Vimma, set the pref, `chmod 600` the file, `--profile`; busy: retry |
| 4    | token or protocol refused                           | the file is from another run; restart Vimma                               |
| 5    | malformed reply or timeout                          | a server bug; `--timeout` for a busy browser                              |
