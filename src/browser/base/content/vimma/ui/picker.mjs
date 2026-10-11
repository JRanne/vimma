/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The `prefix+g` goto picker (spec: docs/specs/m2-picker-rename.md) and the `prefix+w`
// workspace picker (docs/specs/m3-workspaces.md, sub-spec 5). A modal <dialog> in the chrome
// document, as the help overlay. Keys reach it only through VimmaHost (`key`), which consumes
// every one while it is open; the logic is core picker.mjs, this only renders it.

import { addonRowText } from "../core/addons.mjs";
import { itemId, openPicker, pickerKey, setPickerItems } from "../core/picker.mjs";

/** @import { AnyItem, AddonOp, PickerItem, PickerState, WorkspaceItem } from "../core/picker.mjs" */
/** @import { AddonItem } from "../core/addons.mjs" */

export const PICKER_ID = "vimma-picker";
export const WORKSPACE_PICKER_ID = "vimma-workspace-picker";
export const ADDON_PICKER_ID = "vimma-addon-picker";
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
 * @property {(op: AddonOp, id: string) => void} [addon]  an add-on key; the picker stays open
 */

/**
 * What one kind of picker shows: its dialog id, heading, hint, and a row's cells after the index.
 * @typedef {object} PickerLook
 * @property {string} id
 * @property {string} title
 * @property {string} listLabel
 * @property {string} hint
 * @property {(item: any) => [index: string, right: string]} cells
 * @property {string} [empty]  the list's one row when there are no items
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
  cells: (/** @type {WorkspaceItem & { countText?: string }} */ item) => {
    // The private workspace's row: its count only, `new` while closed (private-workspace 5).
    if (item.countText !== undefined) {
      return ["", `${item.countText}${item.active ? " · current" : ""}`];
    }
    const tabs = `${item.tabCount} ${item.tabCount === 1 ? "tab" : "tabs"}`;
    const foreign = item.foreignCount ? `, ${item.foreignCount} foreign` : "";
    return [String(item.workspaceIndex), `${tabs}${foreign}${item.active ? " · current" : ""}`];
  },
};

/** @type {PickerLook} docs/specs/addon-manager.md */
const ADDONS = {
  id: ADDON_PICKER_ID,
  title: "Add-ons",
  listLabel: "Add-ons",
  hint: "Enter popup · o options · x on/off · d remove · u update · P private · / search",
  cells: (/** @type {AddonItem} */ item) => [item.enabled ? "●" : "○", addonRowText(item)],
  empty: "No add-ons installed. Get them at addons.mozilla.org.",
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
    // The list, not the dialog: aria-activedescendant names the active row only while the
    // element carrying it has focus (m7-a11y).
    /** @type {HTMLElement} */ (this.list).focus();
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
    if (effect?.type === "addon") this.host.addon?.(effect.op, effect.id);
  }

  /**
   * New rows while open (an add-on toggled); the selected row stays selected if it survives.
   * @param {AnyItem[]} items
   */
  setItems(items) {
    if (!this.state) return;
    this.state = setPickerItems(this.state, items);
    this.render();
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
        if ("enabled" in m.item && !m.item.enabled) row.classList.add("vimma-picker-disabled");
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
    if (!state.items.length && this.look.empty) {
      // Not an option: the listbox is empty, and describes itself with this line.
      const empty = el("li", "vimma-picker-empty", this.look.empty);
      empty.id = `${this.look.id}-empty`;
      empty.setAttribute("role", "none");
      list.append(empty);
      list.setAttribute("aria-describedby", empty.id);
    } else {
      list.removeAttribute("aria-describedby");
    }
    const current = state.matches.length ? list.children[state.selected] : undefined;
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
    dialog.setAttribute("aria-modal", "true");
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
    // Focusable by script only: keys reach the picker through VimmaHost, not Tab.
    list.tabIndex = -1;
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

/**
 * `prefix+e` / `:addons` (docs/specs/addon-manager.md): the installed extensions. AddonManager
 * answers asynchronously, so `load` fetches the rows first and `items` hands them over.
 */
export class AddonPicker extends GotoPicker {
  /**
   * @param {Window} win  a browser window
   * @param {Omit<PickerHost, "items" | "activeId"> & { load: () => Promise<AnyItem[]> }} host
   */
  constructor(win, host) {
    /** @type {AnyItem[]} */
    let rows = [];
    super(win, { ...host, items: () => rows, activeId: () => null }, ADDONS);
    this.load = host.load;
    /** @param {AnyItem[]} next */
    this.setRows = (next) => {
      rows = next;
    };
    /** @type {Promise<void> | null} while the rows load for open() */
    this.opening = null;
  }

  /**
   * Opens once the rows are in. Resolves when it is open (or did not open).
   * @returns {Promise<void>}
   */
  openAsync() {
    if (this.isOpen) return Promise.resolve();
    this.opening ??= this.load()
      .then((rows) => {
        this.setRows(rows);
        super.open();
      })
      .finally(() => {
        this.opening = null;
      });
    return this.opening;
  }

  open() {
    this.openAsync().catch((e) => console.error("vimma: add-on picker", e));
  }

  /**
   * Reloads the rows while open (after `x`, `shift+p`, `u`).
   * @returns {Promise<void>}
   */
  async refresh() {
    const rows = await this.load();
    this.setRows(rows);
    if (this.isOpen) this.setItems(rows);
  }
}
