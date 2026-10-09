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
engine/obj-x86_64-pc-linux-gnu/dist/bin/vimma --version   # "Mozilla vimma 1.0.0"
engine/obj-x86_64-pc-linux-gnu/dist/bin/vimma --headless --no-remote --profile "$(mktemp -d)" \
  --screenshot /tmp/shot.png "data:text/html,<h1>ok</h1>"
```

Known after first build (branding not done yet, brand defaults to `unofficial`): version string is
`Mozilla vimma 1.0.0`, and a fresh profile logs "Failed to import bookmarks from
chrome://browser/content/default-bookmarks.html". Both belong to the M0 branding task.

## CI and automation (spec m0-pipeline)

| Workflow       | Trigger                       | Runner                    | Needs from you                               |
| -------------- | ----------------------------- | ------------------------- | -------------------------------------------- |
| `ci.yml`       | push to `main`, every PR      | `ubuntu-latest`           | nothing                                      |
| `e2e.yml`      | every PR                      | `ubuntu-latest`           | nothing (no-op until the build-strategy ADR) |
| `nightly.yml`  | 03:00 UTC, manual             | self-hosted `vimma-build` | register the runner, set `NIGHTLY_ENABLED`   |
| `upstream.yml` | every 6 h (`:17`), manual     | `ubuntu-latest`           | allow Actions to open PRs; optional token    |
| `claude.yml`   | `@claude`, `spec`+`claude:go` | `ubuntu-latest`           | Claude GitHub app + a secret                 |
| Renovate       | Mondays before 07:00 Helsinki | Renovate's own            | install the Renovate app                     |

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

### Actions minutes budget

The free plan has a limited monthly budget of minutes for private repos, billed per job and rounded
up to the minute. Rough use: CI ≈ 2 min and e2e ≈ 1 min per PR push; upstream 4 × 1 min a day
(≈ 120 min a month); claude.yml only when triggered. `nightly.yml` uses the self-hosted runner,
which costs no hosted minutes. Check usage in Settings → Billing → Usage.

### Nightly build runner (`nightly.yml`)

A full build does not fit a GitHub-hosted runner (22 GB `engine/`, 39 min on 16 threads), so it
runs on a self-hosted runner, e.g. this dev box or a dedicated machine. Only for this private
repo: never attach a self-hosted runner to a public repo that takes fork PRs.

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
opens `chore(upstream): Firefox X.Y` on branch `upstream/firefox-X.Y` (skipped if the branch
exists). One-time setup:

1. Settings → Actions → General → Workflow permissions → tick "Allow GitHub Actions to create and
   approve pull requests" (`gh pr create` with the default token fails without it).
2. Recommended: PRs opened with the default `GITHUB_TOKEN` do not trigger `ci.yml`. Create a
   fine-grained token for this repo only (Contents + Pull requests: read/write) and store it:
   `gh secret set UPSTREAM_PR_TOKEN`. The workflow uses it when present.

Before merging a bump: `npm run import && npx surfer build` on the build machine (the nightly does
this once merged).

### Claude Code in GitHub (`claude.yml`)

Follows `anthropics/claude-code-action` v1. Until a secret exists every run is green and skips
all work with a notice.

1. Install the Claude GitHub app on the repo: <https://github.com/apps/claude>.
2. Add one secret: `gh secret set ANTHROPIC_API_KEY`, or with a Pro/Max plan run
   `claude setup-token` and `gh secret set CLAUDE_CODE_OAUTH_TOKEN`.
3. Create the labels: `gh label create spec`, `gh label create claude:go`
   (`bot`, `upstream`, `nightly-failure` are created by the workflows).
4. Use: `@claude` in an issue, comment or review; or label a `spec` issue `claude:go` to get a
   draft PR labelled `bot`. Only you add `claude:go`; Claude Code never merges.

The job token is scoped to contents, pull-requests and issues (write), `actions: read` and
`id-token: write` for the Claude app token; no other secret is passed.

### Renovate

1. Install the Renovate GitHub app for this repo: <https://github.com/apps/renovate> → Configure →
   Only select repositories → `vimma`.
2. It opens an onboarding PR only when no config exists; `renovate.json` is already here, so the
   first run goes straight to the dependency dashboard issue and update PRs.

`renovate.json`: npm and GitHub Actions only, Mondays, releases at least 3 days old, actions kept
pinned to commit SHAs. Patch/minor/digest PRs automerge once all checks pass; Renovate merges them
itself (`platformAutomerge: false`, since there is no branch protection for GitHub auto-merge to
wait on). Majors and `@zen-browser/surfer` stay open for review.

### Licences

`npm run license-check` checks every package in `package-lock.json` against MIT, ISC,
BSD-2/3-Clause, Apache-2.0, MPL-2.0. Reviewed exceptions live in
`tools/license-check/exceptions.json`, keyed by exact `name@version`, so an upgrade must be
re-reviewed; stale exceptions fail the check too.
