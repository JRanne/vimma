# ADR-001: Engine: Firefox fork built with Surfer

- Status: Accepted
- Date: 2026-10-09

## Context

vimma needs total keyboard ownership (URL bar, about: pages, PDF viewer), real split panes and an always-visible status bar, built and maintained by one person.

## Decision

Fork Firefox using Surfer (the toolchain Zen Browser uses).

## Reasoning

Firefox's browser UI is JS/CSS/XHTML, so panes, status bar and key capture are front-end work rather than C++. Zen demonstrates that a small team can ship this feature set and track upstream with Surfer.

## Alternatives rejected

- **Chromium fork**: C++ UI, multi-hour builds, monthly rebases of a ~30M-line tree.
- **CEF + Rust shell**: loses the WebExtension ecosystem entirely.
- **WebExtension only**: cannot capture keys in the URL bar, about: pages or PDF viewer; no real panes; no real status bar.
- **Fork Zen itself**: tracking two fast-moving upstreams doubles rebase work. Revisit if we end up re-implementing most of Zen.

## Consequences

We depend on Surfer (small project; it is a thin Node CLI over `mach`, so we can fork it into `tools/` if it stalls). Full builds are slow; see ADR-002 and the M0 build-strategy question.
