# Rebase playbook: moving to a new Firefox release

We track Firefox **release**: every 4-weekly release and every dot release (ADR-002). Our upstream
surface is the `.patch` files under `src/` (ADR-003 lists each one and why). Plan §6 budgets half
a day for each of the first three bumps. After that the bump should be automatic. This page is the
procedure, from the bot's PR to a merged bump, plus the fast path for security releases and how
to roll back. Background: [ADR-002](adr/002-upstream-release-channel.md),
[ADR-003](adr/003-own-files-minimal-patches.md), [ADR-010](adr/010-pr-artifact-builds.md),
[runbook](runbook.md) (CI and automation). Spec: [m0-rebase-playbook](specs/m0-rebase-playbook.md).

## At a glance

| #   | Step                                     | Where                                | Time                    |
| --- | ---------------------------------------- | ------------------------------------ | ----------------------- |
| 1   | Bot opens the bump PR with a patch check | `upstream.yml`, hosted runner        | ≤ 6 h after the release |
| 2   | Download the new source                  | build machine (self-hosted or yours) | 12.5 min                |
| 3   | Import; fix any patch that fails         | build machine                        | 1 min, plus fixes       |
| 4   | Full build + full mochitest suite        | build machine                        | 39 min cold + suite     |
| 5   | Artifact build + suite (preflight first) | build machine, and `e2e.yml` on PR   | 5 min                   |
| 6   | Version files, branding prefs, cfr pref  | build machine                        | 5 min                   |
| 7   | Split-view contract (M4 canary)          | both builds                          | part of the suite       |
| 8   | Mark ready, CI, merge                    | GitHub                               | CI ≈ 8 min              |

Decision points are marked **Decide**.

## 1. Detection: the bump PR

`upstream.yml` runs every 6 h (`:17`) and on demand (`gh workflow run upstream.yml`):

1. **`check` job** (read-only token). `tools/upstream/check-release.py` reads
   `LATEST_FIREFOX_VERSION` from product-details. If that is newer than `surfer.json`'s
   `version.version`, it streams
   `https://archive.mozilla.org/pub/firefox/releases/X.Y/source/firefox-X.Y.source.tar.xz`
   (≈ 810 MB, the same file `surfer download` fetches) through
   `tools/upstream/patch-check.py --tarball -`. Only the patched files are extracted, so the disk
   is barely touched; about 1–2 min.
2. **`pr` job** (the only one that can write). `bump-surfer-json.py` bumps the pin, and the job
   pushes `upstream/firefox-X.Y` and opens a draft PR `upstream: update to Firefox X.Y`, labelled
   `upstream`. Its body carries the patch-check summary. The JSON report is the run's
   `patch-check` artifact (30 days).

The summary is a table, one row per patch:

| Result    | Meaning                                                 | `surfer import`               |
| --------- | ------------------------------------------------------- | ----------------------------- |
| `clean`   | applies exactly                                         | applies                       |
| `offset`  | applies; a hunk moved (the note says how many lines)    | applies                       |
| `applied` | the tree already has it (only on an imported `engine/`) | reverts it, then re-applies   |
| `fuzz`    | applies only with less context (`git apply -C2`/`-C1`)  | **fails**: re-export (step 3) |
| `failed`  | a hunk's lines are gone, or the file is                 | **fails**: fix by hand        |

Each `fuzz` or `failed` hunk is listed under the table, collapsed, as the hunk from our patch.

**Decide:**

- All rows import → go to step 2; expect a mechanical bump.
- "Patch check did not run" → the tarball was not readable (not published yet, or a network
  error). Run the check yourself after step 2.
- Any `fuzz` or `failed` → step 3 will fail at that patch; plan the fix before building.
- A PR for the branch is already open → the workflow does nothing. Closing the PR is the way to get
  a fresh one: the branch is rebuilt from `main` on the next run.

Nothing happens in the bump PR until you act. A PR opened with `GITHUB_TOKEN` runs no CI until it
is marked ready for review (runbook, Upstream bumps).

## 2. Download the new source

