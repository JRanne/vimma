# Security model

What each risky part of Vimma may do, what it must never do, who can reach it, and the test that
holds it to that. It is a page of rules, not code: review it like a contract. Reporting a
vulnerability: [SECURITY.md](../SECURITY.md).

**How to read it.** Each rule is one "must" or "never" sentence, followed by the tests that
enforce it, as `test name` links into the test file. CI fails if a link stops resolving
(`tools/security/check-doc-links.mjs`), so a renamed or deleted test cannot leave a rule
unguarded. **⚠ gap** marks a rule the code does not meet yet, with its issue.

**Fuzzing.** Every parser of outside input (the control protocol, vimma-ctl's JSON, `config.toml`,
routing rules, key notation, the command line, a theme's `colors.toml`) is fuzzed with
property-based tests: a fixed seed on every PR, a random seed and many more cases nightly
(`.github/workflows/fuzz.yml`, spec [m7-fuzzing](specs/m7-fuzzing.md)). Rules S11, U7, R6, F5 and
O7 rest on them.
[`parseKey and parseBinding throw nothing but KeyNotationError, on any text`](../packages/vimma-core/test/fuzz/keys.fuzz.test.mjs),
[`json_parse_never_panics`](../tools/vimma-ctl/tests/protocol_props.rs),
[`decoders_never_panic_and_accept_only_the_schema`](../tools/vimma-ctl/tests/protocol_props.rs)

**Who can reach what.** _You_ means the local user Vimma runs as. _Other local users_ are other
accounts on the same machine. _Pages_ are web content, which runs in sandboxed content
processes. _Extensions_ are installed WebExtensions. _Local apps_ are other programs running as
you.

## 1. Control socket (`ctl/VimmaControl.sys.mjs`)

Lets `vimma-ctl` and scripts drive Vimma: send keys, read state, open a URL, reload the theme.
Since protocol 2 it also lets local AI agents use the agent workspace (the `agent` role, §12).
Specs: [m0-control-server](specs/m0-control-server.md),
[m0-control-protocol-and-vimma-ctl](specs/m0-control-protocol-and-vimma-ctl.md),
[vimma-mcp](specs/vimma-mcp.md), [ADR-007](adr/007-control-socket.md),
[ADR-019](adr/019-agents-over-mcp.md).

**Reach:** any local process can connect to the port; only one that can read the token file
(you, or root) gets past the handshake. Pages and extensions cannot speak the protocol (an HTTP
request is refused). A connection's hello picks its role. With the `full` role, whoever holds the
token is treated as you: `send-keys` can do anything your keyboard can. The `agent` role reaches
only the agent workspace, and every request asks you first (§12).

- S1. The socket **must** be off by default and start or stop only with the pref
  `vimma.control.enabled` or `vimma.mcp.enabled` (`:mcp on`, `[mcp] enabled`). Either one starts
  it, and it stops when both are off.
  [`test_pref_starts_and_stops_the_server`](../tests/browser/browser_vimma_control.js),
  [`test_agent_role_has_its_own_switch`](../tests/browser/browser_vimma_mcp_agent.js)
- S2. It **must** listen on 127.0.0.1 only, never on another interface.
  [`test_pref_starts_and_stops_the_server`](../tests/browser/browser_vimma_control.js)
- S3. The token file **must** be mode 0600 from its first byte, and `vimma-ctl` **must** refuse
  one that others can read.
  [`test_pref_starts_and_stops_the_server`](../tests/browser/browser_vimma_control.js),
  [`refuses_a_file_others_can_read`](../tools/vimma-ctl/src/discovery.rs),
  [`refuses_an_insecure_discovery_file`](../tools/vimma-ctl/tests/cli.rs)
- S4. No command **must** run before the HMAC handshake; a wrong token is refused and the
  connection closed; the token is never sent before the server proved it knows it.
  [`test_handshake`](../tests/browser/browser_vimma_control.js),
  [`challenge.valid's proof is HMAC-SHA256(token, vimma-server NUL nonce)`](../packages/vimma-core/test/control.test.mjs),
  [`a_squatter_gets_neither_the_token_nor_a_command`](../tools/vimma-ctl/tests/cli.rs)
- S5. It **must** cap connections (8 open, of which at most 4 agents; 2 waiting for a hello),
  line length (1 MiB) and handshake and idle time.
  [`test_limits`](../tests/browser/browser_vimma_control.js),
  [`test_agents_cannot_take_every_connection`](../tests/browser/browser_vimma_mcp_agent.js)
- S6. A token file left by a crash **must** be removed at start; a symlink or directory in its
  place is never followed. [`test_stale_discovery_file_removed_at_start`](../tests/browser/browser_vimma_control.js)
- S7. Only the commands of the connection's role **must** run (`full`: the four of protocol 1;
  `agent`: the seven agent commands); anything else, and any unknown argument, is refused.
  [`test_handshake`](../tests/browser/browser_vimma_control.js),
  [`protocol version 1 with the commands of ADR-007`](../packages/vimma-core/test/control.test.mjs),
  [`protocols 1 and 2, two roles, the agent commands apart from v1's`](../packages/vimma-core/test/control-v2.test.mjs),
  [`test_each_role_runs_only_its_commands`](../tests/browser/browser_vimma_mcp_agent.js)
- S8. `reload-theme` **never** takes an argument; it reads only the theme folder Vimma's own
  prefs name. [`test_reload_theme`](../tests/browser/browser_vimma_control.js),
  [`takes no args`](../packages/vimma-core/test/control.test.mjs)
- S9. `state` **must** be read-only: it changes no tab, selection, mode or workspace.
  [`control_state_is_read_only`](../tests/browser/browser_vimma_security_invariants.js)
- S10. `open` **must** load only http, https, file and about URLs of at most 64 KiB, checked by
  the server itself, never only by the client.
  [`test_server_checks_the_scheme_itself`](../tests/browser/browser_vimma_control.js),
  [`test_open`](../tests/browser/browser_vimma_control.js)
- S11. Whatever bytes a client sends, the server's framing and validator **never** throw, hang
  or change a built-in prototype; the framing gives back exactly the lines sent and refuses a
  line over 1 MiB, and a message outside the protocol is refused.
  [`LineFramer gives back the lines sent, however the bytes are chunked`](../packages/vimma-core/test/fuzz/control.fuzz.test.mjs),
  [`any line a client sends, decoded as the server does, validates without throwing`](../packages/vimma-core/test/fuzz/control.fuzz.test.mjs),
  [`every valid message validates; one changed or added field makes it invalid`](../packages/vimma-core/test/fuzz/control.fuzz.test.mjs),
  [`send-keys passes only keys the server can parse; open only short http(s), file and about URLs`](../packages/vimma-core/test/fuzz/control.fuzz.test.mjs),
  [`a type that is not a string is an error, never a throw`](../packages/vimma-core/test/control.test.mjs),
  [`agent-open passes only short http(s) URLs; agent labels never carry control or bidi characters`](../packages/vimma-core/test/fuzz/control.fuzz.test.mjs),
  [`test_handshake`](../tests/browser/browser_vimma_control.js)
- S12. The `full` role **must** run only with `vimma.control.enabled`, and the `agent` role only
  with MCP on; a hello for a role that is off is refused (`role-off`) and closed, and turning a
  switch off closes that role's connections. An agent connection **never** reaches `send-keys`,
  `state` or protocol 1's `open`.
  [`test_agent_role_has_its_own_switch`](../tests/browser/browser_vimma_mcp_agent.js),
  [`test_each_role_runs_only_its_commands`](../tests/browser/browser_vimma_mcp_agent.js),
  [`says_the_control_socket_is_off_when_only_mcp_is_on`](../tools/vimma-ctl/tests/cli.rs)
