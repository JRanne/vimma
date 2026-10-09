# ADR-007: Control socket

- Status: Accepted
- Date: 2026-10-09

## Context

Users want Herdr-style scripting, and e2e tests must not depend on window-manager key injection.

## Decision

A local TCP server (`nsIServerSocket`, localhost, random port, token in a file under the profile) speaking JSON lines. Commands: `send-keys`, `state`, `list-tabs`, `screenshot`, `reload-config`, `open <url>`. The protocol carries an integer version.

## Reasoning

One mechanism serves both the user scripting API (`vimma-ctl`) and the e2e harness.

## Alternatives rejected

- **Unix domain socket**: not portable to Windows via `nsIServerSocket` uniformly.
- **Marionette/WebDriver**: heavier, not a user-facing API.

## Consequences

Security surface: token location and default-off in release builds are open questions for M0.
