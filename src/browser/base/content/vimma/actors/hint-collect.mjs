/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Link-hint target collection in one frame (spec: docs/specs/m1-hints.md). Runs in the content
// process, in VimmaChild. Finds what a user could click in the viewport, skips what is hidden or
// covered, and reports subframes so the parent can ask their own child.

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */
/** @typedef {"link" | "input" | "click"} TargetKind */
/**
 * @typedef {object} Found
 * @property {Element} el
 * @property {Rect} rect      viewport-clipped, in this frame's CSS pixels
 * @property {TargetKind} kind
 * @property {string} [href]  links only
 */
/** @typedef {{ bc: any, rect: Rect }} FoundFrame */

/** At most this many targets per frame; the rest are dropped. */
export const MAX_TARGETS = 5000;

/**
 * Hintable by what they are: the HTML and ARIA vocabulary Vimium (`LocalHints.isClickable`) and
 * Tridactyl (`DOM.HINTTAGS_selectors`) both use. `[contenteditable]` is filtered to roots below.
 */
const STRONG = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[contenteditable]:not([contenteditable=false])",
].join(",");

/** Hintable by a hint of behaviour; dropped inside another target, so a link's span is not. */
const WEAK = [
  "label",
  "[onclick]",
  "[onmousedown]",
  "[tabindex]:not([tabindex^='-'])",
  ...[
    "button",
    "link",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "treeitem",
    "combobox",
    "textbox",
    "searchbox",
  ].map((r) => `[role=${r}]`),
].join(",");

const LINKS = "a[href]";

/** Listener types that make an element clickable (Tridactyl watches addEventListener for these). */
const LISTENER_TYPES = ["click", "mousedown"];

/** Elements a listener never makes a target: delegation roots (React, jQuery `on`). */
const NEVER = new Set(["html", "body", "head", "script", "style", "iframe", "frame"]);

/** Inputs that take text: a hint focuses them (insert) instead of clicking. */
const TEXTLESS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * @param {Element} el
 * @returns {TargetKind}
 */
function kindOf(el) {
  const name = el.localName;
  if (name === "a") return "link";
  if (name === "textarea" || name === "select") return "input";
  if (name === "input")
    return TEXTLESS.has(/** @type {HTMLInputElement} */ (el).type) ? "click" : "input";
  if (/** @type {HTMLElement} */ (el).isContentEditable) return "input";
  return "click";
}

/**
 * The first box of `el` that shows in the viewport, clipped to it; for an inline link that
 * wraps, the first line on screen. An anchor with no box of its own (a floated image inside)
 * uses its first child's.
 * @param {Element} el
 * @param {number} vw
 * @param {number} vh
 * @returns {Rect | null}
 */
function visibleRect(el, vw, vh) {
  for (const source of [el, el.firstElementChild]) {
    if (!source) continue;
    for (const r of source.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      const x = Math.max(r.left, 0);
      const y = Math.max(r.top, 0);
      const right = Math.min(r.right, vw);
      const bottom = Math.min(r.bottom, vh);
      if (right - x >= 1 && bottom - y >= 1) return { x, y, width: right - x, height: bottom - y };
    }
  }
  return null;
}

/**
 * Whether a click at some point of `rect` lands on `el`: the centre, then the four corners
 * one pixel in. A fixed header or a modal over it fails all five.
 * @param {Element} el
 * @param {Rect} rect
 */
function unoccluded(el, rect) {
  const root = /** @type {Document | ShadowRoot} */ (el.getRootNode());
  const { x, y, width: w, height: h } = rect;
  const points = [
    [x + w / 2, y + h / 2],
    [x + 1, y + 1],
    [x + w - 1, y + 1],
    [x + 1, y + h - 1],
    [x + w - 1, y + h - 1],
  ];
  for (const [px, py] of points) {
    const hit = root.elementFromPoint(/** @type {number} */ (px), /** @type {number} */ (py));
    if (hit && (hit === el || el.contains(hit))) return true;
  }
  return false;
}

/**
 * @param {Element} el
 * @param {Set<Element>} candidates
 */
function insideCandidate(el, candidates) {
  for (let p = parentOf(el); p; p = parentOf(p)) if (candidates.has(p)) return true;
  return false;
}

/**
 * @param {Element} el
 * @returns {Element | null}
 */