- S13. While MCP is on, a new `full` connection **must** get its welcome only after the user's
  `y` in the agent question line (no grant covers it, one waits at a time, three noes mute the
  question for a minute); a no, a timeout or a closed connection refuses it (`denied`). An agent
  with a shell can read the token, so the token alone **never** gives it keys in your window.
  With MCP off nothing asks. While MCP is on, `vimma-ctl` sends a 4-character code in its auth
  and only then prints it, so a process reading your terminal learns it too late to race it in,
  and the question shows it (`vimma-ctl with code 7F3K wants full control`; a client
  without one is "a client with no code"), so a racing client's question is told from the one
  the user ran. `:control on <minutes>` **must** turn full control off when its time is up, also
  across a restart, and **must** fail closed: an end time that is not a time ahead within 1441
  minutes turns it off.
  [`test_full_control_asks_only_while_mcp_is_on`](../tests/browser/browser_vimma_mcp_control.js),
  [`prints_and_sends_a_code_while_mcp_is_on`](../tools/vimma-ctl/tests/cli.rs),
  [`the_code_is_shown_only_after_its_auth_was_sent`](../tools/vimma-ctl/src/client.rs),
  [`a time ahead, within 1440 minutes and a minute: control stays on until then`](../packages/vimma-core/test/agent-prompt.test.mjs),
  [`test_control_on_minutes_turns_itself_off`](../tests/browser/browser_vimma_mcp_control.js),
  [`waits_for_the_users_answer_while_mcp_is_on`](../tools/vimma-ctl/tests/cli.rs),
  [`reports_refused_full_control_with_exit_4`](../tools/vimma-ctl/tests/cli.rs)

## 2. Workspace routing (`workspaces/WorkspaceRouter.sys.mjs`)

Sends a URL to the workspace (container, so cookies) that a `[[routes]]` rule names. Spec:
[workspace-routing](specs/workspace-routing.md).

**Reach:** you (URL bar, `:open`, bookmarks, `p`); local apps (links they open through
`vimma-open`); pages try to (link clicks, `window.open`) and must fail.

- R1. Routing **must** apply only to opens you or Vimma's chrome started, and to links from other
  apps. [`the_url_bar_routes_to_the_rules_workspace_and_switches`](../tests/browser/browser_vimma_workspace_routes.js),
  [`shift_p_routes_a_clipboard_url`](../tests/browser/browser_vimma_workspace_routes.js),
  [`an_external_link_routes_by_the_app_that_opened_it`](../tests/browser/browser_vimma_workspace_routes.js)
- R2. A page **never** routes what it opens (clicks, `target=_blank`, `window.open`, redirects,
  same-tab navigation): it could open a URL of its choice with another workspace's cookies.
  [`a_page_can_never_route_the_links_it_opens`](../tests/browser/browser_vimma_workspace_routes.js),
  [`same_tab_navigation_is_never_moved_but_hinted`](../tests/browser/browser_vimma_workspace_routes.js),
  [`a_redirect_inside_a_tab_is_never_moved`](../tests/browser/browser_vimma_workspace_routes.js)
- R3. A private window is **never** routed and gets no container.
  [`private_windows_are_never_routed`](../tests/browser/browser_vimma_workspace_routes.js),
  [`private_windows_are_untouched`](../tests/browser/browser_vimma_workspace_routing.js)
- R4. The app hint (`-vimma-from`, `VIMMA_FROM`) **must** only select a workspace that a rule in
  config.toml names and that exists; anything but a short lower-case token never matches.
  [`a hint that is not a token never matches`](../packages/vimma-core/test/routes.test.mjs),
  [`a rule naming a workspace that does not exist is skipped`](../packages/vimma-core/test/routes.test.mjs)
- R5. `VIMMA_FROM` **must** be read once and cleared, so it never reaches a later window or a
  process Vimma starts.
  [`a_new_windows_first_tab_is_routed_with_the_startup_app`](../tests/browser/browser_vimma_workspace_routes.js)
