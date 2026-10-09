# Spec: m3-workspaces

Status: research and plan; split into sub-specs (see Breakdown) · Milestone: M3 · Area: host
(`src/browser/base/content/vimma/workspaces/`, `ui/`), one upstream patch

Plan §6 M3: container-backed workspaces; hidden tabs; `ctrl+i`/`ctrl+u`; a `prefix+w` picker; a
`<leader>n` side panel with `panel` mode; SessionStore persistence and restore; `[workspaces]`
config. **Gate:** a login in `work` is invisible in `personal`; a restart restores workspaces,
tabs and scroll positions.

This spec is the umbrella: it records the research, the decisions and the architecture, and
splits the work into one-session sub-specs. The pure model is already specified in
[m3-m4-core-models](m3-m4-core-models.md) (PR #10, `workspaces.mjs`, `snapshot.mjs`) and the
`[workspaces]` schema in [m5-core-config-and-theme](m5-core-config-and-theme.md). Engine paths are
relative to `engine/` (Firefox 157.0.1); Zen paths are relative to `zen-browser/desktop` at
`185e856f`.

## User stories

- As a user, my tabs live in named workspaces (`work`, `admin`, `personal`), each a Firefox
  container: a site I am signed in to in `work` sees no cookies or storage of mine in `personal`.
- As a user, `ctrl+i` / `ctrl+u` go to the next / previous workspace (wrapping), and I see only
  that workspace's tabs: `prefix+1..9`, `gt`, `ctrl+tab`, `ctrl+pagedown` and closing a tab never
  take me into another workspace.
- As a user, a new tab (`prefix+c`, `t`, `ctrl+t`, a bookmark, a link from another app) opens in
  the current workspace's container; a link opened from a page stays in that page's container.
- As a user, `prefix+w` lists the workspaces (`/` filters); Enter switches. From it I can also
  move the current tab to another workspace, after a warning that the page is reopened and its
  history and form state are lost.
- As a user, `prefix+shift+n` / `prefix+shift+w` / `prefix+shift+d` create, rename and close a
  workspace. Closing asks first when it has tabs, and says whether the site data goes too.
- As a user, `<leader>n` (or `prefix+b`) opens a panel on the left headed by the current workspace
  (name, colour, `ctrl+u` / `ctrl+i` neighbours), listing its tabs as numbered rows; `1-9`, `j/k`,
  Enter pick a tab; `<leader>n` / `Esc` close it.
- As a user, `[workspaces]` in `config.toml` defines my workspaces, their order, colour, icon and
  home page; without it I get one workspace and can add more at runtime.
- As a user, quitting and restarting vimma brings back every workspace, every tab in the right
  workspace and container, the active workspace and tab, and each page's scroll position.

## Research (Firefox 157 engine)

### Containers (contextual identities)

- **API** (`toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs`, CIS below):
  `create(name, icon, color)` (391-432) returns an identity with a fresh `userContextId` from an
  ever-increasing counter (`++_lastUserContextId`); it does **not** validate icon or colour (only
  the WebExtension API does, `toolkit/components/extensions/parent/ext-contextualIdentities.js:29-40`),
  so validation stays in our config schema. `update(id, name, icon, color)` (434-465),
  `remove(id)` (500-526), `getPublicIdentities()` / `getPublicIdentityFromId(id)` (752-786),
  `closeContainerTabs(id)` (897-918, resolves once every remote browser is destroyed, 933-951).
  Notifications: `contextual-identity-created` / `-updated` / `-deleted` / `-reordered`.
- **Storage:** `<profile>/containers.json`, version 6 (CIS:7, 1061-1065), written with a 1500 ms
  debounce, an `AsyncShutdown.profileBeforeChange` blocker and an atomic `tmpPath` write
  (CIS:356-389). Valid colours and icons (CIS:25-113) are exactly the lists our config schema
  accepts. A fresh profile has Firefox's four public defaults (personal, work, banking, shopping,
  ids 1-4) plus two private system identities (CIS:176-257).
- **`remove(id)` clears the container's site data**: it calls
  `Services.clearData.deleteDataFromOriginAttributesPattern({ userContextId })` (CIS:510) before
  dropping the identity. It does **not** close tabs. The same clear broadcasts
  `clear-origin-attributes-data`, on which SessionStore forgets closed tabs of that container
  (`browser/components/sessionstore/SessionStore.sys.mjs:1016-1024, 5004-5014`): after a delete,
  "undo close tab" cannot bring them back.
- **Prefs** (`browser/app/profile/firefox.js:2766-2771`): `privacy.userContext.enabled` (default
  true). Flipping it to false makes CIS close every container tab, clear the data of every public
  container and reset `containers.json` to the defaults (CIS:237, 268-283): every workspace
  container and its logins are gone. `privacy.userContext.ui.enabled` only shows the Settings box.
  Isolation itself does not depend on either pref: the origin attributes come from the browser's
  `usercontextid` attribute.
- **Id reuse after a reset:** `resetDefault()` (on a missing or corrupt `containers.json`)
  recomputes the counter from the defaults, so ids ≥ 6 can be handed out again; it first clears
  only ids that still have cookies (CIS:320-337, 957-984). Our definitions must not trust a stored
  `userContextId` blindly (see Container lifecycle).
