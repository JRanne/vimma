# Spec: site-compat

Status: proposed (sub-PR 1 in review) · Milestone: after private-swap (testing infrastructure, no
user-visible change) · Area: `tools/sites/` (new), `tools/e2e/launcher.mjs` (one option),
`.github/workflows/sites.yml` (new), `package.json` (one script). No upstream patch, no product
code, no new dependency.

Engine paths are relative to `engine/` (Firefox 157.0.1). Timings were measured with
`gh run list` / `gh run view` on 2026-10-12. GitHub's billing and runner facts were checked
against docs.github.com the same day (links in Research).

## The user's words

2026-10-12: "could we run automated test on sites that most developers use? to see how well
Vimma works on them?" Then: "start with sites without login, however i wonder how heavy workflow
that would be on github side? or if i should have my own dedicated runner doing it?"

## Short answer to the cost question

Free, and light. The repo is public, and GitHub's billing docs say "GitHub Actions usage is free
for self-hosted runners and for public repositories that use standard GitHub-hosted runners".
A nightly run is one job of about 20 minutes on one standard runner (estimate below): about
600 runner-minutes a month at no charge, 1 of the 20 hosted jobs the free plan runs at once, at
an hour when no PR is waiting. A dedicated runner is not needed for cost. It could matter for
**IP reputation**: some sites show bot checks more often to datacenter IPs. The plan is to run
on GitHub's runners every night, run `npm run sites` from home when wanted, and revisit a
self-hosted runner only if bot checks make the nightly results useless (open question 1).

## User stories

- As the maintainer, `npm run sites` loads each site on the list once in a real Vimma build
  under Xvfb, runs the same checks on each, and writes a JSON file plus an HTML and a Markdown
  report: a table of site × check (pass, fail, skipped with a reason, or blocked), screenshots,
  load times and key-to-effect latencies. `npm run sites -- --filter github` runs a subset.
- As the maintainer, every night the `sites` workflow does the same on a GitHub-hosted runner,
  writes the table into the job summary and uploads the report as an artifact. It never runs
  on a pull request and never blocks a merge.
- As the maintainer, a site that shows a bot check or captcha is reported as
  "blocked (bot check)" and a consent wall Vimma could not get past as "consent", not as a
  failure of Vimma. Where a consent page has a plain "Reject all" button, the run clicks it and
  carries on.
- As the maintainer, I can edit the site list (`tools/sites/sites.json`) without touching code.
- As the maintainer, a site that takes over a Vimma key (YouTube's `k`, GitHub's `s`) shows up
  as a note in the report, so I know which bindings users of that site lose in normal mode.

## Research

### How e2e.yml and nightly.yml build and run Vimma

