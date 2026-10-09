# ADR-005: `vimma-core` is a pure ES module package

- Status: Accepted
- Date: 2026-10-09

## Context

Most behaviour (key parsing, dispatch, keymaps, pane/workspace state) does not need a browser, and browser tests are slow.

## Decision

`packages/vimma-core` contains the dispatcher, key notation, keymap merge, actions and state tree with **zero Firefox imports** (enforced by eslint). It is tested with Vitest in Node and copied into `src/` by `npm run sync-core`.

## Reasoning

~80% of behaviour becomes testable in milliseconds; the same module could run in an extension or other host.

## Alternatives rejected

- **Logic inside the host modules**: only testable via mochitest, slow feedback.

## Consequences

A sync step between `packages/` and `src/`; the host must translate DOM events into core's plain key objects.
