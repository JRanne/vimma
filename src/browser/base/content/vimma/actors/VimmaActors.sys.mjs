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
          // Only for an editable document root; a frame never focused has no actor to ask.
          mousedown: { capture: true, createActor: false },
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

  /**
   * The top frame's scroll position (where `/` started, spec m1-find), or null.
   * @param {any} browser XULBrowserElement
   * @returns {Promise<{ x: number, y: number } | null>}
   */
  async scrollPosition(browser) {
    try {
      return (await actorFor(browser.browsingContext)?.sendQuery("Vimma:ScrollPosition")) ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Makes the next find start where Vim's would (spec m1-find): at a selection still on screen,
   * else at the top of the viewport, not at the document's first match.
   * @param {any} browser XULBrowserElement
   */
  findAnchor(browser) {
    actorFor(browser.browsingContext)?.sendAsyncMessage("Vimma:FindAnchor");
  },

  /**
   * Scrolls the top frame back to a position from `scrollPosition` (Esc in a find).
   * @param {any} browser XULBrowserElement
   * @param {{ x: number, y: number }} at
   */
  scrollTo(browser, at) {
    actorFor(browser.browsingContext)?.sendAsyncMessage("Vimma:ScrollTo", at);
  },
};
