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

## CI and automation (spec m0-pipeline)

| Workflow       | Trigger                          | Runner                    | Needs from you                             |
| -------------- | -------------------------------- | ------------------------- | ------------------------------------------ |
| `ci.yml`       | push to `main`, PRs, manual      | `ubuntu-latest`           | nothing                                    |
| `e2e.yml`      | PRs touching the browser, manual | `ubuntu-24.04`            | nothing (ADR-010)                          |
| `nightly.yml`  | 03:00 UTC, manual                | self-hosted `vimma-build` | register the runner, set `NIGHTLY_ENABLED` |
| `upstream.yml` | every 6 h (`:17`), manual        | `ubuntu-latest`           | allow Actions to open PRs; optional token  |
| `claude.yml`   | `@claude`, `spec`+`claude:go`    | `ubuntu-latest`           | a secret, two labels, Actions may open PRs |
| Renovate       | Mondays before 07:00 Helsinki    | Renovate's own            | install the Renovate app                   |

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
nightly.yml) could push to `main`, since nothing protects it. Mitigations: those jobs run no
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

What it does not cover: compiled-in build config (C++ defines, `--disable-crashreporter`). Tests
of that carry `skip-if = ["artifact"]` in `tests/browser/browser.toml` and run in the nightly
(full build) and locally with plain `npm run mochitest`. If the job fails with "no built
artifacts found", Mozilla's index has no shippable linux64 build for `engine/sourcestamp.txt`'s
revision (release tasks are kept a year): check `surfer.json` points at a real release.

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

### Upstream bumps (`upstream.yml`)

`tools/upstream/check-release.py` prints `LATEST_FIREFOX_VERSION` from product-details when it
is newer than `surfer.json`; `bump-surfer-json.py` rewrites only that version. The workflow then
opens a draft PR `chore(upstream): Firefox X.Y` on branch `upstream/firefox-X.Y`. If a PR for
that branch is already open it does nothing; a branch left by a failed or closed run is rebuilt
from `main` and force-pushed, so a failed run is retried 6 h later.

Every bump PR: refresh the copy of `browser.newtabpage.activity-stream.asrouter.providers.cfr`
in `src/browser/branding/vimma/pref/firefox-branding.js` from `engine/browser/app/profile/firefox.js`,
keeping `"enabled":false` (spec m0-mozilla-services). A stale copy shadows upstream's provider.

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

### Licences

`npm run license-check` checks every package in `package-lock.json` against MIT, ISC,
BSD-2/3-Clause, Apache-2.0, MPL-2.0. Reviewed exceptions live in
`tools/license-check/exceptions.json`, keyed by exact `name@version`, so an upgrade must be
re-reviewed; stale exceptions fail the check too.