function parentOf(el) {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return "host" in root ? /** @type {ShadowRoot} */ (root).host : null;
}

/**
 * The hint targets of one frame, in no particular order (core orders them), and its visible
 * subframes.
 * @param {Window} win  the frame's content window
 * @param {{ linksOnly: boolean }} options  `F` hints links only
 * @returns {{ targets: Found[], frames: FoundFrame[] }}
 */
export function collectTargets(win, { linksOnly }) {
  const doc = win.document;
  const vw = doc.documentElement?.clientWidth || win.innerWidth;
  const vh = doc.documentElement?.clientHeight || win.innerHeight;
  const els = Services.els;

  /** @type {Set<Element>} */
  const strong = new Set();
  /** @type {Set<Element>} */
  const weak = new Set();
  /** @type {Element[]} */
  const frameEls = [];

  // One pass per tree: the document, then every open or closed shadow root found in it.
  /** @type {(Document | ShadowRoot)[]} */
  const roots = [doc];
  for (let i = 0; i < roots.length; i++) {
    const root = /** @type {Document | ShadowRoot} */ (roots[i]);
    for (const el of root.querySelectorAll(linksOnly ? LINKS : STRONG)) strong.add(el);
    if (!linksOnly) for (const el of root.querySelectorAll(WEAK)) weak.add(el);
    for (const el of root.querySelectorAll("*")) {
      const shadow = el.openOrClosedShadowRoot;
      if (shadow) roots.push(shadow);
      const name = el.localName;
      if (name === "iframe" || name === "frame") frameEls.push(el);
      else if (!linksOnly && !NEVER.has(name) && !strong.has(el) && !weak.has(el)) {
        for (const type of LISTENER_TYPES) {
          if (els.hasListenersFor(el, type)) {
            weak.add(el);
            break;
          }
        }
      }
    }
  }

  /** @type {Set<Element>} */
  const all = new Set([...strong, ...weak]);
  /** @type {Found[]} */
  const targets = [];
  /** @type {Set<Element>} */
  const shown = new Set();
  /** @type {Element[]} */
  const labels = [];
  for (const el of all) {
    if (targets.length >= MAX_TARGETS) break;
    const isStrong = strong.has(el);
    if (!isStrong && insideCandidate(el, all)) continue;
    if (
      el.localName !== "a" &&
      /** @type {HTMLElement} */ (el).isContentEditable &&
      /** @type {HTMLElement} */ (parentOf(el))?.isContentEditable
    ) {
      continue; // only the editing host of a contenteditable region
    }
    const rect = visibleRect(el, vw, vh);
    if (!rect) continue;
    if (!el.checkVisibility({ visibilityProperty: true })) continue;
    if (/** @type {HTMLInputElement} */ (el).disabled) continue;
    if (!unoccluded(el, rect)) continue;
    /** @type {Found} */
    const found = { el, rect, kind: kindOf(el) };
    if (found.kind === "link") found.href = /** @type {HTMLAnchorElement} */ (el).href;
    targets.push(found);
    shown.add(el);
    if (el.localName === "label") labels.push(el);
  }
  // A label next to its visible control is a second hint for the same thing; keep the control.
  const dropped = new Set(
    labels.filter((l) => {
      const control = /** @type {HTMLLabelElement} */ (l).control;
      return control && shown.has(control);
    }),
  );
  const kept = dropped.size ? targets.filter((t) => !dropped.has(t.el)) : targets;

  /** @type {FoundFrame[]} */
  const frames = [];
  for (const el of frameEls) {
    const bc = /** @type {any} */ (el).browsingContext;
    if (!bc) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
    if (!el.checkVisibility({ visibilityProperty: true })) continue;
    // The frame's viewport starts inside its border and padding.
    const style = win.getComputedStyle(el);
    const pl = parseFloat(style.paddingLeft) || 0;
    const pt = parseFloat(style.paddingTop) || 0;
    const width = el.clientWidth - pl - (parseFloat(style.paddingRight) || 0);
    const height = el.clientHeight - pt - (parseFloat(style.paddingBottom) || 0);
    if (width < 1 || height < 1) continue;
    frames.push({
      bc,
      rect: { x: r.left + el.clientLeft + pl, y: r.top + el.clientTop + pt, width, height },
    });
  }
  return { targets: kept, frames };
}
