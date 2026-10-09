/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Registers the Vimma JSWindowActor pair and sends it commands (spec:
// docs/specs/m1-actor-insert-scroll.md). The host talks to content only through here.

import { HINT_REPLY_MAX_TARGETS, parseHintReply } from "../core/hints.mjs";

// System modules have no timer globals; Firefox's actors import them the same way.
const { clearTimeout, setTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs",
);

const NAME = "Vimma";
const BASE = "chrome://browser/content/vimma/actors/";

/** @typedef {"down" | "up" | "left" | "right" | "half_down" | "half_up" | "top" | "bottom"} ScrollKind */

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */
/**
 * A hint target in the parent: where to draw it and how to reach its element again.
 * @typedef {object} HintTarget
 * @property {Rect} rect  in the top frame's CSS pixels
 * @property {"link" | "input" | "click"} kind
 * @property {string} [href]  links only
 * @property {number} gen  the collection it came from
 * @property {number} id  the element's index in its frame's collection
 * @property {any} bc  its frame's BrowsingContext
 * @property {any} wg  the frame's WindowGlobalParent at collection time
 */

let registered = false;

/** Hint collections so far; a reply or an activation from an older one is ignored. */
let hintGen = 0;
/** The live collection of each window; another window's `f` must not void it. */
/** @type {WeakMap<object, number>} */
const liveGen = new WeakMap();

/** How long a subframe may take to answer (ms) before its targets are left out. */
const FRAME_TIMEOUT_PREF = "vimma.hints.frameTimeoutMs";
const FRAME_TIMEOUT_DEFAULT = 150;
/** The top frame gets longer: without it there are no hints at all. */
const TOP_TIMEOUT_MS = 2000;

/** At most this many targets in all frames (each frame: core HINT_REPLY_MAX_TARGETS). */
const MAX_HINTS = HINT_REPLY_MAX_TARGETS;
/** At most this deep in frames. */
const MAX_FRAME_DEPTH = 8;
/** Schemes `F` opens; the page's principal must be allowed to load them too. */
const OPENABLE = new Set(["http:", "https:", "file:"]);

const ReferrerInfo = Components.Constructor(
  "@mozilla.org/referrer-info;1",
  "nsIReferrerInfo",
  "init",
);

/**
 * @param {Rect} r
 * @param {{ x: number, y: number }} by
 * @returns {Rect}
 */
function offset(r, by) {
  return { x: r.x + by.x, y: r.y + by.y, width: r.width, height: r.height };
}

/**
 * @param {Rect} a
 * @param {Rect} b
 * @returns {Rect | null}
 */
function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right - x >= 1 && bottom - y >= 1 ? { x, y, width: right - x, height: bottom - y } : null;
}

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
   * Test-only: the content-side time of the last collectHints, summed over frames, in ms.
   * @type {number}
   */
  _lastCollectMs: 0,

  /**
   * The hint targets on screen in the browser's page and its frames (m1-hints), in the top
   * frame's CSS pixels. Each frame's child collects its own; frames from other origins are
   * other processes, so the parent merges them, offset by the frame rects their embedder
   * reported and clipped to them. Replies are from content processes and checked like any
   * other message: a malformed one drops that frame.
   * @param {any} browser XULBrowserElement
   * @param {string} action "hint.follow" or "hint.follow_new_tab" (links only)
   * @returns {Promise<HintTarget[]>}
   */
  async collectHints(browser, action) {
    const gen = ++hintGen;
    const win = browser.ownerDocument.defaultView;
    liveGen.set(win, gen);
    const live = () => liveGen.get(win) === gen;
    const frameTimeout = Services.prefs.getIntPref(FRAME_TIMEOUT_PREF, FRAME_TIMEOUT_DEFAULT);
    /** Each frame at most once, whatever its embedder reports. */
    const visited = new Set();
    const linksOnly = action === "hint.follow_new_tab";
    /** @type {HintTarget[]} */
    const out = [];
    let ms = 0;
    /**
     * @param {any} bc BrowsingContext
     * @param {Rect} frame the frame's viewport in top-frame pixels, as clipped by its ancestors
     * @param {{ x: number, y: number }} origin the frame's viewport origin in top-frame pixels
     * @param {number} depth
     */
    const visit = async (bc, frame, origin, depth) => {
      if (visited.has(bc.id)) return;
      visited.add(bc.id);
      const wg = bc.currentWindowGlobal;
      /** @type {unknown} */
      let raw;
      /** @type {number | undefined} */
      let timer;
      try {
        // A busy or hung frame (its process spinning) must not hold up the others' labels.
        const late = new Promise((resolve) => {
          timer = setTimeout(resolve, depth === 0 ? TOP_TIMEOUT_MS : frameTimeout, null);
        });
        const query = actorFor(bc)?.sendQuery("Vimma:CollectHints", { gen, linksOnly });
        raw = await Promise.race([query, late]);
      } catch {
        return; // the frame navigated or its process went away
      } finally {
        clearTimeout(timer);
      }
      // From a content process, which may be compromised: a fresh, checked copy or nothing.
      const reply = parseHintReply(raw);
      if (!reply || !live()) return;
      ms += reply.ms;
      for (const t of reply.targets) {
        if (out.length >= MAX_HINTS) break;
        const rect = intersect(offset(t.rect, origin), frame);
        if (!rect) continue;
        out.push({ gen, bc, wg, id: t.id, kind: t.kind, href: t.href, rect });
      }
      if (depth >= MAX_FRAME_DEPTH) return;
      const children = reply.frames.map((f) => {
        const child = BrowsingContext.get(f.id);
        // Only a frame this document embeds: a content process names no other.
        if (!child || child.parent !== bc) return null;
        const rect = offset(f.rect, origin);
        const clipped = intersect(rect, frame);
        return clipped && visit(child, clipped, { x: rect.x, y: rect.y }, depth + 1);
      });
      await Promise.all(children);
    };
    const top = browser.browsingContext;
    const all = { x: 0, y: 0, width: Infinity, height: Infinity };
    await visit(top, all, { x: 0, y: 0 }, 0);
    this._lastCollectMs = ms;
    return live() ? out : [];
  },

  /**
   * Follows a target in its own frame: a click, or focus for a text field.
   * @param {HintTarget} target
   */
  activateHint(target) {
    if (target.bc.currentWindowGlobal !== target.wg) return;
    actorFor(target.bc)
      ?.sendQuery("Vimma:ActivateHint", { gen: target.gen, id: target.id })
      .catch(() => {});
  },

  /**
   * Opens a link target in a new background tab next to the browser's, in its container, as
   * the page itself would load it: the page's principal triggers the load, so a page cannot
   * open what it could not link to.
   * @param {any} browser XULBrowserElement
   * @param {HintTarget} target
   * @returns {boolean} whether a tab was opened
   */
  openInBackground(browser, target) {
    const wg = target.bc.currentWindowGlobal;
    if (target.kind !== "link" || !target.href || wg !== target.wg) return false;
    const url = URL.parse(target.href);
    if (!url || !OPENABLE.has(url.protocol)) return false;
    const principal = wg.documentPrincipal;
    try {
      Services.scriptSecurityManager.checkLoadURIWithPrincipal(
        principal,
        url.URI,
        Ci.nsIScriptSecurityManager.DISALLOW_INHERIT_PRINCIPAL,
      );
    } catch {
      return false;
    }
    const win = browser.ownerDocument.defaultView;
    const tab = win.gBrowser.getTabForBrowser(browser);
    win.openLinkIn(url.href, "tab", {
      inBackground: true,
      relatedToCurrent: true,
      userContextId: tab?.userContextId ?? 0,
      triggeringPrincipal: principal,
      originPrincipal: principal,
      originStoragePrincipal: wg.documentStoragePrincipal,
      triggeringRemoteType: wg.domProcess?.remoteType,
      referrerInfo: new ReferrerInfo(Ci.nsIReferrerInfo.EMPTY, true, wg.documentURI),
    });
    return true;
  },

  /**
   * Drops the window's collection in flight (Esc, tab switch): its reply is ignored.
   * @param {object} win
   */
  cancelHints(win) {
    liveGen.delete(win);
  },

  /**
   * Focuses the first visible text field in the top frame (`i`).
   * @param {any} browser XULBrowserElement
   */
  focusInput(browser) {
    actorFor(browser.browsingContext)?.sendAsyncMessage("Vimma:FocusInput");
  },
};