- `e2e.yml` (the required "mochitest (artifact build)" check) runs on `ubuntu-24.04`, a
  standard hosted runner. It builds `vimma-ctl` (`cargo build --locked`), downloads the Firefox
  source tarball (checked against Mozilla's `SHA512SUMS`), runs `npm run import`, makes an
  **artifact build** (`tools/artifact-build/artifact-build.mjs`: our front end on Mozilla's
  compiled binaries for that exact release, ADR-010), then runs the mochitests and
  `npm run e2e -- --artifact` (`.github/workflows/e2e.yml:91-147`). No secret, read-only
  token.
- `nightly.yml` is the **full** build on the self-hosted `vimma-build` runner (a full build
  does not fit a hosted runner: 22 GB, 39 min). It is gated by `NIGHTLY_ENABLED` and holds the
  Safe Browsing secret (`.github/workflows/nightly.yml:1-30`). The site suite must not go
  there: it would need that self-hosted runner and sit next to a secret, and it needs neither.
  It reuses e2e.yml's artifact build in a workflow of its own.
- Step times of a recent successful e2e run (run 38229657690): checkout, Node, `npm ci` 12 s;
  `vimma-ctl` 9 s; harness tests 9 s; Firefox source tarball 58 s; import 1 s; artifact build
  127 s; mochitests 258 s; e2e scenarios 39 s. The last 20 successful runs took 6.4 to 8.9 min
  (median 8.4). **Setup up to a runnable artifact build is about 3.6 min**; the site suite
  replaces the mochitests and scenarios.

### The harness to build on

- `tools/e2e/launcher.mjs` makes the throwaway profile (`createProfile`, line 133, with the prefs
  at line 42: first-run pages, telemetry and background network off), starts Xvfb, spawns the
  browser in its own process group and waits for the control socket (`launch`, line 664).
  `tools/e2e/driver.mjs:92` (`Ctl`) runs `vimma-ctl` for `send-keys`, `state` and `open`.
- `state` (`ctl/VimmaControl.sys.mjs:260`) reports `mode`, `pending` (`"prefix"` after
  `ctrl+b`), `workspace` and each tab's `id` (the browserId), `url` and `title`. That is enough
  for keys, navigation and modes, but not for what a check must see in the page: scroll
  positions, the focused element, hint labels, the find result, the clipboard, errors.

### How to observe the page without changing what a site sees

Four options were tried or read:

1. **WebDriver BiDi or Marionette.** Both turn on `navigator.webdriver`:
   `Navigator::Webdriver()` returns true while either reports `isBrowserAutomationRunning`
   (`dom/base/Navigator.cpp:2352-2374`; `remote/components/RemoteAgent.sys.mjs:146-148`), and
   there is no pref to hide it (`dom/webidl/Navigator.webidl:316-318` has no `[Pref]`). Bot
   checks (Cloudflare, Google) look for exactly that, so the suite would measure its own
   automation. Rejected.
2. **A test-only probe command on the control socket.** Honest, but it adds product surface
   (protocol, Rust client, a pref gate, a security review) for a test tool. Kept as the fallback
   if option 4 breaks.
3. **A helper WebExtension.** Release builds enforce add-on signing
   (`toolkit/moz.configure:2018-2029`; `MOZ_REQUIRE_SIGNING = 1` in the artifact build's
   `config.status`). A temporary install needs a privileged client anyway. Rejected.
4. **The DevTools remote debugging server (chosen).** `--start-debugger-server <path>` opens
   the DevTools protocol (RDP) on a Unix socket (`devtools/startup/DevToolsStartup.sys.mjs:1245-1266`)
   when `devtools.debugger.remote-enabled` and `devtools.chrome.enabled` are on (line 23). It is
   what about:debugging and `web-ext run` use. It is not browser automation, so
   `navigator.webdriver` stays `false` (checked live on Wikipedia). It can evaluate read-only
   probes in the parent process (chrome scope: the status bar, the hint layer, `VimmaHost.status`,
   the clipboard) and in a tab (scroll positions, the focused element, links under a hint).
   The prototype got all of these on GitHub and Wikipedia.

So the suite drives with `vimma-ctl`, the shipped client, exactly like the e2e scenarios, and
uses RDP only to look. RDP framing is `<byte length>:<JSON>`; a reply comes from the actor in
request order; `evaluateJSAsync` answers `{ resultID }` and then sends an `evaluationResult`
event (`devtools/shared/specs/webconsole.js:45-60, 149-165`). A client of about 200 lines in Node
needs no dependency.

### What each check can see

- **Hints.** The labels are drawn in the chrome document, in `#vimma-hints` with one
  `.vimma-hint` per target, `data-label` and `left`/`top` at the target's top-left in content
  CSS pixels times the zoom (`ui/hint-overlay.mjs:13, 50-55`). A probe in the tab maps each
  label's point to the link under it (`elementFromPoint(...).closest("a[href]")`), so the suite
  can choose a same-tab link and type its label.
- **Scrolling.** `j`/`k` step 60 px, `ctrl+d`/`ctrl+u` half a page, `gg`/`G` top and bottom
  (`packages/vimma-core/src/defaults.mjs:105-121`). The actor scrolls the document's scrolling
  element, or the largest scrollable inner element when the page is an app shell or locked
  (`actors/VimmaChild.sys.mjs:457-510`). The probe lists the scrolling element and every inner
  element that can scroll, so a check sees which one moved.
- **Find.** `VimmaHost.status(win).find` (`host/VimmaHost.sys.mjs:1091-1106`) holds the query,
  `notFound`, `current` and `total` once the find bar reports (live on GitHub: "neovim",
  10 matches).
- **`yy`.** `page.yank_url` copies `currentURI.spec` with `nsIClipboardHelper`
  (`host/page-ops.mjs:75-80`). The suite writes a sentinel first and reads the clipboard back
  in chrome. It always runs under its own Xvfb, so it never touches the desktop's clipboard.
- **`ctrl+b`.** `state.pending` is `"prefix"` after `ctrl+b`. A keydown listener the probe adds
  to the page's window (capture phase) shows whether the page saw the key.
- **Status bar.** The mode segment is `#vimma-statusbar [data-segment=mode]`, its text the mode
  in capitals (`ui/statusbar.mjs:17`, `packages/vimma-core/src/statusbar.mjs:159-160`). It
  renders on a scheduled frame: right after `i` it still said `NORMAL` once in the prototype,
  so the check polls for up to a second before it compares.
- **Errors.** Content processes forward their console messages to the parent's console
  service (`dom/ipc/ContentChild.cpp:475-504`, `ContentParent::RecvScriptError`,
  `dom/ipc/ContentParent.cpp:4914`). One `nsIConsoleListener` in the parent therefore sees
  errors from chrome and from the actor. The suite keeps those whose source or stack is under
  `chrome://browser/content/vimma/` and, through `console-api-log-event`, Vimma's own
  `console.error`. GitHub alone logs dozens of the site's own errors and warnings (the
  prototype saw referrer-policy warnings); those are ignored.
