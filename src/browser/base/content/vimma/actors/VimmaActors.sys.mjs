/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Registers the Vimma JSWindowActor pair and sends it commands (spec:
// docs/specs/m1-actor-insert-scroll.md). The host talks to content only through here.

const NAME = "Vimma";
const BASE = "chrome://browser/content/vimma/actors/";

/** @typedef {"down" | "up" | "left" | "right" | "half_down" | "half_up" | "top" | "bottom"} ScrollKind */

let registered = false;

/**
 * The actor of a frame's current document, or null when the document does not match
 * (moz-extension:, data:, view-source:) or the frame is gone.
 * @param {any} bc BrowsingContext
 * @returns {any} JSWindowActorParent
 */
function actorFor(bc) {
  try {
    return bc?.currentWindowGlobal?.getActor(NAME) ?? null;
  } catch {
    return null;
  }
}

/**
 * The browser's focused frame when it is a subframe, then its top frame.
 * @param {any} browser XULBrowserElement
 * @returns {any[]} BrowsingContexts
 */
function framesFor(browser) {
  const top = browser.browsingContext;
  const focused = Services.focus.focusedContentBrowsingContext;
  return focused && focused !== top && focused.top === top ? [focused, top] : [top];
}

export const VimmaActors = {
  /** Registers the actor pair once per process; vimma.js calls this before VimmaHost.init. */
  register() {
    if (registered) return;
    registered = true;
    ChromeUtils.registerWindowActor(NAME, {
      parent: { esModuleURI: `${BASE}VimmaParent.sys.mjs` },
      child: {
        esModuleURI: `${BASE}VimmaChild.sys.mjs`,
        events: {
          focusin: { capture: true },
          focusout: { capture: true },
          focus: { capture: true },
        },
      },
      allFrames: true,
      matches: ["http://*/*", "https://*/*", "file:///*", "about:*"],
      messageManagerGroups: ["browsers"],
      // The child only reports focus and scrolls its own page; the parent trusts nothing but
      // a descriptor, which at worst flips that tab's mode.
      safeForUntrustedWebProcess: true,
    });
  },

  /**
   * Whether the browser's page has our actor (else the host keeps it in insert).
   * @param {any} browser XULBrowserElement
   */
  has(browser) {
    return !!actorFor(browser.browsingContext);
  },

  /**
   * Scrolls the focused frame, or the top frame if the focused one has nothing to scroll.
   * @param {any} browser XULBrowserElement
   * @param {ScrollKind} kind
   * @param {number} [count]
   */
  async scroll(browser, kind, count = 1) {
    for (const bc of framesFor(browser)) {
      if (await actorFor(bc)?.sendQuery("Vimma:Scroll", { kind, count })) return;
    }
  },

  /**
   * Blurs the focused element of the focused frame (Esc in insert).
   * @param {any} browser XULBrowserElement
   */
  blur(browser) {
    actorFor(framesFor(browser)[0])?.sendAsyncMessage("Vimma:Blur");
  },

  /**
   * Focuses the first visible text field in the top frame (`i`).
   * @param {any} browser XULBrowserElement
   */
  focusInput(browser) {
    actorFor(browser.browsingContext)?.sendAsyncMessage("Vimma:FocusInput");
  },
};
