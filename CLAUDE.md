# Vimma

Keyboard-first Firefox fork (Surfer). Neovim modal layer + Herdr prefix keymap (ctrl+b),
workspaces as containers, on-demand side panel, always-visible status bar, Omarchy theming.
Read plan.md once per milestone; read docs/specs/<current>.md every session.

## Commands

- npm test # Vitest for packages/vimma-core (fast, run constantly)
- npm run typecheck # tsc --checkJs over src/**/vimma/** and packages/**
- npm run lint # eslint + prettier check
- npm run gen-docs # regenerate docs/bindings.md from actions.mjs
- npm run import # sync-core + surfer import: symlink src/ and tests/ into engine/; rerun after editing packages/vimma-core
- npx surfer build --ui && npx surfer run # rebuild our UI only, launch (plain ./mach build after a moz.build change)
- npm run mochitest -- tests/browser/browser_vimma_<name>.js
- npm run e2e -- --filter <name> # socket-driven e2e under Xvfb

## Rules

- TDD: write the failing test, run it, paste red output; implement; paste green. Never loosen a test.
- packages/vimma-core imports nothing from Firefox. Enforced by eslint; do not disable the rule.
- Our code lives in src/browser/base/content/vimma/. Touch upstream files only to inject ours,
  in the smallest hunk possible. A new .patch needs a line in the ADR for it.
- Never edit screenshot baselines or snapshots without a changelog line explaining the change.
- Conventional Commits with a body; the body is the changelog line.
- User-visible change → update docs/guide.md (and README status if it changes what works).
- No new dependency without a licence check and a PR line. No #[allow]-style suppressions
  (eslint-disable) without a reason comment.
- Never disable a workflow, pin, or lint rule to get green. Stop and report instead.
- When unsure how Firefox's front end does something: grep the engine tree and Zen's
  components; do not guess from memory.

## Layout

- packages/vimma-core: dispatcher, key notation, actions.mjs, keymap, state tree (pure)
- src/.../vimma/host: VimmaHost.sys.mjs (key capture, applies actions to gBrowser)
- src/.../vimma/actors: JSWindowActor parent/child (focus, scroll, hints, caret)
- src/.../vimma/ui: status bar, which-key, help overlay, command line, side panel, pickers
- src/.../vimma/workspaces, split, config, ctl
- tests/browser: mochitests; tests/e2e: socket scenarios + baselines

## Context hygiene

- One spec per session. Clear after merge, before review, after 3 failed attempts, when switching area.
- Before clearing mid-task: commit or stash, and write a handover paragraph into the spec.