- R6. A domain rule **never** matches a host outside its domain: not a lookalike
  (`evil-github.com`, `github.com.evil`, letters from another script), nor a disguise
  (`github.com@evil`, a path, query or fragment, `\`, `%2e`, the ideographic full stop).
  [`a domain rule never matches a URL whose host is outside its domain`](../packages/vimma-core/test/fuzz/routes.fuzz.test.mjs),
  [`a domain rule matches its own host and subdomains, however written`](../packages/vimma-core/test/fuzz/routes.fuzz.test.mjs)

## 3. Workspace deletion and containers (`workspaces/WorkspaceStore.sys.mjs`)

Closing a runtime workspace deletes its container and that container's cookies and site data.
Spec: [m3-workspaces](specs/m3-workspaces.md).

**Reach:** you, by keys or `:wsdelete`. Extensions and Firefox's Settings can delete containers.

- W1. Site data **never** goes without a y to a y/N question; n keeps everything.
  [`closing_asks_n_keeps_y_deletes_the_container_and_its_cookies`](../tests/browser/browser_vimma_workspace_ops.js),
  [`a_confirmed_delete_removes_the_container_and_its_cookies`](../tests/browser/browser_vimma_workspace_store.js)
- W2. A y **must** stand only for the workspace as asked: after a rename or a config reload in
  between, nothing is closed.
  [`a_stale_answer_closes_nothing`](../tests/browser/browser_vimma_workspace_store.js)
- W3. A delete **must** clear only that workspace's container; other containers keep their data.
  [`a_confirmed_delete_removes_the_container_and_its_cookies`](../tests/browser/browser_vimma_workspace_store.js)
- W4. A container that is no longer recognisably the workspace's (renamed in Settings, reused)
  **must** be kept with its data.
  [`a_container_no_longer_ours_is_kept_and_the_notice_says_so`](../tests/browser/browser_vimma_workspace_ops.js),
  [`reconcile_adopts_and_never_deletes_silently`](../tests/browser/browser_vimma_workspace_store.js)
- W5. Container 0 (the default, shared by everything outside a workspace) is **never** a
  workspace's, so it is never closed or cleared.
  [`container 0 is never a workspace's: a stored id of 0 or below is refused`](../packages/vimma-core/test/workspacedefs.test.mjs)
- W6. Closing a config workspace **must** close its tabs only, never its data; the last
  workspace is never closed.
  [`closing_a_config_workspace_closes_its_tabs_only`](../tests/browser/browser_vimma_workspace_ops.js),
  [`the_last_workspace_cannot_be_closed`](../tests/browser/browser_vimma_workspace_ops.js)
- W7. A container deleted outside Vimma **must** be replaced at once, so new tabs never fall
  into the default container.
  [`a_container_deleted_by_an_extension_is_replaced_at_once`](../tests/browser/browser_vimma_workspace_edges.js),
  [`a_container_deleted_in_settings_is_replaced_and_ext_stays_usable`](../tests/browser/browser_vimma_workspace_edges.js)

## 4. Opening URLs from untrusted text

The clipboard, bookmarks and the command line can hold text someone else wrote. Pages also send
link targets for hints, which chrome must treat as untrusted.

- U1. `p`/`P` **never** open `javascript:` or `data:` URLs, however disguised (case, tabs,
  newlines, `view-source:`).
  [`p_and_shift_p_refuse_javascript_and_data_urls`](../tests/browser/browser_vimma_normal_extras.js),
  [`refuses %j`](../packages/vimma-core/test/pageurl.test.mjs)
- U2. Clipboard text over 8,192 characters **must** be refused, not truncated.
  [`text over the cap is refused, not truncated`](../packages/vimma-core/test/pageurl.test.mjs)
- U3. Bookmarks **must** open only http, https, file and about URLs (bookmarklets are listed but
  never run).
  [`javascript_and_data_bookmarks_refuse_with_a_notice`](../tests/browser/browser_vimma_bookmarks.js),
  [`a javascript: bookmark is listed but refuses to open`](../packages/vimma-core/test/bookmarks.test.mjs)
- U4. `:open` and `:tabnew` **never** open `javascript:` or `data:` URLs, however disguised (case,
  tabs, newlines, leading controls, `view-source:`)
  ([#98](https://github.com/vimma-browser/vimma/issues/98)). No length cap applies to text typed there.
  A search alias or bookmark keyword at the start resolves as the URL bar resolves it
  (`UrlbarUtils.getShortcutOrURIAndPostData`), and the URL it resolves to is checked again, so a
  keyword bookmarklet is refused; the bookmark's principal is never inherited. Other schemes a
  keyword resolves to (`file:`, `about:`) load as they would if typed: there is no allowlist like
  the bookmarks panel's. The query goes to the tab it was typed in (or a new tab in its
  container), even when the workspace changes while the keyword is looked up.
  [`javascript_urls_are_blocked_with_a_notice`](../tests/browser/browser_vimma_cmdline.js),
  [`data_urls_are_blocked_with_a_notice`](../tests/browser/browser_vimma_cmdline.js),
  [`bookmark_keywords_work_and_refused_ones_never_run`](../tests/browser/browser_vimma_search.js),
  [`a_keyword_page_never_inherits_the_current_page`](../tests/browser/browser_vimma_search.js),
  [`a_workspace_switch_during_the_lookup_keeps_the_query_where_it_was_typed`](../tests/browser/browser_vimma_search.js)
- U5. Every Vimma open of text with the system principal (`p`, `P`, `:open`, `:tabnew`) **must**
  refuse those schemes through one shared check (`refusedScheme`, `core/pageurl.mjs`); bookmarks
  and the socket's `open` go further and allow only http, https, file and about.
  [`refuses %j as %s`](../packages/vimma-core/test/pageurl.test.mjs),
  [`lets %j through`](../packages/vimma-core/test/pageurl.test.mjs)
- U6. Hint replies from a page **must** be capped (5,000 targets, 64 frames, 8 KiB links) and
  copied field by field before chrome uses them.
  [`the caps are 5,000 targets, 64 frames and 8 KiB hrefs`](../packages/vimma-core/test/hints.test.mjs),
  [`a well-formed reply → a fresh copy with only the known fields`](../packages/vimma-core/test/hints.test.mjs)
- U7. Text pasted on the command line **must** be read in bounded time: a megabyte never
  freezes the window.
  [`a pasted megabyte is parsed and completed in bounded time`](../packages/vimma-core/test/fuzz/cmdline.fuzz.test.mjs),
  [`parseCommandLine never throws, and a run names a real action`](../packages/vimma-core/test/fuzz/cmdline.fuzz.test.mjs)

## 5. Add-ons (`host/addon-ops.mjs`)

The add-on picker lists, enables, disables and removes extensions. Spec:
[addon-manager](specs/addon-manager.md).

**Reach:** you only (keys and `:addon`); nothing in it is reachable from pages.

- A1. Vimma **never** installs an add-on or an add-on update; an update goes through
  about:addons, where Firefox asks about new permissions.
  [`u_reports_the_update_check`](../tests/browser/browser_vimma_addons.js),
  [`never installs an add-on`](../tools/security/test/chrome-source.test.mjs)
- A2. Removal **must** ask y/N, and a y stands only for the add-on and version asked about.
  [`d_removes_after_yes_and_keeps_after_no`](../tests/browser/browser_vimma_addons.js),
  [`a_stale_yes_removes_nothing`](../tests/browser/browser_vimma_addons.js)
- A3. System, built-in and hidden add-ons are **never** listed or acted on, by the picker or by
  `:addon name`.
  [`lists_extensions_but_not_system_ones`](../tests/browser/browser_vimma_addons.js),
  [`:addon never reaches a hidden or system add-on`](../packages/vimma-core/test/addons.test.mjs)

Allowed without a question, as in about:addons: enable, disable, and private-window access.

## 6. Chrome UI rendering

Vimma's status bar, pickers, side panel and overlays run with full browser privileges and show
text that pages, add-ons and bookmarks choose.

- C1. Page titles, add-on names and bookmark titles **must** be set as text (`textContent`),
  **never** parsed as HTML.
  [`page_titles_with_html_stay_text`](../tests/browser/browser_vimma_security_invariants.js),
  [`names_with_html_are_text`](../tests/browser/browser_vimma_addons.js),
  [`toggles_in_the_side_panels_slot_one_panel_at_a_time`](../tests/browser/browser_vimma_bookmarks.js),
  [`never parses strings as HTML: page titles, add-on and bookmark names stay text`](../tools/security/test/chrome-source.test.mjs)
- C2. Chrome code **never** builds code from text (`eval`, `Function`) and **never** starts a
  process, with one exception: the system's `clamscan` (only `/usr/bin/clamscan` or
  `/usr/local/bin/clamscan`, never a `PATH` search, and only a regular file another user (root)
  owns that the user cannot write, in a folder the user cannot write), in one call with fixed
  arguments, the path after `--` and no shell, on an agent download in the quarantine folder
  (M13; [vimma-mcp](specs/vimma-mcp.md) decision 31 g). [`never builds code from text: no eval, Function or sandbox evaluation`](../tools/security/test/chrome-source.test.mjs),
  [`never starts a process, but clamscan on an agent download`](../tools/security/test/chrome-source.test.mjs)

## 7. Omarchy hook and the `vimma-open` launcher

The hook (`omarchy/vimma-theme-reload.sh`) runs when you change your Omarchy theme. Vimma
writes it into `~/.config/omarchy/hooks/theme-set.d/`. `vimma-open` (`tools/package/`) is the
desktop entry's launcher (`vimma-open %u`): it finds which app opened a link, for routing.

**Reach:** the hook gets the theme name, which comes from a theme anyone can publish.
`vimma-open` gets a URL from any local app, and reads `/proc` for the app's name.

- O1. The hook **must** only ask running Vimmas to reload their theme (D-Bus, else
  `vimma-ctl reload-theme`) and **never** start a Vimma.
  [`asks every running Vimma, over Firefox's D-Bus remoting, to reload its theme`](../tools/omarchy/test/theme-hook.test.mjs),
  [`never starts Vimma: with none running it does nothing and says nothing`](../tools/omarchy/test/theme-hook.test.mjs)
- O2. The hook **never** passes its arguments (the theme name) on to Vimma or `vimma-ctl`.
  [`never passes its arguments on: a hostile theme name changes nothing`](../tools/omarchy/test/theme-hook.test.mjs)
- O3. `-vimma-reload-theme` **must** open no window or tab.
  [`test_remote_reload_theme`](../tests/browser/browser_vimma_omarchy_hook.js)
- O4. Vimma **must** write the hook only where none is, or over its own unedited copy; an edited
  copy is yours and never touched. [`test_installer`](../tests/browser/browser_vimma_omarchy_hook.js)
- O5. `vimma-open` **never** passes a single argument that starts with `-`, so a crafted link
  cannot become a browser flag (`-profile`, `--remote-debugging-port`).
  [`refuses a single argument that is a flag: %u must never smuggle one in`](../tools/package/test/vimma-open.test.mjs)
- O6. The app name **must** be a lower-case token of at most 32 characters, and an inherited
  `VIMMA_FROM` is **never** passed on.
  [`never passes a name that is not a simple token`](../tools/package/test/vimma-open.test.mjs),
  [`refuses a name with a newline in it`](../tools/package/test/vimma-open.test.mjs),
  [`never passes a VIMMA_FROM it did not set`](../tools/package/test/vimma-open.test.mjs)
- O7. A theme's `colors.toml` (anyone can publish a theme) **must** give only `#rrggbb` colours
  and one CSS rule, and be read in bounded time however deep or large it is.
  [`parseOmarchyColors never throws; a palette has every key, as #rrggbb or a mode`](../packages/vimma-core/test/fuzz/theme.fuzz.test.mjs),
  [`any theme file and any accepted font give CSS that tokensToCss accepts`](../packages/vimma-core/test/fuzz/theme.fuzz.test.mjs),
  [`a hostile theme file is read in bounded time: deep, huge, many keys`](../packages/vimma-core/test/fuzz/theme.fuzz.test.mjs)

Allowed: two or more arguments pass through unchanged; a local app that runs `vimma-open` with
its own flags could run `vimma` with them directly.
[`passes anything but one URL through unchanged`](../tools/package/test/vimma-open.test.mjs)

## 8. `config.toml` (`config/ConfigHost.sys.mjs`)

A local file you trust and edit. Spec: [m5-config-load](specs/m5-config-load.md),
[ADR-008](adr/008-config-toml.md).

- F1. A config.toml Vimma creates **must** be mode 0600 in a 0700 folder, and an existing file is
  never overwritten.
  [`a_missing_folder_is_created_private`](../tests/browser/browser_vimma_config_first_run.js),
  [`an_existing_file_is_never_touched`](../tests/browser/browser_vimma_config_first_run.js),
  [`route_add_creates_a_private_config_toml`](../tests/browser/browser_vimma_security_invariants.js)
- F2. Every value **must** be validated; a broken file keeps the last good config and a bad
  value (such as a `javascript:` home page) is an error.
  [`broken text keeps the previous config active, unchanged`](../packages/vimma-core/test/config.test.mjs),
  [`workspace %s is an error`](../packages/vimma-core/test/config.test.mjs)
- F3. The config is **never** executed: no value is evaluated as code or run as a command.
  [`never builds code from text: no eval, Function or sandbox evaluation`](../tools/security/test/chrome-source.test.mjs)
- F4. `:route add` **must** write each value as one escaped TOML string, and write nothing when
  the result would not parse.
  [`appendRouteText quotes a workspace name as a TOML string`](../packages/vimma-core/test/routes.test.mjs),
  [`appendRouteText refuses what would not parse, and says why`](../packages/vimma-core/test/routes.test.mjs),
  [`route_add_creates_a_private_config_toml`](../tests/browser/browser_vimma_security_invariants.js)
- F5. Reading `config.toml` **never** throws, hangs or changes a built-in prototype; nesting
  deeper than 32 levels is refused; a key, colour or modifier named like an `Object` member
  (`constructor`, `__proto__`) is unknown, never looked up; an accepted config holds only values
  its schema allows.
  [`parseConfig never throws, on any text, and its result is well-formed`](../packages/vimma-core/test/fuzz/config.fuzz.test.mjs),
  [`an accepted config holds only what the schema allows`](../packages/vimma-core/test/fuzz/config.fuzz.test.mjs),
  [`huge and deeply nested files are refused or read in bounded time`](../packages/vimma-core/test/fuzz/config.fuzz.test.mjs),
  [`a workspace colour named after an Object member is an error, not a value`](../packages/vimma-core/test/fuzz/config.fuzz.test.mjs),
  [`a prototype member name is never a key or a modifier: constructor, toString, __proto__`](../packages/vimma-core/test/fuzz/keys.fuzz.test.mjs),
  [`nesting deeper than MAX_DEPTH, by dotted keys, headers or values, is refused at its line`](../packages/vimma-core/test/toml.test.mjs)

## 9. Privacy defaults

Spec: [m0-mozilla-services](specs/m0-mozilla-services.md),
[m0-safebrowsing-key](specs/m0-safebrowsing-key.md).

- P1. Vimma **must** be built without telemetry reporting and upload nothing.
  [`test_no_telemetry_upload`](../tests/browser/browser_vimma_mozilla_services.js)
- P2. Studies and experiments (Normandy, Nimbus) **never** run.
  [`test_normandy_and_nimbus_do_not_run`](../tests/browser/browser_vimma_mozilla_services.js),
  [`test_studies_crash_and_sponsored_defaults_are_off`](../tests/browser/browser_vimma_mozilla_services.js)
- P3. Sponsored content and suggestions are **never** shown by default.
  [`test_no_sponsored_address_bar_suggestions`](../tests/browser/browser_vimma_mozilla_services.js),
  [`test_sponsored_suggestions_survive_suggest_migrations`](../tests/browser/browser_vimma_mozilla_services.js)
- P4. Crash reports are **never** sent. [`test_no_crash_reporter`](../tests/browser/browser_vimma_crash_reporter.js)
- P5. Security services (add-on blocklist, CRLite, add-on updates) **must** keep Firefox's
  defaults. [`test_security_services_stay_on`](../tests/browser/browser_vimma_mozilla_services.js)
- P6. Safe Browsing **must** be on in a build with a Google key, and honestly off (Settings
  says so) in one without.
  [`test_keyed_build_fetches_google_lists`](../tests/browser/browser_vimma_safebrowsing.js),
  [`test_keyless_build_is_honestly_off`](../tests/browser/browser_vimma_safebrowsing.js)
- P7. Site permissions (camera, location, notifications …) **must** be kept per container, so
  per workspace (`permissions.isolateBy.userContext`;
  [vimma-mcp](specs/vimma-mcp.md) decision 30): one given in one workspace never applies to the
  same site in another, the agent workspace included.
  [`test_site_permissions_are_per_workspace`](../tests/browser/browser_vimma_mcp_agent_pages.js)

## 10. Firefox updates (the upstream autopilot, `upstream.yml`; the Beta canary, `upstream-beta.yml`)

Vimma is only as safe as the Firefox release under it. The autopilot finds each new release,
rebases our patches onto it, runs the suites and opens the PR; a person reviews and merges. Spec:
[m7-upstream-autopilot](specs/m7-upstream-autopilot.md), [ADR-015](adr/015-upstream-autopilot.md),
playbook: [docs/rebase.md](rebase.md). The Beta canary tests `main` on each Firefox Beta build and
reports in an issue, so a release's breakage is known before its deadline (spec
[upstream-beta-canary](specs/upstream-beta-canary.md)).