- **A tab's container is fixed for its browser's lifetime.** `addTab(uri, { userContextId })` sets
  the `usercontextid` attribute on tab and browser
  (`browser/components/tabbrowser/Tabbrowser.sys.mjs:4546-4565, 3052-3054`); the origin
  attributes are read once when the browsing context attaches (`dom/base/nsFrameLoader.cpp:3567-3585,
3821-3843`) and `BrowsingContext::CanSetOriginAttributes` refuses (MOZ_CRASH for an attached
  content context) afterwards (`docshell/base/BrowsingContext.cpp:1791-1815`). Changing container
  means a new tab.
- **Default container of a new tab:** `addTab` inherits the opener's container when none is given
  (`Tabbrowser.sys.mjs:4546-4549`); otherwise the tab is in container 0 ("no container").
  `ctrl+t` (`BrowserCommands.openTab`, `browser/base/content/browser-commands.js:228+`), bookmarks,
  `alt+enter` in the URL bar and the replacement tab Firefox opens when the last tab closes
  (`Tabbrowser.sys.mjs:6626-6633`) pass no container, so they land in container 0. External links
  use `URILoadingHelper.guessUserContextId` (`browser/modules/URILoadingHelper.sys.mjs:880-920`),
  which only looks at **visible** tabs (so with hidden tabs it guesses within the active
  workspace) and returns null when nothing matches.

### What a container isolates

Isolated (keyed by `OriginAttributes.userContextId`), with the engine test or code that shows it:

| Data                                         | Evidence                                                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Cookies, localStorage                        | `browser/components/contextualidentity/test/browser/browser_usercontext.js:33-80`                                                  |
| sessionStorage, IndexedDB                    | `browser/components/contextualidentity/test/browser/browser_forgetaboutsite.js:269-301`                                            |
| HTTP cache, image cache                      | `browser_forgetaboutsite.js:154, 219`; `netwerk/base/LoadContextInfo.h:21-28`                                                      |
| Service workers, BroadcastChannel, blob URLs | `browser_serviceworkers.js`, `browser_blobUrl.js` (same directory)                                                                 |
| HTTP auth cache                              | `netwerk/protocol/http/nsHttpAuthCache.cpp:22-25`                                                                                  |
| DNS cache, connections, TLS sessions         | `netwerk/dns/nsHostResolver.cpp:323-325`; `netwerk/protocol/http/nsHttpConnectionInfo.cpp:293`; `nsSocketTransport2.cpp:1203-1217` |
| Alt-Svc                                      | `netwerk/protocol/http/AlternateServices.cpp:62-67`                                                                                |

**Not isolated** (shared by every workspace):

| Data                                              | Evidence                                                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HSTS                                              | `security/manager/ssl/nsSiteSecurityService.cpp:249-252, 264-267` ("Don't isolate by userContextId")                                                       |
| Site permissions (camera, notifications, …)       | `extensions/permissions/PermissionManager.cpp:4375-4389`: stripped unless `permissions.isolateBy.userContext` (default false, `StaticPrefList.yaml:17435`) |
| Saved logins (password manager)                   | stored by origin without origin attributes (`toolkit/components/passwordmgr/LoginManagerParent.sys.mjs:137-139` keys only generated passwords)             |
| History, bookmarks, stored favicons, form history | no `userContextId` in `toolkit/components/places/*.sys.mjs` or `satchel/FormHistory.sys.mjs` (grep)                                                        |
| Downloads list                                    | only records the source container (`toolkit/components/downloads/DownloadCore.sys.mjs:1794-1797`)                                                          |

So the gate (a login cookie) holds, but a saved password autofills in every workspace (the
`autofill` key in `[workspaces]`, M6), history and the URL bar's suggestions mix workspaces, and
a permission granted in one is granted in all. These go to `docs/limits.md`.

### Hidden tabs

- `gBrowser.hideTab(tab, source)` / `showTab(tab)` (`Tabbrowser.sys.mjs:7535-7612`) are plain
  chrome methods; extensions reach them through `tabs.hide()` with the `tabHide` permission
  (`browser/components/extensions/parent/ext-tabs.js:1646-1663`). `hideTab` silently does nothing
  for a tab that is **pinned, selected, closing, or sharing camera/mic/screen** (7565-7572); with
  a `source` it records `hiddenBy` in SessionStore, without one it does not. A split-view tab is
  hidden together with its siblings (7604-7611). **Selecting a hidden tab shows it** (1865).
- `gBrowser.visibleTabs` excludes hidden tabs (588-590, `content/tabs.js:945-949`), and everything
  tab-navigational uses it: `selectTabAtIndex` (`ctrl+1..9`, 7626-7641), `ctrl+pagedown` /
  `ctrl+tab` without previews (`toolkit/content/widgets/tabbox.js:149-165, 1189-1190, 1233-1259`),
  the `ctrl+tab` MRU panel (`browser/components/tabbrowser/content/browser-ctrlTab.js:486,
614, 800-802`), and the tab to select after a close (`_findTabToBlurTo`, 7013-7090, never picks a
  hidden tab). Firefox View excludes hidden tabs (`browser/components/firefoxview/OpenTabs.sys.mjs:357`);
  the all-tabs panel lists them under "Hidden tabs" (`content/browser-allTabsMenu.js:45-127`).
  URL-bar "switch to tab" does include hidden tabs (3843); selecting one un-hides it.
- **Closing the last visible tab** ignores hidden tabs (`#isLastTabInWindow`, 6419-6436): with
  `browser.tabs.closeWindowWithLastTab` (default true, `firefox.js:1113`) the **window closes with
  every hidden tab in it**; with false, Firefox opens a new tab in container 0 (6626-6633). The
  decision is taken before `TabClose` fires (6547-6647), so the host cannot intervene.
