# Spec: m0-control-server

Status: implemented, awaiting review · Milestone: M0 · Area: `src/browser/base/content/vimma/ctl/`
Prerequisites: ADR-007 (control socket), ADR-011 (vimma-ctl), spec
[m0-control-protocol-and-vimma-ctl](m0-control-protocol-and-vimma-ctl.md) (the protocol, which
is authoritative; this spec only adds what the browser side decides).

## User story

As a user or the e2e harness, with `vimma.control.enabled` on, `vimma-ctl state`,
`vimma-ctl send-keys "ctrl+b ?"` and `vimma-ctl open https://example.com` work against the
running browser, and with it off nothing listens and no token file exists.

## Scope

- `ctl/VimmaControl.sys.mjs`: protocol v1 server. One per app: every window's `vimma.js` calls
  `VimmaControl.init(window)`, which acts once. The pref `vimma.control.enabled` (default `false`,
  branding prefs file) starts and stops it live; starts and stops run one after another.
- `nsIServerSocket.init(-1, /* loopbackOnly */ true, 16)`: 127.0.0.1, an OS-chosen port.
- Discovery file `<profile>/vimma-control.json` `{protocol, port, token, pid}`, 0600 from creation,
  renamed into place; deleted when the pref goes off, at `quit-application-granted`, and (as a
  backstop) in an `AsyncShutdown.profileBeforeChange` blocker.
- Line framing, 1 MiB limit, 5 s hello deadline, 60 s idle timeout, 8 connections then `busy`,
  constant-time token check (`tokensEqual`), every message checked with `validateMessage`.
- Commands `send-keys`, `state`, `open`; `list-tabs`, `screenshot`, `reload-config` answer
  `not-implemented`.
- Host seam: `VimmaHost.controlState(win)` → `{ mode, pending }` (one additive method).

## Settled

- **Key injection: a `TextInputProcessor`, not the dispatcher.** Each chord becomes a real key
  press: modifier keydowns, the key's keydown/keyup, modifier keyups, through
  `nsITextInputProcessor.beginInputTransaction(win)` on the most recently focused browser window
  (`BrowserWindowTracker.getTopWindow`). The events are trusted and go through the widget, so
  the host's capture-phase keydown listener (and so the dispatcher and mode handling), Firefox's
  `<key>` shortcuts (`ctrl+t`, `ctrl+q`) and the focused page all see what a keyboard would have
  produced. Calling the dispatcher directly would skip Firefox's shortcuts and the page, so e2e
  would test something users never do. Cost: keys go where focus is; for page-bound keys that is
  the page only while the window has focus, as with a real keyboard. `?` is sent without shift
  (vimma-core's canonical chord), which the host treats the same.
- **`state.pending`** is `dispatcher.pending().join(" ")`, what the status bar shows: `"prefix"`
  after `ctrl+b`, `null` when empty. `mode` is the host's `_mode`: `help` with the overlay
  open, else the focused page's mode (`normal` on a page with Vimma's actor, `insert` in a text
  field, a page without the actor, or chrome; m1-actor-insert-scroll). Each tab also
  has `index` (strip order among visible tabs) and `pinned`; clients ignore fields they do not
  know. `workspace` and `panes` are `null` until M3/M4.
- **`open`**: the URL is re-parsed with `Services.io.newURI` and its scheme checked again
  (http, https, file, about). Loaded with the **system principal**, as `BrowserContentHandler`
  does for `vimma <url>`: the token holder is the user, and with `javascript:`/`data:` refused
  nothing runs in a page's context. Not through `browserDOMWindow.openURI(OPEN_EXTERNAL)` like
  the command line: that turns an external `about:blank` into the new-tab page with the URL bar
  focused, and lets the external-link prefs choose another window, while `where` here is
  explicit. `tab`: `gBrowser.addTab(url, { triggeringPrincipal, inBackground: false })`;
  `current`: `selectedBrowser.loadURI`. Checked: the opened page has its own content principal.
- **Discovery file 0600 with no window**: `IOUtils.createUniqueFile(profile,
"vimma-control.json.tmp", 0o600)`, then `IOUtils.writeUTF8` (an overwrite keeps the mode,
  `IOUtils.cpp` WriteSync opens with `PR_TRUNCATE`), then `IOUtils.move` over the real name.
  `writeJSON({ tmpPath })` would create the temporary file 0644 and leave a window before a
  `setPermissions`.
- **Loopback only, verified**: `nsServerSocket::Init(…, loopbackOnly)` →
  `InitSpecialConnection` → `PR_SetNetAddr(PR_IpAddrLoopback, PR_AF_INET, …)` (127.0.0.1, not
  `::1`, not 127/8). The test connects to 127.0.0.2 (Linux) and gets `NS_ERROR_CONNECTION_REFUSED`.
- **Starts after the first window's delayed startup**: the server (and so the file) waits for
  `browser-delayed-startup-finished` of the window that called `init`. Found by the e2e harness:
  writing the file during the first window's load let `state` answer `failed: no browser window`
  in ~70 % of runs. `topWindow()` also falls back to `Services.wm.getMostRecentWindow`.
- **Errors that end a connection linger** (`unauthorized`, `unsupported-protocol`, `bad-request`
  in the handshake or for an oversized line, `busy`): the server writes the error, then reads and
  drops input until the client closes or 1 s passes, then closes. Closing at once lost the
  answer in ~10 % of runs (a socket closed with unread input is reset; our own JS test client
  also saw the close before the data). `busy` connections linger outside the 8-connection count.
- **The line limit counts bytes** (1 MiB = `MAX_LINE_LENGTH`, plus one for a trailing `\r`), not
  UTF-16 units: a byte cap bounds memory before decoding and is never looser. A line over the
  limit is answered as soon as the limit is passed, without waiting for its newline.
