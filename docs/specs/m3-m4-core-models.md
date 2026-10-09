# Spec: m3-m4-core-models

Status: implemented (core), awaiting review; host wiring pending · Milestones: M3 (workspaces), M4 (panes) · Area: `packages/vimma-core`

## User stories

- As the vimma host, I keep one pure model of the window's panes and workspaces in `vimma-core`,
  apply every `pane.*` / `workspace.*` / tab bookkeeping action to it, and then mirror the result
  onto Firefox (split view, containers, hidden tabs). Every rule about what happens next (which
  pane gets focus, which tab becomes active, where a closed workspace's tabs go) lives here, where
  it is tested in milliseconds.
- As a user, `prefix+h/j/k/l` moves to the pane that is visually next to me, as in tmux and Herdr;
  `prefix+v` / `prefix+-` / `prefix+x` / `prefix+z` / resize behave the same every time.
- As a user, restarting vimma restores my workspaces, their tab order and their pane layouts, and a
  state file written by an older vimma is migrated, not dropped.

## Scope

| Module           | Exports                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `panes.mjs`      | `createPanes`, `split`, `closePane`, `focus`, `focusPane`, `swap`, `toggleZoom`,      |
|                  | `resize`, `setPaneTab`, `layout`, `leaves`, `paneOfTab`, `MIN_RATIO`, `PaneError`     |
| `workspaces.mjs` | `createWorkspaces`, `addWorkspace`, `renameWorkspace`, `deleteWorkspace`,             |
|                  | `switchWorkspace`, `nextWorkspace`, `previousWorkspace`, `openTab`, `closeTab`,       |
|                  | `selectTab`, `moveTab`, `splitPane`, `withPanes`, `activeWorkspace`, `findWorkspace`, |
|                  | `workspaceOfTab`, `WorkspaceError`                                                    |
| `snapshot.mjs`   | `SCHEMA_VERSION`, `toSnapshot`, `fromSnapshot`, `migrateSnapshot`,                    |
|                  | `SNAPSHOT_MIGRATIONS`, `SnapshotError`                                                |
| `index.mjs`      | re-exports                                                                            |

Contract fixtures: `tests/contract/state/v1/valid.json`, `tests/contract/state/v1/invalid.json`.
Bench: `packages/vimma-core/bench/core.bench.mjs` (`npm run bench`, not a CI gate yet): key to
action ≈ 1.3 µs, pane focus ≈ 3 µs, `withPanes` + `selectTab` ≈ 11 µs (budget 50 µs).

All state is plain, frozen, JSON-shaped data. Every operation is a pure function
`(state, ...args) → newState`; the input is never mutated. Ids are opaque strings: the host owns
tab ids and container ids; the model mints pane ids (`p1`, `p2`, …) and workspace ids (`w1`, …).

## Pane tree (`panes.mjs`)

```js
/** @typedef {{ type: "leaf", pane: string, tab: string }} Leaf */
/** @typedef {{ type: "split", axis: "x" | "y", children: Node[], ratios: number[] }} Split */
/** @typedef {{ root: Node, focus: string, zoom: string | null, next: number }} Panes */
/** @typedef {"left" | "down" | "up" | "right"} Direction */
```

- `axis: "x"` lays children out left → right, `"y"` top → bottom. A split has ≥ 2 children and one
  ratio per child.
- `createPanes(tabId)` → one leaf `p1` showing `tabId`, focused.
- `split(state, paneId, "vertical" | "horizontal", newTabId)`: `vertical` = split right (`:vsplit`,
  `prefix+v`, axis `x`); `horizontal` = split down (`:split`, `prefix+-`, axis `y`). The new pane
  goes right after `paneId`. If `paneId`'s parent already has that axis, the pane's ratio is halved
  between the two; otherwise the leaf is replaced by a new 50/50 split. Focus moves to the new pane.
- `closePane(state, paneId)`: removes the leaf; its ratio goes to the previous sibling (the next one
  if it was first). A split left with one child is replaced by that child (sibling promotion), and a
  promoted split with its parent's axis is flattened into the parent, scaling its ratios. If the
  closed pane had focus, focus goes to the sibling that absorbed its space (the first leaf of it in
  reading order). Closing the last pane throws `PaneError("last-pane")`; the host closes the tab.
- `focus(state, direction)`: geometric neighbour lookup on `layout(state, unit rect)`, as in tmux:
  the new pane is the one just past the focused pane's `direction` edge, in line with its top edge
  (for left/right) or left edge (for up/down). In a tiling that pane always touches the edge and
  overlaps the focused pane, so it is the touching neighbour nearest the start of the edge. No
  neighbour → state unchanged (no wrap).
- `focusPane(state, paneId)` focuses a pane directly (picker, mouse).
- `swap(state, direction)`: exchanges the focused leaf with its `focus` neighbour in the tree; the
  focused pane keeps focus and moves with its tab. No neighbour → unchanged.
- `toggleZoom(state)`: zooms the focused pane, or unzooms. `split`, `closePane`, `focus`,
  `focusPane`, `swap`, `resize` clear the zoom first (tmux). `layout` of a zoomed state returns the
  zoomed pane alone, filling the rect.
- `resize(state, "wider" | "narrower" | "taller" | "shorter", amount)`: on the nearest ancestor split
  with the matching axis (`x` for wider/narrower), the child holding the focused pane grows by
  `amount` (a ratio, e.g. `0.05`) taken from its next sibling (the previous one if it is last), or
  shrinks giving it back. Both the child and that sibling stay ≥ `MIN_RATIO` (`0.1`), so two
  panes stay within `[0.1, 0.9]`; the change is clamped, never rejected, and never moves the wrong
  way (a pane already below `MIN_RATIO` after splits can grow, not shrink). No such ancestor or
  nothing left to move → unchanged.
- `setPaneTab(state, paneId, tabId)` shows another tab in a pane (tab switching in the focused pane).
- `layout(state, rect)` → `[{ pane, tab, rect: { x, y, width, height } }]` in reading order. Edges
  are computed once per split as `start + size × cumulative ratio`, the last edge is exactly
  `start + size`, so neighbours share the same edge value.
- `leaves(state)` → leaves in reading order; `paneOfTab(state, tabId)` → pane id or `undefined`.
- Unknown pane id → `PaneError("unknown-pane")`; a tab already shown in another pane →
  `PaneError("tab-shown")` (one `<browser>` per pane); `bad-direction`, `bad-amount` (≤ 0) for
  invalid arguments.

### Invariants (fast-check, over random operation sequences)

1. Every split has ≥ 2 children, `ratios.length === children.length`, ratios > 0 and summing to 1
   (± 1e-9).
2. No split has a child split with the same axis (canonical form).
3. Every leaf is reachable from the root, pane ids are unique, tab ids are unique.
4. `focus` names an existing leaf; `zoom` is `null` or an existing leaf.
5. `closePane(split(s, p, d, t), newPane)` equals `s` up to `next` and focus on `p` (tree deep-equal,
   ratios exact).
6. `layout(s, r)` tiles `r`: every rect lies in `r`, areas sum to `r`'s area, and every sample point
   of `r` lies in exactly one rect (half-open rects).
7. `focus(s, d)` lands on a pane whose rect touches the start pane's `d` edge and overlaps it on the
   other axis; it leaves the state unchanged only when no pane does.

## Workspaces (`workspaces.mjs`)

```js
/** @typedef {{ id: string, name: string, container: string, tabs: string[],
 *              activeTab: string | null, panes: Panes | null }} Workspace */
/** @typedef {{ workspaces: Workspace[], active: string, next: number }} Workspaces */
/** @typedef {{ id: string } | { index: number } | { name: string }} WorkspaceRef */
```

- A workspace's **index** is its 1-based position in `workspaces` (the `ctrl+i` order); it is not
  stored. Names are unique, non-empty after trimming, compared case-sensitively.
- `container` is the opaque string the host maps to a `userContextId`. Unique per workspace.
- `createWorkspaces([{ name, container }, …])` (≥ 1; config `[workspaces]` order); first is active.
- `addWorkspace(state, { name, container }, { activate = true })` appends.
- `renameWorkspace(state, ref, name)`.
- `deleteWorkspace(state, ref)` → `{ state, closedTabs }`: Herdr's `close_workspace` closes what
  is in it, so the workspace's tabs are returned for the host to close (moving them would reopen
  them in another container and lose page state anyway, plan §2). Deleting the active workspace
  activates the previous one (the next if it was first). Deleting the last workspace throws
  `WorkspaceError("last-workspace")`.
