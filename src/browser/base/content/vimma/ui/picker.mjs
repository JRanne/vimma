/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The `prefix+g` goto picker (spec: docs/specs/m2-picker-rename.md). A modal <dialog> in the
// chrome document, as the help overlay. Keys reach it only through VimmaHost (`key`), which
// consumes every one while it is open; the logic is core picker.mjs, this only renders it.

import { openPicker, pickerKey } from "../core/picker.mjs";

/** @import { PickerItem, PickerState } from "../core/picker.mjs" */

export const PICKER_ID = "vimma-picker";
const STYLESHEET = "chrome://browser/skin/vimma/picker.css";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const HINT = "j/k move · / search · Enter go · Esc close";
/** @type {WeakSet<Window>} windows our stylesheet is loaded into */
const styled = new WeakSet();

/**
 * @typedef {object} PickerHost
 * @property {() => PickerItem[]} items  the tabs to list, in order
 * @property {() => string | null} activeTabId  selected when the picker opens
 * @property {(tabId: string) => void} select  Enter on a row; the picker has closed already
 */

/**
 * The host of a URL, or the URL itself when it has none (about:, data:).
 * @param {string} url
 */
function hostOf(url) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export class GotoPicker {
  /**
   * @param {Window} win  a browser window
   * @param {PickerHost} host
   */
  constructor(win, host) {
    this.win = win;
    this.host = host;
    /** @type {HTMLDialogElement | null} */
    this.dialog = null;
    /** @type {HTMLElement | null} */
    this.query = null;
    /** @type {HTMLElement | null} */
    this.list = null;
    /** @type {PickerState | null} */
    this.state = null;
    /** @type {Element | null} focused before open; close() falls back if it is gone */
    this.opener = null;
  }

  get isOpen() {
    return !!this.dialog?.open;
  }

  open() {
    if (this.isOpen) return;
    this.opener = Services.focus.focusedElement;
    const dialog = this.dialog ?? this.build();
    this.state = openPicker(this.host.items(), { activeTabId: this.host.activeTabId() });
    this.render();
    dialog.showModal();
    dialog.focus();
  }

  /**
   * One key, as formatKey writes it.
   * @param {string} key
   */
  key(key) {
    if (!this.state) return;
    const { state, effect } = pickerKey(this.state, key);
    if (state !== this.state) {
      this.state = state;
      this.render();
    }
    if (effect?.type === "close") this.close();
    if (effect?.type === "select") {
      this.close();
      this.host.select(effect.tabId);
    }
  }

  /**
   * As HelpOverlay.close: focus returns where it was, or to the selected browser when the tab
   * changed underneath or that element is gone.
   * @param {{ tabChanged?: boolean }} [options]
   */
  close({ tabChanged = false } = {}) {
    if (!this.isOpen) return;
    /** @type {HTMLDialogElement} */ (this.dialog).close();
    this.state = null;
    const opener = this.opener;
    this.opener = null;
    if (tabChanged || !opener?.isConnected) {
      /** @type {{ gBrowser?: { selectedBrowser: HTMLElement } }} */ (
        /** @type {unknown} */ (this.win)
      ).gBrowser?.selectedBrowser.focus();
    }
  }

  /** Close and remove the dialog (VimmaHost.uninit). */
  destroy() {
    this.close();
    this.dialog?.remove();
    this.dialog = this.query = this.list = null;
  }

  /** @private */
  render() {
    const state = /** @type {PickerState} */ (this.state);
    const doc = this.win.document;
    const query = /** @type {HTMLElement} */ (this.query);
    const searching = state.mode === "search" || state.query !== "";
    query.textContent = searching ? `/${state.query}` : "";
    query.hidden = !searching;
    /** @type {HTMLElement} */ (query.nextElementSibling).hidden = searching;

    /**
     * @param {string} tag
     * @param {string} className
     * @param {string} [text]
     */
    const el = (tag, className, text = "") => {
      const node = /** @type {HTMLElement} */ (doc.createElementNS(HTML_NS, tag));
      node.className = className;
      node.textContent = text;
      return node;
    };
    const list = /** @type {HTMLElement} */ (this.list);
    list.replaceChildren(
      ...state.matches.map((m, i) => {
        const row = el("li", "vimma-picker-row");
        row.id = `${PICKER_ID}-${i}`;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(i === state.selected));
        row.dataset.tabId = m.item.tabId;
        const title = el("span", "vimma-picker-title");
        let at = 0;
        for (const [start, end] of m.highlights.display ?? []) {
          title.append(m.item.display.slice(at, start));
          title.append(el("mark", "", m.item.display.slice(start, end)));
          at = end;
        }
        title.append(m.item.display.slice(at));
        row.append(
          el("span", "vimma-picker-index", String(m.item.tabIndex)),
          title,
          el("span", "vimma-picker-host", hostOf(m.item.url)),
        );
        return row;
      }),
    );
    const current = list.children[state.selected];
    if (current) {
      list.setAttribute("aria-activedescendant", current.id);
      current.scrollIntoView({ block: "nearest" });
    } else {
      list.removeAttribute("aria-activedescendant");
    }
  }

  /**
   * @private
   * @returns {HTMLDialogElement}
   */
  build() {
    const doc = this.win.document;
    if (!styled.has(this.win)) {
      this.win.windowUtils.loadSheetUsingURIString(STYLESHEET, this.win.windowUtils.AUTHOR_SHEET);
      styled.add(this.win);
    }
    /** @param {string} tag */
    const el = (tag) => /** @type {HTMLElement} */ (doc.createElementNS(HTML_NS, tag));

    const dialog = /** @type {HTMLDialogElement} */ (el("dialog"));
    dialog.id = PICKER_ID;
    dialog.tabIndex = -1;
    dialog.setAttribute("aria-label", "Go to tab");
    const header = el("header");
    const h1 = el("h1");
    h1.textContent = "Go to tab";
    const query = el("span");
    query.className = "vimma-picker-query";
    const hint = el("span");
    hint.className = "vimma-picker-hint";
    hint.textContent = HINT;
    header.append(h1, query, hint);
    const list = el("ul");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Tabs");
    dialog.append(header, list);
    doc.body.append(dialog);
    this.dialog = dialog;
    this.query = query;
    this.list = list;
    return dialog;
  }
}
