/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The tab rename prompt (spec: docs/specs/m2-picker-rename.md): one line at the window's foot,
// styled as the `:` command line (cmdline.css). Its input is a chrome text field, so the host is
// in insert and keys type; the input's own keydown takes Enter (apply) and Esc (cancel).
// The same line asks y/N questions (`ask`, m3-workspaces 4a: closing a workspace): `y` says
// yes, any other key no.

import { loadCmdlineSheet } from "./cmdline.mjs";

export const RENAME_ID = "vimma-rename";
export const RENAME_INPUT_ID = "vimma-rename-input";
const STATUSBAR_ID = "vimma-statusbar";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const RENAME_LABEL = "rename tab: ";
const RENAME_PLACEHOLDER = "empty: back to the page title";

/**
 * @typedef {object} RenameCallbacks
 * @property {(tab: Element, text: string) => void} apply  Enter; the prompt has closed already
 * @property {() => void} [changed]  after it opens or closes (the status bar's mode)
 */

export class RenamePrompt {
  /**
   * @param {Window} win  a browser window
   * @param {RenameCallbacks} callbacks
   */
  constructor(win, { apply, changed = () => {} }) {
    this.win = win;
    this.apply = apply;
    this.changed = changed;
    /** @type {HTMLElement | null} */
    this.el = null;
    /** @type {HTMLInputElement | null} */
    this.input = null;
    /** @type {Element | null} the tab being renamed */
    this.tab = null;
    /** @type {Element | null} focused before open */
    this.opener = null;
    /** @type {HTMLElement | null} the prompt text before the input */
    this.label = null;
    /** @type {(() => void) | null} a y/N question's yes, while one is open */
    this.yes = null;
  }

  get isOpen() {
    return !!this.el && !this.el.hidden;
  }

  /**
   * @param {Element} tab
   * @param {string} current  its label now, to edit ("" for none)
   */
  open(tab, current) {
    if (!this.show(RENAME_LABEL, RENAME_PLACEHOLDER, "Rename tab")) return;
    const input = /** @type {HTMLInputElement} */ (this.input);
    this.tab = tab;
    input.value = current;
    input.select();
  }

  /**
   * A y/N question: `y` runs `yes`; any other key, Enter (the default, N) or Esc says no.
   * @param {string} question  ends with "y/N"
   * @param {() => void} yes  after the prompt has closed
   */
  ask(question, yes) {
    if (!this.show(`${question} `, "", question)) return;
    this.yes = yes;
  }

  /**
   * @private
   * @param {string} label
   * @param {string} placeholder
   * @param {string} ariaLabel
   * @returns {boolean} whether it opened (not over a page in DOM fullscreen)
   */
  show(label, placeholder, ariaLabel) {
    if (this.win.document.documentElement.hasAttribute("inDOMFullscreen")) return false;
    const input = this.input ?? this.build();
    if (!this.isOpen) this.opener = Services.focus.focusedElement;
    this.tab = null;
    this.yes = null;
    /** @type {HTMLElement} */ (this.label).textContent = label;
    input.placeholder = placeholder;
    input.setAttribute("aria-label", ariaLabel);
    input.value = "";
    /** @type {HTMLElement} */ (this.el).hidden = false;
    input.focus();
    this.changed();
    return true;
  }

  /**
   * Hides the prompt; focus goes back where it was (`restoreFocus`), or to the selected browser
   * after a tab switch or when that element is gone.
   * @param {{ restoreFocus?: boolean, tabChanged?: boolean }} [options]
   */
  close({ restoreFocus = true, tabChanged = false } = {}) {
    if (!this.isOpen) return;
    const opener = this.opener;
    this.opener = null;
    this.tab = null;
    this.yes = null;
    if (tabChanged || (restoreFocus && !opener?.isConnected)) {
      /** @type {{ gBrowser?: { selectedBrowser: HTMLElement } }} */ (
        /** @type {unknown} */ (this.win)
      ).gBrowser?.selectedBrowser.focus();
    } else if (restoreFocus) {
      /** @type {HTMLElement} */ (opener).focus();
    }
    /** @type {HTMLElement} */ (this.el).hidden = true;
    this.changed();
  }

  /** Close and remove the element (VimmaHost.uninit). */
  destroy() {
    this.close({ restoreFocus: false });
    this.el?.remove();
    this.el = this.input = null;
  }

  /**
   * @private
   * @param {KeyboardEvent} e
   */
  onKeyDown(e) {
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    const yes = this.yes;
    if (yes) {
      // Modifier keys alone (shift for `Y`) are not an answer.
      if (["Shift", "CapsLock"].includes(e.key)) return;
      // Nor is a key held down from before the question (the D of ctrl+b shift+d repeating).
      if (e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      this.close();
      if (e.key === "y" || e.key === "Y") yes();
    } else if (e.key === "Enter") {
      const tab = this.tab;
      const text = /** @type {HTMLInputElement} */ (this.input).value;
      this.close();
      if (tab?.isConnected) this.apply(tab, text);
    } else if (e.key === "Escape") {
      this.close();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * Focus moving elsewhere in the window cancels; the window losing focus keeps the prompt.
   * @private
   */
  onFocusOut() {
    this.win.setTimeout(() => {
      const doc = this.win.document;
      if (this.isOpen && doc.activeElement !== this.input && doc.hasFocus()) {
        this.close({ restoreFocus: false });
      }
    }, 0);
  }

  /**
   * @private
   * @returns {HTMLInputElement}
   */
  build() {
    const doc = this.win.document;
    loadCmdlineSheet(this.win);
    /**
     * @param {string} tag
     * @param {string} [className]
     */
    const el = (tag, className) => {
      const node = /** @type {HTMLElement} */ (doc.createElementNS(HTML_NS, tag));
      if (className) node.className = className;
      return node;
    };
    const container = el("div");
    container.id = RENAME_ID;
    container.hidden = true;
    const panel = el("div", "vimma-cmdline-panel");
    const row = el("div", "vimma-cmdline-row");
    const prompt = el("span", "vimma-cmdline-prompt");
    prompt.textContent = RENAME_LABEL;
    prompt.setAttribute("aria-hidden", "true");
    const input = /** @type {HTMLInputElement} */ (el("input"));
    input.id = RENAME_INPUT_ID;
    input.type = "text";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.placeholder = RENAME_PLACEHOLDER;
    input.setAttribute("aria-label", "Rename tab");
    this.label = prompt;
    input.addEventListener("keydown", (e) => this.onKeyDown(e));
    input.addEventListener("focusout", () => this.onFocusOut());
    row.append(prompt, input);
    panel.append(row);
    container.append(panel);
    const statusBar = doc.getElementById(STATUSBAR_ID);
    const browser = doc.getElementById("browser");
    if (statusBar) statusBar.before(container);
    else if (browser) browser.after(container);
    else doc.body.append(container);
    this.el = container;
    this.input = input;
    return input;
  }
}
