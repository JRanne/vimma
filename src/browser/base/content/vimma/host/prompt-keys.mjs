/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Firefox's permission prompts (doorhangers) from the keyboard (docs/specs/toolbar-toggle.md
// decision 11a). VimmaHost hands every keydown here from its capture listener, after the agent
// question's: `y` clicks the prompt's main button, `n` its secondary one, `Tab` moves focus onto
// its buttons (where Firefox's own Tab, arrow keys, Enter and Space work), and Esc stays
// Firefox's. As the agent question line (agent-ui.mjs), the prompt never takes focus by itself,
// a key counts only once it is armed, and a key typed on through it (any key) starts the delay
// again, so typing never answers it; keys typed in a field are the field's. The delay is
// Firefox's own for these prompts (security.notification_enable_delay), whose buttons also
// refuse a click before it (PopupNotifications._onButtonEvent). A line in the prompt names the
// keys once it is armed.

import { doorhangerHint, doorhangerKey } from "../core/prompt-keys.mjs";
import { chordFromEvent, formatKey } from "../core/keys.mjs";

const DELAY_PREF = "security.notification_enable_delay";
const DEFAULT_DELAY_MS = 500;
const PANEL_ID = "notification-popup";
const HINT_CLASS = "vimma-prompt-keys";
const HTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * What the keys need from VimmaHost.
 * @typedef {object} PromptKeysHost
 * @property {() => boolean} inField  focus is in an editable field (insert mode)
 * @property {() => boolean} otherOpen  a picker, prompt, panel or the command line of Vimma's
 * @property {() => boolean} pending  a key sequence is under way (after ctrl+b)
 */

/** @param {any} node  an element, possibly in a shadow root */
function hostChain(node) {
  /** @type {any[]} */
  const chain = [];
  for (let el = node; el; el = el.parentNode ?? el.host) chain.push(el);
  return chain;
}

export class PromptKeys {
  /**
   * @param {Window} win  a browser window
   * @param {PromptKeysHost} host
   */
  constructor(win, host) {
    this.win = win;
    this.host = host;
    /** when the open prompt showed */
    this.shownAt = 0;
    /** the last key while it was open */
    this.lastKeyAt = 0;
    this.armTimer = 0;
    this.onPopup = (/** @type {Event} */ e) => this.popup(e);
  }

  init() {
    this.win.addEventListener("popupshown", this.onPopup, true);
    this.win.addEventListener("popuphidden", this.onPopup, true);
  }

  uninit() {
    this.win.removeEventListener("popupshown", this.onPopup, true);
    this.win.removeEventListener("popuphidden", this.onPopup, true);
    this.win.clearTimeout(this.armTimer);
  }

  get delay() {
    return Math.max(0, Services.prefs.getIntPref(DELAY_PREF, DEFAULT_DELAY_MS));
  }

  /** The prompt shown in the open doorhanger panel, or null. @returns {any} */
  get notification() {
    const panel = /** @type {any} */ (this.win.document.getElementById(PANEL_ID));
    if (panel?.state !== "open") return null;
    // The topmost prompt, the one Firefox's own Esc answers (PopupNotifications).
    const n = panel.firstElementChild;
    return n?.localName === "popupnotification" ? n : null;
  }

  /** @param {Event} e */
  popup(e) {
    if (/** @type {Element} */ (e.target).id !== PANEL_ID) return;
    if (e.type === "popuphidden") {
      this.win.clearTimeout(this.armTimer);
      return;
    }
    this.shownAt = Date.now();
    this.lastKeyAt = 0;
    const n = this.notification;
    if (!n) return;
    let hint = n.querySelector(`.${HINT_CLASS}`);
    if (!hint) {
      hint = this.win.document.createElementNS(HTML_NS, "div");
      hint.className = HINT_CLASS;
      // The buttons say what they do; the line is a reminder of the keys, not a second label.
      hint.setAttribute("aria-hidden", "true");
      (n.buttonGroup ?? n).before(hint);
    }
    const secondaryHidden = n.hasAttribute("secondarybuttonhidden");
    hint.textContent = doorhangerHint({
      main: n.getAttribute("buttonlabel") ?? "",
      secondary: secondaryHidden ? "" : (n.getAttribute("secondarybuttonlabel") ?? ""),
    });
    this.arm(hint);
  }

  /**
   * Hides the keys line and shows it again once the prompt is armed.
   * @param {HTMLElement | null} hint
   */
  arm(hint) {
    if (!hint) return;
    this.win.clearTimeout(this.armTimer);
    hint.hidden = true;
    this.armTimer = this.win.setTimeout(() => {
      hint.hidden = false;
    }, this.delay);
  }

  /**
   * A keydown in the window, before any binding.
   * @param {KeyboardEvent} e
   * @returns {boolean} whether it was the prompt's key (consumed)
   */
  onKey(e) {
    const n = this.notification;
    if (!n) return false;
    const chord = chordFromEvent(e);
    if (!chord) return false; // a bare modifier
    const now = Date.now();
    const armed = now - Math.max(this.shownAt, this.lastKeyAt) >= this.delay;
    this.lastKeyAt = now;
    this.arm(n.querySelector(`.${HINT_CLASS}`));
    if (this.host.otherOpen()) return false;
    const focused = /** @type {any} */ (this.win.document).commandDispatcher?.focusedElement;
    const inPrompt = hostChain(focused).includes(n);
    const result = doorhangerKey(formatKey(chord), {
      open: true,
      armed,
      inField: this.host.inField(),
      inPrompt,
      pending: this.host.pending(),
      repeat: e.repeat,
    });
    if (result.kind === "pass") return false;
    e.preventDefault();
    e.stopPropagation();
    if (result.kind === "allow") n.button?.click();
    else if (result.kind === "block") {
      if (!n.hasAttribute("secondarybuttonhidden")) n.secondaryButton?.click();
    } else if (result.kind === "focus") n.footerFocusableButtons?.[0]?.focus();
    return true;
  }
}
