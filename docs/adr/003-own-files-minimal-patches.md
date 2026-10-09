# ADR-003: Our code lives in our own files

- Status: Accepted
- Date: 2026-10-09

## Context

Every upstream hunk we modify is a potential rebase conflict every month.

## Decision

All vimma code lives under `src/browser/base/content/vimma/` (and `browser/themes/shared/vimma/`, `browser/branding/vimma/`). Upstream files are touched only to inject our code, in the smallest possible hunk. Every new `.patch` file needs a line in this ADR.

## Reasoning

Keeps the patch set small and rebases mechanical. Same discipline as Zen's `zen-components`.

## Alternatives rejected

- **Edit upstream files freely**: faster initially, unsustainable under monthly rebases.

## Consequences

Some features need awkward indirection instead of a direct edit.

## Patch register

| Patch        | Why |
| ------------ | --- |
| _(none yet)_ |     |
