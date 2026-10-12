# Spec: release-versioning

Status: implemented · Area: CI (`release-please-config.json`, `docs/runbook.md` "Releases",
`tools/package/test/release-workflow.test.mjs`). No upstream patch, no app code.

## The user's words

"i think we should start versioning this way 0.1.1 --> 0.1.2 etc."

## User stories

- As the maintainer, every release before 1.0 bumps the patch version, whether it brings `feat`
  or only `fix` commits: 0.1.1 → 0.1.2 → 0.1.3. A breaking change (`!`, `BREAKING CHANGE:`)
  still bumps the minor version (0.1.x → 0.2.0), so it stands out.
- As the maintainer, merging a release PR before I have daily-driven Vimma publishes nothing:
  release-please makes a **draft** GitHub Release that only collaborators see, and the tag
  `vX.Y.Z`. `release.yml` does not run for a draft. When the release gate opens, I publish the
  draft (or turn drafts off), and the release goes out as before.
- As the maintainer, no one-off setting pins every future release to one version.

## Research (release-please 17.6.0, bundled in release-please-action v5.0.0, pinned by SHA)

- `bump-patch-for-minor-pre-major` is in the v17 schema ("Feature changes only bump semver patch
  if version < 1.0.0"). In `DefaultVersioningStrategy.determineReleaseType`: breaking →
  minor when `bump-minor-pre-major` and pre-1.0; else `feat` → patch when
  `bump-patch-for-minor-pre-major` and pre-1.0; else patch. So with both on, `feat` and `fix`
  bump the patch and a breaking change the minor.
- `release-as` (schema: deprecated) is returned by `buildNewVersion` before any commit is
  looked at, so while it is set every release PR proposes that version again. It goes.
- `draft` ("Create the GitHub release in draft mode") is in the schema. GitHub creates no git tag
  for a draft until it is published. release-please finds its last release through the
  releases API, skipping releases without a tag commit, then through tags; with neither, it bumps
  the manifest version but lists every commit since the start of history. `force-tag-creation`
  (in the schema, and in 17.6.0's `createRelease`: it creates `refs/tags/vX.Y.Z` before the
  release) closes that gap, so it is on with `draft`.
- `release.yml` runs on `release: published` only. GitHub fires no `published` for a draft, and
  no workflow for the `created`/`edited`/`deleted` events of a draft. The tag is created with
  the release-please token through the API; no workflow here runs on tag pushes.

## Scope

- `release-please-config.json`: add `bump-patch-for-minor-pre-major`, `draft` and
  `force-tag-creation` (all `true`); keep `bump-minor-pre-major`; remove `"release-as"`.
- Tests (vitest, `tools/package/test/release-workflow.test.mjs`): the config has those options
  and no `release-as`; the manifest matches `surfer.json`'s `displayVersion`; `release.yml` has
  only the `published` release type.
- Runbook "Releases": bumps, drafts, the first release, and how to switch drafts off when the
  gate opens.

## The first release

No `v0.1.0` tag exists. The manifest's `0.1.0` is what every build so far shows, so
release-please treats it as released and the first release is **0.1.1**; its changelog lists
every `feat`/`fix` since the first commit (as #127 does today). The open release PR #127
(`chore(main): release 0.1.0`) is rewritten on the next push to `main` after this merges:
`chore(main): release 0.1.1`, same branch and number.

## Open questions

- Breaking changes before 1.0: keep 0.1.x → 0.2.0 (recommended: a breaking change, such as a
  renamed config key, should stand out in the number). release-please has no option to bump the
  patch for a breaking change; without `bump-minor-pre-major` it would bump to 1.0.0.
- First release 0.1.1 (recommended: 0.1.0 is what the dev builds already say) or 0.1.0 (push a
  commit with a `Release-As: 0.1.0` footer before merging the release PR; it applies once).
