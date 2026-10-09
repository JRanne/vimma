# Spec: m0-control-protocol-and-vimma-ctl

Status: implemented (client and contract), awaiting review; server side pending · Milestone: M0 ·
Area: `packages/vimma-core` (contract validator), `tools/vimma-ctl` (Rust client),
`tests/contract/control/v1/` (fixtures)
Prerequisites: ADR-007 (control socket), ADR-011 (vimma-ctl in Rust).

## User story

As a Vimma user or the e2e harness, I can run `vimma-ctl state`, `vimma-ctl send-keys "ctrl+b c"`
or `vimma-ctl open https://example.com` against a running Vimma, and the browser-side server
(next spec) has a written, fixture-backed contract to implement against.

## Scope

1. Version 1 of the control protocol (below), with JSON fixtures in
   `tests/contract/control/v1/`: one valid and one invalid file per message type.
2. `packages/vimma-core/src/control.mjs`: a pure validator for every v1 message and the
   discovery file, plus `tokensEqual` (constant-time token comparison). The browser-side server
   will import it. Vitest runs it against the fixtures.
3. `tools/vimma-ctl/`: the Rust client (ADR-011). Subcommands `send-keys <keys>`,
   `state [--json]`, `open <url>`; options `--profile <dir>`, `--timeout <secs>`. Its unit tests
   decode and encode against the same fixtures; integration tests run it against a fake server.
4. CI: a `rust` job (fmt, clippy `-D warnings`, tests) and a crate licence check.

## Protocol, version 1

### Transport

- TCP on `127.0.0.1` only (`nsIServerSocket.init(-1, /* loopbackOnly */ true, backlog)`), a
  random port chosen by the OS. Never `0.0.0.0`, never `::`.
- UTF-8 **JSON lines**: every message is one JSON object on one line, terminated by `\n`
  (a preceding `\r` is tolerated). No other framing.
- A line longer than **1 MiB** is an error: the server answers `bad-request` and closes.
- One connection carries one handshake and then any number of requests. Requests are answered in
  the order received; every response carries its request's `id`, so a client may pipeline.
- Clients and servers **must ignore unknown fields in results** (`result`, `welcome`): adding a
  field is a compatible change within version 1. Removing or renaming one needs version 2.
  Requests are strict: unknown `args` fields are `invalid-args`, so typos fail loudly.

### Discovery file

When the server starts it writes `<profile>/vimma-control.json`, mode **0600**, atomically
(write `vimma-control.json.tmp` with 0600, then rename), and deletes it on shutdown:

```json
{ "protocol": 1, "port": 43817, "token": "<64 lowercase hex chars>", "pid": 12345 }
```

- `protocol`: integer, the highest protocol version the server speaks.
- `port`: integer 1..65535.
- `token`: 32 bytes from a CSPRNG (`crypto.getRandomValues`), lowercase hex, new every start.
- `pid`: integer ≥ 1, the browser's parent process; lets a client report a stale file
  (a crashed browser cannot delete it).

Clients refuse a discovery file readable or writable by group or others (`mode & 0o077 != 0`),
like `ssh` with a private key, and say how to fix it. A stale file (nothing listening) is reported
as "Vimma is not running (or the control socket is off)".

### Handshake

The client's first line must be `hello`; anything else, or no `hello` within 5 s, closes the
connection with an error.

```json
{ "type": "hello", "protocol": 1, "token": "<token from the discovery file>" }
```

Success:

```json
{ "type": "welcome", "protocol": 1, "app": "Vimma", "version": "0.1.0" }
```

Failure: an error response with `"id": null`, then the server closes the connection:

```json
{
  "type": "response",
  "id": null,
  "ok": false,
  "error": { "code": "unauthorized", "message": "bad token" }
}
```

The server compares tokens with `tokensEqual` (vimma-core), which takes time independent of where
the strings differ. A wrong token, a `protocol` the server does not speak (`unsupported-protocol`)
and a malformed `hello` (`bad-request`) all end the connection.

### Requests and responses

```json
{ "type": "request", "id": 7, "command": "state", "args": {} }
{ "type": "response", "id": 7, "ok": true, "result": { "...": "..." } }
{ "type": "response", "id": 7, "ok": false, "error": { "code": "invalid-args", "message": "..." } }
```

- `id`: an integer 1 ≤ id ≤ 2^53 − 1 chosen by the client (unique per connection).
- `command`: one of the commands below. `args`: an object, `{}` when the command takes none.
- A response has exactly one of `result` (when `ok` is true) and `error` (when false).
- `error.code` is one of the codes below; `error.message` is a human-readable string.
- An unparseable line or a broken envelope gets an error response with the request's `id` if it
  could be read, else `null`; the connection stays open unless the line was over the limit.