On the build machine (the self-hosted runner's host or your own), in the repo:

```sh
gh pr checkout <PR number>                  # branch upstream/firefox-X.Y
npx surfer download --force                 # deletes engine/ (and its 20 GB objdir), fetches X.Y
echo X.Y > engine/.vimma-firefox-version    # what nightly.yml compares against surfer.json
```

`surfer download` reads the version from `surfer.json` and caches the tarball in `.surfer/engine/`.
Expect ≈ 12.5 min, `.surfer/` ≈ 0.8 GB and `engine/` ≈ 7.6 GB (runbook, First Firefox build).
Surfer commits the pristine tree as `Firefox X.Y` in `engine/.git`: that commit is what
`surfer export` diffs against, and what patch-check reads by default.

Check the patches before importing (≈ 1 s):

```sh
python3 tools/upstream/patch-check.py       # engine/ at HEAD: the pristine new Firefox
```

Expected, when all is well:

```text
patch-check: …/engine at HEAD (Firefox X.Y)
  clean    src/browser/base/content/browser-xhtml.patch
  …
6 patches: 6 clean
```

Exit status: 0 every patch imports, 1 at least one does not, 2 the check could not run. Other
inputs: `--worktree` (the working tree, e.g. an engine you already imported, where every patch
reads `applied`), `--ref REF`, `--tarball FILE|URL|-`. For files: `--json`, `--markdown`.

## 3. Import, and fix a patch that fails

```sh
npm run import    # sync-core, version files, brand, surfer import, mozconfig
```

**How a failure shows up.** Surfer applies `src/**/*.patch` one at a time with
`git apply --ignore-space-change --ignore-whitespace`, after a silent `git apply -R` (which is why
re-importing is safe). It **stops at the first patch that fails**: the task named
`Apply …/src/<path>.patch` fails with git's message
(`error: patch failed: <file>:<line>`, `error: <file>: patch does not apply`), and later patches
are not tried. patch-check lists every failing patch, so read its report rather than repeating
the import one failure at a time.

**Fix one failed patch** (example: `browser-xhtml.patch` against `browser/base/content/browser.xhtml`):

1. Read the failing hunk (PR summary, or `python3 tools/upstream/patch-check.py --markdown x.md`).
   Note which line is ours (`+`) and which upstream lines anchored it (context).
2. Find where the anchor went in the new file:
   `grep -n 'browser-main.js' engine/browser/base/content/browser.xhtml`. If the file itself moved,
   find it with `grep -rl` or `find engine -name`. Upstream's history:
   <https://hg.mozilla.org/releases/mozilla-release/log/tip/browser/base/content/browser.xhtml>.
3. Re-make the same minimal change in `engine/`, by hand, or with
   `git -C engine apply --reject ../src/browser/base/content/browser-xhtml.patch` and then the
   `.rej` files (delete them afterwards). Keep the hunk as small as before (ADR-003); if the change
   no longer fits in a tiny hunk, stop and write it up in a spec, not in the bump PR.
4. Re-export from the repo root, with the path relative to `engine/`:

   ```sh
   npx surfer export browser/base/content/browser.xhtml
   # → Wrote "browser-xhtml.patch" to patches directory. (src/browser/base/content/)
   ```

   Surfer names the patch after the path, with dots turned to dashes. It warns if the patch is
   over 8,000 characters (it should never be).

5. Re-check and review:

   ```sh
   python3 tools/upstream/patch-check.py        # the fixed patch: clean
   git diff src/                                # same + lines as before, new context only
   python3 tools/upstream/patch-audit.py        # still registered, hunk count unchanged
   ```

6. Commit on the bump branch. For example, `upstream: re-export browser-xhtml.patch for Firefox X.Y`,
   with a body saying what moved upstream. If a patch moved to a new path, rename its ADR-003
   register line in the same commit (`npm run test:py` fails until the register matches `src/`).

**Decide (per failing patch):**

- `fuzz`: only the context drifted. Steps 3–5 are mechanical.
- `failed` with the anchor still present → re-make the change (steps 2–5).
- `failed`, file gone or anchor gone (upstream refactor) → the injection point needs a new design.
  Hold the bump (keep the PR as a draft), open a spec, and do not ship a half-working patch.

Run `npm run import` again until it completes.

## 4. Full build and the full mochitest suite

```sh
npx surfer build                                       # ≈ 39 min cold on 16 threads
engine/obj-x86_64-pc-linux-gnu/dist/bin/vimma --version
# → Vimma Vimma 0.x.y           (brands.vimma.release.displayVersion, unchanged by a bump)
sed -n 's/^Version=//p' engine/obj-x86_64-pc-linux-gnu/dist/bin/application.ini
# → X.Y                         (the new Firefox version: spec m0-app-version)
npm run mochitest -- tests/browser/
```

These are the nightly's own smoke checks. Expect the same pass count as on `main` and zero
failures. Tests marked `skip-if = ["artifact"]` (crash reporter, updater) run only here.
Our patches change upstream behaviour (e.g. `tab-bar-visibility-js.patch`), and so do the
prefs, so a green import alone is not enough: run the whole directory, not a subset.

## 5. Artifact build and the suite on it

PR CI (`e2e.yml`) does this once the PR is ready for review, because the bump changes
`surfer.json`. Run it locally too, next to the full build (≈ 0.6 GB in `engine/obj-artifact`):

```sh
node tools/artifact-build/artifact-build.mjs
# → artifact-build: Mozilla binaries of <rev> (indexed until <date>), objdir engine/obj-artifact
npm run mochitest -- --artifact tests/browser/
```

**Artifact preflight.** The artifact build needs Mozilla's own build of the exact revision in
`engine/sourcestamp.txt`, found in the Taskcluster index. The tool checks it first; to check by
hand:

```sh
rev=$(sed -n 's|.*/rev/||p' engine/sourcestamp.txt)
curl -fsS "https://firefox-ci-tc.services.mozilla.com/api/index/v1/task/gecko.v2.mozilla-release.shippable.revision.$rev.firefox.linux64-opt"
# → { "namespace": "…", "taskId": "…", "expires": "<a year after the build>" }
```

**Decide:** HTTP 404 means Mozilla has no indexed release build of that revision. Check that
`surfer.json` pins a real release (not a candidate, beta or ESR) and that `npm run import` ran on
its tarball. A full build does not need the index, but PR CI does: without it, e2e.yml stays red.

## 6. Version files, branding prefs, cfr provider

**Version files.** `npm run import` regenerates them from `surfer.json`
(`tools/version-files`, spec m0-app-version):

```sh
tail -1 src/browser/config/vimma/version.txt          # → X.Y (Firefox)
tail -1 src/browser/config/vimma/version_display.txt  # → 0.x.y (Vimma, unchanged)
```

`browser_vimma_app_version.js` compares against `Services.appinfo.platformVersion`, so a bump
needs no test edit. If it fails, the version files are stale (re-run the import), or Firefox's app
and platform versions have diverged (never so far on release). **Stop and investigate**; do not
edit the test.

**Branding prefs.** Our `firefox-branding.js` replaces upstream's unofficial one, so a pref
upstream adds there is silently dropped, and some break startup (spec m0-branding):

```sh
npx vitest run tools/branding/
# fails with the missing pref names; add each to src/browser/branding/vimma/pref/firefox-branding.js
```

**cfr provider (spec m0-mozilla-services).** We carry a full copy of upstream's
`browser.newtabpage.activity-stream.asrouter.providers.cfr` with `"enabled":false`. A stale copy
shadows upstream's provider. Compare:

```sh
node -e '
const fs = require("fs");
const re = /^pref\("browser\.newtabpage\.activity-stream\.asrouter\.providers\.cfr", (".*")\);$/m;
const cfr = (f) => JSON.parse(JSON.parse(re.exec(fs.readFileSync(f, "utf8"))[1]));
const want = { ...cfr("engine/browser/app/profile/firefox.js"), enabled: false };
const ours = cfr("src/browser/branding/vimma/pref/firefox-branding.js");
const same = JSON.stringify(ours) === JSON.stringify(want);
console.log(same ? "cfr provider: up to date" : `cfr provider: refresh to ${JSON.stringify(want)}`);
process.exit(same ? 0 : 1);'
```

If it says "refresh", put the printed JSON into our pref line, escaped as in the existing one. That
line stays one line, under `// prettier-ignore`. If the regexp finds nothing (a `TypeError`),
upstream renamed or removed the provider: read `firefox.js` and the spec before changing anything.

## 7. Split-view contract: the canary (M4)

`tests/browser/browser_vimma_split_contract.js` (M4 sub-spec 1, ADR-013) pins the upstream
split-view behaviour we rely on without a patch (spec m4-split-panes, Contract). It always uses
wrappers of three and four tabs, never only two. It covers an L shape of three and a 2×2 grid of
four placed at vimma-core's `layout()` rectangles, focus and the URL bar following the pane, the
find bar and notifications per pane, zoom, and `removeTab` on a member of a three-tab split. Run
it first on both builds, before the rest of the suite:

```sh
npm run mochitest -- tests/browser/browser_vimma_split_contract.js
npm run mochitest -- --artifact tests/browser/browser_vimma_split_contract.js
```

**Decide:** if it fails, Firefox changed its split view (renames, a two-tab limit, panel
reordering). Do not loosen the test or wrap upstream code at runtime. Hold the bump, and follow
the spec's risk table: the named contingency patch, with an ADR-003 register line, or a design
change.

## 8. Ready, CI, merge

- [ ] patch-check: every patch `clean`/`offset` on the new tree; re-exported patches committed
- [ ] `npm run import` completes
- [ ] full build: `--version` and `application.ini` as above; `npm run mochitest -- tests/browser/`
      green (paste counts in the PR, as the PR template asks)
- [ ] artifact build: preflight OK; `npm run mochitest -- --artifact tests/browser/` green
- [ ] `npx vitest run tools/branding/` green; cfr provider up to date
- [ ] split-view contract green on both builds

Then `gh pr ready <n>`, which starts `ci.yml` and `e2e.yml`. Merge when green. The nightly
re-downloads Firefox because `surfer.json` changed, and builds it at 03:00 UTC. release-please
then lists `upstream: update to Firefox X.Y` under Changed in the next release PR.

## Security dot release: the fast path

Target: **released within 7 days** of Mozilla's release (ADR-002, plan §4). A dot release
(`X.Y.Z`, e.g. 157.0.2) is a few backported fixes; our front-end patches nearly always stay
`clean`. Mozilla's advisories: <https://www.mozilla.org/security/advisories/>.

| Day | Do                                                                                     |
| --- | -------------------------------------------------------------------------------------- |
| 0   | The bump PR arrives. Its summary should read all `clean`; if not, steps 3 first.       |
| 0–1 | Steps 2–6 (download, import, full build + suite, artifact build + suite, prefs checks) |
| 1   | Ready for review, CI green, merge                                                      |
| 1–2 | Merge the release-please PR (a dot release alone produces one), run `release.yml`      |

Skip nothing in the checklist, but there is no need to wait for a nightly: the local full-build
suite is the same test. Releases skipped in between need nothing extra: `check-release.py`
reports only the latest, so the bump goes straight to it. Auto-approval for `security` bumps
(plan §4) is not built yet; today a person merges.

## Rolling back

- **Before merge:** keep the PR as a draft, and **do not close it** while you hold the bump. An
  open PR for the branch is what stops `upstream.yml` from opening a new one every 6 h.
- **After merge, before a release:** revert on `main` through a PR (`git revert <merge commit>`,
  `revert:` with a body saying why). That restores `surfer.json` and any re-exported patches. The
  nightly re-downloads the old version by itself (`engine/.vimma-firefox-version` differs).
  Locally: `npx surfer download --force && npm run import && npx surfer build`. The next
  `upstream.yml` run opens the bump again; keep that PR as a draft until the cause is fixed.
- **After a release:** do not ship an older Firefox (it reintroduces the fixed security bugs). Fix
  forward with a patch release. To pull a bad release: `gh release edit vX.Y.Z --draft` (runbook,
  Release packages).

## Patch-size audit (plan §4, Sunday maintenance)

```sh
python3 tools/upstream/patch-audit.py      # --json FILE for machines
```

```text
Patch                                                                      Files  Hunks  +  -  Chars  Register
src/browser/base/content/browser-xhtml.patch                                   1      1  1  0    651  yes
…
Total: 6 patches, 6 hunks, +10 -5
Register matches src/ (6 patches).
```

Exit 1 means a patch is not in the ADR-003 register, or a register line has no patch (both are
listed). `npm run test:py` runs the same check on every push. Review: a patch that grew (more
hunks or lines than last month, or `large`, Surfer's 8,000-character warning) is a candidate for
moving code into our own files (ADR-003). Propose that in a spec, not in a bump PR.

## Reference: measurements (Firefox 157.0.1, 2026-10-09)

- Source tarball 811,383,348 bytes; 4.2 GB unpacked stream. Full `xz` decompress: 20.8 s on one
  thread, 10.0 s on two (16-thread dev box).
- `patch-check.py --tarball` on it: 25–31 s locally, no disk beyond the 6 patched files.
- `patch-check.py` on `engine/` at HEAD: 0.15 s. All 6 patches `clean` on 157.0.1.
- `surfer download` 12.5 min; cold full build 38.7 min; artifact-build job 5.5 min on a hosted
  runner (runbook, ADR-010).