**Reach:** Mozilla's public feeds (product-details, the MFSA index, archive.mozilla.org, the
Taskcluster index) and this repository. Nothing here runs code from a pull request.

- G1. A newer Firefox release **must** produce a tested bump PR within 6 hours of
  product-details listing it (detection every 4 h, the rebase and suites ≈ 25 min), or, when
  Actions may not open PRs, a pushed branch and a prefilled compare link on its tracking issue.
  [`detects every 4 hours, so a release has a PR within 6 hours`](../tools/test/upstream-workflow.test.mjs),
  [`finds 157.0.2 as a critical security dot release, 3 days to merge`](../tools/upstream/test/autopilot.test.mjs),
  [`falls back to a compare link when Actions may not open PRs`](../tools/test/upstream-workflow.test.mjs),
  [`the fallback comment links a prefilled compare page and keeps the summary`](../tools/upstream/test/autopilot.test.mjs)
- G2. `upstream.yml` **must** fail, and open a `security` issue that mentions the owner, once the
  Firefox on `main` is more than 3 days behind a security dot release (7 days for a major
  release, 14 for a dot release without an advisory), counted from the release date.
  [`limits: 3 days for a security dot release, 7 for a major, 14 otherwise`](../tools/upstream/test/releases.test.mjs),
  [`a security dot release is behind for 3 days, then overdue`](../tools/upstream/test/releases.test.mjs),
  [`the earliest deadline wins: a skipped security release still counts`](../tools/upstream/test/releases.test.mjs),
  [`the drift job fails the run`](../tools/test/upstream-workflow.test.mjs),
  [`the drift issue tables every unshipped release and mentions the owner`](../tools/upstream/test/autopilot.test.mjs)
- G3. A release whose advisories cannot be read **must** count as a security release (label and
  limit), never as one without.
  [`unreadable advisories make security unknown (null), never false`](../tools/upstream/test/releases.test.mjs),
  [`unknown security status (advisories unreadable) uses the security limit`](../tools/upstream/test/releases.test.mjs),
  [`an unreachable advisories page: security unknown, labelled security, a warning`](../tools/upstream/test/autopilot.test.mjs)
- G4. Nothing is **ever** reported on or built from a Firefox source tarball whose SHA-512
  differs from a signed `SHA512SUMS` (B1), a run artifact included: the patch-check report is
  uploaded only after the source check verified the tarball.
  [`nothing is built from a tarball whose SHA-512 Mozilla did not publish`](../tools/test/upstream-workflow.test.mjs),
  [`test_good_signature_but_a_different_hash_fails_naming_expected_and_actual`](../tools/upstream/test_verify_sha512.py),
  [`the source check fails on a SHA512SUMS whose signature is not good`](../tools/upstream/test/source-check.test.mjs),
  [`a report on a tarball that failed verification is never uploaded`](../tools/test/upstream-workflow.test.mjs),
  [`a tampered tarball already on disk fails like a downloaded one`](../tools/upstream/test/firefox-source.test.mjs),
  [`no workflow runs surfer download itself`](../tools/test/full-build-workflows.test.mjs)
- G5. A bump PR is **never** opened ready for review unless every patch applies and the suites
  passed on the new release; otherwise it is a draft that names the conflicting files and hunks.
  [`a ready PR only when patches apply, suites pass and a token starts CI`](../tools/upstream/test/autopilot.test.mjs),
  [`a conflicting bump is a draft that lists the conflicts`](../tools/upstream/test/autopilot.test.mjs),
  [`lists the conflicting files and hunks, fuzz included`](../tools/upstream/test/autopilot.test.mjs)
- G6. The autopilot's jobs **must** run with least privilege: nothing by default, write access
  only in the job that publishes, no secret in detection, the patch check or the suites, no
  `pull_request_target`, every action pinned by commit SHA.
  [`grants nothing by default and each job only what it needs`](../tools/test/upstream-workflow.test.mjs),
  [`no secret reaches detection, the patch check or the suites`](../tools/test/upstream-workflow.test.mjs),
  [`no workflow runs on pull_request_target`](../tools/test/upstream-workflow.test.mjs),
  [`every action it uses is pinned by a full commit SHA`](../tools/test/upstream-workflow.test.mjs)
