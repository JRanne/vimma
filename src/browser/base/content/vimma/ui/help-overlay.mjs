/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The `prefix+?` bindings overlay (spec: docs/specs/m0-help-overlay.md). A modal <dialog> in the
// chrome document, so it sits above every page: about:preferences, pdf.js, remote content.
// Keys reach it only through VimmaHost; it owns no key handling of its own.

import { bindingTable, filterBindings } from "../core/help.mjs";

/** @import { Keymap } from "../core/keymap.mjs" */
/** @import { BindingRow } from "../core/help.mjs" */

export const HELP_OVERLAY_ID = "vimma-help";
const STYLESHEET = "chrome://browser/skin/vimma/help-overlay.css";
const HTML_NS = "http://www.w3.org/1999/xhtml";

export class HelpOverlay {
  /**
   * @param {Window} win  a browser window
   * @param {Keymap} keymap  the keymap the dispatcher uses, so help cannot drift from behaviour
   */
  constructor(win, keymap) {
    this.win = win;
    /** @type {BindingRow[]} */
    this.rows = bindingTable(keymap);
    /** @type {HTMLDialogElement | null} */
    this.dialog = null;
    /** @type {HTMLInputElement | null} */
    this.input = null;
  }

  get isOpen() {
    return !!this.dialog?.open;
  }

  get filterFocused() {
    return this.isOpen && this.win.document.activeElement === this.input;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (this.isOpen) return;
    const dialog = this.dialog ?? this.build();
    /** @type {HTMLInputElement} */ (this.input).value = "";
    this.applyFilter();
    dialog.showModal();
    dialog.scrollTop = 0;
    dialog.focus();
  }

  /** HTMLDialogElement.close() returns focus to where it was before showModal(). */
  close() {
    if (!this.isOpen) return;
    /** @type {HTMLDialogElement} */ (this.dialog).close();
  }

  focusFilter() {
    this.input?.focus();
  }

  /** @private */
  applyFilter() {
    const dialog = /** @type {HTMLDialogElement} */ (this.dialog);
    const query = /** @type {HTMLInputElement} */ (this.input).value;
    const shown = new Set(filterBindings(this.rows, query).map((r) => r.name));
    for (const section of dialog.querySelectorAll("section")) {
      let any = false;
      for (const row of section.querySelectorAll("[data-action]")) {
        const visible = shown.has(/** @type {HTMLElement} */ (row).dataset.action ?? "");
        /** @type {HTMLElement} */ (row).hidden = !visible;
        any ||= visible;
      }
      /** @type {HTMLElement} */ (section).hidden = !any;
    }
  }

  /**
   * @private
   * @returns {HTMLDialogElement}
   */
  build() {
    const doc = this.win.document;
    this.win.windowUtils.loadSheetUsingURIString(STYLESHEET, this.win.windowUtils.AUTHOR_SHEET);

    /**
     * @param {string} tag
     * @param {string} [className]
     * @param {string} [text]
     */
    const el = (tag, className, text) => {
      const node = /** @type {HTMLElement} */ (doc.createElementNS(HTML_NS, tag));
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };

    const dialog = /** @type {HTMLDialogElement} */ (el("dialog"));
    dialog.id = HELP_OVERLAY_ID;
    dialog.tabIndex = -1;
    dialog.setAttribute("aria-label", "Key bindings");

    const header = el("header");
    header.append(el("h1", "", "Key bindings"));
    const input = /** @type {HTMLInputElement} */ (el("input"));
    input.type = "search";
    input.placeholder = "/ to filter, Esc to close";
    input.setAttribute("aria-label", "Filter bindings");
    input.addEventListener("input", () => this.applyFilter());
    header.append(input);
    dialog.append(header);

    /** @type {HTMLElement | null} */
    let section = null;
    let group = "";
    for (const r of this.rows) {
      if (!section || r.group !== group) {
        group = r.group;
        section = el("section");
        section.append(el("h2", "", group));
        dialog.append(section);
      }
      const row = el("div", "vimma-help-row");
      row.dataset.action = r.name;
      row.append(
        el("span", "vimma-help-override", r.overridden ? "*" : ""),
        el("span", "vimma-help-keys", r.bindings.length ? r.bindings.join(", ") : "(unbound)"),
        el("span", "vimma-help-name", r.name),
        el("span", "vimma-help-description", r.description),
      );
      section.append(row);
    }

    doc.body.append(dialog);
    this.dialog = dialog;
    this.input = input;
    return dialog;
  }
}
