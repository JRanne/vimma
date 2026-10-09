/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The pane tree (spec m3-m4-core-models): an immutable tree of splits and leaves that the host
 * mirrors onto the split view, one `<browser>` per leaf. Every operation is pure and returns a new
 * frozen state; a no-op returns the input state itself.
 */

/** @typedef {{ readonly type: "leaf", readonly pane: string, readonly tab: string }} Leaf */
/**
 * `axis: "x"` lays children out left → right, `"y"` top → bottom. ≥ 2 children, one ratio each,
 * ratios sum to 1, and no child split has its parent's axis (canonical form).
 * @typedef {{ readonly type: "split", readonly axis: Axis, readonly children: readonly PaneNode[],
 *   readonly ratios: readonly number[] }} Split
 */
/** @typedef {Leaf | Split} PaneNode */
/** @typedef {"x" | "y"} Axis */
/**
 * `next` mints pane ids (`p<next>`).
 * @typedef {{ readonly root: PaneNode, readonly focus: string, readonly zoom: string | null,
 *   readonly next: number }} Panes
 */
/** @typedef {"left" | "down" | "up" | "right"} Direction */
/** @typedef {"vertical" | "horizontal"} SplitDirection */
/** @typedef {"wider" | "narrower" | "taller" | "shorter"} ResizeDirection */
/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */
/** @typedef {{ pane: string, tab: string, rect: Rect }} PaneRect */

/** Smallest share of a split a pane can be resized down to. */
export const MIN_RATIO = 0.1;

