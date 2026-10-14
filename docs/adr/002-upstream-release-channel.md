# ADR-002: Upstream: Firefox release channel

- Status: Accepted
- Date: 2026-10-09

## Context

We must choose which Firefox channel to track and how often to rebase.

## Decision

Track the Firefox **release** channel. Rebase every 4 weeks and on every dot release, driven by an automated PR from `upstream.yml`.

## Reasoning

Release is what Zen tracks and what users expect. Security dot releases must ship quickly (target: within 7 days, unattended).

## Alternatives rejected

- **ESR**: fewer rebases but web platform features arrive up to a year late.
- **Beta/Nightly**: too much churn for one maintainer.

## Consequences

Monthly rebase cost; mitigated by ADR-003 (minimal patch surface) and automation.

Amended by [ADR-015](015-upstream-autopilot.md): the bump PR arrives rebased and tested, and the
target for security dot releases is 3 days, enforced by a drift check.

Amended by [upstream-beta-canary](../specs/upstream-beta-canary.md): Vimma still tracks and ships
the release channel, and now also tests the Beta channel without tracking it. Since 154.0 Firefox
releases a major version every two weeks, and its first Beta appears about 15 days before the
release, so a release leaves too little time between its publication and the drift deadline to
find breakage there. `upstream-beta.yml` runs `main`'s patches and suites on each Beta build and
reports findings in an issue; it never changes the pin, never opens a PR and is never a required
check. The rejection of Beta and Nightly as the tracked channel is unchanged.
