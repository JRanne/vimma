# ADR-004: Language: JavaScript ES modules with JSDoc types

- Status: Accepted
- Date: 2026-10-09

## Context

Firefox chrome code is JS (`.sys.mjs` / `.mjs`). We want type safety without a compile step inside the Firefox tree.

## Decision

Write plain ES modules with JSDoc types, type-checked by `tsc --checkJs` (no emit) in CI.

## Reasoning

No transpile step means patches and stack traces map 1:1 to source; debugging in the Browser Toolbox works directly.

## Alternatives rejected

- **TypeScript with a build step**: complicates Surfer integration and debugging inside the Firefox tree.

## Consequences

JSDoc is more verbose than TS syntax; tsc strictness must be enforced in CI.