export class PaneError extends Error {
  /**
   * @param {"unknown-pane" | "tab-shown" | "last-pane" | "bad-direction" | "bad-amount"} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "PaneError";
    this.code = code;
  }
}

/** @type {Record<SplitDirection, Axis>} */
const SPLIT_AXIS = { vertical: "x", horizontal: "y" };
/** @type {Record<ResizeDirection, [Axis, 1 | -1]>} */
const RESIZE = { wider: ["x", 1], narrower: ["x", -1], taller: ["y", 1], shorter: ["y", -1] };
const DIRECTIONS = ["left", "down", "up", "right"];
const EPS = 1e-9;
const UNIT = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

/**
 * @param {string} pane
 * @param {string} tab
 * @returns {Leaf}
 */
function leafNode(pane, tab) {
  return Object.freeze({ type: "leaf", pane, tab });
}

/**
 * Builds a split in canonical form: a single child is returned as is (sibling promotion) and
 * child splits on the same axis are flattened into this one, scaling their ratios.
 * @param {Axis} axis
 * @param {readonly PaneNode[]} children
 * @param {readonly number[]} ratios
 * @returns {PaneNode}
 */
function makeSplit(axis, children, ratios) {
  if (children.length === 1) return /** @type {PaneNode} */ (children[0]);
  /** @type {PaneNode[]} */
  const kids = [];
  /** @type {number[]} */
  const rs = [];
  children.forEach((c, i) => {
    const r = /** @type {number} */ (ratios[i]);
    if (c.type === "split" && c.axis === axis) {
      kids.push(...c.children);
      rs.push(...c.ratios.map((cr) => cr * r));
    } else {
      kids.push(c);
      rs.push(r);
    }
  });
  return Object.freeze({
    type: "split",
    axis,
    children: Object.freeze(kids),
    ratios: Object.freeze(rs),
  });
}

/**
 * @param {Panes} s
 * @param {Partial<Panes>} changes
 * @returns {Panes}
 */
function update(s, changes) {
  return Object.freeze({ ...s, ...changes });
}

/**
 * Child indices from the root to the leaf showing `paneId`, or null.
 * @param {PaneNode} node
 * @param {string} paneId
 * @returns {number[] | null}
 */
function pathTo(node, paneId) {
  if (node.type === "leaf") return node.pane === paneId ? [] : null;
  for (let i = 0; i < node.children.length; i++) {
    const p = pathTo(/** @type {PaneNode} */ (node.children[i]), paneId);
    if (p) return [i, ...p];
  }
  return null;
}

/**
 * @param {Panes} s
 * @param {string} paneId
 * @returns {number[]}
 */
function mustPath(s, paneId) {
  const p = pathTo(s.root, paneId);
  if (!p) throw new PaneError("unknown-pane", `no pane "${paneId}"`);
  return p;
}

/**
 * @param {PaneNode} node
 * @param {readonly number[]} path
 * @returns {PaneNode}
 */
function nodeAt(node, path) {
  let n = node;
  for (const i of path) n = /** @type {PaneNode} */ (/** @type {Split} */ (n).children[i]);
  return n;
}

/**
 * Replaces the node at `path`, rebuilding (and re-canonicalising) every ancestor.
 * @param {PaneNode} node
 * @param {readonly number[]} path
 * @param {PaneNode} replacement
 * @returns {PaneNode}
 */
function replaceAt(node, path, replacement) {
  if (path.length === 0) return replacement;
  const split = /** @type {Split} */ (node);
  const [i, ...rest] = path;
  const children = split.children.slice();
  children[/** @type {number} */ (i)] = replaceAt(
    /** @type {PaneNode} */ (children[/** @type {number} */ (i)]),
    rest,
    replacement,
  );
  return makeSplit(split.axis, children, split.ratios);
}

/**
 * @param {PaneNode} node
 * @returns {Leaf}
 */
function firstLeaf(node) {
  return node.type === "leaf" ? node : firstLeaf(/** @type {PaneNode} */ (node.children[0]));
}

/**
 * One pane, `p1`, showing `tabId`.
 * @param {string} tabId
 * @returns {Panes}
 */
export function createPanes(tabId) {
  return Object.freeze({ root: leafNode("p1", tabId), focus: "p1", zoom: null, next: 2 });
}

/**
 * Leaves in reading order.
 * @param {Panes} s
 * @returns {Leaf[]}
 */
export function leaves(s) {
  /** @type {Leaf[]} */
  const out = [];
  /** @param {PaneNode} n */
  const walk = (n) => (n.type === "leaf" ? out.push(n) : n.children.forEach(walk));
  walk(s.root);
  return out;
}

/**
 * @param {Panes} s
 * @param {string} tabId
 * @returns {string | undefined}
 */
export function paneOfTab(s, tabId) {
  return leaves(s).find((l) => l.tab === tabId)?.pane;
}

/**
 * Splits `paneId`; the new pane shows `newTabId`, goes right after it and gets focus.
 * `vertical` = split right (`:vsplit`), `horizontal` = split down (`:split`).
 * @param {Panes} s
 * @param {string} paneId
 * @param {SplitDirection} direction
 * @param {string} newTabId
 * @returns {Panes}
 */
export function split(s, paneId, direction, newTabId) {
  const axis = SPLIT_AXIS[direction];
  if (!axis) throw new PaneError("bad-direction", `bad split direction "${direction}"`);
  const path = mustPath(s, paneId);
  if (paneOfTab(s, newTabId) !== undefined) {
    throw new PaneError("tab-shown", `tab "${newTabId}" is already shown in a pane`);
  }
  const id = `p${s.next}`;
  const fresh = leafNode(id, newTabId);
  const leaf = nodeAt(s.root, path);
  const parentPath = path.slice(0, -1);
  const parent = path.length ? /** @type {Split} */ (nodeAt(s.root, parentPath)) : null;
  let root;
  if (parent && parent.axis === axis) {
    const i = /** @type {number} */ (path[path.length - 1]);
    const half = /** @type {number} */ (parent.ratios[i]) / 2;
    const children = parent.children.slice();
    const ratios = parent.ratios.slice();
    children.splice(i + 1, 0, fresh);
    ratios.splice(i, 1, half, half);
    root = replaceAt(s.root, parentPath, makeSplit(axis, children, ratios));
  } else {
    root = replaceAt(s.root, path, makeSplit(axis, [leaf, fresh], [0.5, 0.5]));
  }
  return update(s, { root, focus: id, zoom: null, next: s.next + 1 });
}

/**
 * Removes a pane; its share goes to the previous sibling (the next one if it was first). A split
 * left with one child is replaced by it. Focus, if it was here, goes to the absorbing sibling.
 * @param {Panes} s
 * @param {string} paneId
 * @returns {Panes}
 */
export function closePane(s, paneId) {
  const path = mustPath(s, paneId);
  if (path.length === 0) throw new PaneError("last-pane", "cannot close the last pane");
  const parentPath = path.slice(0, -1);
  const parent = /** @type {Split} */ (nodeAt(s.root, parentPath));
  const i = /** @type {number} */ (path[path.length - 1]);
  const children = parent.children.filter((_, k) => k !== i);
  const ratios = parent.ratios.filter((_, k) => k !== i);
  const j = i > 0 ? i - 1 : 0;
  ratios[j] = /** @type {number} */ (ratios[j]) + /** @type {number} */ (parent.ratios[i]);
  const absorber = /** @type {PaneNode} */ (children[j]);
  const root = replaceAt(s.root, parentPath, makeSplit(parent.axis, children, ratios));
  const focus = s.focus === paneId ? firstLeaf(absorber).pane : s.focus;
  return update(s, { root, focus, zoom: null });
}

/**
 * @param {PaneNode} node
 * @param {Rect} rect
 * @param {PaneRect[]} out
 */
function layoutNode(node, rect, out) {
  if (node.type === "leaf") {
    out.push({ pane: node.pane, tab: node.tab, rect });
    return;
  }
  const horizontal = node.axis === "x";
  const start = horizontal ? rect.x : rect.y;
  const size = horizontal ? rect.width : rect.height;
  const n = node.children.length;
  const edges = [start];
  let cum = 0;
  for (let i = 0; i < n - 1; i++) {
    cum += /** @type {number} */ (node.ratios[i]);
    edges.push(start + size * cum);
  }
  edges.push(start + size);
  node.children.forEach((child, i) => {
    const a = /** @type {number} */ (edges[i]);
    const b = /** @type {number} */ (edges[i + 1]);
    layoutNode(
      child,
      horizontal
        ? { x: a, y: rect.y, width: b - a, height: rect.height }
        : { x: rect.x, y: a, width: rect.width, height: b - a },
      out,
    );
  });
}

/**
 * Pane rectangles inside `rect`, in reading order. A zoomed state yields the zoomed pane alone.
 * @param {Panes} s
 * @param {Rect} rect
 * @returns {PaneRect[]}
 */
export function layout(s, rect) {
  const r = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  if (s.zoom !== null) {
    const leaf = /** @type {Leaf} */ (nodeAt(s.root, mustPath(s, s.zoom)));
    return [{ pane: leaf.pane, tab: leaf.tab, rect: r }];
  }
  /** @type {PaneRect[]} */
  const out = [];
  layoutNode(s.root, r, out);
  return out;
}

/**
 * The pane just past the focused pane's `direction` edge, in line with its top (left/right) or
 * left (up/down) edge, as tmux does. Undefined when the focused pane is at the window's edge.
 * @param {Panes} s
 * @param {Direction} direction
 * @returns {string | undefined}
 */
function neighbour(s, direction) {
  if (!DIRECTIONS.includes(direction)) {
    throw new PaneError("bad-direction", `bad direction "${direction}"`);
  }
  const rects = layout(update(s, { zoom: null }), UNIT);
  const a = /** @type {PaneRect} */ (rects.find((r) => r.pane === s.focus)).rect;
  const across = direction === "left" || direction === "right";
  /** @param {Rect} b */
  const touches = (b) => {
    switch (direction) {
      case "left":
        return Math.abs(b.x + b.width - a.x) < EPS;
      case "right":
        return Math.abs(a.x + a.width - b.x) < EPS;
      case "up":
        return Math.abs(b.y + b.height - a.y) < EPS;
      default:
        return Math.abs(a.y + a.height - b.y) < EPS;
    }
  };
  // on the other axis: [start, end) of a candidate must contain the focused pane's start
  /** @param {Rect} b */
  const inLine = (b) => {
    const [b0, b1, a0] = across ? [b.y, b.y + b.height, a.y] : [b.x, b.x + b.width, a.x];
    return b0 <= a0 + EPS && a0 < b1 - EPS;
  };
  return rects.find((r) => r.pane !== s.focus && touches(r.rect) && inLine(r.rect))?.pane;
}

/**
 * Moves focus to the geometric neighbour; no neighbour (no wrap) → unchanged.
 * @param {Panes} s
 * @param {Direction} direction
 * @returns {Panes}
 */
export function focus(s, direction) {
  const target = neighbour(s, direction);
  return target === undefined ? s : update(s, { focus: target, zoom: null });
}

/**
 * @param {Panes} s
 * @param {string} paneId
 * @returns {Panes}
 */
export function focusPane(s, paneId) {
  mustPath(s, paneId);
  return s.focus === paneId && s.zoom === null ? s : update(s, { focus: paneId, zoom: null });
}

/**
 * Exchanges the focused leaf with its neighbour; focus stays on the (moved) pane.
 * @param {Panes} s
 * @param {Direction} direction
 * @returns {Panes}
 */
export function swap(s, direction) {
  const other = neighbour(s, direction);
  if (other === undefined) return s;
  const pa = mustPath(s, s.focus);
  const pb = mustPath(s, other);
  const a = nodeAt(s.root, pa);
  const b = nodeAt(s.root, pb);
  const root = replaceAt(replaceAt(s.root, pa, b), pb, a);
  return update(s, { root, zoom: null });
}

/**
 * Zooms the focused pane, or unzooms.
 * @param {Panes} s
 * @returns {Panes}
 */
export function toggleZoom(s) {
  return update(s, { zoom: s.zoom === null ? s.focus : null });
}

/**
 * Grows or shrinks the focused pane's share of its nearest ancestor split on the matching axis,
 * trading with the next sibling (previous if last). Both stay ≥ MIN_RATIO; the change is clamped.
 * @param {Panes} s
 * @param {ResizeDirection} direction
 * @param {number} amount a share of the split, e.g. 0.05
 * @returns {Panes}
 */
export function resize(s, direction, amount) {
  const spec = RESIZE[direction];
  if (!spec) throw new PaneError("bad-direction", `bad resize direction "${direction}"`);
  if (!(amount > 0 && Number.isFinite(amount))) {
    throw new PaneError("bad-amount", `resize amount must be positive, got ${amount}`);
  }
  const [axis, sign] = spec;
  const path = mustPath(s, s.focus);
  const unzoomed = s.zoom === null ? s : update(s, { zoom: null });
  for (let k = path.length - 1; k >= 0; k--) {
    const at = path.slice(0, k);
    const node = /** @type {Split} */ (nodeAt(s.root, at));
    if (node.axis !== axis) continue;
    const i = /** @type {number} */ (path[k]);
    const j = i < node.ratios.length - 1 ? i + 1 : i - 1;
    const ri = /** @type {number} */ (node.ratios[i]);
    const rj = /** @type {number} */ (node.ratios[j]);
    let ni = ri + sign * amount;
    let nj = rj - sign * amount;
    if (nj < MIN_RATIO) [ni, nj] = [ri + rj - MIN_RATIO, MIN_RATIO];
    if (ni < MIN_RATIO) [ni, nj] = [MIN_RATIO, ri + rj - MIN_RATIO];
    // never move the wrong way (a pane already below MIN_RATIO after splits) or past the pair
    if (sign * (ni - ri) <= 0 || ni < MIN_RATIO || nj < MIN_RATIO) return unzoomed;
    const ratios = node.ratios.slice();
    ratios[i] = ni;
    ratios[j] = nj;
    const root = replaceAt(s.root, at, makeSplit(axis, node.children, ratios));
    return update(s, { root, zoom: null });
  }
  return unzoomed;
}

/**
 * Shows another tab in a pane (switching tabs in the focused pane).
 * @param {Panes} s
 * @param {string} paneId
 * @param {string} tabId
 * @returns {Panes}
 */
export function setPaneTab(s, paneId, tabId) {
  const path = mustPath(s, paneId);
  const leaf = /** @type {Leaf} */ (nodeAt(s.root, path));
  if (leaf.tab === tabId) return s;
  if (paneOfTab(s, tabId) !== undefined) {
    throw new PaneError("tab-shown", `tab "${tabId}" is already shown in a pane`);
  }
  return update(s, { root: replaceAt(s.root, path, leafNode(paneId, tabId)) });
}