- **Site shortcuts.** In insert mode with no field focused (`i`), keys reach the page. A key the
  site handles shows as `defaultPrevented`, a focus change, a URL change, a scroll or a new
  dialog. On GitHub, `s` focused the search field (and Vimma went to insert mode, correctly).

### Bot checks, consent walls and IP reputation

- Recognisable from the URL, the title, the start of the page text and the iframes: Cloudflare's
  "Just a moment..." / "Verify you are human" and `challenges.cloudflare.com` (Stack Overflow,
  Cloudflare docs, CodePen), Google's `/sorry/` page and "unusual traffic", reCAPTCHA and
  hCaptcha iframes, Reddit's "whoa there, pardner!" and "blocked by network security",
  DuckDuckGo's anomaly page, Akamai's "Access Denied". Consent walls: `consent.google.com`,
  `consent.youtube.com` ("Before you continue"), and common consent-manager containers
  (OneTrust, Sourcepoint, Quantcast, Didomi, Funding Choices).
- **IP reputation.** GitHub-hosted runners are Azure datacenter IPs. Reddit, Google search and
  Cloudflare-fronted sites (Stack Overflow) challenge datacenter ranges far more often than a
  home connection. Expect some of those to show as blocked on some nights. That is why bot
  checks are their own status, and why `npm run sites` from the user's own network is the
  second half of the plan.
- **Consent.** The runner is in the US, so Google and YouTube usually show no consent wall
  there. From Finland they do. A "Reject all" click is safe (it only refuses), so the suite
  tries it. It never clicks "Accept".

### GitHub's terms that matter here

