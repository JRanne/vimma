/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Versioned JSON for the workspace + pane state (spec m3-m4-core-models). The host writes
 * `toSnapshot(state)` to its state file and restores with `fromSnapshot`, which migrates older
 * schemas and validates every invariant, failing with the JSON path of the first problem.
 * Contract fixtures: tests/contract/state/v<n>/.
 */

/** @import { Workspaces } from "./workspaces.mjs" */
/** @import { Workspace } from "./workspaces.mjs" */
/** @import { Panes } from "./panes.mjs" */
/** @import { PaneNode } from "./panes.mjs" */
/** @typedef {(raw: any) => any} Migration a step from schema n to n + 1 */

export const SCHEMA_VERSION = 1;

/**
 * `SNAPSHOT_MIGRATIONS[n]` upgrades a schema-n snapshot to n + 1. Schema 1 is the first.
 * @type {Readonly<Record<number, Migration>>}
 */
export const SNAPSHOT_MIGRATIONS = Object.freeze({});

export class SnapshotError extends Error {
  /**
   * @param {"invalid" | "bad-json" | "unsupported-schema"} code
   * @param {string} path JSON path of the offending value, "" for the whole document
   * @param {string} message
   */
  constructor(code, path, message) {
    super(`${path || "<root>"}: ${message}`);
    this.name = "SnapshotError";
    this.code = code;
    this.path = path;
  }
}

/**
 * @param {string} path
 * @param {string} message
 * @param {"invalid" | "bad-json" | "unsupported-schema"} [code]
 * @returns {never}
 */
function fail(path, message, code = "invalid") {
  throw new SnapshotError(code, path, message);
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {v is string}
 */
function isId(v) {
  return typeof v === "string" && v.length > 0;
}

/**
 * `next` must be above every minted id (`<prefix><n>`) so new ids never collide.
 * @param {unknown} next
 * @param {Iterable<string>} ids
 * @param {string} prefix
 * @param {string} path
 */
function checkNext(next, ids, prefix, path) {
  let max = 0;
  for (const id of ids) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  if (!Number.isInteger(next) || /** @type {number} */ (next) <= max) {
    fail(path, `must be an integer above ${max}`);
  }
}

/**
 * Plain JSON for persistence.
 * @param {Workspaces} s
 */
export function toSnapshot(s) {
  return {
    schema: SCHEMA_VERSION,
    active: s.active,
    next: s.next,
    workspaces: s.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      container: w.container,
      tabs: w.tabs.slice(),
      activeTab: w.activeTab,
      panes: w.panes && JSON.parse(JSON.stringify(w.panes)),
    })),
  };
}

/**
 * Upgrades `raw` step by step to SCHEMA_VERSION; returns `raw` itself when it is current.
 * @param {unknown} raw
 * @param {Readonly<Record<number, Migration>>} [migrations]
 * @returns {Record<string, any>}
 */
export function migrateSnapshot(raw, migrations = SNAPSHOT_MIGRATIONS) {
  let doc = raw;
  for (;;) {
    if (!isObject(doc)) return fail("", "a snapshot must be a JSON object");
    const schema = doc.schema;
    if (!Number.isInteger(schema)) return fail("schema", "missing or not an integer");
    if (schema === SCHEMA_VERSION) return doc;
    const step = migrations[schema];
    if (schema > SCHEMA_VERSION || !step) {
      return fail("schema", `schema ${schema} is not supported`, "unsupported-schema");
    }
    doc = step(doc);
  }
}

/**
 * @param {any} node
 * @param {string} path
 * @param {string | null} parentAxis
 * @param {{ panes: Set<string>, shown: Set<string>, tabs: Set<string> }} ctx
 * @returns {PaneNode}
 */
function readNode(node, path, parentAxis, ctx) {
  if (!isObject(node)) return fail(path, "a pane node must be an object");
  if (node.type === "leaf") {
    if (!isId(node.pane) || ctx.panes.has(node.pane)) fail(`${path}.pane`, "missing or duplicate");
    if (!isId(node.tab) || !ctx.tabs.has(node.tab))
      fail(`${path}.tab`, "not a tab of this workspace");
    if (ctx.shown.has(node.tab)) fail(`${path}.tab`, "tab shown in two panes");
    ctx.panes.add(node.pane);
    ctx.shown.add(node.tab);
    return Object.freeze({ type: "leaf", pane: node.pane, tab: node.tab });
  }
  if (node.type !== "split") return fail(`${path}.type`, `must be "leaf" or "split"`);
  const axis = node.axis;
  if (axis !== "x" && axis !== "y") fail(`${path}.axis`, `must be "x" or "y"`);
  if (axis === parentAxis) fail(`${path}.axis`, "same axis as the parent split");
  const { children, ratios } = node;
  if (!Array.isArray(children) || children.length < 2) {
    fail(`${path}.children`, "a split needs at least two children");
  }
  if (
    !Array.isArray(ratios) ||
    ratios.length !== children.length ||
    !ratios.every((r) => typeof r === "number" && Number.isFinite(r) && r > 0) ||
    Math.abs(ratios.reduce((a, b) => a + b, 0) - 1) > 1e-6
  ) {
    fail(`${path}.ratios`, "one positive ratio per child, summing to 1");
  }
  const kids = children.map((c, i) => readNode(c, `${path}.children[${i}]`, axis, ctx));
  return Object.freeze({
    type: "split",
    axis,
    children: Object.freeze(kids),
    ratios: Object.freeze(ratios.slice()),
  });
}

