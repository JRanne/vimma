# Security model

What each risky part of Vimma may do, what it must never do, who can reach it, and the test that
holds it to that. It is a page of rules, not code: review it like a contract. Reporting a
vulnerability: [SECURITY.md](../SECURITY.md).

**How to read it.** Each rule is one "must" or "never" sentence, followed by the tests that
enforce it, as `test name` links into the test file. CI fails if a link stops resolving
(`tools/security/check-doc-links.mjs`), so a renamed or deleted test cannot leave a rule
unguarded. **⚠ gap** marks a rule the code does not meet yet, with its issue.

**Who can reach what.** _You_ means the local user Vimma runs as. _Other local users_ are other
accounts on the same machine. _Pages_ are web content, which runs in sandboxed content
processes. _Extensions_ are installed WebExtensions. _Local apps_ are other programs running as
you.

## 1. Control socket (`ctl/VimmaControl.sys.mjs`)

Lets `vimma-ctl` and scripts drive Vimma: send keys, read state, open a URL, reload the theme.
Specs: [m0-control-server](specs/m0-control-server.md),
[m0-control-protocol-and-vimma-ctl](specs/m0-control-protocol-and-vimma-ctl.md),
[ADR-007](adr/007-control-socket.md).

**Reach:** any local process can connect to the port; only one that can read the token file
(you, or root) gets past the handshake. Pages and extensions cannot speak the protocol (an HTTP
request is refused). Whoever holds the token is treated as you: `send-keys` can do anything your
keyboard can.

- S1. The socket **must** be off by default and start or stop only with the pref
  `vimma.control.enabled`.
  [`test_pref_starts_and_stops_the_server`](../tests/browser/browser_vimma_control.js)
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
- S5. It **must** cap connections (8 open, 2 waiting for a hello), line length (1 MiB) and
  handshake and idle time. [`test_limits`](../tests/browser/browser_vimma_control.js)
- S6. A token file left by a crash **must** be removed at start; a symlink or directory in its
  place is never followed. [`test_stale_discovery_file_removed_at_start`](../tests/browser/browser_vimma_control.js)
- S7. Only the four commands in the protocol **must** run; anything else, and any unknown
  argument, is refused.
  [`test_handshake`](../tests/browser/browser_vimma_control.js),
  [`protocol version 1 with the commands of ADR-007`](../packages/vimma-core/test/control.test.mjs)
- S8. `reload-theme` **never** takes an argument; it reads only the theme folder Vimma's own
  prefs name. [`test_reload_theme`](../tests/browser/browser_vimma_control.js),
  [`takes no args`](../packages/vimma-core/test/control.test.mjs)
- S9. `state` **must** be read-only: it changes no tab, selection, mode or workspace.
  [`control_state_is_read_only`](../tests/browser/browser_vimma_security_invariants.js)
- S10. `open` **must** load only http, https, file and about URLs of at most 64 KiB, checked by
  the server itself, never only by the client.
  [`test_server_checks_the_scheme_itself`](../tests/browser/browser_vimma_control.js),
  [`test_open`](../tests/browser/browser_vimma_control.js)

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
  ([#98](https://github.com/JRanne/vimma/issues/98)). No length cap applies to text typed there.
  [`javascript_urls_are_blocked_with_a_notice`](../tests/browser/browser_vimma_cmdline.js),
  [`data_urls_are_blocked_with_a_notice`](../tests/browser/browser_vimma_cmdline.js)
- U5. Every Vimma open of text with the system principal (`p`, `P`, `:open`, `:tabnew`) **must**
  refuse those schemes through one shared check (`refusedScheme`, `core/pageurl.mjs`); bookmarks
  and the socket's `open` go further and allow only http, https, file and about.
  [`refuses %j as %s`](../packages/vimma-core/test/pageurl.test.mjs),
  [`lets %j through`](../packages/vimma-core/test/pageurl.test.mjs)
- U6. Hint replies from a page **must** be capped (5,000 targets, 64 frames, 8 KiB links) and
  copied field by field before chrome uses them.
  [`the caps are 5,000 targets, 64 frames and 8 KiB hrefs`](../packages/vimma-core/test/hints.test.mjs),
  [`a well-formed reply → a fresh copy with only the known fields`](../packages/vimma-core/test/hints.test.mjs)

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
  process. [`never builds code from text: no eval, Function or sandbox evaluation`](../tools/security/test/chrome-source.test.mjs),
  [`never starts a process`](../tools/security/test/chrome-source.test.mjs)

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

## 10. Out of scope and trust boundaries

- **Gecko itself.** Page isolation, the sandbox, TLS and the JavaScript engine are Firefox's.
  Vimma is only as safe as the Firefox release under it, so security comes from shipping each
  Firefox release, and each security dot release, quickly:
  [docs/rebase.md](rebase.md) ("Security dot release: the fast path"). Vimma has no built-in
  updater ([`updater_is_not_built`](../tests/browser/browser_vimma_updater.js)); updates come
  with your package.
- **Malware running as you.** It can read your profile, cookies, the control token and
  config.toml, and drive any app you run. Vimma does not defend against it; file modes keep out
  other local users, not your own processes.
- **Root and physical access** are out of scope.
- **What you type.** Commands you type yourself (`:open`, `:source`, the control socket with your
  token) act with your authority; the rules above stop text from others from doing the same.
