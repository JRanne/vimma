/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The pane keys (docs/specs/m4-split-panes.md, sub-specs 3 and 5) over the window's PaneView
// (split/PaneView.mjs), and the tiling layouts (docs/specs/tiling-layouts.md). Each returns the
// text to show (a refusal, or a layout's name), or null.

import { closest, describeAction } from "../core/actions.mjs";
import { LAYOUTS, isLayoutName, layoutOfAction } from "../core/layouts.mjs";
import { PaneViews } from "../split/PaneView.mjs";
import { closeTab } from "./tab-ops.mjs";

/** @import { Action } from "../core/dispatcher.mjs" */
/** @import { Direction, ResizeDirection } from "../core/panes.mjs" */
/** @import { PaneResult } from "../split/PaneView.mjs" */

/** One resize key's step: a share of the split (m3-m4-core-models, For the host specs). */
export const RESIZE_STEP = 0.05;

/** @param {Window} win */
function gBrowserOf(win) {
  return /** @type {{ gBrowser: { selectedBrowser: Element & { focus(): void } } }} */ (
    /** @type {unknown} */ (win)
  ).gBrowser;
}

/**
 * Whether the window shows two panes or more: the <C-w> family is runnable only then, so with
 * one pane the first ctrl+w still passes to Firefox and closes the tab (plan §2).
 * @param {Window} win
 */
export function hasPanes(win) {
  return !!PaneViews.get(win)?.panes;
}

/**
 * tmux: moving to a pane focuses its page. Firefox's tab switch would otherwise restore the URL
 * bar if that tab last had it, or leave focus where it was. A tab-modal dialog keeps its focus.
 * @param {Window} win
 */
function focusPage(win) {
  const browser = gBrowserOf(win).selectedBrowser;
  if (!browser.hasAttribute("tabDialogShowing")) browser.focus();
}

/**
 * @param {Action} action
 * @param {PaneResult | undefined} result
 * @returns {string | null}
 */
function refusal(action, result) {
  return result && !result.ok ? `${describeAction(action)}: ${result.reason}` : null;
}

/**
 * pane.split_vertical / pane.split_horizontal: a new pane with a new tab (the start page) right
 * of or below the focused one, focused, its URL bar ready for an address as after ctrl+b c.
 * @param {Window} win
 * @param {Action} action
 */
export function splitPane(win, action) {
  const view = PaneViews.get(win);
  const direction = action.id === "pane.split_vertical" ? "vertical" : "horizontal";
  const result = view?.split(direction);
  if (result?.ok) /** @type {any} */ (win).gURLBar?.select();
  return refusal(action, result);
}

/**
 * pane.new (`prefix+enter`, docs/specs/tiling-layouts.md): a new pane without a direction,
 * along the focused pane's longer side (`[panes] layout = "dwindle"`) or right ("manual"); as
 * split_vertical / split_horizontal otherwise.
 * @param {Window} win
 * @param {Action} action
 */
export function newPane(win, action) {
  const result = PaneViews.get(win)?.newPane();
  if (result?.ok) /** @type {any} */ (win).gURLBar?.select();
  return refusal(action, result);
}

/**
 * pane.next_layout (`prefix+space`, `:layout`), pane.select_layout (`:layout <name>`) and
 * pane.layout_<preset>: rearranges the panes, focuses the focused pane's page as after a move,
 * and returns what the notice says: `layout: <name>`, or the refusal.
 * @param {Window} win
 * @param {Action} action
 * @param {string} [text]  `:layout`'s name
 * @returns {string}
 */
export function layoutPanes(win, action, text) {
  const view = PaneViews.get(win);
  if (!view?.panes) return `${describeAction(action)}: only one pane`;
  /** @type {import("../core/layouts.mjs").LayoutName | undefined} */
  let name = layoutOfAction(action.id);
  if (action.id === "pane.select_layout") {
    const typed = (text ?? "").trim();
    if (!isLayoutName(typed)) {
      const near = closest(typed, LAYOUTS);
      return `no layout "${typed}"${near ? ` (did you mean "${near}"?)` : ""}`;
    }
    name = typed;
  }
  const result = name ? view.arrange(name) : view.nextLayout();
  if (!result.ok) return /** @type {string} */ (refusal(action, result));
  focusPage(win);
  return `layout: ${view.panes?.layout ?? name}`;
}

/**
 * pane.focus_left / _down / _up / _right: the geometric neighbour (core breaks ties by MRU); no
 * neighbour, or one pane, changes nothing. A move unzooms (core); none keeps the zoom.
 * @param {Window} win
 * @param {Action} action
 */
export function focusPane(win, action) {
  const view = PaneViews.get(win);
  if (!view?.panes) return null;
  const direction = /** @type {Direction} */ (action.id.slice("pane.focus_".length));
  const result = view.focus(direction);
  if (result.ok) focusPage(win);
  return refusal(action, result);
}

/**
 * pane.zoom: the focused pane fills the content area, or the layout comes back.
 * @param {Window} win
 * @param {Action} action
 */
export function zoomPane(win, action) {
  const view = PaneViews.get(win);
  if (!view?.panes) return null;
  return refusal(action, view.zoom());
}

/**
 * pane.close (`prefix+x`, `:q`): closes the focused pane, whose tab stays open; the last pane
 * closes the tab, with tab.close's rules (a pinned tab selects the first unpinned one).
 * @param {Window} win
 * @param {Action} action
 */
export function closePane(win, action) {
  const view = PaneViews.get(win);
  if (!view?.panes) {
    closeTab(win);
    return null;
  }
  const result = view.close();
  if (result.ok) focusPage(win);
  return refusal(action, result);
}

/**
 * pane.swap_left / _down / _up / _right: the focused pane trades places with its neighbour and
 * keeps focus; no neighbour changes nothing.
 * @param {Window} win
 * @param {Action} action
 */
export function swapPane(win, action) {
  const view = PaneViews.get(win);
  if (!view?.panes) return null;
  const direction = /** @type {Direction} */ (action.id.slice("pane.swap_".length));
  const result = view.swapPane(direction);
  if (result.ok) focusPage(win);
  return refusal(action, result);
}

/**
 * pane.resize_wider / _narrower / _taller / _shorter (resize mode, <C-w> <>+-): one step per
 * key, `count` steps after a count (3l, 3<C-w>>).
 * @param {Window} win
 * @param {Action} action
 */
export function resizePane(win, action) {
  const view = PaneViews.get(win);
  if (!view?.panes) return null;
  const direction = /** @type {ResizeDirection} */ (action.id.slice("pane.resize_".length));
  return refusal(action, view.resize(direction, RESIZE_STEP * (action.count ?? 1)));
}