- Billing (<https://docs.github.com/en/billing/concepts/product-billing/github-actions>):
  "GitHub Actions usage is free for self-hosted runners and for public repositories that use
  standard GitHub-hosted runners." "Larger runners are always charged for, even when used by
  public repositories." So the workflow uses `ubuntu-24.04`, never a larger runner.
- Runners (<https://docs.github.com/en/actions/reference/runners/github-hosted-runners>): a
  standard Linux runner for a public repo has 4 CPUs, 16 GB RAM and 14 GB SSD.
- Self-hosted security (<https://docs.github.com/en/actions/reference/security/secure-use>,
  "Hardening for self-hosted runners"): "self-hosted runners should almost never be used for
  public repositories", because "any user can open pull requests against the repository and
  compromise the environment", and a self-hosted runner "can be persistently compromised by
  untrusted code in a workflow".

## Cost and runtime

| Part                                               | Time                   | Source                                  |
| -------------------------------------------------- | ---------------------- | --------------------------------------- |
| Checkout, Node, `npm ci`, `vimma-ctl`              | ≈ 0.4 min              | e2e run 38229657690                     |
| Firefox source, import, artifact build             | ≈ 3.1 min              | same                                    |
| 22 site entries × ≈ 40-50 s (launch, load, checks) | ≈ 15-18 min (estimate) | prototype; replaced by the measured run |
| Report, upload                                     | < 0.5 min              |                                         |
| **Total per night**                                | **≈ 20 min**           |                                         |

- About 600 runner-minutes a month, free (public repo, standard runner). The job takes 1 of the
  free plan's 20 concurrent hosted jobs, at 04:30 UTC, when no PR is waiting on e2e.
- Artifacts: one PNG per site after load and one with the hint labels showing, plus one per
  failed check: roughly 40-60 PNGs of 100-400 kB, so about 10-20 MB a night. Kept 14 days.
- Network: each site is loaded once, plus the one link a hint follows. No crawling. That is a
  few MB per site, one visit a day from one IP. Well under anything a site would notice.
- **Self-hosted alternative.** Free too, but on a public repo it is only acceptable if: the
  workflow that uses it is triggered **only** by `schedule` and `workflow_dispatch` (never
  `pull_request`, `pull_request_target`, `issue_comment` or `push` from forks), the runner is
  registered to this repo with a dedicated label, it runs in a dedicated VM or container that is
  reset after each job (ephemeral runner), it holds no secret beyond its registration, and it is
  **not the user's daily machine**. `nightly.yml` already uses that pattern for the full build
  (`if:` on the event and ref). The gain would be a residential IP, which matters only if
  bot checks swamp the hosted results.

## Decisions

1. **A separate workflow, `sites.yml`, on `ubuntu-24.04`.** Triggers: `schedule` (04:30 UTC
   daily) and `workflow_dispatch` (with an optional `filter`). Never `pull_request` or `push`; a
   workflow test enforces that. It is not a required check. It reuses e2e.yml's steps up to
   the artifact build (copied, with the tarball's SHA-512 check). It does not touch
   `nightly.yml`.
2. **Drive with `vimma-ctl`, observe with RDP** (Research, option 4). The probes only read,
   except three narrow writes: the clipboard sentinel, a keydown recorder on the page's window
   for the `ctrl+b` and shortcut checks, and a "Reject all" click on a consent wall.
3. **One fresh profile and browser per site**, as e2e does per scenario: no cookies or state
   carry over, and a crash costs one site. The launcher gains an `args` option for
   `--start-debugger-server`, and the profile gets the three DevTools prefs on top of e2e's.
4. **Firefox's normal user agent**, unchanged (Vimma's UA is Firefox's, spec m0-user-agent).
   The window is 1280 × 800, the e2e size.
5. **Checks per site, in this order**, each recorded as `pass`, `fail`, `skip` (with a reason) or
   `info`:
   1. `load`: the page loads (`readyState` complete) within 45 s; records the navigation-timing
      load time. A bot check or consent wall here makes the site `blocked` or `consent`, and the
      remaining checks `skip` with that reason.
   2. `scroll`: `j`, `k`, `G`, `gg`, `ctrl+d`, `ctrl+u` each move the main scrolling element or
      an inner scroller the right way. Records which one moved and the `j` latency. `skip` when
      nothing on the page can scroll.
   3. `find`: `/`, a word taken from the visible text (or the site's `find` entry), Enter: the
      find status has the query and at least one match, and the mode is back to normal.
   4. `yank`: `yy` puts the tab's URL on the clipboard.
   5. `insert`: focusing the site's search field (its `search` selector, else the first visible
      search or text input) gives insert mode; Esc gives normal mode and the field loses focus.
      `skip` when the page has no such field.
   6. `prefix`: `ctrl+b` in normal mode and in a focused field gives `pending: "prefix"`, and the
      page sees no `ctrl+b` keydown.
   7. `shortcuts` (`info`): Vimma's single normal-mode keys, pressed in pass-through insert mode;
      the ones the site reacts to are listed. Stops at the first key that navigates.
   8. `hints`: `f` shows labels (count and the visible links/buttons are recorded); typing the
      label of a same-tab link navigates. Last, because it leaves the page.
   9. `errors`: no uncaught error and no `console.error` from Vimma's code during the visit.
   10. `statusbar`: after every step above, `state.mode` is the expected mode and the status bar
       shows it.
6. **Latency** is measured in Node from the `vimma-ctl send-keys` call to the effect seen by
   polling (10 ms): an upper bound that includes starting `vimma-ctl` (a few ms) and one RDP
   round trip. Good enough to spot a page where `j` takes 300 ms instead of 30.
7. **Statuses per site**: `ok` (no fail), `fail`, `blocked`, `consent`, `error` (the harness
   could not load or drive it). The run's exit code is 0 when it produced a report, whatever the
   sites did, and 1 when the harness itself failed. It is a report, not a gate.
8. **Output** in `site-compat-output/` (git-ignored): `results.json`, `report.md` (also the job
   summary), `report.html` (self-contained, screenshots linked), `screenshots/<site>-<n>.png`.
9. **The list is data**, `tools/sites/sites.json`: `id`, `name`, `url`, and optional `search`
   (CSS selector), `find` (a word on the page), `notes`. A unit test checks its shape.

## Sub-PRs

1. **This one.** `tools/sites/` (RDP client, probes, checks, bot-check classification, results,
   report, CLI), `sites.json` with the 22 entries, `npm run sites`, `sites.yml`, unit tests for
   the pure parts and the workflow's shape, one local live run whose table goes into the PR.
2. **Night-to-night diff** (if wanted, open question 3): fetch the previous night's
   `results.json` artifact and report what changed; optionally open or update one issue when a
   site goes from `ok` to `fail`.
3. **Snapshot layer**, the per-PR gate (design below). Not small, so not in sub-PR 1.

### Snapshot layer (design; sub-PR 3)

Goal: run the same checks on PRs, offline and deterministic, against recorded versions of
selected pages, and fail the PR when a check that passed on the recording fails.

- **What is recorded.** Not the network (a recording proxy needs a CA in the profile, a
  Python or Go dependency, and replays scripts that phone home). Instead the page's **rendered
  DOM** after load: `document.documentElement.outerHTML` with scripts, event handlers and
  `<iframe>` sources removed, every same-origin and fetchable stylesheet inlined (from
  `document.styleSheets[*].cssRules`), images replaced by sized placeholders, and inner
  scrollers' `overflow` kept. Taken through the same RDP connection, by
  `npm run sites -- --record <id>`. What it keeps: links, buttons, inputs, layout and inner
  scroll containers, which is what hints, scrolling, find, insert and `ctrl+b` depend on. What it
  loses: the site's scripts, so app shells (Excalidraw, YouTube, CodePen's editor) and site
  shortcuts cannot be replayed. Those stay live-only.
- **Licences decide what may be committed.** The repo is public. Only pages whose licence
  allows redistribution go in `tests/e2e/fixtures/sites/`: Wikipedia and MDN (CC BY-SA, with
  attribution in a README next to them), docs.python.org (PSF documentation licence),
  doc.rust-lang.org (MIT/Apache-2.0). GitHub, Stack Overflow's layout, YouTube, Google and the
  rest are not committed. For those, a failure found by the live run becomes a **hand-written
  minimal fixture** that reproduces the structure (an app-shell scroller, a shadow-DOM button, a
  page that grabs `keydown`), named after the issue, like the existing e2e fixtures (plan §5:
  one regression test per bug).
- **How it runs.** A scenario type in `tools/e2e` (or `npm run sites -- --offline`) serves the
  fixtures from the existing page server on 127.0.0.1 and runs the checks above except
  `shortcuts`. On PRs it runs inside e2e.yml after the scenarios, adding about 1 min for 4-6
  pages. Screenshots are not compared (fonts differ between machines; the checks assert on
  state).
- **Size:** recorder, sanitiser, offline mode, 4-6 fixtures with attribution, e2e.yml wiring
  and tests: a PR of its own.

## Test plan

- Vitest, written first (`tools/sites/test/`):
  - `classify.test.mjs`: Cloudflare, Google `/sorry/`, reCAPTCHA/hCaptcha iframes, Reddit,
    DuckDuckGo and Akamai pages are `bot-check`; Google/YouTube consent pages and consent
    manager containers are `consent`, with the reject button found when it is there; ordinary
    pages that mention "captcha" in an article are not.
  - `results.test.mjs`: a site's status from its checks (fail beats skip, blocked and consent
    skip the rest, `info` never fails), the summary counts, the exit code, the mode-step
    aggregation for `statusbar`.
  - `report.test.mjs`: the Markdown table (one row per site, one column per check, symbols and
    reasons, latency and load columns), the HTML report escapes page titles and links the
    screenshots, the summary line.
  - `rdp.test.mjs`: packet framing (split and joined chunks, UTF-8 lengths), replies matched to
    requests per actor, `evaluationResult` matched by `resultID`, a closed socket rejects what is
    pending. Against a fake RDP server on a Unix socket.
  - `sites-data.test.mjs`: every entry has a unique `id`, an `https` URL, and only known fields.
  - `tools/test/sites-workflow.test.mjs`: `sites.yml` runs on `schedule` and
    `workflow_dispatch` only, on `ubuntu-24.04`, with `contents: read`, no secrets, every action
    pinned by SHA, and the report uploaded even when the run fails.
  - `tools/e2e/test/launcher.test.mjs`: `browserArgs` puts extra switches before the URL.
- Live: one local run over the full list under Xvfb from the maintainer's network; the summary
  table goes into the PR. Then one `workflow_dispatch` run after merge to compare the hosted
  runner's bot-check rate (open question 1).

## Docs to update

- `docs/runbook.md`, "Actions minutes budget": one paragraph for `sites.yml` (≈ 20 min a
  night, free, never on PRs).
- `CONTRIBUTING.md`: `npm run sites` under the test commands.
- No guide, README or changelog change: nothing user-visible changes.

## Out of scope

- Sites behind a login (Gmail, GitHub notifications, Slack, Jira). A later spec, with a
  throwaway account and a secret, which would need its own security review.
- Crawling, or more than one page per entry (plus the one link a hint follows).
- Screenshot comparison of live sites (they change daily).
- Fixing what the suite finds: each problem becomes an issue and its own spec or bug fix.
- Running on macOS or Windows, or on Wayland.

## Open questions

1. **Runner.** GitHub-hosted nightly plus local runs (recommended), or a self-hosted runner on
   a dedicated VM with a home IP if bot checks make the nightly results useless? Decide after
   a week of nightly results.
2. **Bot-check handling.** Report only (as now), or also retry a blocked site once at the end of
   the run?
3. **Alerts.** Should a site going from `ok` to `fail` open or update a GitHub issue (sub-PR 2),
   or is the artifact and job summary enough?
4. **Shortcut conflicts.** Report only (as now), or also suggest a per-site pass-through list
   for the config (a feature of its own)?
5. **The site list.** Add the user's daily sites beyond the 19 in the request (Hacker News
   comments page, a GitLab project, crates.io)?