/**
 * @param {any} raw
 * @param {string} path
 * @param {Set<string>} tabs
 * @returns {Panes}
 */
function readPanes(raw, path, tabs) {
  if (!isObject(raw)) return fail(path, "must be an object or null");
  const ctx = { panes: new Set(), shown: new Set(), tabs };
  const root = readNode(raw.root, `${path}.root`, null, ctx);
  if (!ctx.panes.has(raw.focus)) fail(`${path}.focus`, "must name a pane");
  if (raw.zoom !== null && !ctx.panes.has(raw.zoom)) fail(`${path}.zoom`, "must be null or a pane");
  checkNext(raw.next, ctx.panes, "p", `${path}.next`);
  return Object.freeze({ root, focus: raw.focus, zoom: raw.zoom, next: raw.next });
}

/**
 * Parses, migrates and validates a snapshot (object or JSON text).
 * @param {unknown} input
 * @param {{ migrations?: Readonly<Record<number, Migration>> }} [options]
 * @returns {Workspaces}
 */
export function fromSnapshot(input, { migrations } = {}) {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      fail("", `not JSON: ${/** @type {Error} */ (e).message}`, "bad-json");
    }
  }
  const doc = migrateSnapshot(raw, migrations);
  const list = doc.workspaces;
  if (!Array.isArray(list) || list.length === 0) {
    fail("workspaces", "need at least one workspace");
  }
  const ids = new Set();
  const names = new Set();
  const containers = new Set();
  const allTabs = new Set();
  /** @type {Workspace[]} */
  const workspaces = list.map((w, k) => {
    const at = `workspaces[${k}]`;
    if (!isObject(w)) return fail(at, "must be an object");
    if (!isId(w.id) || ids.has(w.id)) fail(`${at}.id`, "missing or duplicate");
    if (typeof w.name !== "string" || !w.name.trim() || names.has(w.name)) {
      fail(`${at}.name`, "empty or duplicate");
    }
    if (!isId(w.container) || containers.has(w.container)) {
      fail(`${at}.container`, "empty or duplicate");
    }
    if (!Array.isArray(w.tabs)) fail(`${at}.tabs`, "must be an array");
    w.tabs.forEach((/** @type {unknown} */ t, i) => {
      if (!isId(t) || allTabs.has(t)) fail(`${at}.tabs[${i}]`, "empty or already open");
      allTabs.add(t);
    });
    ids.add(w.id);
    names.add(w.name);
    containers.add(w.container);
    /** @type {Panes | null} */
    let panes = null;
    if (w.tabs.length === 0) {
      if (w.activeTab !== null) fail(`${at}.activeTab`, "must be null without tabs");
      if (w.panes !== null) fail(`${at}.panes`, "must be null without tabs");
    } else {
      if (!w.tabs.includes(w.activeTab)) fail(`${at}.activeTab`, "must be one of the tabs");
      if (w.panes === null) fail(`${at}.panes`, "a workspace with tabs needs a layout");
      panes = readPanes(w.panes, `${at}.panes`, new Set(w.tabs));
      if (findTab(panes.root, panes.focus) !== w.activeTab) {
        fail(`${at}.activeTab`, "must be the focused pane's tab");
      }
    }
    return Object.freeze({
      id: w.id,
      name: w.name,
      container: w.container,
      tabs: Object.freeze(w.tabs.slice()),
      activeTab: w.activeTab,
      panes,
    });
  });
  if (!ids.has(doc.active)) fail("active", "must name a workspace");
  checkNext(doc.next, ids, "w", "next");
  return Object.freeze({
    workspaces: Object.freeze(workspaces),
    active: doc.active,
    next: doc.next,
  });
}

/**
 * @param {PaneNode} node
 * @param {string} pane
 * @returns {string | undefined}
 */
function findTab(node, pane) {
  if (node.type === "leaf") return node.pane === pane ? node.tab : undefined;
  return node.children.map((c) => findTab(c, pane)).find((t) => t !== undefined);
}