- `switchWorkspace(state, ref)`, `nextWorkspace(state)`, `previousWorkspace(state)` (wrap around).
- `openTab(state, tabId, { workspace, after, activate = true })`: into `workspace` (default
  active), after tab `after` (default: at the end, as Firefox does for `ctrl+t`). Activating shows
  it in the focused pane. The first tab of an empty workspace creates its pane layout.
- `closeTab(state, tabId)`: removes it. If it was active, the tab to its right becomes active, else
  the one to its left (Firefox). If it was shown in a pane, that pane shows the new active tab if
  the closed one was focused (if that tab is already shown in another pane, the closed tab's pane
  is closed and that pane gets focus), otherwise the nearest tab not shown in any pane (rightwards
  first); if there is none, the pane is closed. The last tab of a workspace leaves
  `activeTab: null, panes: null`.
- `selectTab(state, tabId)`: switches to the tab's workspace; if a pane shows the tab it gets focus,
  else the focused pane shows it. It becomes `activeTab`.
- `moveTab(state, tabId, ref, { newTabId })`: close-tab bookkeeping in the source, open (not
  activated) at the end of the target. The host reopens the page in the target container and passes
  the new tab id (defaults to `tabId`). Moving into its own workspace is a no-op.
- `splitPane(state, direction, newTabId)`: opens `newTabId` after the active tab in the active
  workspace and splits the focused pane with it.
