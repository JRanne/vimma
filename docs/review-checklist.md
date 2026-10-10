# Review checklist

Posted on every PR by the reviewer (a fresh Claude Code session with the spec open, then the
maintainer). Plan §4, step 5. Each item is ticked, or answered "n/a" with a reason.

- [ ] A spec exists (`docs/specs/<name>.md`) and the PR stays inside its scope.
- [ ] The tests prove the behaviour in the spec's acceptance criteria. They were written first,
      and the PR or spec shows the red run and then the green run.
- [ ] No test was weakened: no loosened assertion, removed case or new skip without a reason.
- [ ] No new action without a docs line: `npm run gen-docs` was run and `docs/bindings.md` is
      current.
- [ ] A config schema change comes with a migration and a new contract fixture pair.
- [ ] No new upstream `.patch` without a line in ADR-003's patch register. Boundary changes have
      an ADR.
- [ ] No new dependency without a licence check and a PR line (`npm run license-check`).
- [ ] No snapshot or screenshot baseline changed without a changelog line explaining why.
- [ ] Touches `*.patch`, `configs/`, `moz.configure` or branding → a full-build mochitest run is
      reported (ADR-010).
- [ ] User-visible change → update `docs/guide.md` (and the README feature list or status if it changes what works).
- [ ] User-visible change → a line in `CHANGELOG.md` `[Unreleased]` (the coordinator adds it at merge time, so
      parallel PRs do not conflict).
- [ ] Every commit is a Conventional Commit with a body. The subject is the changelog line; the body
      explains why.