- G7. The prefs we copy from upstream (the cfr provider, the Safe Browsing lists) **must** match
  the release under test, or the suites fail with the line to paste.
  [`our branding prefs match Firefox 157.0.1's`](../tools/upstream/test/upstream-prefs.test.mjs),
  [`a new upstream cfr field is reported with the line to paste`](../tools/upstream/test/upstream-prefs.test.mjs),
  [`a pref upstream renamed or removed is its own problem, not a silent pass`](../tools/upstream/test/upstream-prefs.test.mjs)
- G8. Every upstream file Vimma patches **must** have a line in the ADR-003 register with a hunk
  and line budget it stays within, and a person **must** review each patch at least once a
  quarter: `patch-audit.yml` opens an `upstream` `audit` issue on the first day of each quarter,
  listing reviews over 92 days old, with `issues: write` only in the job that runs no repository
  code.
  [`test_a_patch_over_its_hunk_or_line_budget_fails_the_audit`](../tools/upstream/test_patch_audit.py),
  [`test_a_register_line_without_a_budget_or_review_date_fails_the_audit`](../tools/upstream/test_patch_audit.py),
  [`test_within_budget_passes_and_reviews_over_92_days_old_are_due`](../tools/upstream/test_patch_audit.py),
  [`test_every_patch_has_a_budget_and_review_date_and_stays_within_it`](../tools/upstream/test_patch_audit.py),
  [`runs on the first day of each quarter, and by hand`](../tools/test/patch-audit-workflow.test.mjs),
  [`grants nothing by default; issues: write only in the report job`](../tools/test/patch-audit-workflow.test.mjs),
  [`the job holding the issue token never checks out or runs repository code`](../tools/test/patch-audit-workflow.test.mjs)
- G9. The Beta canary **must never** write anything but issues: nothing granted by default,
  `issues: write` only in the report job, which checks out and runs no repository code and runs
  only on `main`; no secret, no push, no commit, no pull request, no change to the Firefox pin,
  no `pull_request_target`; every job skipped in a fork. A new issue mentions the owner; an update,
  a comment or a close never does, and test output is fenced so it cannot mention or link.
  [`grants nothing by default and no job more than issues: write`](../tools/test/upstream-beta-workflow.test.mjs),
  [`the job with issues: write checks out and runs no repository code`](../tools/test/upstream-beta-workflow.test.mjs),
  [`the report job runs only on main`](../tools/test/upstream-beta-workflow.test.mjs),
  [`no job pushes, commits or opens a pull request`](../tools/test/upstream-beta-workflow.test.mjs),
  [`no secret reaches any job, and the e2e call passes none`](../tools/test/upstream-beta-workflow.test.mjs),
  [`every job is skipped outside vimma-browser/vimma`](../tools/test/upstream-beta-workflow.test.mjs),
  [`every action is pinned by a full commit SHA`](../tools/test/upstream-beta-workflow.test.mjs),
  [`mentions the owner only when it opens an issue`](../tools/upstream/test/canary.test.mjs),
  [`fences test output and cuts the body to 60,000 characters`](../tools/upstream/test/canary.test.mjs),
  [`surfer.json on main pins a Firefox release, never a beta`](../tools/test/surfer-pin.test.mjs)
- G10. The Beta canary **must never** build from or report on a Beta source tarball whose SHA-512
  differs from that Beta's signed `SHA512SUMS` (B1): the source check fails the run before the
  suites or the issue (G4 for Betas).
  [`nothing is built from a tarball whose SHA-512 Mozilla did not publish`](../tools/test/upstream-beta-workflow.test.mjs),
  [`test_good_signature_but_a_different_hash_fails_naming_expected_and_actual`](../tools/upstream/test_verify_sha512.py),
  [`a report on a tarball that failed verification is never uploaded`](../tools/test/upstream-workflow.test.mjs)

## 11. Out of scope and trust boundaries

- **Gecko itself.** Page isolation, the sandbox, TLS and the JavaScript engine are Firefox's.
  Vimma is only as safe as the Firefox release under it, so security comes from shipping each
  Firefox release, and each security dot release, quickly: §10 above and
  [docs/rebase.md](rebase.md) ("Security dot release: the fast path"). Vimma has no built-in
  updater ([`updater_is_not_built`](../tests/browser/browser_vimma_updater.js)); updates come
  with your package.
- **Malware running as you.** It can read your profile, cookies, the control token and
  config.toml, and drive any app you run. Vimma does not defend against it; file modes keep out
  other local users, not your own processes.
- **Root and physical access** are out of scope.
- **What agents do outside Vimma.** Vimma bounds what a local AI agent can do _through Vimma_
  (§12): the agent workspace only, each request asked. It cannot bound what the agent does with
  its own shell, files and network, or what its host lets it do unasked; that is the agent
  host's matter. A prompt-injected agent with a shell can also read the control token like any
  process of yours, which is why the `full` role is a separate switch to keep off.
- **What you type.** Commands you type yourself (`:open`, `:source`, the control socket with your
  token) act with your authority; the rules above stop text from others from doing the same.

## 12. Agents (MCP) (`ctl/AgentGate.sys.mjs`, `ctl/agent-commands.mjs`)

Lets local AI agents (Claude Code, Codex, opencode, Copilot) list, read, open and close tabs of
one workspace, **agent**, through the control socket's `agent` role. Spec:
[vimma-mcp](specs/vimma-mcp.md), [ADR-019](adr/019-agents-over-mcp.md).

**Reach:** any local process that can read the token file, an agent's own shell included,
while MCP is on (`:mcp on`). Every check runs in the browser, never in the client: an agent with
a shell can run `vimma-ctl` itself, or speak the protocol directly.

