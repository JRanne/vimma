# ADR-009: Only an ambiguous pending sequence times out

- Status: Accepted
- Date: 2026-10-09

## Context

The m0-help-overlay host armed the `timeout_ms` flush timer on every `pending` result, so
`ctrl+b`, a pause, then `x` cancelled the prefix and typed `x` into the page. Plan §2 says the
prefix is transient until one command or `Esc`; the dispatcher contract says `flush()` resolves
an _ambiguous_ pending (`g` bound and `gg` bound).

## Decision

The dispatcher gains `ambiguous()`: true when the pending buffer is itself a complete binding,
i.e. `flush()` would resolve it to an action. The host arms the timer only then. A bare prefix,
a dead modal prefix (`g` with no `g` binding) and a count stay pending until the next key or `Esc`.

## Reasoning

Keeps the timer policy in the host but the knowledge of the trie in core, testable in Vitest.

## Alternatives rejected

- **A flag on the `pending` result** (`{ kind: "pending", ambiguous: true }`): changes the shape
  every caller and test matches on.
- **Host inspects `pending()` labels**: duplicates trie knowledge outside core.

## Consequences

`createDispatcher` returns `{ dispatch, flush, reset, pending, ambiguous, timeoutMs }`.
