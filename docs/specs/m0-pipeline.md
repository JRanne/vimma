# Spec: m0-pipeline

Status: ready · Milestone: M0 · Area: CI (`.github/workflows/`)

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
- Branch protection on `main` (documented in `docs/runbook.md`; applied by `gh api` once the repo
  is on GitHub): CI required, signed commits, one approval.

## Tests (write first)

- `tools/upstream/test_check_release.py`: given a fixture JSON with a newer version, outputs it;
  same version → no output; malformed JSON → non-zero exit.
- `bump-surfer-json.py`: fixture `surfer.json` in, expected out.
- A deliberately failing commit message (`feat: x` without body) is rejected by commitlint.

## Out of scope

Release workflow (M6), signing, AUR.