- **Quitting while a command runs** (`send-keys ctrl+q`): the in-flight request is answered,
  then the connection closes; the file is removed. Verified with the real build (exit 0, file
  gone, `vimma-ctl` exit 0).
- **`SIGTERM` does not run our shutdown** (measured, 157.0.1 headless: the process dies by the
  signal in ~20 ms, exit 143). The discovery file then stays; clients report it as stale ("not
  running") and the next start overwrites it. Harnesses should quit with `send-keys ctrl+q`
  (`browser.warnOnQuitShortcut=false`) and keep signals as the fallback.
- **Test-only prefs** `vimma.control.helloTimeoutMs` and `vimma.control.idleTimeoutMs` (read per
  connection, unset in builds).
- **vimma-ctl in mochitests**: the test resolves `tools/vimma-ctl/target/{release,debug}/vimma-ctl`
  through its symlink into the checkout (or `VIMMA_CTL`) and runs it with `Subprocess.sys.mjs`.
  Absent → skip with a message; `e2e.yml` builds it (`cargo build --locked`, the harness's step)
  and sets `VIMMA_REQUIRE_CTL=1` so CI cannot silently skip. The nightly full-build run skips it.

## Tests (written first)

`tests/browser/browser_vimma_control.js`:

- Pref off: no listener, no file. On: file valid per `validateMessage(kind: discovery)`, mode
  0600, port matches, pid is the parent, no `.tmp` left, handshake works, 127.0.0.2 refused. Off:
  file gone, old port refused. On again: a new token.
- Handshake: wrong token → exact `unauthorized` response, then close; an HTTP request →
  `bad-request`, close; protocol 2 → `unsupported-protocol`, close; right token → valid
  `welcome` (app, version). After it: not-JSON → `bad-request`, unknown command, reserved →
  `not-implemented`, unknown args → `invalid-args`, connection still usable.
- `send-keys ctrl+b` → `state.pending` `"prefix"`; `?` → overlay opens, host saw real keydowns,
  `state.mode` `help`; `esc` closes it, back to `normal`; a bad chord → `invalid-args` and nothing
  sent. `state` fields: tabs, ids (`browserId`), url, index, pinned, null workspace/panes.
- `send-keys "j shift+k"` with the page focused, in normal mode: Vimma takes `j` (as with a real
  `j`), the page records `Shift`, `K`.
- `open https://example.com/` → new selected tab, result id, content principal; `where: current`
  reuses it; `about:blank` → a new selected tab at `about:blank`; `javascript:`, `data:`,
  `chrome:` → `invalid-args`, nothing opened.
- Limits: 8 connections (4 authenticated, 4 handshaking), the 9th gets `busy` (id null) and a
  close, a freed slot works; an oversized line → `bad-request` and a close; idle (500 ms pref) →
  closed without a message; no hello (300 ms pref) → `bad-request` and a close.
- `vimma-ctl --profile <test profile> state --json` exits 0 with the live state.

Every response is checked with `validateMessage(kind: response, command)`.

## Implementation log (2026-10-09)

- TDD red: the new test crashed the browser at import (`CheckForBrokenChromeURL`: no
  `ctl/VimmaControl.sys.mjs`), 0 passed. Green: 143 passed, then 152 with the `about:blank` case.
- Mutation: comparing only `typeof m.token` (no `tokensEqual`) → "a wrong token is unauthorized"
  failed (got `welcome`) and the task timed out; reverted.
- Flakiness: `--repeat=19` found lost error replies (16 failures in 20 runs) and an idle pref that
  leaked into the connection-limit check; fixed (lingering close, EOF detected by a 0-byte read
  instead of `available() == 0`, which is also 0 before the transport attaches; output waits
  dispatched to the main thread; idle pref scoped). Then 20/20 green, and 10/10 on two busy CPUs.
- Real build, headless, temporary profile, 21 launches: `state` the moment the file appears
  succeeded every time (mode 0600); `open about:blank` then `send-keys "ctrl+b ?"` gave two tabs,
  the new one selected at `about:blank`, mode `help`.
- Suites: full build `tests/browser/` 602 passed, 0 failed; artifact build 585 passed, 0 failed.
- Merged main (#28 tab keys, #32 normal mode and actors, #35 e2e harness). Red: 4 failures, the
  page now starts in `normal` and takes `j`; the tests now expect `normal` and the page to see
  only `Shift`, `K`. Green: full build 903 passed, artifact build 886 passed, 0 failed. The e2e
  workflow's existing `vimma-ctl` build (debug) serves the mochitest too.

## For the e2e harness (PR #35)

1. File within 30 s: yes, right after the first window's delayed startup.
2. `state`: the host's mode. Measured after the m1-actor-insert-scroll merge on the real build
   (headless, fresh profile, `about:blank` start page): **`insert`** at startup (focus is in
   chrome), so the scenario's `insert` holds; `normal` once a page has focus (the
   mochitest's case); `help` with the overlay. Tabs carry `url` and `selected`.
3. Fresh profile with `browser.startup.page=0`: one `about:blank` tab; `open about:blank` adds
   a second, selected, at `about:blank`.
4. `send-keys "ctrl+b ?"`: real key presses (TextInputProcessor).
5. Differs: **`SIGTERM` leaves the discovery file** (see Settled). Quit with
   `send-keys ctrl+q` and `browser.warnOnQuitShortcut=false` to get a clean exit (0) and the file
   removed; teardown can then still signal and delete the temporary profile.

## Out of scope

`list-tabs`, `screenshot`, `reload-config`; a `[control]` table in `config.toml`; macOS/Windows
specifics; enabling the harness scenario (PR #35's follow-up once both merge).