- **SessionStore** saves `hidden` per tab (`browser/components/sessionstore/TabState.sys.mjs:176`)
  and restores it with `hideTab`/`showTab` inside the same synchronous restore
  (`SessionStore.sys.mjs:6488-6492`): restored tabs come back hidden without a flash.
- **Memory:** restored non-selected tabs stay lazy (no content process) until selected
  (`SessionStore.sys.mjs:5880-5882, 6459-6477`; `browser.sessionstore.restore_on_demand`).
  `TabUnloader` has no preference for hidden tabs (`browser/components/tabbrowser/TabUnloader.sys.mjs:32-40`)
  and is off on Linux (`browser.tabs.unloadOnLowMemory`, `firefox.js:1213-1217`). Nothing unloads
  hidden tabs automatically.
- **Audio:** hiding does not mute; the tab container tracks hidden tabs playing sound
  (`hiddensoundplaying`, `content/tabs.js:287-316`).
- **Moving a tab to another window** (`adoptTab`) does not carry `hidden` but carries custom tab
  values (`SessionStore.sys.mjs:1339-1350`); `duplicateTab` copies all custom values (`extData`)
  (`SessionStore.sys.mjs:3730-3765`; tests `browser_393716.js`, `browser_465215.js`).

### SessionStore

- `setCustomTabValue(tab, key, string)` / `getCustomTabValue` / `deleteCustomTabValue`
  (`SessionStore.sys.mjs:4790-4834`): strings only, kept in a WeakMap and serialised as the tab's
  `extData`; they work on lazy tabs. `setCustomWindowValue` / `getCustomWindowValue` (4716-4780)
  likewise per window. Both go into `sessionstore-backups/recovery.jsonlz4` every
  `browser.sessionstore.interval` (15 s) and `sessionstore.jsonlz4` at shutdown
  (`SessionFile.sys.mjs:73-110`), so they survive a crash up to the last 15 s.
- **Trap:** during a restore, `#restoreTab` replaces a tab's custom values with its saved
  `extData` (6361-6365). A value set in a `TabOpen` handler before that is lost.
- **Order of a window restore** (`#restoreWindow`, 5812+): `SSWindowStateBusy` →
  `createTabsForSessionRestore` (all tabs, one fragment) → `#restoreTab` for each tab
  synchronously (custom values, then `hidden`) → `SSWindowStateReady` → `SSWindowRestored`
  (6103-6115). After all windows: `sessionstore-windows-restored` (1559, 1588, 7692) and
  `SessionStore.promiseAllWindowsRestored` (575). `SSTabRestoring` fires when a tab's history is
  restored into a browser, which for lazy tabs is only on first selection (8398-8413).
- **A normal restart does not restore tabs** by default: `browser.startup.page` is 1
  (`firefox.js:337`); only 3, `resume_session_once` or a crash restores the session
  (`SessionStartup.sys.mjs:337-345, 415-429`); otherwise only pinned tabs come back and the rest
  wait for "restore previous session".
- **Scroll positions** are saved per history entry and for the current document
  (`toolkit/modules/sessionstore/SessionHistory.sys.mjs:214-222`) and restored when the tab
  restores (`SessionStore.sys.mjs:8325-8335`); `privacy_level` does not filter them
  (`PrivacyFilter.sys.mjs:22-77`). Nothing for us to build; lazy tabs get theirs on selection.
- **No tab identity survives a restart:** `permanentKey` is per session (`Tabbrowser.sys.mjs:3034`)
  and `TabState` saves no id (`TabState.sys.mjs:160-217`), so we keep our own uuid in a custom
  tab value, and must re-mint it on a duplicate (which copies it).
- **Our own JSON file:** `JSONFile` (`toolkit/modules/JSONFile.sys.mjs`) debounces `saveSoon()`
  (1500 ms), writes with `IOUtils.writeJSON` and `tmpPath` (atomic rename,
  `xpcom/ioutils/IOUtils.cpp:1459-1479`), keeps an optional `backupTo`, and flushes pending saves
  at `profileBeforeChange` (128-133, 489-500). Plain `IOUtils.writeJSON` gives the atomic write
  but no shutdown flush of a debounced save. Precedent: `browser/components/customkeys/CustomKeys.sys.mjs:30-32`.

### "Reopen in Container"

`TabContextMenu.reopenInContainer` (`browser/components/tabbrowser/content/tab-context-menu.js:1174-1240`)
opens `gBrowser.addTab(currentURI.spec, { userContextId, pinned, tabIndex: index + 1,
triggeringPrincipal })`, where the principal is the tab's content principal (or, for a lazy tab,
the one in `SessionStore.getTabState`) rewrapped with `principalWithOA(…, { userContextId })`;
it selects the new tab if the old one was selected and copies mute. **Only the URL travels**: no
back/forward history, form data, scroll position or POST data, and the old tab stays open.
Restoring the old tab's SessionStore state into a tab of another container (`duplicateTab`'s
pattern, 3701-3714) would carry history, but its entries keep principals with the old origin
attributes (`toolkit/modules/sessionstore/SessionHistory.sys.mjs:535-553`, which docshell asserts
on, `docshell/base/nsDocShell.cpp:9259-9265`) and its sessionStorage is keyed by the old
container's origin (`toolkit/components/sessionstore/SessionStoreUtils.cpp:1617-1641, 1788`):
copying it across would leak data between containers. We do not.

### Sidebar

