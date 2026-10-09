# Spec: m0-pipeline

Status: implemented, awaiting review · Milestone: M0 · Area: CI (`.github/workflows/`)

## User story

As the maintainer, every push is linted, typechecked and tested; nightlies build without me;
new Firefox releases arrive as PRs.

## Scope

- `ci.yml` (push + PR): `npm ci`, `npm run lint`, `npm run typecheck`, `npm run coverage`
  (90 % gate in `vitest.config.mjs`), commitlint over the PR range, licence check of
  `package-lock.json` (allowlist: MIT, ISC, BSD-2/3, Apache-2.0, MPL-2.0), and a custom
  commitlint rule: `feat`/`fix` require a non-empty body.
- `e2e.yml` (PR): skeleton job that runs only once the M0 build-strategy ADR picks
  UI-only vs artifact build; until then it is a no-op with a TODO naming the ADR.
- `nightly.yml` (03:00 UTC): full Linux x86_64 build via Surfer on a large or self-hosted runner,
  publish rolling `nightly` release; on failure open an issue with logs.
- `upstream.yml` (every 6 h): `tools/upstream/check-release.py` polls
  `https://product-details.mozilla.org/1.0/firefox_versions.json` (`LATEST_FIREFOX_VERSION`);
  on change, `bump-surfer-json.py` + PR `chore(upstream): Firefox X.Y`.
- `claude.yml`: `@claude` mentions; `spec` + `claude:go` labelled issues → draft PR. Scoped token.
- `renovate.json`: npm + GitHub Actions; automerge patch/minor after CI.
- ~~Branch protection on `main`~~: dropped, see Settled.

## Tests (write first)

- `tools/upstream/test_check_release.py`: given a fixture JSON with a newer version, outputs it;
  same version → no output; malformed JSON → non-zero exit.
- `bump-surfer-json.py`: fixture `surfer.json` in, expected out.
- A deliberately failing commit message (`feat: x` without body) is rejected by commitlint.

## Settled (2026-10-09)

- **No branch protection for now** (user decision). GitHub refuses it on this free private repo
  (`gh api …/branches/main/protection` → 403 "Upgrade to GitHub Pro"). `docs/runbook.md` says it
  is deliberately off. PRs merge after review and green checks; no required approvals.
- **nightly.yml runs on a self-hosted runner** labelled `vimma-build` (22 GB `engine/`, 39 min
  build: too big for hosted runners). The schedule is gated by `vars.NIGHTLY_ENABLED == 'true'`;
  `workflow_dispatch` bypasses the gate so the runner can be tested first. `clean: false` keeps
  `engine/` between runs; Firefox is re-downloaded only when `surfer.json` changes. Full e2e on
  the nightly waits for the build-strategy ADR (TODO in the workflow).
- **e2e.yml** is a no-op job naming the build-strategy ADR (to be `docs/adr/010-*`).
- **claude.yml** follows anthropics/claude-code-action v1.0.247 (`examples/claude.yml`,
  `docs/setup.md`): interactive `@claude` job plus a `spec` + `claude:go` job in automation mode
  that opens a draft PR labelled `bot` (the action never opens PRs itself, so the prompt does it
  with `gh pr create --draft`). Accepts `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`; without
  either, steps skip and the run is green.
- **upstream.yml** needs no `npm ci` (Python stdlib scripts) to stay cheap. It does not run
  `surfer import` + build: that needs the self-hosted runner; the PR body says to, and the nightly
  does it after merge. `GITHUB_TOKEN` PRs do not trigger CI, so an optional `UPSTREAM_PR_TOKEN`
  secret is used when present.
- **Licence check is a small script**, not a dependency: `tools/license-check/license-check.mjs`
  (SPDX `AND`/`OR`, spec allowlist). Four permissive dev-only packages are outside the allowlist
  and listed with reasons in `tools/license-check/exceptions.json`, pinned to `name@version`:
  argparse (Python-2.0), minimatch (BlueOak-1.0.0), os-shim (MIT in its LICENSE, none in the
  lockfile), pako (MIT AND Zlib). Stale exceptions fail the check.
- **commitlint rule** `body-required-for-types` lives in `tools/commitlint/body-required.mjs` as
  a local plugin; every commit on `main` passes it. Vitest now also runs `tools/**/test/`.
- **CI also runs** `npm run test:py` and `npx surfer license-check` (MPL headers, exits 1 on a
  missing header). Actions are pinned to commit SHAs; Renovate keeps them pinned.
- **Renovate** uses `platformAutomerge: false` so Renovate itself waits for green checks (with no
  branch protection, GitHub auto-merge has nothing to wait on). `@zen-browser/surfer` and majors
  never automerge.
- Workflow YAML is checked with actionlint v1.7.12 via `go run` (not installed, not a repo
  dependency); `.github/actionlint.yaml` declares the `vimma-build` runner label.

## Out of scope

Release workflow (M6), signing, AUR.
