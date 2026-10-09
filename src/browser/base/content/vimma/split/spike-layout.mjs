/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// SPIKE (docs/specs/m4-split-panes.md, sub-spec 1; ADR-013). Not wired into the host: only
// browser_vimma_split_contract.js imports it. It proves that our own sheet can place Firefox's
// split-view panels at core layout() rectangles. Sub-spec 2 replaces it with split/PaneView.mjs
// and split.css; delete this file and split-spike.css then.

const STYLESHEET = "chrome://browser/skin/vimma/split-spike.css";
export const PANES_ATTR = "vimma-panes";
export const ZOOMED_AWAY_ATTR = "vimma-zoomed-away";
const PROPS = /** @type {const} */ ([
  ["--vimma-pane-x", "x"],
  ["--vimma-pane-y", "y"],
  ["--vimma-pane-w", "width"],
  ["--vimma-pane-h", "height"],
]);

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */
/** @typedef {{ linkedPanel: string }} PanelTab */

/** @type {WeakSet<Window>} windows the sheet is loaded into (loading it twice throws) */
const styled = new WeakSet();

/**
 * Positions each tab's panel at its rectangle, in CSS px relative to #tabbrowser-tabpanels.
 * Panels of tabs not in `rects` keep Firefox's styling.
 * @param {Window} win
 * @param {Map<PanelTab, Rect>} rects
 */
export function applyLayout(win, rects) {
  if (!styled.has(win)) {
    win.windowUtils.loadSheetUsingURIString(STYLESHEET, win.windowUtils.AUTHOR_SHEET);
    styled.add(win);
  }
  const doc = win.document;
  const panels = /** @type {Element} */ (doc.getElementById("tabbrowser-tabpanels"));
  panels.toggleAttribute(PANES_ATTR, true);
  for (const [tab, rect] of rects) {
    const panel = /** @type {HTMLElement | null} */ (doc.getElementById(tab.linkedPanel));
    if (!panel) continue;
    for (const [prop, key] of PROPS) panel.style.setProperty(prop, `${rect[key]}px`);
  }
}

/**
 * Zooms one tab's panel to the whole area; every other positioned panel is visually hidden but
 * keeps its frame. `null` unzooms.
 * @param {Window} win
 * @param {PanelTab | null} zoomed
 * @param {PanelTab[]} tabs  every tab of the split
 * @param {Rect} area  the full rectangle the zoomed panel gets
 * @param {Map<PanelTab, Rect>} rects  the unzoomed layout
 */
export function setZoom(win, zoomed, tabs, area, rects) {
  const doc = win.document;
  for (const tab of tabs) {
    const panel = doc.getElementById(tab.linkedPanel);
    panel?.toggleAttribute(ZOOMED_AWAY_ATTR, zoomed !== null && tab !== zoomed);
  }
  applyLayout(win, zoomed ? new Map([[zoomed, area]]) : rects);
}

/**
 * Removes our attribute and custom properties.
 * @param {Window} win
 * @param {PanelTab[]} tabs
 */
export function clearLayout(win, tabs) {
  const doc = win.document;
  doc.getElementById("tabbrowser-tabpanels")?.removeAttribute(PANES_ATTR);
  for (const tab of tabs) {
    const panel = /** @type {HTMLElement | null} */ (doc.getElementById(tab.linkedPanel));
    if (!panel) continue;
    panel.removeAttribute(ZOOMED_AWAY_ATTR);
    for (const [prop] of PROPS) panel.style.removeProperty(prop);
  }
}