**Planned:** [mcp-drive](specs/mcp-drive.md) adds `vimma_show` and `vimma_keys` (the agent shows
a page, and runs Vimma's own page keys in an agent tab) and makes full control's questions say
that it reaches beyond the agent workspace while MCP is on. Its rules M16-M23 (key whitelist,
background-only, follows as loads, show always asked, limits, delimited link lists, full
control's wording, the audit) enter this section with their tests in the sub-PR that builds each.

- M1. Every agent command but `agent-hello`, `agent-ping` and `agent-cancel` **must** wait for
  your yes, or run under an unexpired grant of that connection and tool.
  [`test_grants_per_connection_and_tool`](../tests/browser/browser_vimma_mcp_agent.js),
  [`15 min for (conn 1, read): reads run unasked until 15:00; opens and conn 2 ask`](../packages/vimma-core/test/agent-gate.test.mjs)
- M2. Agent commands **must** see only tabs of the agent workspace in its container, checked
  when each command runs; **never** another workspace's tab, a foreign or pinned tab, or a
  private window's.
  [`test_agent_sees_only_the_agent_workspace`](../tests/browser/browser_vimma_mcp_agent.js),
  [`test_confinement_edges`](../tests/browser/browser_vimma_mcp_agent.js)
- M3. No answer within `[mcp] ask_timeout`, a full queue (4 per connection, 16 in all), more
  than 4 requests of one connection waiting or running at once (grants included), more than 10
  opens of one connection in a minute (grants included) and a muted connection (three noes in a
  row, for 60 s; `x`, until it reconnects) **must** deny.
  [`test_denials_timeouts_queue_and_mute`](../tests/browser/browser_vimma_mcp_agent.js),
  [`two connections sending 5 each: 4 of each wait in order, the 5th of each is busy`](../packages/vimma-core/test/agent-gate.test.mjs),
  [`three denials in a row mute a connection for 60 s, without asking`](../packages/vimma-core/test/agent-gate.test.mjs),
  [`no sequence of events breaks the queue's limits or resolves a request twice`](../packages/vimma-core/test/fuzz/agent.fuzz.test.mjs),
  [`test_grants_cannot_flood`](../tests/browser/browser_vimma_mcp_agent.js),
  [`at most OPEN_RATE.max opens per connection in any OPEN_RATE.ms window`](../packages/vimma-core/test/agent-gate.test.mjs)
- M4. The question **never** opens by itself while you type, are in a field, or have another
  prompt open, never takes focus, is armed only after `security.dialog_enable_delay` (1 s), a
  held key **never** counts, and no key but `y` or a count with `a` allows; any other key
  neither allows nor denies. It **must** arm again whenever its window is activated or
  deactivated, focused or blurred, hidden or shown, and when a key arrives before it is armed,
  so a window brought to the front (by the user, or by a process that can focus windows) never
  takes a key meant for another; a just-focused window counts as one being typed in. With a
  prompt, picker, panel or the command line open over it, and for the rest of a key sequence,
  the keys are theirs. Text an agent or a page chooses (the client name, which is the agent's own
  claim and proves nothing, and titles) is drawn as a bidi isolate (`<bdi>`), URLs as
  left-to-right isolates. A window not in front gets the urgency hint and a notification with no
  URL, no title and no buttons.
  [`test_the_line_opens_arms_and_ignores_stray_keys`](../tests/browser/browser_vimma_mcp_prompt.js),
  [`test_focus_changes_and_early_keys_rearm_the_line`](../tests/browser/browser_vimma_mcp_prompt_guards.js),
  [`test_other_ui_opened_over_the_line_gets_the_keys`](../tests/browser/browser_vimma_mcp_prompt_guards.js),
  [`test_names_titles_and_urls_are_bidi_isolates`](../tests/browser/browser_vimma_mcp_prompt_guards.js),
  [`test_typing_in_a_field_waits_for_ctrl_b_shift_a`](../tests/browser/browser_vimma_mcp_prompt.js),
  [`test_a_window_not_in_front_gets_attention_and_a_notification`](../tests/browser/browser_vimma_mcp_control.js),
  [`any other key neither allows nor denies`](../packages/vimma-core/test/agent-prompt.test.mjs),
  [`a hostile title of 300 characters is literal text cut at 60 columns`](../packages/vimma-core/test/agent-prompt.test.mjs)
- M5. Grants **must** be per connection and tool, capped at `[mcp] grant_max_minutes`, held in
  memory only, and end on `:mcp revoke`, when their connection closes, on `:mcp off` and at
  expiry.
  [`grants end on revoke and on disconnect, and are listed shortest first`](../packages/vimma-core/test/agent-gate.test.mjs),
  [`the length: a count, or the default for a bare a, capped at grant_max_minutes`](../packages/vimma-core/test/agent-gate.test.mjs),
  [`test_grants_per_connection_and_tool`](../tests/browser/browser_vimma_mcp_agent.js),
  [`test_agent_role_has_its_own_switch`](../tests/browser/browser_vimma_mcp_agent.js)
- M6. `agent-open` **must** load only http and https, in the agent container, never routed and
  never in the foreground: your window keeps its workspace, selected tab and focus.
  [`test_agent_open_is_background_and_checked`](../tests/browser/browser_vimma_mcp_agent.js),
  [`agent-open: only http and https, at most 65536 characters, an optional tab`](../packages/vimma-core/test/control-v2.test.mjs)
- M7. Page text and the page's selection **must** be capped (`[mcp] max_read_chars`, and the
  1 MiB line), well-formed Unicode, and returned inside the untrusted-content delimiters, which
  the page cannot close early, not even with a look-alike tag (other spacing or separators,
  full-width letters, attributes; matched after NFKC).
  [`test_agent_read_returns_marked_text_of_a_hidden_tab`](../tests/browser/browser_vimma_mcp_agent.js),
  [`any page text comes out with exactly one opening and one closing delimiter`](../packages/vimma-core/test/fuzz/agent.fuzz.test.mjs),
  [`test_the_selection_is_marked_and_fits_the_line`](../tests/browser/browser_vimma_mcp_agent.js),
  [`test_replies_are_well_formed_unicode`](../tests/browser/browser_vimma_mcp_agent.js)
- M8. A yes **must** stand only for the tab and URL asked about: if the tab left the agent
  workspace or navigated since, the request is denied (`changed`) and nothing is read, loaded
  or closed; a read checks again after collecting everything, just before it replies.
  [`test_the_yes_stands_for_what_was_asked`](../tests/browser/browser_vimma_mcp_agent.js),
  [`test_the_read_checks_last`](../tests/browser/browser_vimma_mcp_agent.js),
  [`test_confinement_edges`](../tests/browser/browser_vimma_mcp_agent.js)
- M10. Pages in the agent container **must** get no permission prompt and no permission given
  elsewhere: site permissions are kept per container (`permissions.isolateBy.userContext`,
  [vimma-mcp](specs/vimma-mcp.md) decision 30), every `nsIContentPermissionPrompt` request from
  the agent container is cancelled, and camera, microphone and screen are denied per agent tab (a
  browser-scoped DENY, set on each HTTP response and when each document's window global is
  created, so a page a service worker serves is covered). They **must** open no new window or
  tab (`SANDBOXED_AUXILIARY_NAVIGATION` on every agent tab, which is reloaded if it had loaded
  without it) and launch no other app through an external protocol (Firefox's chooser is
  wrapped for the agent container). Their downloads follow M11-M13. A tab of another workspace
  still asks, opens pop-ups and downloads as before.
  [`test_the_agent_container_asks_for_nothing`](../tests/browser/browser_vimma_mcp_agent_pages.js),
  [`test_another_workspace_still_asks`](../tests/browser/browser_vimma_mcp_agent_pages.js),
  [`test_agent_tabs_open_no_popups`](../tests/browser/browser_vimma_mcp_agent_pages.js),
  [`test_site_permissions_are_per_workspace`](../tests/browser/browser_vimma_mcp_agent_pages.js),
  [`test_a_page_from_a_service_worker_is_denied_too`](../tests/browser/browser_vimma_mcp_agent_pages.js),
  [`test_a_sweep_reloads_agent_tabs_that_loaded_unsandboxed`](../tests/browser/browser_vimma_mcp_agent_pages.js),
  [`test_agent_pages_launch_no_app`](../tests/browser/browser_vimma_mcp_agent_pages.js)
- M11. A download from the agent workspace (by its container, its tab's container, or being written
  to the quarantine folder) **must** ask in the question line first (its name, size, type and host,
  **never** the URL). It is the `vimma_download` of an agent connection only when it is the very
  load that connection's `agent-open` started (its URL before redirects, within a minute, once, and
  never after the tab showed a page); anything else, a page's own download under a grant included,
  asks as "a page in the agent workspace" (no grant, `x` a plain no). Only `https:` is downloaded,
  nothing over `[mcp] download_max_mb` (refused when the size is known, stopped and deleted once it
  grows past it), and a refused download leaves no file. The user's own Save Page, Save Link As and
  Save Image As are the user's (an agent cannot press them) and ask nothing. Another workspace's
  downloads are untouched.
  [`test_the_question_then_yes_saves_to_the_quarantine_0600_unopened`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`test_no_saves_nothing`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`test_http_is_refused`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`test_the_size_cap`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`test_an_agents_download_is_its_and_a_grant_covers_it`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`test_a_grant_never_covers_the_pages_own_downloads`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`test_classified_by_tab_and_by_place_too`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`test_the_dialog_the_launch_path_a_frame_and_a_blob`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`test_the_users_save_page_in_an_agent_tab_is_the_users`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`test_another_workspace_downloads_as_before`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`name, size, type and extension, and the host in bold; no URL`](../packages/vimma-core/test/agent-prompt.test.mjs)
