# ADR-003: Our code lives in our own files

- Status: Accepted
- Date: 2026-10-09

## Context

Every upstream hunk we modify is a potential rebase conflict every month.

## Decision

All vimma code lives under `src/browser/base/content/vimma/` (and `browser/themes/shared/vimma/`, `browser/branding/vimma/`). Upstream files are touched only to inject our code, in the smallest possible hunk. Every new `.patch` file needs a line in this ADR.

## Reasoning

Keeps the patch set small and rebases mechanical. Same discipline as Zen's `zen-components`.

## Alternatives rejected

- **Edit upstream files freely**: faster initially, unsustainable under monthly rebases.

## Consequences

Some features need awkward indirection instead of a direct edit.

## Patch register

| Patch                                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/browser/base/moz-build.patch`                                          | Adds `content/vimma` to `DIRS` so our own `moz.build` registers our `jar.mn` and mochitest manifest (m0-key-capture).                                                                                                                                                                                                                                                                                                                                                                          |
| `src/browser/base/content/browser-xhtml.patch`                              | One `<script>` after `browser-main.js` loads `vimma/vimma.js`, which starts `VimmaHost` (m0-key-capture).                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/browser/moz-configure.patch`                                           | `MOZ_APP_VENDOR` "Mozilla" → "Vimma": an implied option cannot be overridden from a mozconfig (m0-branding); `MOZ_APP_UA_NAME` "Firefox": a project flag only `imply_option` can set, keeps the UA Firefox's (m0-user-agent).                                                                                                                                                                                                                                                                  |
| `src/toolkit/components/utils/ClientEnvironment-sys-mjs.patch`              | `ClientEnvironmentBase.version` reads `MOZ_APP_VERSION` (the Firefox version), not the display version (Vimma's), so Remote Settings and Normandy filters see Firefox 157 (m0-app-version).                                                                                                                                                                                                                                                                                                    |
| `src/toolkit/components/messaging-system/targeting/Targeting-sys-mjs.patch` | Same for `TargetingEnvironment.version`, which Nimbus and ASRouter targeting use (m0-app-version).                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/browser/components/tabbrowser/content/tab-bar-visibility-js.patch`     | `TabBarVisibility.update()` counts `:root[vimma-tabstrip-hidden]` as a hidden strip for `tabs-hidden` and the nav bar's titlebar class, so window controls move to the nav bar (m0-tabstrip-hidden). A patch, not a runtime wrap: a rebase that moves this code fails at `surfer import`, not silently.                                                                                                                                                                                        |
| `src/browser/components/tabbrowser/Tabbrowser-sys-mjs.patch`                | Tabs and a window's first tab opened with no container take the active workspace's container (`addTab` after `openerTab`; `#setupInitialBrowserAndTab`), so new tabs, lazy tabs and new windows are isolated from the start (m3-workspaces, decision 3). A first tab asks `firstTabUserContextId`, which routes the window's URL by `[[routes]]` (workspace-routing).                                                                                                                          |
| `src/browser/modules/BrowserDOMWindow-sys-mjs.patch`                        | An external link with no container guess passes no container instead of an explicit 0, so `Tabbrowser-sys-mjs.patch` gives it the active workspace's (m3-workspaces, decision 3). The same line first asks `WorkspaceRouter` for a `[[routes]]` rule's container (domain, URL, the app from `-vimma-from`) (workspace-routing).                                                                                                                                                                |
| `src/browser/modules/URILoadingHelper-sys-mjs.patch`                        | `openLinkIn` to a new window with no container takes the opening page's container (a content triggering principal), else the active workspace's: `openInWindow` would otherwise pass an explicit 0 and skip `Tabbrowser-sys-mjs.patch` (m3-workspaces, decision 3). The same hunk first lets `WorkspaceRouter.routeLinkIn` give a typed URL, a bookmark or a page's new-tab link its `[[routes]]` rule's container, and copies it into `openLinkIn`'s own `userContextId` (workspace-routing). |
| `src/browser/base/content/browser-init-js.patch`                            | A new window's URL with no container loads in the first tab's container instead of 0, so it does not open a second tab in container 0 next to the routed first tab (m3-workspaces, decision 3).                                                                                                                                                                                                                                                                                                |
