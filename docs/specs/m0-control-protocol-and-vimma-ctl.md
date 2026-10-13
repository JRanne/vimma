# Spec: m0-control-protocol-and-vimma-ctl

Status: implemented (client and contract); the server is spec m0-control-server · Milestone: M0 ·
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
4. CI: Rust steps (fmt, clippy `-D warnings`, tests) in the existing `ci.yml` job (ADR-011:
   one job on purpose, minutes are billed per job) and a crate licence check.

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
as "Vimma is not running (or the control socket is off)". On Linux the client also checks that
`pid` is alive (`/proc/<pid>`) and reports a stale file when it is not. The server removes any
file at that path when it starts (whatever the pref) and when it stops.

### Handshake

Four lines, in this order; anything else, or no `welcome` within 5 s of connecting (one deadline
for the whole handshake), closes the connection with an error. The server proves it knows the
token **before** the client sends it.

1. Client: `{ "type": "hello", "protocol": 1, "nonce": "<64 hex>" }`. `nonce`: 32 fresh bytes
   from a CSPRNG per connection, lowercase hex. **No token**: a `hello` with a `token` is
   `bad-request`.
2. Server: `{ "type": "challenge", "protocol": 1, "proof": "<64 hex>" }`, where
   `proof` = HMAC-SHA256(key: the token, message: `"vimma-server\0"` + the nonce), ASCII
   (vimma-core `CHALLENGE_CONTEXT`), in lowercase hex. The prefix separates this use of the token
   from any other, so a proof the server hands to an unauthenticated client is good for nothing
   else.
3. Client: compares the proof with its own in constant time. On a mismatch it closes and sends
   **nothing more**: neither the token nor a command. Otherwise `{ "type": "auth", "token": "<token
from the discovery file>" }`.
4. Server: `{ "type": "welcome", "protocol": 1, "app": "Vimma", "version": "0.1.0" }`.

Fixtures: `challenge.valid.json` answers `hello.valid.json` for the token of `auth.valid.json`.

