# Developing Vimma

How to build, run and test Vimma, and how changes get in. For what Vimma is and does, see the
[README](README.md); for using it, the [user guide](docs/guide.md).

## Requirements

- Linux x86_64 (the only platform built and tested so far).
- About 35 GB of free disk space, as measured on one machine: `engine/` 27 GB (source and the
  full build), the sccache compiler cache 6.8 GB, toolchains in `~/.mozbuild` 3.1 GB and the
  Firefox source download in `.surfer/` 0.8 GB.
- Node.js 20 or later, Python 3, git.
- Time: the first full build took 39 min on a 16-thread Ryzen with 58 GB RAM. The Firefox source
  download took 12.5 min. See [docs/runbook.md](docs/runbook.md).

## Build and run

```sh
npm ci                  # dev tools, including Surfer
npx surfer download     # Firefox source for the version in surfer.json, into engine/
npx surfer bootstrap    # Mozilla's toolchains into ~/.mozbuild (once)
npm run import          # apply Vimma's files and patches, select the vimma brand
npx surfer build        # full build
```

Run it:

```sh
npm start               # full build if present, else the artifact build; ~/.cache/vimma-dev-profile
npm start -- --fresh    # a throwaway profile instead
npm start -- --import   # run `npm run import` first
npm start -- --profile DIR -- --jsconsole   # another profile; after the second -- browser flags
```

`npm start` (`tools/start.mjs`) passes its own profile, so it never touches your Firefox profile
(remoting is keyed by app name and profile: a `vimma` command line never reaches Firefox), and refuses to start a second instance on the same profile. It adds
one line to the profile's `user.js` (other lines are kept):
`security.sandbox.content.read_path_whitelist` set to this checkout's `src/`. A local build's
front-end files are symlinks into `src/`, outside the Firefox tree, and without that pref the
content sandbox refuses them, so Vimma's page actor never loads (packaged builds copy the files
and do not need it). `npx surfer run` uses a scratch profile without it.

After editing JavaScript or CSS under `src/`, run `npm run import && npx surfer build --ui`. That
rebuilds only the front end. Changes to branding, `configs/` or `moz.configure` need a full
`npx surfer build`.

