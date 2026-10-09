/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// about:vimma (spec: docs/specs/m5-about-vimma.md): what Vimma is doing, for the user and for a
// bug report. Firefox's own about: pages are a C++ table (AboutRedirector.cpp); this one is
// registered at runtime as an nsIAboutModule factory, the way BrowserTestUtils.registerAboutPage
// does it, so it needs no upstream patch. The page is chrome://browser/content/vimma/about/
// about.html loaded under the about:vimma URL, in the parent process (no URI_*_IN_CHILD flag),
// with the system principal its chrome: channel carries; web content cannot link to it (no
// URI_SAFE_FOR_UNTRUSTED_CONTENT). `collect` gathers the data; the page only renders it.

import { bindingTable } from "../core/help.mjs";
import { compileKeymap } from "../core/keymap.mjs";
import { formatConfigError } from "../core/config.mjs";
import { leaves } from "../core/panes.mjs";
import { redactReport } from "../core/report.mjs";
import { ConfigHost } from "../config/ConfigHost.sys.mjs";
import { ENABLED_PREF, VimmaControl } from "../ctl/VimmaControl.sys.mjs";
import { VimmaHost } from "../host/VimmaHost.sys.mjs";
import { PaneViews } from "../split/PaneView.mjs";
import { ThemeHost } from "../ui/theme-host.mjs";
import { WindowWorkspaces } from "../workspaces/WindowWorkspaces.sys.mjs";
import { WorkspaceStore } from "../workspaces/WorkspaceStore.sys.mjs";
import { KeyLog } from "./key-log.mjs";

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  AppConstants: "resource://gre/modules/AppConstants.sys.mjs",
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
});

export const ABOUT_URL = "about:vimma";
const PAGE_URL = "chrome://browser/content/vimma/about/about.html";
/** Generated at import by tools/version-files (patchManifest) and packaged by jar.mn. */
const PATCHES_URL = "chrome://browser/content/vimma/about/patches.json";
const CONTRACT = "@mozilla.org/network/protocol/about;1?what=vimma";

/**
 * @typedef {object} AboutData
 * @property {{ vimma: string, firefox: string, buildId: string, channel: string }} version
 * @property {{ patches: { path: string, hunks: number }[], hunks: number } | null} patches
 * @property {{ window: number, current: boolean, mode: string }[]} modes
 * @property {import("./key-log.mjs").KeyEvent[]} keys
 * @property {{ path: string, file: "pending" | "missing" | "read", schema: number | null,
 *   errors: string[] }} config
 * @property {{ name: string, group: string, bindings: string[], overridden: boolean }[]} bindings
 * @property {{ source: string, path: string, state: string, mtime: number | null,
 *   lastError: string | null, warnings: string[], name: string | null }} theme
 * @property {{ count: number, window: { name: string, active: boolean, tabs: number,
 *   panes: number }[] }} workspaces
 * @property {{ enabled: boolean, port: number | null }} control
 */

/** An nsIAboutModule that is its own nsIFactory; XPCOM types are untyped here (types/). */
const aboutModule = /** @type {any} */ ({
  QueryInterface: ChromeUtils.generateQI(["nsIAboutModule", "nsIFactory"]),
  getURIFlags() {
    return Ci.nsIAboutModule.ALLOW_SCRIPT | Ci.nsIAboutModule.IS_SECURE_CHROME_UI;
  },
  getChromeURI() {
    return Services.io.newURI(PAGE_URL);
  },
  /** @param {unknown} uri @param {unknown} loadInfo */
  newChannel(uri, loadInfo) {
    const channel = Services.io.newChannelFromURIWithLoadInfo(
      Services.io.newURI(PAGE_URL),
      loadInfo,
    );
    channel.originalURI = uri;
    return channel;
  },
  /** @param {unknown} iid */
  createInstance(iid) {
    return aboutModule.QueryInterface(iid);
  },
});

let registered = false;

/** @param {string} url */
async function fetchJson(url) {
  try {
    const response = await fetch(url);
    return await response.json();
  } catch {
    return null; // not packaged (an import without version-files): the page says so
  }
}

/**
 * The theme directory's sibling `theme.name` (omarchy-theme-set writes it), or null.
 * @param {string} dir
 */
async function omarchyThemeName(dir) {
  try {
    return (await IOUtils.readUTF8(PathUtils.join(PathUtils.parent(dir) ?? dir, "theme.name")))
      .trim()
      .slice(0, 80);
  } catch {
    return null;
  }
}

/**
 * The workspaces of `win`: each one's name, tab count and pane count.
 * @param {Window} win
 */
