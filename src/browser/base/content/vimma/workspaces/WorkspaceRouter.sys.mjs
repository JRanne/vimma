/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Workspace routing (spec: docs/specs/workspace-routing.md): `[[routes]]` rules pick the
 * container a tab opens in. One per app. The routing points, each only filling in a container
 * for a tab or window being created (never moving a tab, so nothing here can loop):
 * - `routeLinkIn`, from URILoadingHelper-sys-mjs.patch: the URL bar, `:open`, bookmarks, and
 *   links a page opens in a new tab or window;
 * - `externalUserContextId`, from BrowserDOMWindow-sys-mjs.patch: links from other apps;
 * - `firstTab`, from Tabbrowser-sys-mjs.patch hunk 2 (through WorkspaceStore): a new window's
 *   first tab, with the app of a cold start.
 * The app that opened a link comes from vimma-open as `-vimma-from <app>` on the remote command
 * line (a handler registered here) or, at a cold start, as `VIMMA_FROM`. It is an untrusted
 * hint: a token or nothing, only ever compared with a rule's `app`.
 */

import { isAppToken, matchRoute } from "../core/routes.mjs";
import { WorkspaceStore } from "./WorkspaceStore.sys.mjs";

/** @import { Route } from "../core/routes.mjs" */
/** @import { WorkspaceDefinition } from "../core/workspacedefs.mjs" */

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

const ReferrerInfo = Components.Constructor(
  "@mozilla.org/referrer-info;1",
  "nsIReferrerInfo",
  "init",
);

const FLAG = "vimma-from";
const ENV = "VIMMA_FROM";
const CONTRACT = "@vimma.org/routing/from-clh;1";
/** Before "x-default" (nsDefaultCommandLineHandler), which opens the URL. */
const CATEGORY_ENTRY = "k-vimma-from";
/** The rules in force at the last change, so a cold start routes before config.toml is read. */
const CACHE_PREF = "vimma.routes.cache";

/** @type {Route[]} */
let routes = readCache();
/** The app of the command line being handled, until the current task ends. */
/** @type {string | null} */
let pendingApp = null;
/** `VIMMA_FROM`, read once (the first window of a cold start). */
let envRead = false;
let registered = false;