**What this guarantees.** A process squatting on a stale discovery file's port (the browser
crashed; another local user bound the port) learns only the nonce: it cannot produce the proof,
so it never receives the token or a command (`vimma-ctl` exits 4). It does not stop a squatter
from making the client wait (no reply: the client's timeout ends it) or from learning that a
client tried to connect.

**Amended in v1, not v2** (reviews of #38): the handshake was reordered before any server
shipped. The v1 server first lands with it, and `vimma-ctl` and the e2e harness live in the same
repository, so no deployed peer speaks an earlier form; a v2 would only carry dead compatibility
code. (An intermediate form sent the token in the `hello` next to the nonce, so a squatter could
compute the proof itself; a security review found it.)

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
the strings differ. A wrong token (`unauthorized`), a `protocol` the server does not speak
(`unsupported-protocol`), and a malformed or out-of-order line (`bad-request`) all end the
connection. `busy` may come instead of a `challenge` (evicted while waiting) or instead of the
`welcome` (8 authenticated connections).

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
| `busy`                 | at the connection limit (handshake only; see Security)           |

### Commands

| Command         | `args`                                                 | `result`                |
| --------------- | ------------------------------------------------------ | ----------------------- |
| `send-keys`     | `{ "keys": "ctrl+b c" }`                               | `{ "sent": 2 }`         |
| `state`         | `{}`                                                   | the state object below  |
| `open`          | `{ "url": "https://…", "where"?: "tab" \| "current" }` | `{ "tab": "<tab id>" }` |
| `reload-theme`  | `{}`                                                   | `{ "changed": true }`   |
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
- `workspace`: the active workspace's name, `null` until workspaces exist (filled since M3) or in a
  window without them. A private window is the private workspace: `"private"`
  ([private-workspace](private-workspace.md)).
- `private`: `true` in a private window, absent otherwise. Its tabs' `url` and `title` are then
  `null`, withheld so that scripts never see private pages (private-workspace decision 8d); `id`,
  `selected` and `panes` are kept.
- `tabs`: the window's visible tabs in strip order. `id` is an opaque string, stable for the tab's
  lifetime (the server uses `browser.browserId`); exactly one tab is `selected` when there are any.
- `panes`: the pane tree once split view exists (M3), `null` before. Its shape is that spec's to
  define; it is added without a version bump because clients ignore what they do not know.
  Since m3-workspaces sub-spec 7: `null` while the window shows one pane, else
  `{ "focus": "<tab id>", "zoomed": false, "root": <node> }`, where a node is a split
  `{ "axis": "x" | "y", "ratios": [0.5, 0.5], "children": [<node>, …] }` (`x` left to right,
  `y` top to bottom, one ratio per child) or a leaf `{ "tab": "<tab id>", "index": 1 }`: the
  tab's id as in `tabs` and its place there (`-1` if it is not visible). Read-only, like the
  rest of `state`. Since side-panel-unsplit (decision 28) it also has `"hidden": true | false`:
  true while the split is kept as a hidden view and another tab shows alone.

**`open`.** `url` is an absolute URL whose scheme is `http`, `https`, `file` or `about`; anything
else (notably `javascript:` and `data:`) is `invalid-args`. At most 65536 characters. `where`
defaults to `tab` (a new foreground tab); `current` loads it in the selected tab. The result is
the tab's id, as in `state`.

**`reload-theme`** (added 2026-10-10, spec m5-omarchy-theme "Instant reload"). Re-reads the
Omarchy theme now instead of at the next poll: the same check as the poll (the directory in
`vimma.theme.omarchyPath`, the same strict validation, a rejected file keeps the colours), except
that `colors.toml` is read even when its stat looks unchanged. No args: a client cannot point the
browser at another file. The response comes once every window shows the result; `changed` says
whether the colours differ from before. With `vimma.theme.source` = `builtin` it is a no-op
(`changed: false`). Its whole effect is one early poll: it takes no input, reads only the file
the poll reads anyway, and changes only the theme's token stylesheet.

Adding a command within v1: a v1 client never sends it unasked, and an older server answers it
`unknown-command` (exit 1), which is the right message. No existing message changes shape.

## Protocol, version 2 (roles; 2026-10-13)

Spec: [vimma-mcp](vimma-mcp.md) (decisions 2-4), ADR-019. Fixtures:
`tests/contract/control/v2/` (v1's are unchanged). The server speaks 1 and 2.

- **Hello.** `{ "type": "hello", "protocol": 2, "nonce": "…", "role": "agent" | "full" }`. The
  role is required in protocol 2 and not allowed in protocol 1, whose hello is the `full` role.
  The challenge and the welcome carry the hello's protocol; a protocol 2 welcome also repeats the
  `role`. Any other protocol is `unsupported-protocol` ("this server speaks protocols 1 and 2").
- **Roles and switches.** `full` runs protocol 1's commands and is served while
  `vimma.control.enabled` is on. `agent` runs only the agent commands below and is served while
  MCP is on (`vimma.mcp.enabled`, `[mcp] enabled`). Either switch starts the server; it stops
  when both are off. A hello for a role that is off is answered `role-off` (its message names
  the switch) and closed, and turning a switch off closes that role's connections. Each role gets
  `unknown-command` for the other's commands.
- **Discovery file.** `protocol` is 2, and `roles` lists the roles served, in the order
  `["agent", "full"]`: `{ "protocol": 2, "port": …, "token": "…", "pid": …, "roles": ["agent"] }`.
  A v1 client reads past `roles` and speaks protocol 1, which works while `full` is served.
  `vimma-ctl` speaks protocol 2 as `full` when the file says 2, and says the control socket is
  off when `roles` lacks `full`, without connecting.
- **Full control while MCP is on** ([vimma-mcp](vimma-mcp.md) decision 29). After a `full`
  connection's auth and before its welcome, Vimma asks the user; a refusal is the error `denied`
  (with its `reason`) in place of the welcome. The auth may carry `"code"`: 4 characters of 2-9
  and A-Z without I and O, which `vimma-ctl` prints on stderr and the question shows, so the
  user answers for the client they ran. `vimma-ctl` sends it, and waits up to 310 s for the
  welcome, only when the discovery file lists `agent`.
- **New error codes.** `role-off` (above) and `denied`: an agent request the user did not allow.
  A `denied` error carries `reason`: `user`, `timeout`, `busy`, `muted`, `changed` or
  `cancelled`; no other error has a `reason`.
- **Agent commands** (role `agent` only; `agent-hello` must come first, and only once):

  | Command       | `args`                                                     | `result`                                                                         |
  | ------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
  | `agent-hello` | `{ "client": { "name", "version"? }, "via"? }`             | `{ "workspace": "agent", "exists": true }`                                       |
  | `agent-tabs`  | `{}`                                                       | `{ "tabs": [{ "id", "url", "title", "loading" }] }`                              |
  | `agent-read`  | `{ "tab", "format"?: "markdown" \| "text", "max_chars"? }` | `{ "url", "title", "text", "truncated", "selection", "language", "background" }` |
  | `agent-open`  | `{ "url", "tab"? }`                                        | `{ "tab": "<id>" }`                                                              |
  | `agent-close` | `{ "tab" }`                                                | `{ "closed": true }`                                                             |
  | `agent-ping`  | `{}`                                                       | `{}`                                                                             |

  `name` and `version` are 1 to 64 printable characters and `via` 1 to 32 (no control
  characters, no bidirectional marks or overrides). `tab` is a tab id as `state` gives it
  (digits). `url` is http or https only, at most 65536 characters. `max_chars` is 1 to 500000,
  and the server caps it at `[mcp] max_read_chars`. `text` is the page text between
  `<untrusted-web-content>` and `</untrusted-web-content>` lines; a delimiter inside the page
  text is broken with a zero-width space. `selection` and `language` may be `null`.
  `background` says the tab was not in front while it was read.

- **Asking.** Every agent command but `agent-hello` and `agent-ping` waits for the user's answer
  in Vimma, or runs under a grant of that connection and tool. An agent connection's requests do
  not wait for each other: each is answered by `id` when its answer comes, so responses may come
  out of order. A connection with requests waiting is not closed by the 60 s idle limit. Limits: at most 4
  agent connections (of the server's 8), at most 4 requests of one agent connection waiting or
  running at once, and at most 10 `agent-open`s of one connection a minute; beyond each, `busy`.
  Strings in agent replies are well-formed Unicode (a lone surrogate becomes U+FFFD), and the
  read's `selection` is inside the untrusted-content delimiters too.

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
- **Connection limits.** Any local user can connect before proving the token, so the server
  bounds what a connection may hold:
  - **At most 8 authenticated connections** and, apart from them, **at most 2 still in the
    handshake**. Real use is one short-lived `vimma-ctl` per command plus the e2e harness; 8 leaves
    room for scripts running in parallel. Anyone local can open waiting connections, so a new
    one evicts the oldest waiting one (answered `busy`) instead of being refused: idle
    connections cannot lock out a client that holds the token, which answers at once. A fast
    **connect flood still can**: two new connections arriving between a client's connect and its
    `auth` evict it. That is an active local denial of service by a process of some local user;
    the remedy is turning the pref off. Up to 16 refused connections linger 1 s to deliver their
    `busy`; beyond that they are closed at once.
  - **Handshake deadline 5 s** (above): no `welcome` earned within 5 s of connecting → close.
  - **Idle timeout 60 s after the handshake**: no complete request line for 60 s → the server
    closes the connection without a message. A client that wants a long-lived connection sends
    a request (e.g. `state`) at least every 60 s.
  - **At the limit**, the 9th correct `auth` is answered with one line
    `{"type":"response","id":null,"ok":false,"error":{"code":"busy","message":"…"}}` and the
    connection closes, so the client can tell "busy" from "not running". It never queues.
  - **A client that stops reading** (over 4 MiB of unsent replies) is disconnected.
  - `vimma-ctl` reports `busy` as "Vimma's control socket is busy (…); try again" with exit 3;
    a refused connection is exit 3 ("not running"); a connection dropped mid-reply (idle
    timeout, shutdown) is exit 5 "connection closed before a complete reply".

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
vimma-ctl [--profile DIR] [--timeout SECS] reload-theme   # prints changed or unchanged
```

| Exit | Meaning                                                                                       |
| ---- | --------------------------------------------------------------------------------------------- |
| 0    | success                                                                                       |
| 1    | the server answered with an error (code and message printed to stderr)                        |
| 2    | usage error                                                                                   |
| 3    | Vimma not reachable: no profile, no or stale discovery file, insecure file, no server, `busy` |
| 4    | authentication failed (`unauthorized`, `unsupported-protocol`, or no valid `proof`)           |
| 5    | protocol error: malformed response, wrong id, connection closed, timeout                      |

The timeout (default 5 s, at most 3600 s) covers connect, handshake and the response.

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
- Enforce the connection limits in § Security: 8 connections, 5 s handshake, 60 s idle, `busy`.
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
- Review follow-up: `--timeout` capped at 3600 s (a huge value overflowed the deadline and
  panicked); connection limits and the `busy` code specified; discovery file read capped at
  64 KiB. Red: lib tests did not compile (`Busy`, `MAX_TIMEOUT`, `MAX_FILE_SIZE` missing),
  integration "18 passed; 2 failed", Vitest "1 failed" (`busy`); green: 47 unit,
  20 integration, 89 Vitest.
- Not done here: the server; `npx surfer license-check` needs `engine/`.
