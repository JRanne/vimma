/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The `prefix+g` goto picker (spec: docs/specs/m2-picker-rename.md) and the `prefix+w`
// workspace picker (docs/specs/m3-workspaces.md, sub-spec 5). A modal <dialog> in the chrome
// document, as the help overlay. Keys reach it only through VimmaHost (`key`), which consumes
// every one while it is open; the logic is core picker.mjs, this only renders it.

import { itemId, openPicker, pickerKey } from "../core/picker.mjs";

/** @import { AnyItem, PickerItem, PickerState, WorkspaceItem } from "../core/picker.mjs" */

export const PICKER_ID = "vimma-picker";
export const WORKSPACE_PICKER_ID = "vimma-workspace-picker";
const STYLESHEET = "chrome://browser/skin/vimma/picker.css";
const HTML_NS = "http://www.w3.org/1999/xhtml";
/** @type {WeakSet<Window>} windows our stylesheet is loaded into */
const styled = new WeakSet();

/**
 * @typedef {object} PickerHost
 * @property {() => AnyItem[]} items  what to list, in order
 * @property {() => string | null} activeId  selected when the picker opens
 * @property {(id: string) => void} select  Enter on a row; the picker has closed already
 * @property {(id: string) => void} [move]  `m` on a workspace row; the picker has closed already
 */

/**
 * What one kind of picker shows: its dialog id, heading, hint, and a row's cells after the index.
 * @typedef {object} PickerLook
 * @property {string} id
 * @property {string} title
 * @property {string} listLabel
 * @property {string} hint
 * @property {(item: any) => [index: string, right: string]} cells
 */

/** @type {PickerLook} */
const GOTO = {
  id: PICKER_ID,
  title: "Go to tab",
  listLabel: "Tabs",
  hint: "j/k move · / search · Enter go · Esc close",
  cells: (/** @type {PickerItem} */ item) => [String(item.tabIndex), hostOf(item.url)],
};

/** @type {PickerLook} */
const WORKSPACES = {
  id: WORKSPACE_PICKER_ID,
  title: "Workspaces",
  listLabel: "Workspaces",
  hint: "j/k move · / search · Enter switch · m move tab here · Esc close",
  cells: (/** @type {WorkspaceItem} */ item) => {
    const tabs = `${item.tabCount} ${item.tabCount === 1 ? "tab" : "tabs"}`;
    const foreign = item.foreignCount ? `, ${item.foreignCount} foreign` : "";
    return [String(item.workspaceIndex), `${tabs}${foreign}${item.active ? " · current" : ""}`];
  },
};

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
   * @param {PickerLook} [look]
   */
  constructor(win, host, look = GOTO) {
    this.win = win;
    this.host = host;
    this.look = look;
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
    this.state = openPicker(this.host.items(), { activeId: this.host.activeId() });
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
      this.host.select(effect.id);
    }
    if (effect?.type === "move") {
      this.close();
      this.host.move?.(effect.id);
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
        row.id = `${this.look.id}-${i}`;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(i === state.selected));
        row.dataset.id = itemId(m.item);
        if ("tabId" in m.item) row.dataset.tabId = m.item.tabId;
        if (m.item.active) row.classList.add("vimma-picker-active");
        const title = el("span", "vimma-picker-title");
        let at = 0;
        for (const [start, end] of m.highlights.display ?? []) {
          title.append(m.item.display.slice(at, start));
          title.append(el("mark", "", m.item.display.slice(start, end)));
          at = end;
        }
        title.append(m.item.display.slice(at));
        const [index, right] = this.look.cells(m.item);
        row.append(
          el("span", "vimma-picker-index", index),
          title,
          el("span", "vimma-picker-host", right),
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
    dialog.id = this.look.id;
    dialog.className = "vimma-picker";
    dialog.tabIndex = -1;
    dialog.setAttribute("aria-label", this.look.title);
    const header = el("header");
    const h1 = el("h1");
    h1.textContent = this.look.title;
    const query = el("span");
    query.className = "vimma-picker-query";
    const hint = el("span");
    hint.className = "vimma-picker-hint";
    hint.textContent = this.look.hint;
    header.append(h1, query, hint);
    const list = el("ul");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", this.look.listLabel);
    dialog.append(header, list);
    doc.body.append(dialog);
    this.dialog = dialog;
    this.query = query;
    this.list = list;
    return dialog;
  }
}

/** `prefix+w`: the workspaces, Enter switches, `m` moves the current tab (m3-workspaces 5). */
export class WorkspacePicker extends GotoPicker {
  /**
   * @param {Window} win  a browser window
   * @param {PickerHost} host
   */
  constructor(win, host) {
    super(win, host, WORKSPACES);
  }
}