/** @returns {Route[]} */
function readCache() {
  try {
    const cached = JSON.parse(Services.prefs.getStringPref(CACHE_PREF, "[]"));
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
}

/** @param {any} win */
function unroutable(win) {
  return !win || lazy.PrivateBrowsingUtils.isWindowPrivate(win) || win.toolbar?.visible === false;
}

/**
 * What the URL bar or `:open` would load for `url` (`example.com` → `http://example.com/`), or
 * `url` itself.
 * @param {string} url
 */
function fixup(url) {
  try {
    return (
      Services.uriFixup.getFixupURIInfo(url, Ci.nsIURIFixup.FIXUP_FLAG_NONE).preferredURI?.spec ??
      url
    );
  } catch {
    return url;
  }
}

/**
 * A tab nothing has been loaded in yet: a new-tab page or blank, with no history.
 * @param {any} win
 * @param {any} tab
 */
function untouched(win, tab) {
  const browser = tab?.linkedBrowser;
  if (!browser || browser.canGoBack || tab.pinned) return false;
  const spec = browser.currentURI?.spec ?? "";
  return typeof win.isBlankPageURL === "function"
    ? win.isBlankPageURL(spec)
    : spec === "about:blank" || spec === "about:newtab";
}

/** `-vimma-from <app>`: held for the command line being handled, then dropped. */
const handler = {
  handle(/** @type {any} */ cmdLine) {
    /** @type {string | null} */
    let app;
    try {
      app = cmdLine.handleFlagWithParam(FLAG, false);
    } catch {
      return; // the flag without a value: x-default reports it
    }
    if (app === null) return;
    const token = app.toLowerCase();
    if (!isAppToken(token)) return;
    pendingApp = token;
    // x-default opens the URL inside this same task (handURIToExistingBrowser → openURI).
    Services.tm.dispatchToMainThread(() => {
      if (pendingApp === token) pendingApp = null;
    });
  },
  helpInfo: `  --${FLAG} <app>  The application that opened the link (vimma-open), for [[routes]].\n`,
  QueryInterface: ChromeUtils.generateQI(["nsICommandLineHandler"]),
};

const factory = {
  createInstance(/** @type {unknown} */ iid) {
    return handler.QueryInterface(iid);
  },
  QueryInterface: ChromeUtils.generateQI(["nsIFactory"]),
};

export const WorkspaceRouter = {
  /** Once per process (vimma.js): the `-vimma-from` command-line handler. */
  init() {
    if (registered) return;
    registered = true;
    const registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    if (registrar.isContractIDRegistered(CONTRACT)) return;
    registrar.registerFactory(
      Components.ID(Services.uuid.generateUUID().toString()),
      "Vimma -vimma-from",
      CONTRACT,
      factory,
    );
    Services.catMan.addCategoryEntry("command-line-handler", CATEGORY_ENTRY, CONTRACT, false, true);
  },

  /** The rules in force (ConfigHost sets them from config.toml). */
  get routes() {
    return routes;
  },

  /**
   * @param {Route[]} next  core `parseConfig(...).config.routes`
   */
  setRoutes(next) {
    routes = next;
    try {
      Services.prefs.setStringPref(CACHE_PREF, JSON.stringify(next));
    } catch (e) {
      console.warn("vimma: routes not cached", e);
    }
  },

  /** The app of the command line being handled, or null. */
  get app() {
    return pendingApp;
  },

  /**
   * The first rule for `url` opened by `app` whose workspace exists, with that workspace.
   * @param {string} url
   * @param {string | null} [app]
   * @returns {{ route: Route, workspace: WorkspaceDefinition } | null}
   */
  match(url, app = null) {
    if (!routes.length || WorkspaceStore.disabled) return null;
    const defs = WorkspaceStore.definitions.workspaces;
    const route = matchRoute(routes, { url, app }, { workspaces: defs.map((d) => d.name) });
    const workspace = route && defs.find((d) => d.name === route.workspace);
    return route && workspace && workspace.userContextId !== null ? { route, workspace } : null;
  },

  /**
   * The container a rule gives `url` (opened by `app`), or null.
   * @param {string} url
   * @param {string | null} [app]
   * @returns {number | null}
   */
  userContextIdFor(url, app = null) {
    return this.match(url, app)?.workspace.userContextId ?? null;
  },

  /**
   * URILoadingHelper.openLinkIn, before it fills in a new window's container: sets
   * `params.userContextId` when a rule routes the load. Only for a load the user started
   * (system principal, no container chosen) or a link a page opens in a new tab or window in
   * its own container; never a same-tab link, never a private or popup window. A `current`
   * load routed elsewhere becomes a new tab (openLinkIn's own rule); an untouched new tab it
   * leaves behind is closed. A page's link that changes container loses its referrer, as
   * Firefox's "Open Link in New Container Tab" does.
   * @param {any} win  the window the load starts from
   * @param {string} url  as given, maybe not yet fixed up (`example.com`)
   * @param {string} where
   * @param {any} params  openLinkIn's copy, changed in place
   * @param {any} target  the window it loads in, null for a new one
   * @returns {number | undefined} `params.userContextId` afterwards, for openLinkIn's own copy
   */
  routeLinkIn(win, url, where, params, target) {
    this._routeLinkIn(win, url, where, params, target);
    return params.userContextId;
  },

  /**
   * @param {any} win
   * @param {string} url
   * @param {string} where
   * @param {any} params
   * @param {any} target
   */
  _routeLinkIn(win, url, where, params, target) {
    try {
      if (!routes.length || params.private || unroutable(win)) return;
      if (target && unroutable(target)) return;
      const principal = params.triggeringPrincipal;
      const fromPage = !!principal?.isContentPrincipal;
      if (fromPage) {
        if (where === "current") return;
        if ((params.userContextId ?? 0) !== principal.originAttributes.userContextId) return;
      } else if (!principal?.isSystemPrincipal || params.userContextId != null) {
        return;
      }
      const ucid = this.userContextIdFor(fixup(url));
      if (ucid === null) return;
      if (fromPage && ucid !== (params.userContextId ?? 0) && params.referrerInfo) {
        const old = params.referrerInfo;
        params.referrerInfo = new ReferrerInfo(old.referrerPolicy, false, old.originalReferrer);
      }
      if (where === "current" && target) {
        const browser = params.targetBrowser ?? target.gBrowser.selectedBrowser;
        if (browser.browsingContext?.originAttributes.userContextId === ucid) return;
        const tab = target.gBrowser.getTabForBrowser(browser);
        if (untouched(target, tab)) {
          target.setTimeout(() => {
            if (tab.isConnected && !tab.selected && untouched(target, tab)) {
              target.gBrowser.removeTab(tab);
            }
          }, 0);
        }
      }
      params.userContextId = ucid;
    } catch (e) {
      console.error("vimma: routing failed; the load goes on unrouted", e);
    }
  },

  /**
   * BrowserDOMWindow, for a link from another app: the container a rule gives it, or null
   * (Firefox's guess, then the workspace default).
   * @param {any} uri  nsIURI
   * @param {any} win  the window it opens in
   * @returns {number | null}
   */
  externalUserContextId(uri, win) {
    try {
      if (!routes.length || unroutable(win)) return null;
      return this.userContextIdFor(uri.spec, pendingApp);
    } catch (e) {
      console.error("vimma: routing an external link failed", e);
      return null;
    }
  },

  /**
   * A new window's first tab (WorkspaceStore.firstTabUserContextId): the container a rule gives
   * the window's single URL argument, opened by the cold start's app (`VIMMA_FROM`, read once
   * and cleared), or null.
   * @param {any} win
   * @returns {number | null}
   */
  firstTab(win) {
    try {
      const app = this.takeStartupApp();
      if (!routes.length || unroutable(win)) return null;
      const url = singleUrl(win.arguments?.[0]);
      if (!url) return null;
      WorkspaceStore.ensureLoaded();
      return this.userContextIdFor(fixup(url), app);
    } catch (e) {
      console.error("vimma: routing a new window failed", e);
      return null;
    }
  },

  /** `VIMMA_FROM` once per process: vimma-open's app at a cold start. */
  takeStartupApp() {
    if (envRead) return null;
    envRead = true;
    const raw = Services.env.get(ENV);
    if (!raw) return null;
    // Not for later windows, nor for processes Vimma starts.
    Services.env.set(ENV, "");
    const token = raw.toLowerCase();
    return isAppToken(token) ? token : null;
  },

  /** Tests: read `VIMMA_FROM` again at the next new window. */
  resetStartupAppForTesting() {
    envRead = false;
  },
};

/**
 * `window.arguments[0]` when it is one URL: a string, an nsISupportsString or an nsIArray of one
 * (browser-init.js `uriToLoadPromise`). A `|`-separated list is several pages: not routed.
 * @param {any} arg
 * @returns {string | null}
 */
function singleUrl(arg) {
  /** @type {string | null} */
  let url = null;
  if (typeof arg === "string") url = arg;
  else if (arg instanceof Ci.nsISupportsString) url = arg.data;
  else if (arg instanceof Ci.nsIArray && arg.length === 1) {
    url = arg.queryElementAt(0, Ci.nsISupportsString).data;
  }
  return url && !url.includes("|") ? url : null;
}