`npm run import` first restores the upstream files our `.patch` files touch
(`tools/import/restore-patched.mjs`, the `+++ b/` paths, `--dry-run` to list them), so an edited
patch re-applies cleanly instead of failing on its old version; nothing else in `engine/` is
reset. After moving the checkout to another path, run
`node tools/import/relocate-checkout.mjs --from <old path>` before importing: it retargets
`engine/`'s absolute symlinks and rewrites the old path in the objdir
([runbook](docs/runbook.md#moving-the-checkout)).

## Testing

```sh
npm test                 # Vitest: vimma-core and tools (fast, no browser)
npm run typecheck        # tsc --checkJs
npm run lint             # eslint + prettier --check
npm run mochitest -- tests/browser/                       # browser tests on your full build
npm run mochitest -- tests/browser/browser_vimma_tabstrip.js
npm run sites -- --filter github                          # live sites, a report (docs/runbook.md)
```

A test that needs a temp dir makes it with `tempDir(prefix)` from `tools/test/temp-dir.mjs`,
which removes it when the test ends, also when it fails. `npm test` runs with a `TMPDIR` of its
own and fails if a test leaves anything in it. A mochitest removes its temp files in
`registerCleanupFunction`, and a Rust test drops its temp dir guard.

You can also test the front end without a full build. An artifact build puts our front end on
top of Mozilla's compiled binaries for the same release, and is what PR CI uses
([ADR-010](docs/adr/010-pr-artifact-builds.md)):

```sh
npm run import
node tools/artifact-build/artifact-build.mjs    # ~25 s warm; first run downloads 163 MB
npm run mochitest -- --artifact tests/browser/
```

An artifact build cannot check compiled-in settings (the `--version` string, the crash reporter
flag). A PR that touches patches, `configs/`, `moz.configure` or branding must report a
mochitest run on a full build.

## Project layout

| Path                              | What                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/vimma-core/`            | Pure ES modules with no Firefox imports: key notation, actions, keymap, dispatcher, config and theme. Tested with Vitest.                        |
| `src/browser/base/content/vimma/` | Our browser code: the key host, actors, UI, workspaces, split panes, config and the control socket. `core/` is copied in by `npm run sync-core`. |
| `src/**/*.patch`                  | The small upstream patches, each listed in [ADR-003](docs/adr/003-own-files-minimal-patches.md).                                                 |
| `configs/`                        | mozconfigs and branding inputs.                                                                                                                  |
| `tests/browser/`                  | Mochitests (`browser_vimma_*.js`).                                                                                                               |
| `tools/`                          | Build, upstream-bump, licence and commitlint helpers.                                                                                            |
| `docs/`                           | [User guide](docs/guide.md), [bindings](docs/bindings.md), [limits](docs/limits.md), specs, ADRs, [runbook](docs/runbook.md).                    |

## Workflow

Vimma follows a spec-first, test-first loop ([plan.md](plan.md) §4–§5):

- **Issues.** Every planned feature has one GitHub issue (label `planned`) with a short reason,
  a link to its spec and the spec's open questions. The issues are the backlog; the
  [Vimma roadmap](https://github.com/users/JRanne/projects/2) board tracks them, and
  [plan.md](plan.md) §6 keeps only the milestones and their order.
- **Specs.** Every feature starts as `docs/specs/<feature>.md`, written to
  [docs/specs/README.md](docs/specs/README.md). A spec merges to `main` at once as a draft with
  its open questions; the maintainer answers them in the feature's issue, each answer is a small
  edit merged at once, and the spec is accepted when nothing is open (the "Lifecycle" section of
  that page). Boundary changes and new upstream patches need an ADR in `docs/adr/`.
- **Pull requests.** A pull request is only for work that is ready to merge. Work that waits on a
  decision is a question in its issue, not an open pull request.
- **TDD.** Write the failing test and run it, then implement until it passes. Never loosen a test.
- **Commits.** Use Conventional Commits with a body: the subject is the changelog line; the body
  explains why.
  `npx commitlint --from origin/main` checks this, and CI rejects `feat` and `fix` commits
  without a body.
- **Docs.** A user-visible change updates [docs/guide.md](docs/guide.md), and the README's
  status if it changes what works. See [docs/review-checklist.md](docs/review-checklist.md).
- **Agents.** [CLAUDE.md](CLAUDE.md) sets the rules for AI coding agents. They apply to human
  contributors too.

Before pushing, run `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:py`,
`npm run license-check` and `npx surfer license-check`.

## Branch policy

A ruleset protects `main`:

- **Pull requests only.** Nobody pushes to `main` directly. PRs are squash-merged, so history
  stays linear and each PR is one commit whose subject is the PR's changelog line.
- **Required checks.** A PR merges only when these pass: "lint, typecheck, test, commitlint,
  licences" (`ci.yml`), "mochitest (artifact build)" (`e2e.yml`), the Semgrep check
  (`semgrep.yml`), "CodeQL (javascript-typescript)" and "CodeQL (rust)". A PR that changes only
  prose Markdown skips the build and the tests, and those checks still pass; prettier,
  commitlint, the Markdown checks, Semgrep and CodeQL run on every PR
  ([runbook](docs/runbook.md#docs-only-pull-requests-issue-245)).
- **Code scanning gate.** A PR that adds a code-scanning alert of severity high or above
  cannot merge. Fix the alert; a false positive is dismissed on GitHub with a reason, never
  silenced in the code.
- **No force-push or deletion** of `main`.
- **Branches are deleted on merge.** Start new work from a fresh `origin/main`.
- **Auto-merge is available.** Turn it on for a PR and it squash-merges once the checks pass.

## Dependency updates

Dependabot ([.github/dependabot.yml](.github/dependabot.yml)) keeps npm, the vimma-ctl crate,
its Rust toolchain and the GitHub Actions current:

- **Weekly, grouped.** On Monday mornings (Helsinki) it opens one PR per ecosystem with every
  minor and patch update, and one PR per major update. A release must be three days old first.
  Titles read `build(deps): bump …`, which commitlint accepts.
- **Security fixes come at once.** A Dependabot alert gets its fix PR as soon as there is one,
  outside the schedule. When a parent package pins the vulnerable version, add an `overrides`
  entry to the root `package.json` instead (as for `sharp` and `qs`) and say why in the PR.
- **Auto-merge when green.** [dependabot-automerge.yml](.github/workflows/dependabot-automerge.yml)
  turns on auto-merge for security, patch and minor updates. They merge only once every
  required check above passes, licences included: a new licence or a new version of a package
  with a licence exception fails `npm run license-check` until a person reviews it.
- **Majors need review.** Major updates, every GitHub Actions update (workflows hold write
  tokens) and `@zen-browser/surfer` version updates get a comment and wait for a person to read
  the changelog, fix what breaks and merge.
- **By hand.** Node in `.nvmrc` (see the bench baseline in [docs/runbook.md](docs/runbook.md))
  and the Semgrep image digest in `semgrep.yml` are not covered; bump them in their own PR.

## More

- [docs/runbook.md](docs/runbook.md): builds, CI, e2e tests, parallel browser lanes and releases.
- [docs/rebase.md](docs/rebase.md): moving to a new Firefox release.
- [docs/review-checklist.md](docs/review-checklist.md): what a PR needs before merge.
- [docs/security.md](docs/security.md): the security model, a rule per risky component with the
  tests that enforce it. A change that touches one of those components keeps its rules true
  and its test links valid (CI checks them); vulnerabilities are reported as
  [SECURITY.md](SECURITY.md) says.
- [docs/adr/](docs/adr/) and [docs/specs/](docs/specs/): decisions and feature specs.
- [plan.md](plan.md): the roadmap.