- `SidebarController` (`browser/components/sidebar/browser-sidebar.js`, 3046 lines) keeps panels
  in a JS map (113-283); a custom panel can be inserted at runtime only through private fields
  (`sidebars`, the hard-coded `toolsNameMap` for launcher icons, 15-24). Panels are documents in
  `<browser id="sidebar">`, an in-process chrome browser (`browser/base/content/browser-box.inc.xhtml:24`);
  web content needs a nested remote `<browser type="content">`, as the AI chatbot does
  (`browser/components/genai/chat.js:136-146`). State is saved by SessionStore
  (`SessionStore.sys.mjs:5411-5413, 6694-6701`). The area is in heavy development: 117 files,
  23 `sidebar.*` prefs, a Nimbus feature that writes user prefs
  (`toolkit/components/nimbus/FeatureManifest.yaml:5302-5318`,
  `browser/components/sidebar/SidebarManager.sys.mjs:127-173`), its own `Escape` handling
  (564-569) and `SidebarFocused` focus logic.
- `#browser` (`browser-box.inc.xhtml:5-30`) is a flex `hbox`; `#tabbrowser-tabbox` has `flex="1"`.
  A box inserted from JS needs no `browser.xhtml` patch. `SidebarController.setPosition()` rewrites
  `style.order` of every child by DOM index (`browser-sidebar.js:1001-1006`), so our box pins its
  place with an `!important` `order` in our stylesheet.
- Firefox's sidebar keys stay: `accel+h` history, `accel+alt+x` chatbot, `accel+alt+u` open tabs,
  `ctrl+alt+z` toggle (`browser/base/content/browser-sets.inc.xhtml:291-334`). `accel+b`
  (bookmarks) is our prefix and never reaches Firefox (capturing listener, m0-key-capture).

### Zen (`src/zen/spaces/`, formerly `workspaces`)