- `withPanes(state, fn)`: applies a pane operation to the active workspace's layout and sets
  `activeTab` to the focused pane's tab (`withPanes(s, p => focus(p, "left"))`). A result that
  shows a tab not in the workspace's `tabs` is rejected (`unknown-tab`).
- Errors: `WorkspaceError` with `code`: `unknown-workspace`, `duplicate-name`, `empty-name`,
  `duplicate-container`, `empty-container`, `unknown-tab`, `duplicate-tab`, `last-workspace`,
  `no-tab`.

### Invariants (fast-check, over random operation sequences)

1. Every tab id belongs to exactly one workspace.
2. `activeTab` is `null` iff `tabs` is empty iff `panes` is `null`; otherwise it is in `tabs` and is
   the focused pane's tab.
3. Every pane's tab is in its workspace's `tabs`.
4. `active` names an existing workspace; names and containers are unique.
5. The pane invariants above hold for every workspace's layout (checked by `fromSnapshot`'s
   validation inside property 6).
6. `fromSnapshot(toSnapshot(s))` deep-equals `s`.

## Persistence (`snapshot.mjs`)

`toSnapshot(state)` → `{ schema: 1, active, next, workspaces: [{ id, name, container, tabs,
activeTab, panes: { root, focus, zoom, next } | null }] }`, plain JSON. `fromSnapshot(json)` accepts an
object or a string, runs `migrateSnapshot`, validates every field and every invariant above, and
throws `SnapshotError` with a JSON path (`workspaces[1].tabs[0]`) on the first problem.
`migrateSnapshot(raw, migrations = SNAPSHOT_MIGRATIONS)` applies `migrations[n]` (n → n + 1) until
`schema === SCHEMA_VERSION`; a missing step or a newer schema throws (`unsupported-schema`). v1 has
no migrations; the hook is tested with an injected v0 → v1 step.

## Tests first (Given / When / Then)

Panes:

- Given one pane `p1`, when `split(p1, vertical, t2)`, then root is `x[p1, p2]` 50/50, focus `p2`.
- Given `x[p1, p2]` focused on `p2`, when `split(p2, vertical, t3)`, then `x[p1, p2, p3]` with
  ratios `[.5, .25, .25]` (same axis: no nesting).
- Given `x[p1, p2]`, when `split(p2, horizontal, t3)`, then `x[p1, y[p2, p3]]`.
- Given `x[p1, y[p2, p3]]`, when `closePane(p3)`, then `x[p1, p2]` (promotion), focus `p2`.
- Given `x[p1, y[p2, x[p3, p4]]]`, when `closePane(p2)`, then `x[p1, p3, p4]` with ratios
  `[.5, .25, .25]` (the promoted split is flattened into its parent).
