# ADR-017: Vimma talks to the window manager (Hyprland only, over its socket)

- Status: Proposed
- Date: 2026-10-12

## Context

The private workspace is Firefox's private window (private-workspace.md), and on Hyprland it
showed up as a second tile. It should replace the Vimma window in place instead
([private-swap](../specs/private-swap.md)), so that entering and leaving the private workspace
feels like switching workspaces. A Wayland client cannot place its own windows, so only the
compositor can do that. Until now Vimma ran no window-manager commands (private-workspace.md,
decided question 1); "swap in place" reverses that. With a Lua config, Hyprland 0.56's `dispatch` runs
its argument as Lua in the compositor, and `hl.exec_cmd` starts any shell command. So
whatever Vimma sends is code.

## Decision

Vimma may send commands to the window manager, under these rules:

- **Hyprland only**, found from `HYPRLAND_INSTANCE_SIGNATURE` (validated) and
  `XDG_RUNTIME_DIR`. The only socket is that instance's `.socket.sock` / `.socket2.sock`, the
  user's own (`drwx------`). There is no configurable path and no other compositor.
- **Over the Unix socket from the parent process**
  (`nsISocketTransportService.createUnixDomainTransport`).
  There is no `hyprctl` exec and no `Subprocess`. Content processes, actors and pages have no
  path to it.
- **A fixed command set built in core** (`hyprswap.mjs`): move, focus, swap, fullscreen state,
  float/tile, exact size and position, a no-op probe, and the `j/clients` query, in the Lua
  and legacy dialects. Arguments are validated window addresses, integer workspace ids or a
  name from a strict character set, integers and the constant `special:vimma`. The encoder
  takes no free text: no titles, URLs, config strings or user input. Anything else refuses
  the command.
- **Read only what is needed** from the event stream (window open, close, move and title
  events). Titles are compared with Vimma's own nonce and then dropped, never logged or stored.
- **Opt-out and fallback:** `[private] placement = "window"` turns it off. No Hyprland, or any
  failure, falls back to today's behaviour with at most one console line.
- **Nothing on disk:** no state about windows, addresses or what is parked.

## Reasoning

Only the compositor can put a window in another's tile. A socket client is a few hundred lines
of chrome JS on machinery Firefox already ships and tests (`test_unix_domain.js`), and a test
can fake it with `nsIServerSocket.initWithFilename`. Exec would cost a process per switch, a
`PATH` lookup and an argv to get right. A closed command set keeps the Lua dialect's code
execution out of reach of anything a page or a config file can say.

## Alternatives rejected

- **Spawn `hyprctl`** (Subprocess.sys.mjs): slower, can be shadowed through `PATH`, and adds
  an exec path to the browser for no gain.
- **`hyprctl eval` / arbitrary Lua:** far more power than needed. The fixed dispatchers are
  enough.
- **Window rules in the user's Hyprland config** (Vimma writing `~/.config/hypr`): changes the
  user's files and cannot express "this window's slot".
- **Keep the `SUPER+G` group recipe only:** it needs setup in the user's config, and the goal is
  for the window itself to change with no setup.
- **A generic WM abstraction** (Sway IPC, KWin scripts): no user asks for it. It can be a later
  ADR with its own threat model.

## Consequences

Vimma depends on Hyprland's IPC format and dispatcher names, which changed with the Lua config.
The dialect probe and both encodings carry that, and a Hyprland release that renames a
dispatcher degrades to `"window"` placement, not to an error. The upstream autopilot does not
cover Hyprland, so the guide names the tested Hyprland version. A future feature that wants
another command adds it to the fixed set, with tests, under this ADR.