| Error code             | Meaning                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `bad-request`          | not JSON, not an object, or the envelope is malformed            |
| `unauthorized`         | wrong or missing token (handshake only)                          |
| `unsupported-protocol` | the `hello` asked for a version the server does not speak        |
| `unknown-command`      | `command` is not a v1 command                                    |
| `invalid-args`         | `args` does not match the command                                |
| `not-implemented`      | a reserved command (below)                                       |
| `failed`               | the command was valid but could not be carried out (e.g. no tab) |
| `internal`             | a bug in the server; the message says what threw                 |

### Commands

| Command         | `args`                                                 | `result`                |
| --------------- | ------------------------------------------------------ | ----------------------- |
| `send-keys`     | `{ "keys": "ctrl+b c" }`                               | `{ "sent": 2 }`         |
| `state`         | `{}`                                                   | the state object below  |
| `open`          | `{ "url": "https://…", "where"?: "tab" \| "current" }` | `{ "tab": "<tab id>" }` |
| `list-tabs`     | reserved, not implemented: `not-implemented`           |                         |
| `screenshot`    | reserved, not implemented: `not-implemented`           |                         |
| `reload-config` | reserved, not implemented: `not-implemented`           |                         |

**`send-keys`.** `keys` is a whitespace-separated sequence of chords in Herdr notation, exactly
what `parseKey` (vimma-core) accepts: `ctrl+b c`, `g t`, `esc`, `shift+t`. Symbolic `prefix` and
`<leader>` are not accepted: the client sends the literal keys. 1 to 256 chords. The server feeds
each chord to the window's dispatcher as if typed (same path as a real keydown, including mode
handling) and returns how many it sent. A chord that fails `parseKey` is `invalid-args` and none
are sent.

**`state`.** A snapshot of the focused window:

```json
{
  "mode": "normal",
  "pending": "ctrl+b",
  "workspace": null,
  "tabs": [{ "id": "12", "url": "https://example.com/", "title": "Example", "selected": true }],
  "panes": null
}
```

- `mode`: one of vimma-core's `MODES`.
- `pending`: the pending key sequence as the status bar shows it (`formatBinding`), or `null`.
- `workspace`: the active workspace's name, `null` until workspaces exist (M2).
- `tabs`: the window's visible tabs in strip order. `id` is an opaque string, stable for the tab's
  lifetime (the server uses `browser.browserId`); exactly one tab is `selected` when there are any.
- `panes`: the pane tree once split view exists (M3), `null` before. Its shape is that spec's to
  define; it is added without a version bump because clients ignore what they do not know.

**`open`.** `url` is an absolute URL whose scheme is `http`, `https`, `file` or `about`; anything
else (notably `javascript:` and `data:`) is `invalid-args`. At most 65536 characters. `where`
defaults to `tab` (a new foreground tab); `current` loads it in the selected tab. The result is
the tab's id, as in `state`.

## Security

- **Off unless enabled.** Pref `vimma.control.enabled` (bool, default `false`) in every build,
  dev and release. With it off there is no listening socket and no discovery file. The e2e
  harness sets it in its temporary profile's `user.js`; users turn it on in `about:config` (a
  `[control]` table in `config.toml` can map onto it once the config spec lands).
- **Localhost only**, loopback-only server socket, random port.
- **Token**: 256 bits, new at every start, compared in constant time, required before any
  command. A wrong token closes the connection.
- **File permissions 0600** on the discovery file, written atomically; the client refuses a
  wider mode. The profile directory itself is already 0700.
- **Scope of trust**: anyone who can read the profile can already read cookies and history, so
  the token adds no new exposure beyond that user; it keeps other local users and web content
  (DNS rebinding, `fetch` to localhost) out. Web pages cannot speak raw TCP and cannot read the
  token, and a non-JSON first line (an HTTP request) is rejected.
- `open` refuses `javascript:` and `data:` URLs, so a client cannot run script in a page's
  context through it.

**Plan §9 open question, decided for now:** the token lives in `<profile>/vimma-control.json`
(0600), and the socket is **off by default in all builds**, release included. Revisit when the
e2e harness or users need it on by default; changing the default is a one-line pref change plus a
note here.

## Profile discovery (`vimma-ctl`)

`--profile <dir>` (or `VIMMA_PROFILE`) names the profile directory directly. Otherwise, on Linux:

1. Root: `$XDG_CONFIG_HOME/vimma/vimma` (default `~/.config/vimma/vimma`), or the legacy
   `~/.vimma/vimma` if it exists (spec m0-branding, `nsXREDirProvider`).
2. `profiles.ini` there, the layout Firefox's `nsToolkitProfileService` writes:

   ```ini
   [Install4F96D1932A9F858E]
   Default=jpa751c5.default-release
   Locked=1

   [Profile0]
   Name=default-release
   IsRelative=1
   Path=jpa751c5.default-release
   Default=1

   [General]
   StartWithLastProfile=1
   Version=2
   ```

