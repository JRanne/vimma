# Spec: ci-quality-gates

Status: implemented, awaiting review · Milestone: M0 (pipeline) · Area: CI (`.github/workflows/`,
`tools/bench/`, `tools/mutation/`)

## User story

As the maintainer, I learn weekly which core changes no test would notice, and a PR that makes
key-to-action in core slower by more than 10 % (or over 50 µs) fails CI without flaking.

## Scope

Two rows of plan §5 and issue #17:

- **Unit layer:** "Stryker mutation testing weekly, survivors become issues."
- **Performance:** "Key-to-action latency in core (< 50 µs) … Regression > 10 % fails CI."
  Key-to-paint (< 5 ms) stays with the e2e timers (issue #17, third bullet); not in this spec.

## Tests (written first)

- `tools/bench/test/compare.test.mjs`: median and min-of-medians; combining processes keeps the
  lowest; a suite (geometric mean) > 10 % over the baseline fails, exactly 10 % passes, one case
  at +15 % only notes, one case > 25 % fails; a slower runner with the same ratio passes; any
  case over 50 µs fails even without a baseline; an unknown machine and a new case only advise; a
  baseline case that was not measured fails; the CLI exits 0/1/2.
- `tools/bench/test/cases.test.mjs`: the cases cover a single key, the prefix plus a key and a
  count plus a motion, and each produces the action it names on every run.
- `tools/mutation/test/report.test.mjs`: the score matches Stryker's formula; survivors are listed
  per file, sorted; the body stays under GitHub's 65 536-character limit; the CLI writes `score`
  and `survivors` to `$GITHUB_OUTPUT`.

## Settled (2026-10-09)

- **Stryker's command runner, not `@stryker-mutator/vitest-runner`.** vitest-runner 10.0.0 (the
  latest) predates Vitest 5 and silently under-tests on it: it filters tests with names joined by
  spaces, Vitest 5 matches the filter against names joined by `" > "`, so tests inside
  `describe()` never run and their mutants are reported as survivors (dispatcher.mjs: 32 % with
  it, 85 % with the command runner). The command runner (part of `@stryker-mutator/core`) runs the
  core suite once per mutant (`packages/vimma-core/vitest.config.mjs`, one worker, `--bail 1`).
  Only one dependency added: `@stryker-mutator/core` 10.0.0, Apache-2.0, pinned exactly. Two of
  its transitive packages are outside the allowlist and have reviewed exceptions: `tslib` (0BSD)
  and `caniuse-lite` (CC-BY-4.0, data, dev-only).
- **Incremental mode, results carried as an artifact.** Each run uploads `mutation-report`
  (HTML, JSON, incremental file; 35 days); the next run downloads the last successful one with
  `gh run download` (`actions: read`). The Actions cache was rejected: it evicts entries unused
  for 7 days, exactly the schedule's period. Without per-test coverage, incremental mode only
  re-tests mutants in changed source files, so a survivor killed by a new test would linger; the
  first Sunday of each month (and a manual run with `full`) re-tests everything.
- **Two jobs in mutation.yml.** The job that runs repository code (npm ci, Stryker, tests) has
  `contents: read` and `actions: read`; only the report job, which runs no npm code, has
  `issues: write`. Costs one extra billed minute a week.
- **Bench: own harness, not `vitest bench`.** `tools/bench/bench.mjs` warms up each case, times
  batches of ≥ 100 µs each followed by a batch of a fixed reference workload, and takes per case
  the median ratio (51 samples a round, median over 5 rounds) and the minimum µs; then the lowest
  of each over 15 fresh processes. The old `core.bench.mjs` (mean latency, no baseline) is gone.
- **The 10 % gate is on the suite.** Measured on a laptop pinned to 2 CPUs, 8 whole runs: single
  cases spread up to 14 % (max−min), the geometric mean of all cases 6 %. One process alone spread
  20–30 % (JIT modes), hence the 15 processes. So: fail when the geometric mean of the cases'
  changes exceeds 10 %, or one case exceeds 25 %; always fail over 50 µs.
- **Baseline per runner class.** `packages/vimma-core/bench/baseline.json` holds one entry per
  `CPU model | arch | Node major`. The relative gate applies only on a recorded machine; elsewhere
  only the 50 µs budget applies and the run prints the entry to record. GitHub's hosted pool mixes
  CPU models, and a ratio measured on one microarchitecture is not comparable with another.
- **A step in ci.yml, not nightly.** Nightly runs on the self-hosted build runner (not enabled
  yet, and a different machine class); the plan wants the gate on PRs. The step costs seconds and
  no extra job minute.

## Handover

Done. Follow-up: when the CI log of another runner CPU model prints "no baseline for machine",
record it as in docs/runbook.md "Bench baseline".