function workspacesOf(win) {
  const model = WindowWorkspaces.get(win)?.model;
  if (!model) return [];
  const view = PaneViews.get(win);
  return model.workspaces.map((w) => {
    const active = w.id === model.active;
    const panes = active ? (view?.panes ?? null) : (view?.parked(w.id) ?? null);
    return {
      name: w.name,
      active,
      tabs: w.tabs.length,
      panes: panes ? leaves(panes).length : 1,
    };
  });
}

export const AboutVimma = {
  /** Once per process (vimma.js): about:vimma resolves from then on. */
  register() {
    if (registered) return;
    registered = true;
    const registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    if (registrar.isContractIDRegistered(CONTRACT)) return;
    registrar.registerFactory(
      Components.ID(Services.uuid.generateUUID().toString()),
      "about:vimma",
      CONTRACT,
      aboutModule,
    );
  },

  /**
   * Everything the page shows, read now. Never the control token, page URLs or titles.
   * @param {Window} win  the browser window the page is in (its workspaces are listed)
   * @returns {Promise<AboutData>}
   */
  async collect(win) {
    const app = lazy.AppConstants;
    const keymap = ConfigHost.keymap ?? compileKeymap();
    const configPath = ConfigHost.path;
    const theme = ThemeHost.status;
    const windows = /** @type {Window[]} */ (lazy.BrowserWindowTracker.orderedWindows);
    return {
      version: {
        vimma: app.MOZ_APP_VERSION_DISPLAY,
        firefox: Services.appinfo.version,
        buildId: Services.appinfo.appBuildID,
        channel: app.MOZ_UPDATE_CHANNEL,
      },
      patches: await fetchJson(PATCHES_URL),
      modes: windows.map((w, i) => ({
        window: i + 1,
        current: w === win,
        mode: VimmaHost.status(w).mode,
      })),
      keys: KeyLog.entries(),
      config: {
        path: configPath,
        file: ConfigHost.file,
        schema: ConfigHost.config?.schema ?? null,
        errors: ConfigHost.errors.map((e) => formatConfigError(e, configPath)),
      },
      bindings: bindingTable(keymap).map((r) => ({
        name: r.name,
        group: r.group,
        bindings: r.bindings,
        overridden: r.overridden,
      })),
      theme: {
        ...theme,
        name: theme.source === "omarchy" ? await omarchyThemeName(theme.path) : null,
      },
      workspaces: {
        count: WorkspaceStore.definitions.workspaces.length,
        window: workspacesOf(win),
      },
      control: {
        enabled: Services.prefs.getBoolPref(ENABLED_PREF, false),
        port: VimmaControl.port,
      },
    };
  },

  /**
   * The plain-text report `:bug` copies: everything but the binding table's defaults, with URLs
   * and paths under $HOME redacted.
   * @param {AboutData} data
   * @returns {string}
   */
  report(data) {
    const v = data.version;
    const lines = [
      "about:vimma report",
      `Vimma ${v.vimma} (Firefox ${v.firefox}, build ${v.buildId}, channel ${v.channel})`,
      `Upstream patches: ${data.patches ? `${data.patches.patches.length} (${data.patches.hunks} hunks)` : "unknown"}`,
      ...(data.patches?.patches ?? []).map((p) => `  ${p.path} (${p.hunks})`),
      `Modes: ${data.modes.map((m) => `window ${m.window} ${m.mode}`).join(", ")}`,
      `Last keys: ${data.keys.map((k) => `${k.key}→${k.outcome}`).join(" ") || "none"}`,
      `Config: ${data.config.path} (${data.config.file}, schema ${data.config.schema ?? "-"})`,
      ...data.config.errors.map((e) => `  error: ${e}`),
      `Overrides: ${
        data.bindings
          .filter((b) => b.overridden)
          .map((b) => `${b.name}=${b.bindings.join("|") || "(unbound)"}`)
          .join(", ") || "none"
      }`,
      `Theme: ${data.theme.source}, ${data.theme.state}, ${data.theme.path}` +
        (data.theme.name ? `, ${data.theme.name}` : ""),
      ...(data.theme.lastError ? [`  error: ${data.theme.lastError}`] : []),
      ...data.theme.warnings.map((w) => `  warning: ${w}`),
      `Workspaces: ${data.workspaces.count}; this window: ${
        data.workspaces.window.map((w) => `${w.name} ${w.tabs}t/${w.panes}p`).join(", ") || "none"
      }`,
      `Control socket: ${data.control.enabled ? `enabled, port ${data.control.port ?? "-"}` : "off"}`,
    ];
    const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
    return redactReport(`${lines.join("\n")}\n`, home);
  },
};