3. The profile is, in order: the `Default=` of the first `[Install…]` section (what the browser
   actually starts with); else the `[Profile…]` with `Default=1`; else the only `[Profile…]`.
   `Path` is relative to the root when `IsRelative=1`, absolute otherwise.
   (Checked against a real Firefox `profiles.ini`, where `[Install…] Default` and the
   `Default=1` profile differ: the install section wins.)

## `vimma-ctl` usage and exit codes

```
vimma-ctl [--profile DIR] [--timeout SECS] send-keys KEYS
vimma-ctl [--profile DIR] [--timeout SECS] state [--json]
vimma-ctl [--profile DIR] [--timeout SECS] open URL
```

| Exit | Meaning                                                                      |
| ---- | ---------------------------------------------------------------------------- |
| 0    | success                                                                      |
| 1    | the server answered with an error (code and message printed to stderr)       |
| 2    | usage error                                                                  |
| 3    | Vimma not reachable: no profile, no discovery file, insecure file, no server |
| 4    | authentication failed (`unauthorized`, `unsupported-protocol`)               |
| 5    | protocol error: malformed response, wrong id, connection closed, timeout     |

The timeout (default 5 s) covers connect, handshake and the response.

## Tests (written first)

- `packages/vimma-core/test/control.test.mjs` (Vitest): every fixture in
  `tests/contract/control/v1/` validates as its file name says (`*.valid.json` /
  `*.invalid.json`); every message type has both; table tests for each rule; `tokensEqual`.
- `tools/vimma-ctl` (`cargo test`):
  - unit: the JSON parser/printer; decoding every server-direction fixture (`welcome`,
    `response-*`, `discovery`) accepts the valid and rejects the invalid one; encoding `hello`
    and each request equals the valid client-direction fixture; `profiles.ini` resolution.
  - integration (`tests/cli.rs`, a `std::net::TcpListener` fake server in the test): auth success
    and failure, `send-keys`, `state`, `state --json`, `open`, a server error response, a
    malformed response, a timeout, no server (exit 3, clear message), insecure discovery file.

Fixture format: `{ "description", "kind", "command"?, "message" }` where `kind` is `hello`,
`welcome`, `request`, `response` or `discovery`, and `command` (responses only) says which
command's result shape applies.

## Out of scope

The browser-side server (`src/browser/base/content/vimma/ctl/`), the e2e harness, macOS/Windows
profile discovery, `list-tabs`/`screenshot`/`reload-config` beyond reserving them, AUR packaging.

## What the server spec must do

- `ctl/VimmaControl.sys.mjs`: start only when `vimma.control.enabled` is true (and stop when it
  turns false); `nsIServerSocket` loopback-only on port -1; write the discovery file 0600
  atomically (to `.tmp`, set 0600, rename; check in the engine tree whether `IOUtils` can create
  the file with a mode, else rely on the 0700 profile directory for the short window) and delete
  it at `quit-application`. Token from `crypto.getRandomValues` (32 bytes, hex).
- Validate every line with `validateMessage` from vimma-core; compare tokens with `tokensEqual`;
  enforce the 1 MiB line limit and the 5 s hello deadline; answer in the formats of the fixtures.
- Implement `send-keys` through the same dispatcher path as real keydowns, `state` from the host's
  dispatcher and `gBrowser`, `open` with the triggering principal the command-line handler uses
  for URLs (grep `nsBrowserContentHandler` / `BrowserContentHandler.sys.mjs`), only for schemes
  the validator allows; answer `not-implemented` for reserved commands.
- Mochitests: start/stop on the pref, file mode 0600, wrong token closes, each command; then the
  e2e harness drives a real build with `vimma-ctl`.

## Implementation log (2026-10-09)

- TDD red, Vitest: `control.test.mjs` failed with "Cannot find module '../src/control.mjs'";
  green: 88 tests, `control.mjs` 100 % lines. `cargo-license-check.test.mjs` likewise red, then
  9 green.
- TDD red, cargo (every function a `todo!()` stub): unit "1 passed; 43 failed", integration
  "1 passed; 16 failed" (the passing ones read only fixtures/vimma-core, or only the fake server);
  green: 44 unit, 17 integration. `cargo clippy --all-targets -- -D warnings` with `pedantic`,
  no `#[allow]`.
- `vimma-ctl` has no dependencies (ADR-011); its JSON module rejects duplicate keys, lone
  surrogates and nesting deeper than 64.
- Checked `profiles.ini` against a real Firefox profile directory on the dev box: its
  `[Install…] Default` and the `[Profile…] Default=1` name different profiles; Firefox starts the
  install's, and so does the client.
- Not done here: the server; `npx surfer license-check` needs `engine/`.
