# ADR-006: Split view is vendored from Zen

- Status: Superseded by [ADR-013](013-split-on-firefox-split-view.md) (split panes build on Firefox's own split view)
- Date: 2026-10-09

## Context

Making `tabbrowser` tolerate several visible browsers is hard; Zen has already done it.

## Decision

Vendor Zen's split view (MPL-2.0, attribution and licence headers kept) into `src/browser/base/content/vimma/split/` and adapt it to the vimma pane tree.

## Reasoning

Months of `tabbrowser` focus/selection work are open source and licence-compatible.

## Alternatives rejected

- **Write from scratch**: high risk of focus/URL-bar bugs (risk table, plan §9).

## Consequences

We must track Zen's split view for fixes; adaptations should stay small and documented.