- **Container binding is optional and loose**: a space has `containerTabId` (0 = none); new tabs
  take the active space's container through a `Tabbrowser-sys-mjs.patch` hunk in `addTab`
  (`getContextIdIfNeeded`), and with `zen.workspaces.force-container-workspace` a tab opened in
  another space's container is moved there and the window switches. Visibility follows a
  `zen-workspace-id` attribute, not the container, so mismatches are allowed and confuse users
  (zen-browser/desktop issues #6904, #11268, #14371).
- **No hideTab**: each space is its own DOM container of tabs, and `gBrowser.tabs` is overridden to
  the active space. That needs about ten patches so upstream code that wants every tab (SessionStore,
  TabStateFlusher, TabUnloader, tabbox, URILoadingHelper, ctrl+tab) sees them; Zen used `hideTab`
  before and now un-hides legacy hidden tabs on init.
- **Persistence**: tab fields added to `TabState` by patch, spaces in SessionStore window data by
  patch, plus their own `zen-sessions.jsonlz4` (JSONFile, rotating backups) and a migration away
  from a Places table. Startup restore is patched into `SessionStartup` (always resume) and
  `restoreTabs`. Tabs whose space is missing are removed as "zombies" (`skipSessionStore`).
- **Lessons** (issues): session loss on a storage migration (#12460, #9062, #10978) → plan
  migrations and keep a backup; tabs lost when a space vanished (#10345) → never drop orphans;
  external and delayed opens landing in the wrong space (#4197, #9728, #15517, #14100) and a
  freeze when external opens switched spaces (#10666) → do not switch on background opens;
  multi-window duplicates (#14004) → a stable per-tab id with a dedupe rule; pinned/"essentials"
  across spaces and containers (#8427, #12573, #13940) → keep pinned tabs out of the model.

## Decisions

1. **Strict container binding.** Every workspace owns exactly one container of its own (never
   container 0, never one of Firefox's defaults, never shared). A tab belongs to the workspace
   that owns its container. This is the invariant the gate needs and what Zen's loose binding
   lacked. A tab in a container no workspace owns (container 0 from an extension or "Open in No
   Container", Firefox's default containers) is adopted by the active workspace and marked
   `foreign` in the picker and the panel; we never reopen it behind the user's back.
2. **Hidden tabs via `gBrowser.hideTab` / `showTab`** (plan §2), not Zen's DOM split: every
   upstream consumer of `visibleTabs` (ctrl+tab, `ctrl+1..9`, close-selects-next, Firefox View,
   URL-bar guessing) becomes workspace-scoped with **zero patches**, and SessionStore restores the
   hidden flag natively.
3. **One upstream patch** (`Tabbrowser-sys-mjs.patch`, one hunk in `addTab`): a tab opened with no
   container and no opener takes the active workspace's container. Without it, `ctrl+t`,
   bookmarks, `alt+enter`, external links and the last-tab replacement open in container 0, and
   fixing them up after `TabOpen` would mean reopening a tab whose load (maybe a POST) has already
   started. A runtime wrap of `addTab` is rejected for the reason m0-tabstrip-hidden gives: a
   patch fails loudly at `surfer import`, a wrap breaks silently.
4. **Side panel: our own box**, inserted from JS into `#browser`, not `SidebarController` (answers
   plan §9). Keys stay in the chrome document's dispatcher (`panel` mode) with no hop into a panel
   document; no dependency on the sidebar's private map, its Escape and focus handling, its
   revamp/visibility state machine or Nimbus; no patch. A web page in the panel later is the same
   nested remote `<browser>` either way. Cost: we persist nothing (the panel is closed at start,
   plan §2) and pin `order` in CSS.
5. **Starter workspaces: only the commented example** (answers plan §9). Without `[workspaces]`,
   first run creates one workspace, `main` (gray, circle). Creating `work`/`admin`/`personal`
   presumes a life layout, adds three containers to Firefox's Settings and, being config-defined,
   could not be deleted (decision 7). `defaults.toml` keeps the three as a commented example.
6. **Moving a tab = reopen by URL in the target container** (Firefox's "Reopen in Container"),
   then close the original. History, form data, scroll and POST data are lost; the tab's rename
   label and mute state carry over. Restoring the session history across containers is rejected
   (principal and sessionStorage leaks, above).
7. **Containers are never deleted silently.**
   - _Runtime workspace_ (created with `prefix+shift+n`): closing it, after confirmation, closes
     its tabs in every window and **removes its container, which deletes its site data**. The
     prompt says so: `Close "shop" (4 tabs) and delete its cookies and site data? y/N`.
   - _Config workspace_ (in `[workspaces]`): closing it closes its tabs only (`Close the 4 tabs of
"work"? It stays: it is in config.toml. y/N`); the workspace and its container (logins) stay.
   - _A config workspace removed from the file_ becomes a runtime workspace with its tabs and
     data; the user can then close it. Nothing is removed at startup.
   - We never touch containers we did not create, and never adopt Firefox's default ones (a
     profile's existing "Work" container may already hold someone's logins).
8. **Persistence in three places**, each where its identity lives:

   | What                                                                                | Where                                                                  | Why                                                                                                                      |
   | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
   | Workspace definitions (global)                                                      | `<profile>/vimma-workspaces.json` (JSONFile, `backupTo`)               | Shared by all windows; outlives sessions (a `startup.page` change, "clear history"). Plan §3's JSON file.                |
   | Per-window state: active workspace, tab order, active tab, pane layouts, tab labels | `SessionStore.setCustomWindowValue(win, "vimma-workspaces", snapshot)` | Windows have no id across restarts; the value travels with the window through crash recovery and "reopen closed window". |
   | Tab identity and membership                                                         | `setCustomTabValue(tab, "vimma-tab", uuid)` and `"vimma-workspace"`    | Plan §3; travels with the tab through undo-close, adopt-to-window and session restore.                                   |

   This refines plan §3, which put pane layouts in the JSON file: a pane layout belongs to a
   window, and a window can only be found again through SessionStore. The window snapshot is the
   core's schema 1 (`toSnapshot`, with M2's `tabLabels`), so `canWrite` guards both it and the
   definitions file.

9. **Restore is on by default**: our branding prefs set `browser.startup.page = 3` (resume the
   previous session), and `browser.tabs.closeWindowWithLastTab = false` so that closing the last
   tab of a workspace never closes a window full of hidden workspaces (Firefox then opens a new
   tab, which the patch puts in the workspace's container). Both are ordinary defaults the user
   can change; the limits say what changing them costs.
10. **Workspaces are global, membership is per window.** A workspace created, renamed or closed in
    one window changes it in every window; each window has its own active workspace and its own
    tabs. A new window starts in the active workspace of the window it was opened from (or the
    first workspace). Private windows and popups have no workspaces.
11. **Pinned tabs are out of the model.** `hideTab` refuses pinned tabs, so a pinned tab would
    leak into every workspace. With the tab strip hidden Vimma offers no way to pin; a tab pinned
    by an extension or an imported session is unpinned by the host on `TabPinned` with a status
    message. A tab sharing camera/mic/screen cannot be hidden either: it stays visible in the
    workspace the user switches to, marked in the status bar, until sharing stops.
12. **Background opens never switch workspace.** A tab opened in another workspace's container
    (a link from a `work` page opened with `F`, an extension) joins that workspace hidden, with a
    status message (`opened in work`); only selecting it (picker, URL-bar switch-to-tab, panel)
    switches. Zen's switch-on-open caused misrouted tabs and a freeze (#10666).

## Architecture

```
config.toml [workspaces] ─┐
vimma-workspaces.json ────┼─▶ WorkspaceStore (per app)  ──containers──▶ ContextualIdentityService
                          │     definitions, reconcile, writes
                          ▼
             WindowWorkspaces (per window) ── model ──▶ vimma-core workspaces.mjs (pure)
               │  gBrowser events: TabOpen, TabClose, TabSelect, TabPinned, TabAttrModified
               │  SessionStore: window value, tab values, SSWindowRestored
               ├─▶ gBrowser.hideTab / showTab / selectedTab / addTab / removeTab
               ├─▶ status bar segment, prefix+w picker (M2 picker.mjs), side panel
               └─▶ VimmaHost actions: workspace.*, sidebar.toggle, panel.*
```

- **`workspaces/WorkspaceStore.sys.mjs`** (one per app, a module singleton): loads and saves
  `vimma-workspaces.json`, reconciles it with `[workspaces]` and `ContextualIdentityService`,
  creates/updates/removes our containers, and notifies windows (`vimma-workspaces-changed`
  observer topic) of definition changes. The pure part (reconcile, schema validation) is a new
  core module, `packages/vimma-core/src/workspacedefs.mjs`, tested in Vitest.
- **`workspaces/WindowWorkspaces.sys.mjs`** (one per window, started by `VimmaHost.init` like
  `TabStrip`, in a `try`/`catch`): owns the window's core `Workspaces` state, maps tab uuids to
  tab elements, listens to tab and SessionStore events, applies the model to the window
  (`hideTab`/`showTab`, selection), writes the window snapshot after each change.
- **`ui/side-panel.mjs`** + `browser/themes/shared/vimma/side-panel.css`.
- Ids: a workspace's id is a global string from the definitions file (`ws-<uuid>`), passed into
  the core model; the model's `container` field holds the `userContextId` as a string; tab ids are
  the `vimma-tab` uuids.
- **Core change** (small, in the first sub-spec): `createWorkspaces` and `addWorkspace` accept an
  optional `id` (validated unique, `duplicate-id`), because ids must agree across windows; the
  model's own `w<n>` minting stays for callers that pass none.

### Mapping the model to Firefox

| Model operation                     | Host                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `switchWorkspace` / next / previous | Select the target's `activeTab` (if empty: open its `home` or `about:newtab` in its container), then `showTab` its tabs and `hideTab` the others. Selecting first matters: the selected tab cannot be hidden. |
| `openTab` (on `TabOpen`)            | Workspace = owner of `tab.userContextId`, else the active one (`foreign`). Position from the tab's index among its workspace's tabs. Not activated unless it is selected.                                     |
| `closeTab` (on `TabClose`)          | Drop it; Firefox already picked the next tab among visible ones, which the host reports with `selectTab`. Ignored while the window is closing.                                                                |
| `selectTab` (on `TabSelect`)        | If the tab is in another workspace (URL-bar switch-to-tab, picker, `undo close tab`), switch to it: show its workspace, hide the rest.                                                                        |
| `moveTab`                           | Reopen by URL in the target container (decision 6), `moveTab(s, old, target, { newTabId })`, close the old tab.                                                                                               |
| `deleteWorkspace`                   | Confirm (decision 7), `removeTab` each of `closedTabs` (all windows), then for a runtime workspace `ContextualIdentityService.remove` after the browsers are gone.                                            |
| `addWorkspace` / `renameWorkspace`  | `ContextualIdentityService.create` / `update`, then the definitions file.                                                                                                                                     |

Tab order: the model's per-workspace order is the order of those tabs in `gBrowser.tabs` (hidden
tabs keep their DOM position). The host reads order from Firefox rather than moving tabs to match
the model, so `TabMove` updates the model and no tab is ever moved behind the user's back.

## Container lifecycle

- **Created** from `[workspaces]` at startup for each config workspace without a live container,
  and at runtime by `prefix+shift+n`, with `ContextualIdentityService.create(name, icon, color)`.
  The container's name is the workspace name.
- **Updated** when config changes a workspace's colour or icon or a rename happens
  (`ContextualIdentityService.update`).
- **Checked** at every startup: a definition whose `userContextId` is missing from
  `getPublicIdentities()`, or whose identity's name no longer matches what we wrote (a reset reused
  the id), gets a new container. Its restored tabs keep the old id (still isolated, but no longer
  the workspace's) and are marked `foreign`; the status bar says `container of "work" was lost:
sign in again`.
- **Removed** only by closing a runtime workspace after confirmation (decision 7).
- `contextual-identity-deleted` for one of ours (the user deleted it in Settings, which closes its
  tabs and then removes it: `browser/components/preferences/config/containers.mjs:124-126`) keeps
  the workspace and gives it a new, empty container at once; nothing else is removed.
- `privacy.userContext.enabled = false`: at startup the host shows a persistent status-bar error
  and runs with workspaces disabled (one implicit workspace, no containers); it does not flip the
  pref back.

## Persistence and restore

### Formats

- `vimma-workspaces.json`: `{ schema: 1, workspaces: [{ id, name, userContextId, color, icon,
home?, source: "config" | "runtime" }] }`, in `ctrl+i` order (config order first, runtime ones
  after, in creation order). JSONFile with `backupTo: "vimma-workspaces.json.bak"`.
- Window value `vimma-workspaces`: `JSON.stringify(toSnapshot(state, { tabLabels }))`, written on
  every model change (`setCustomWindowValue` only marks SessionStore dirty; its own 15 s cadence
  and the shutdown write persist it).
- Tab values `vimma-tab` (uuid) and `vimma-workspace` (workspace id).
- **Newer files:** before every write, `canWrite` on the current file / window value. A newer
  definitions file puts the session in read-only workspaces (no create/rename/delete, status bar
  says so); a newer window value is left untouched for that window. Unreadable definitions are
  moved aside (`vimma-workspaces.json.corrupt-<date>`) and rebuilt from config, containers and
  tab values, never silently emptied (Zen #12460).

### Startup and restore algorithm

1. `WorkspaceStore.init()` (first window): load the definitions file and read `config.toml`'s
   `[workspaces]` once (`parseConfig`; the M5 host adds polling and `:source`). Reconcile
   (`workspacedefs.mjs`, pure): config workspaces by name, keep runtime ones, turn removed config
   ones into runtime ones, create a `main` workspace if the result is empty; then check containers
   (lifecycle above) and write the file if anything changed.
2. Each window's `WindowWorkspaces` starts in a **pending** state: it ignores `TabOpen` while
   SessionStore is restoring the window (`SSWindowStateBusy` … `SSWindowRestored`, or until
   `SessionStore.promiseAllWindowsRestored` for the first window when nothing is restored), because
   tab values set before `#restoreTab` are overwritten.
3. On `SSWindowRestored` (or when no restore happens), build the model:
   1. Parse the window value with `fromSnapshot` (on error: log, start from the definitions).
   2. Align its workspaces with the definitions: drop unknown ones, add missing ones (empty), take
      names and order from the definitions.
   3. Read every live tab's `vimma-tab` and `vimma-workspace`; mint a uuid for tabs without one;
      re-mint the second of any duplicate (a duplicated tab copies its values).
   4. Drop snapshot tabs that are not live (`closeTab`); add live tabs the snapshot lacks
      (`openTab` into the workspace from `vimma-workspace`, else the container's owner, else the
      active one, `foreign`). Never close a live tab because its workspace is unknown (Zen's
      zombie sweep): it goes to the active workspace.
   5. The active workspace is the workspace of `gBrowser.selectedTab`; apply visibility (SessionStore
      already restored `hidden`, so this is normally a no-op) and write the window value.
4. Afterwards, `TabOpen` is handled in a microtask (so a restoring path such as undo-close or
   `duplicateTab` has set its `extData` first): read or mint the uuid, de-duplicate, `openTab`.
5. Scroll: nothing to do; SessionStore restores it when each tab restores (lazy tabs on first
   selection).

### Event order on a normal session restore

`VimmaHost.init` (script in `browser.xhtml`) → `WorkspaceStore.init` (async load) → delayed startup
→ `SSWindowStateBusy` → tabs created, `TabOpen` × n (ignored), each `#restoreTab` sets `extData`
and `hidden` → `SSWindowStateReady` → `SSWindowRestored` → model built → status bar and panel
render → `sessionstore-windows-restored`.

## Side panel

- `#vimma-panel`, a `vbox` inserted as the first child of `#browser` by `ui/side-panel.mjs`;
  `side-panel.css` gives it `order: -1 !important` and a fixed width token. Hidden until opened;
  never persisted open (plan §2: closed by default).
- Content (chrome HTML, rendered from core data like the help overlay): a header with the
  workspace dot (container colour), `index:name`, and the neighbours (`ctrl+u` previous name,
  `ctrl+i` next name); then the workspace's tabs as rows `n  label  host`, the active tab marked,
  `foreign` and sound-playing tabs marked.
- Mode `panel` while open (exists in `MODES`, keys in `defaults.mjs`): `1-9` selects that tab and
  closes the panel; `j`/`k` move the highlight; `Enter` selects the highlighted tab and closes;
  `Esc` and `toggle_sidebar` (`<leader>n`, `prefix+b`) close. `ctrl+i`/`ctrl+u` switch workspace
  with the panel open and it re-renders. Focus stays in the chrome document; closing returns focus
  to the selected browser.
- A web page in the panel is out of scope for M3; when needed it is a nested
  `<browser type="content" remote="true">` as in `browser/components/genai/chat.js:136-146`.

## Upstream patches

| Patch                                                        | Hunks | Why                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/browser/components/tabbrowser/Tabbrowser-sys-mjs.patch` | 1     | In `addTab`, after the opener inheritance (`Tabbrowser.sys.mjs:4546-4549`): `userContextId ??= this.documentGlobal.VimmaHost?.defaultUserContextId(this.documentGlobal)`. An explicit `0` stays `0`. Decision 3. |

Everything else is ours: prefs in `browser/branding/vimma/pref/firefox-branding.js`
(`browser.startup.page`, `browser.tabs.closeWindowWithLastTab`), modules and CSS under `vimma/`.
The patch gets its ADR-003 register line in the sub-spec that adds it. Not needed (checked):
`browser.xhtml` (the panel is inserted from JS), SessionStore and TabState (custom values),
`tabs.js` / ctrl+tab / TabUnloader (`hideTab` keeps upstream's own scoping), SessionStartup
(`browser.startup.page` instead of forcing resume).

Upstream's own split view (`hideTab` hides split siblings together, 7604-7611) is compatible with
this design; the M4 split-panes spec owns how panes map onto it.

## Test plan

Mochitests (`tests/browser/`, one per acceptance criterion; the gate's two first):

- `browser_vimma_workspaces_isolation.js` (**gate 1**): Given workspaces `work` and `personal`
  (test containers), when a page on `https://example.com` in `work` sets a cookie
  `session=work` and a localStorage key, then a tab on the same URL in `personal` sees neither
  (`document.cookie`, `localStorage` via `SpecialPowers.spawn`), `Services.cookies` has the cookie
  only under `work`'s `userContextId`, and the `work` tab still sees both after switching back.
  Also: a new tab from `prefix+c`, `ctrl+t` and a bookmark opens in the active workspace's
  container (the patch); a link opened with `F`/middle-click keeps its page's container.
- `browser_vimma_workspaces_restore.js` (**gate 2**): Given two workspaces with three tabs, one
  renamed, one page scrolled to `y = 1200` (`file_vimma_long.html`), `personal` active, when the
  test flushes (`TabStateFlusher.flush`), saves `SessionStore.getBrowserState()`, closes the
  window's tabs and restores the state with `SessionStore.setBrowserState` (the session-store
  tests' restart simulation, `browser/components/sessionstore/test/head.js:96-125`), then the
  definitions, every tab's workspace and uuid, the order, the active workspace and tab, the label
  and the hidden flags come back, and selecting the scrolled tab shows `scrollY === 1200`.
  A real quit/start is the M3 e2e happy path (plan §5), once `tools/e2e` exists.
- `browser_vimma_workspaces_switch.js`: `ctrl+i`/`ctrl+u` wrap; only the active workspace's tabs
  are visible; `ctrl+tab`, `alt+1..9`, `ctrl+pagedown` stay in it; closing the active tab selects
  one in the same workspace; closing the last one opens a new tab in the same container and keeps
  the window; switching to an empty workspace opens its `home`.
- `browser_vimma_workspaces_events.js`: URL-bar switch-to-tab and undo-close into another workspace
  switch to it; a background open in another workspace's container stays hidden with a status
  message; a duplicate tab gets a new uuid; a tab adopted from another window keeps its workspace;
  a pinned tab is unpinned; a container-0 tab is `foreign`.
- `browser_vimma_workspaces_lifecycle.js`: config workspaces create containers with name, colour
  and icon; a second start creates none; a removed container is recreated; closing a runtime
  workspace asks, closes tabs in every window and removes the container (its cookie is gone);
  closing a config workspace keeps container and cookie; a newer definitions file is never
  overwritten; Firefox's default containers are untouched.
- `browser_vimma_workspaces_move.js`: moving a tab reopens its URL in the target container (cookie
  of the target applies), keeps label and mute, closes the original, and stays in the current
  workspace; a lazy tab moves by its saved URL.
- `browser_vimma_side_panel.js`: `<leader>n` opens the panel on the left listing the workspace's
  tabs; `j`/`k`/`1-9`/Enter/Esc; `ctrl+i` re-renders it; it stays leftmost when
  `sidebar.position_start` flips; focus returns to the page on close.
- **Limits as tests**: a permission granted in `work` is visible in `personal`; HSTS is shared.
  When either is fixed, the test and the limits line go together.
- Vitest: `workspacedefs.mjs` reconcile table (config add/remove/reorder, renamed config entry,
  missing containers, an empty result → `main`), schema fixtures `tests/contract/workspaces/v1/`,
  and the core `id` option.
- Performance: e2e with 200 tabs over 4 workspaces, `ctrl+i` to paint (plan §9 risk).

## Risks

| Risk                                                                                                   | Mitigation                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Setting a tab value before `#restoreTab` loses it (overwritten by `extData`)                           | Pending state until `SSWindowRestored`; microtask handling of `TabOpen`; the restore test covers undo-close.   |
| `closeWindowWithLastTab = true` (user's choice) closes a window with hidden workspaces                 | Default false; limits line; the window stays in "recently closed windows" with all its tabs.                   |
| `containers.json` reset (corrupt file) reuses ids and clears data                                      | Startup container check by id and name; `foreign` marking; status-bar warning. Upstream behaviour; limits.     |
| `privacy.userContext.enabled = false` wipes every container                                            | Detected at startup, workspaces disabled with an error; limits line.                                           |
| The `addTab` hunk drifts on a rebase                                                                   | One small hunk near stable code (opener inheritance); `surfer import` fails loudly; isolation test catches it. |
| Extensions using `tabs.hide`/`show` (Multi-Account Containers, Simple Tab Groups) fight our visibility | Re-apply visibility on `TabShow`/`TabHide` we did not cause; document as unsupported in limits.                |
| Hidden-tab memory with hundreds of tabs                                                                | Lazy restore keeps them cheap; 200-tab e2e; unloading hidden tabs is a later spec.                             |
| Multi-window edge cases (Zen #14004)                                                                   | uuid per tab with re-mint on duplicate; definitions global, membership per window; events test.                |

## Breakdown into sub-specs

Each is one session, in order. M2's host pieces (status bar, picker UI, prompt line) are a
dependency for 5 and parts of 4.

| #   | Sub-spec                   | Scope                                                                                                                                                                                                                                                             | Depends on             |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | `m3-workspace-store`       | Core: `workspacedefs.mjs` (schema, reconcile, `main` default) and the optional `id` in `workspaces.mjs`. Host: `WorkspaceStore` (JSONFile, `canWrite`, containers create/update/check, one-shot `[workspaces]` read). Lifecycle test (no delete yet).             | PR #10 merged          |
| 2   | `m3-workspace-switching`   | `WindowWorkspaces`: tab uuids, `TabOpen`/`TabClose`/`TabSelect`/`TabMove`/`TabPinned`, `hideTab`/`showTab`, `ctrl+i`/`ctrl+u`, new tab in container (the `addTab` patch + ADR-003 line), `closeWindowWithLastTab` pref. **Gate 1** test, switch and events tests. | 1                      |
| 3   | `m3-workspace-persistence` | Window value and tab values, the restore algorithm, `browser.startup.page = 3`, duplicate and adopt handling, `canWrite` for the window value, `tabLabels`. **Gate 2** test.                                                                                      | 2                      |
| 4   | `m3-workspace-ops`         | `prefix+shift+n/w/d` (new, rename, close with the confirmation rules), move tab, cross-window propagation, `contextual-identity-deleted`, `privacy.userContext.enabled` check. Lifecycle and move tests.                                                          | 3; M2 prompt line      |
| 5   | `m3-workspace-picker`      | `prefix+w` (M2 `picker.mjs` with workspace items, `m` = move current tab here with the warning), the status bar's workspace segment and `opened in …` messages.                                                                                                   | 4; M2 picker and bar   |
| 6   | `m3-side-panel`            | `#vimma-panel`, `panel` mode wiring, rows, neighbours, focus. Side-panel test.                                                                                                                                                                                    | 2 (works without 3–5)  |
| 7   | `m3-e2e`                   | Real restart happy path and the 200-tab measurement on the e2e harness.                                                                                                                                                                                           | 3; `tools/e2e` on main |

## Out of scope

Per-workspace autofill stance (`autofill`, M6); syncing workspaces between devices; a web page in
the side panel; unloading hidden tabs; URL-to-workspace routing rules; isolating permissions
(`permissions.isolateBy.userContext` is a possible later opt-in, untested by us); pinned tabs;
config reload of `[workspaces]` while running (M5 host: it reuses step 1's reconcile).