- M12. An agent download **must** be written only to the quarantine folder (`[mcp] download_dir`,
  never home, `/`, the Downloads folder itself, a hidden folder of home, `/tmp`, `/var/tmp` or
  `/dev/shm`; made if missing and chmod 0700, which fails on a folder that is not the user's:
  then, or with any other problem, every agent download is refused with a notice, and the tab's
  bytes go to the profile's own refusal folder), as its `.part` and under its name
  (the agent tab's `downloadFolderOverride`, and Firefox's download dialog wrapped so it never
  offers "open with"), saved with mode 0600 (no exec bit), and **never** opened by Vimma, then or
  later from the downloads list.
  [`test_agent_tabs_may_download_again`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`test_the_question_then_yes_saves_to_the_quarantine_0600_unopened`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`download_dir is ~ or absolute, never home, / or the Downloads folder itself`](../packages/vimma-core/test/config-v2.test.mjs),
  [`download_dir is never in a hidden folder of home or in /tmp, /var/tmp, /dev/shm`](../packages/vimma-core/test/config-v2.test.mjs),
  [`test_a_folder_that_is_not_private_is_refused`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`[mcp] download_dir and download_max_mb are refused or a quarantine folder in bounds`](../packages/vimma-core/test/fuzz/config.fuzz.test.mjs)
- M13. A dangerous file (an executable or library by name, type or first bytes; a script, a `#!`
  line, an installer or package; Firefox's executable list; an archive Vimma cannot list; a zip
  whose central directory names one of these, or holds an entry with an exec bit, a symbolic
  link or a path that leaves its folder) **must** be allowed only by `!` for that one file: no
  grant covers it and `y` does nothing. Found only in the finished `.part`, and of another kind
  than the one a `!` allowed, it asks again before the file gets its name, and a no deletes it.
  With the system's `clamscan` (C2) the `.part` is scanned before it gets its name
  (`--alert-encrypted=yes --alert-exceeds-max=yes`), and deleted when ClamAV flags it; when
  ClamAV fails, takes over five minutes, or could not look inside (encrypted, over its limits),
  keeping the file unscanned is asked (y/N, no grant), and a no deletes it. The notice says
  scanned, not fully scanned or not scanned. Vimma has no download reputation service of its
  own: Firefox's Safe Browsing checks downloads only in a build with a Google key (P6), so in a
  keyless build these checks and ClamAV are all there is.
  [`test_a_dangerous_file_needs_bang_for_that_one_file`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`test_dangerous_content_asks_again_and_no_deletes_it`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`test_a_different_danger_in_the_bytes_asks_again`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`an entry with an exec bit is an executable, whatever its name`](../packages/vimma-core/test/agent-downloads.test.mjs),
  [`a symbolic link is dangerous`](../packages/vimma-core/test/agent-downloads.test.mjs),
  [`encrypted or over ClamAV's limits: not fully scanned, not infected`](../packages/vimma-core/test/agent-downloads.test.mjs),
  [`the arguments: fixed, alerting on what it cannot open, the path after --`](../packages/vimma-core/test/agent-downloads.test.mjs),
  [`test_clamav_clean_infected_error_and_missing`](../tests/browser/browser_vimma_mcp_downloads.js),
  [`a grant of the tool does not run it: it waits`](../packages/vimma-core/test/agent-gate.test.mjs),
  [`! allows a dangerous one; y, a and counts do nothing there`](../packages/vimma-core/test/agent-prompt.test.mjs),
  [`a dangerous name inside makes the zip dangerous, and says which`](../packages/vimma-core/test/agent-downloads.test.mjs),
  [`any bytes: the zip lister and the magic check never throw, and stay inside the file`](../packages/vimma-core/test/fuzz/agent-downloads.fuzz.test.mjs)
- M9. `vimma-ctl mcp`'s JSON-RPC parsing **never** panics, and its standard output carries
  **only** whole JSON-RPC messages, one per line (logs go to standard error); a line over 1 MiB
  is answered with an error and never kept.
  [`any_line_gets_one_message_or_none`](../tools/vimma-ctl/tests/mcp_props.rs),
  [`any_outcome_is_one_tool_result`](../tools/vimma-ctl/tests/mcp_props.rs),
  [`stdout_carries_only_json_rpc_messages`](../tools/vimma-ctl/tests/mcp.rs),
  [`decoders_never_panic_and_accept_only_the_schema`](../tools/vimma-ctl/tests/protocol_props.rs)
- M14. `agent-cancel` (MCP's `notifications/cancelled`) **must** withdraw only a question its own
  connection is still waiting on, and **never** asks or counts towards the connection's limit
  of 4 requests at once. [`test_agent_cancel_withdraws_one_waiting_question`](../tests/browser/browser_vimma_mcp_agent.js),
  [`a_cancelled_call_withdraws_its_question_and_gets_no_response`](../tools/vimma-ctl/tests/mcp.rs)
- M15. `vimma-ctl mcp` **must** connect only with the `agent` role, take the token only from the
  discovery file, and refuse a tool's bad arguments (a non-http(s) URL, a URL over 65,536
  characters, a tab that is not 1 to 20 digits, an unknown argument) before anything reaches
  Vimma. This is defence in depth: the browser checks all of it again (M2, M6, S7), since an
  agent with a shell can run its own client.
  [`a_read_reaches_vimma_as_the_agent_role`](../tools/vimma-ctl/tests/mcp.rs),
  [`the_token_never_leaves_the_handshake`](../tools/vimma-ctl/tests/mcp.rs),
  [`bad_arguments_never_reach_vimma`](../tools/vimma-ctl/tests/mcp.rs),
  [`bad_arguments_are_tool_errors_and_never_reach_vimma`](../tools/vimma-ctl/src/mcp.rs)

## 13. Page modes (`actors/VimmaParent.sys.mjs`, `host/VimmaHost.sys.mjs`)

Whether a key is Vimma's or the page's depends on the tab's mode, which the content actor's focus
reports move. Specs: [m1-actor-insert-scroll](specs/m1-actor-insert-scroll.md),
[insert-focus](specs/insert-focus.md).

**Reach:** pages, through focus changes in their own frames.

- K1. Only the frame that has focus **may** report focus for a tab, and a report that is not a
  well-formed descriptor **must** be dropped; a report changes only its own tab's mode.
  [`only_the_focused_frame_may_report`](../tests/browser/browser_vimma_insert_scroll.js),
  [`malformed_descriptors_are_dropped`](../tests/browser/browser_vimma_insert_scroll.js)
- K2. After `i` or `gi`, a page **must not** turn the user's keys into Vimma commands by moving
  focus: only `Esc` or another top document ends that insert (a page restored from the
  back-forward cache is the same document).
  [`after_i_the_page_moving_focus_off_the_field_keeps_insert`](../tests/browser/browser_vimma_insert_focus.js),
  [`after_i_the_page_blurring_the_field_keeps_insert`](../tests/browser/browser_vimma_insert_focus.js),
  [`after_gi_the_page_moving_focus_off_the_field_keeps_insert`](../tests/browser/browser_vimma_insert_focus.js),
  [`explicit_insert_ends_with_the_page`](../tests/browser/browser_vimma_insert_focus.js)
- K3. `i` **must** focus only a field of its own tab: the field the user last used, asked of the
  frame and document that reported it (still in the tab, not discarded, same inner window), which
  focuses only a connected, visible, editable element of that document; otherwise the top frame's
  first field.
  [`i_focuses_the_field_last_used_in_a_cross_origin_frame`](../tests/browser/browser_vimma_insert_focus.js),
  [`i_falls_back_to_the_first_field_when_the_last_frame_navigated`](../tests/browser/browser_vimma_insert_focus.js),
  [`i_falls_back_to_the_first_field_when_the_last_is_gone`](../tests/browser/browser_vimma_insert_focus.js)

## 14. Build and release supply chain (`release.yml`, `nightly.yml`)

Vimma's binaries are built from Mozilla's Firefox source, this repository, and the npm packages
that drive the build, chiefly Surfer. These rules keep what reaches a build pinned and reviewed.
Spec: [build-supply-chain](specs/build-supply-chain.md), [ADR-001](adr/001-engine-firefox-surfer.md).

**Reach:** Mozilla's archive and Taskcluster, the npm registry, this repository, and GitHub's
hosted runners. Dependabot pull requests run and auto-merge today, whether or not a build runs.

**Planned:** the spec's later deliveries add the rest of B3 (every package in the
release path held for review, with its published diff,
[#223](https://github.com/vimma-browser/vimma/issues/223)), and B6 and B7 (the Safe Browsing key
in a `build` environment, and a watch on Mozilla's release key,
[#225](https://github.com/vimma-browser/vimma/issues/225)).

- B1. Nothing is **ever** built from, or reported on, a Firefox source tarball unless its SHA-512
  is listed in a `SHA512SUMS` carrying exactly one good signature by a valid signing subkey of
  Mozilla's release key `14F26682D0916CDD81E37B6D61B7B526D98F0353`, pinned in
  `tools/upstream/mozilla-release-key.asc` ([ADR-021](adr/021-mozilla-release-key.md)); a
  revoked or expired subkey, another key, a second signature, a signed message in place of a
  detached signature, or a missing signature fails. The verdict comes from `gpgv`'s status lines,
  never its exit status, which is 0 for the revoked, compromised subkey. Every verification goes
  through `tools/upstream/verify-sha512.py`, called by `firefox-source.sh` (every build, PR CI
  included) and `source-check.sh` (the autopilot and the Beta canary); a tarball already on disk
  is verified like a downloaded one. On a contributor's machine, `npx surfer download` checks
  nothing, so `npm run import`, the first step of every local build and lane, refuses an
  `engine/` until `npm run verify-source` has verified the tarball it came from for
  `surfer.json`'s version (a record in `engine/.git`, which `firefox-source.sh` writes too). That
  record guards against building an unverified download, not against someone who can already
  write to `engine/`.
  `firefox-source.sh` also refuses a `surfer.json` with a `version.candidate`, which Surfer would
  fetch from `candidates/` unverified.
  [`test_good_signature_from_mozillas_current_subkey_passes`](../tools/upstream/test_verify_sha512.py),
  [`test_signature_by_the_revoked_compromised_subkey_fails`](../tools/upstream/test_verify_sha512.py),
  [`test_signature_by_another_key_fails`](../tools/upstream/test_verify_sha512.py),
  [`test_a_second_signature_beside_mozillas_fails`](../tools/upstream/test_verify_sha512.py),
  [`test_signature_by_an_expired_subkey_fails`](../tools/upstream/test_verify_sha512.py),
  [`test_one_changed_byte_in_sha512sums_fails_the_signature`](../tools/upstream/test_verify_sha512.py),
  [`test_missing_signature_or_gpgv_cannot_check_and_exits_two`](../tools/upstream/test_verify_sha512.py),
  [`test_pinned_key_is_mozillas_primary_with_the_compromised_subkey_revoked`](../tools/upstream/test_verify_sha512.py),
  [`a SHA512SUMS without a good signature fails before engine/ is touched`](../tools/upstream/test/firefox-source.test.mjs),
  [`the source check fails on a SHA512SUMS whose signature is not good`](../tools/upstream/test/source-check.test.mjs),
  [`test_a_signed_message_in_place_of_a_detached_signature_fails`](../tools/upstream/test_verify_sha512.py),
  [`fails a tampered tarball`](../tools/upstream/test/verify-source.test.mjs),
  [`--require refuses an engine/ never verified, or verified for another version`](../tools/upstream/test/verify-source.test.mjs),
  [`npm run import refuses an engine/ whose source was never verified`](../tools/test/upstream-workflow.test.mjs),
  [`every verify-sha512.py call passes a signature`](../tools/test/upstream-workflow.test.mjs),
  [`refuses a surfer.json with a version.candidate, before anything is fetched`](../tools/upstream/test/firefox-source.test.mjs)
- B2. A nightly or release build **never** builds from an `engine/` it did not extract in the
  same job from the tarball it verified, and **never** restores a tree, an objdir or a compiler
  cache from the Actions cache; a release **must** build in a fresh objdir with an empty
  compiler cache.
  [`a tarball already on disk is verified again and engine/ is extracted from it afresh`](../tools/upstream/test/firefox-source.test.mjs),
  [`no workflow reads or writes engine/.vimma-firefox-version`](../tools/test/full-build-workflows.test.mjs),
  [`the build jobs check out clean and restore nothing from the Actions cache`](../tools/test/full-build-workflows.test.mjs),
  [`a release builds in a fresh objdir with an empty compiler cache`](../tools/test/full-build-workflows.test.mjs)
- B3. Surfer **must** be pinned to one exact version, locked by its integrity hash, and a
  Dependabot update of Surfer **never** merges without a person, security updates and grouped
  updates included, whatever the format of Dependabot's metadata; an update whose dependency
  names are missing waits for a person too. **⚠ gap:** `ajv` itself still auto-merges its
  patch, minor and security updates, and so do the packages Surfer and `ajv` depend on, until
  [#223](https://github.com/vimma-browser/vimma/issues/223) holds the whole release path.
  [`package.json pins Surfer to an exact version, locked by integrity`](../tools/test/build-supply-chain.test.mjs),
  [`a Surfer update is never auto-merged, security updates included`](../tools/test/build-supply-chain.test.mjs),
  [`Surfer is held whatever the separator, quoting or case, or when only the title names it`](../tools/test/build-supply-chain.test.mjs),
  [`an update whose dependency list is empty waits for a person`](../tools/test/build-supply-chain.test.mjs),
  [`the release-path group comes before the minor and patch group`](../tools/test/build-supply-chain.test.mjs)
- B4. An npm install **never** runs install scripts, and the build **must** run Surfer only from
  `node_modules`, never a package `npx` fetches, and **never** lets Surfer fetch an add-on.
  [`.npmrc turns install scripts off for every install`](../tools/test/build-supply-chain.test.mjs),
  [`release and nightly install with npm ci --ignore-scripts and run Surfer with npx --no`](../tools/test/build-supply-chain.test.mjs),
  [`no workflow lets npx fetch a package`](../tools/test/build-supply-chain.test.mjs),
  [`surfer.json lists no add-ons`](../tools/test/build-supply-chain.test.mjs)
- B5. A workflow **never** targets a self-hosted runner: every job runs on a standard
  GitHub-hosted image or calls a workflow file of this repository, and a `runs-on` expression
  that cannot be resolved to a hosted image fails. The test parses each workflow as YAML and
  fails on any shape it does not recognise. A job of a workflow that a pull request, a comment,
  an issue or another workflow run can trigger is held to this as the permanent guard; the build
  jobs run only from `main` or for a release, and only once `NIGHTLY_ENABLED` or
  `RELEASE_ENABLED` is set. **⚠ setting:** fork pull request approval is
  `all_external_contributors`
  (`gh api repos/vimma-browser/vimma/actions/permissions/fork-pr-contributor-approval`), so a
  fork's own workflow files run only once a person approves the run; and the organization has
  no self-hosted runner (`gh api orgs/vimma-browser/actions/runners`, organization owners only),
  since an organization runner shared with this repository is invisible to every
  repository-level check.
  [`no workflow an outsider can trigger runs a job on a self-hosted runner`](../tools/test/self-hosted-runner.test.mjs),
  [`a runs-on expression in such a workflow fails unless it resolves to a hosted image`](../tools/test/self-hosted-runner.test.mjs),
  [`a quoted job id is a job of its own`](../tools/test/self-hosted-runner.test.mjs),
  [`a job written as a flow mapping is checked`](../tools/test/self-hosted-runner.test.mjs),
  [`a matrix key is read only from the job's own strategy.matrix`](../tools/test/self-hosted-runner.test.mjs),
  [`triggers are read in every spelling YAML allows`](../tools/test/self-hosted-runner.test.mjs),
  [`no workflow names a self-hosted runner, and both build jobs run on ubuntu-24.04`](../tools/test/self-hosted-runner.test.mjs),
  [`each build job runs only from main or for a release`](../tools/test/self-hosted-runner.test.mjs)
- B8. The nightly's `build` job, which runs npm, Surfer, `mach` and the mochitests, **never**
  holds a token that can write: it has `contents: read` and keeps its package as a workflow
  artifact for 7 days. Only the `publish` job may write contents, and it publishes the rolling
  `nightly` pre-release **only** when the repository variable `PUBLISH_NIGHTLY_RELEASE` is
  `true` (unset until the release gate); the failure issue comes from a `report` job with
  `issues: write`. Neither of those checks out or runs repository code or reads a secret, and
  the issue quotes only the log the build job redacted before uploading it. **⚠ limit:** the
  repository is public, so anyone signed in to GitHub can download the artifact from the run;
  it is unpublished, not secret.
  [`the workflow and its build job can only read the repository`](../tools/test/nightly-workflow.test.mjs),
  [`the build job keeps the package as a workflow artifact for 7 days`](../tools/test/nightly-workflow.test.mjs),
  [`publishing the rolling release is a separate job, off unless PUBLISH_NIGHTLY_RELEASE`](../tools/test/nightly-workflow.test.mjs),
  [`only the publish job may write contents, and only it releases`](../tools/test/nightly-workflow.test.mjs),
  [`a failure is reported by its own job, from the redacted log artifact`](../tools/test/nightly-workflow.test.mjs),
  [`only the nightly's publish and failure-issue steps get GH_TOKEN`](../tools/test/full-build-workflows.test.mjs)
