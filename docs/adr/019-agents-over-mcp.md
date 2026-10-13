# ADR-019: Agents reach Vimma over MCP, through a confined control-socket role

- Status: Accepted
- Date: 2026-10-13

## Context

The user wants local AI tools (Claude Code, Codex, opencode, Copilot) to use Vimma, with two
conditions: "it should always confirm from user when agents wants to use it's mcp", and "All the
agents usage should be go through agent workspace". These tools speak MCP, the Model Context
Protocol, to servers they start themselves, usually over stdio.

Vimma already has a control socket (ADR-007) and a client for it, `vimma-ctl` (ADR-011). Its
protocol 1 treats whoever holds the token as the user: `send-keys` presses keys wherever focus is,
`state` lists the focused window's tabs and URLs, and `open` loads into the active workspace. None
of it can be confined to one workspace, and an agent with a shell can read the token like any
process of the user's.

## Decision

1. **`vimma-ctl mcp`**, a subcommand of the existing binary, is the MCP server over stdio. It
   holds one control-socket connection for its lifetime. It is hand-written over vimma-ctl's own
   JSON code, so ADR-011's no-dependency rule holds.
2. **Control protocol 2 adds roles.** The hello names its role: `full` (protocol 1's commands;
   protocol 1 is always `full`) or `agent` (only the agent commands: `agent-hello`,
   `agent-tabs`, `agent-read`, `agent-open`, `agent-close`, `agent-ping`). A connection's role
   is fixed by its hello, and the server checks every command against it. Each role has its own
   switch: `vimma.control.enabled` serves `full`, and `:mcp on` (the pref `vimma.mcp.enabled`,
   or `[mcp] enabled`) serves `agent`. A hello for a role that is off gets `role-off`. The discovery file
   lists the roles served.
3. **Confinement and confirmation are enforced in the browser**, never trusted to the client.
   Agent commands see only tabs of the agent workspace in its container, checked when each
   command runs. Every one but hello and ping waits for the user's answer in Vimma, or runs
   under a grant the user gave that connection for that tool, for minutes the user chose. A
   timeout, a full queue and a muted connection deny. The yes stands for the tab and URL asked
   about. Page text comes back between untrusted-content delimiters the page cannot close.

## Rejected

- **MCP inside the browser** (an HTTP or SSE listener in chrome): a second network surface,
  larger than the existing socket, and the tools start stdio servers anyway.
- **MCP elicitation for the confirmation**: the question would show in the agent's UI, which the
  agent's host controls and can set to approve on its own.
- **`send-keys` for agents**: keys go where focus is, so they cannot be confined to a workspace.
  Clicks, form filling and screenshots need their own threat review and are a later spec.
- **Agent access to every workspace**, or "share this tab without reopening it": either hands the
  agent the user's logged-in sessions. A tab is shared by moving it to the agent workspace, where
  it is reopened with the agent's cookies.
- **A check in `vimma-ctl` only**: an agent with a shell can run its own client.

## Consequences

- Protocol 1 clients keep working: a v1 hello is the `full` role, and only `vimma.control.enabled`
  serves it. `vimma-ctl` speaks protocol 2 as `full` to a Vimma whose discovery file says 2.
- With only MCP on, the token reaches only the confined, confirmed role. The guide tells MCP
  users to keep `vimma.control.enabled` off: a `full` token lets any process of theirs press keys
  in their window without asking.
- Rules M1-M9 in [docs/security.md](../security.md) §12 hold this to its tests. Spec:
  [vimma-mcp](../specs/vimma-mcp.md).