- Given one pane, when `closePane(p1)`, then `PaneError("last-pane")`.
- Given `x[p1, y[p2, p3]]` focused on `p3`, when `focus(left)`, then `p1`; when `focus(right)` from
  `p1`, then `p2` (covers `p1`'s top edge).
- Given `x[p1, p2]`, when `focus(up)` from `p1`, then unchanged (no wrap).
- Given `x[p1, p2]` focused on `p1`, when `swap(right)`, then `x[p2, p1]`, focus `p1`.
- Given `x[p1, p2]`, when `toggleZoom` then `layout`, then only the focused pane, full rect; when
  `focus(right)`, then zoom is cleared.
- Given `x[p1, p2]` focused on `p1`, when `resize(wider, 0.1)`, then `[.6, .4]`; when
  `resize(wider, 1)`, then `[.9, .1]` (clamped); when `resize(taller, 0.1)`, then unchanged.
- Given `x[p1, p2]` focused on `p2` (last), when `resize(wider, 0.1)`, then `[.4, .6]`.
- Given `x[p1, y[p2, p3]]` 50/50 in `{0, 0, 100, 80}`, then `layout` gives `p1 {0,0,50,80}`,
  `p2 {50,0,50,40}`, `p3 {50,40,50,40}`.
- Properties 1–7 above.

Workspaces:

- Given `[work, personal]`, when `nextWorkspace` twice, then `work` again (wrap); `previousWorkspace`
  from `work` → `personal`.
- Given `work`, when `switchWorkspace({ index: 2 })` / `({ name: "personal" })`, then `personal`.
- Given `work`, when `addWorkspace({ name: "work" })`, then `WorkspaceError("duplicate-name")`.
- Given `work` with tabs `a, b`, when `deleteWorkspace(work)`, then `closedTabs` is `[a, b]` and the
  previous workspace is active; deleting the only workspace → `last-workspace`.
- Given tabs `a, b, c` with `b` active, when `closeTab(b)`, then `c` active; closing `c` then makes
  `a` active; closing `a` leaves `activeTab: null, panes: null`.
- Given `a` active, when `openTab(d, { after: "a" })`, then `a, d, b, c` and `d` active in the
  focused pane.
- Given panes `x[a, b]` with `b` focused, when `closeTab(b)` and no hidden tab, then one pane `a`.
- Given panes `x[a, b]` and hidden tab `c`, when `closeTab(b)` (focused), then the pane shows the new
  active tab (`c`, its right neighbour).
- Given `a` in `work`, when `moveTab(a, personal, { newTabId: "a2" })`, then `work` lacks `a`,
  `personal` ends with `a2`, `work` stays active.
- Given `a` in `personal` while `work` is active, when `selectTab(a)`, then `personal` is active and
  shows `a` in its focused pane.
- Properties 1–6 above.

Persistence:

- `tests/contract/state/v1/valid.json` parses and round-trips through `toSnapshot`.
- `tests/contract/state/v1/invalid.json` fails with a `SnapshotError` naming the path.
- Given `{ schema: 2 }`, then `unsupported-schema`; given an injected `0 → 1` migration, a v0 file
  loads.

## Actions

No change to `actions.mjs`: every pane and workspace binding of plan §2 (`split_vertical`,
`split_horizontal`, `focus_pane_*`, `swap_pane_*`, `zoom`, `close_pane`, `resize_mode`,
`resize_*`, `next_workspace`, `previous_workspace`, `workspace_picker`, `new_workspace`,
`rename_workspace`, `close_workspace`) already exists from m0-core-dispatcher, so the dispatcher
contract and `docs/bindings.md` are unchanged.

## Out of scope

Everything touching Firefox: containers (`ContextualIdentityService`), `gBrowser.hideTab` /
`showTab`, the vendored split view, SessionStore, the state file on disk, pickers and the side
panel UI, `resize` mode (a new dispatcher mode), `[workspaces]` TOML parsing (M5), the status bar
text. These belong to the host specs (see below).

## For the host specs (M3 / M4)

- Map `pane.split_vertical` → `splitPane(s, "vertical", newTab)` after creating the tab;
  `pane.focus_*` / `pane.swap_*` / `pane.zoom` / `pane.close` / `pane.resize_*` →
  `withPanes(s, p => …)`; resize steps of `0.05`.
- `resize_mode` needs a `resize` mode in `MODES` (a dispatcher contract change: ADR).
- Tab ids must survive a restart (e.g. a uuid in `SessionStore.setCustomTabValue`), since Firefox's
  own tab ids do not; the snapshot stores whatever the host passes.
- Before restoring a snapshot, drop tab ids the session did not restore (via `closeTab`).
- `deleteWorkspace` returns tabs to close; `moveTab` expects the host to reopen the page in the
  target container first.
- Mirror `layout()` onto the split view; hide every tab of non-active workspaces.

## Settled

- **N-ary splits in canonical form**, not a binary tree: three side-by-side panes are one split
  with three ratios, as in tmux; this makes "resize" act on the visible divider.
- **Splitting halves the pane's own share**, never re-balances siblings (tmux), which makes
  `closePane(split(x))` restore ratios exactly (`r/2 + r/2 === r` in binary floating point).
- **Closing a pane keeps its tab** (Vim `:q` in a window, Zen "unsplit"); `prefix+shift+x` closes
  tabs. Closing the last pane is an error for the host to turn into "close tab".
- **No wrap-around for pane focus** (Herdr); workspaces wrap (`ctrl+i` on the last goes to the first).
- **Deleting a workspace closes its tabs** (Herdr `close_workspace`); there is no "move to another
  workspace" because a move reopens every page in another container.
- **Zoom is persisted** (a restart looks the same) and cleared by any structural or focus change.
- **Errors throw** (`PaneError`, `WorkspaceError`, `SnapshotError`, each with `code`) for misuse by
  the host; ordinary no-ops (no neighbour, resize at the clamp) return the state unchanged, so the
  host can compare by identity.
