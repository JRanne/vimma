/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// config.toml for every window (spec: docs/specs/m5-config-load.md). One per app. Reads
// `$XDG_CONFIG_HOME/vimma/config.toml` (default `~/.config/vimma/config.toml`) and nothing else
// in that folder, polls its mtime and size every 2 s (plan §3: Firefox has no portable file
// watcher), and reads it at once on `:source`. vimma-core parses and validates (reloadConfig:
// a file is applied whole or not at all, else the last good config stays); this module does
// the I/O and hands each part to the module that uses it. It never writes the file.

import { formatConfigError, reloadConfig } from "../core/config.mjs";
import { CONFIG_RELOAD_TOPIC, VimmaHost } from "../host/VimmaHost.sys.mjs";
import { PaneViews } from "../split/PaneView.mjs";
import { ThemeHost } from "../ui/theme-host.mjs";

/** @import { ActiveConfig, ConfigError, ResolvedConfig } from "../core/config.mjs" */

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  clearInterval: "resource://gre/modules/Timer.sys.mjs",
  setInterval: "resource://gre/modules/Timer.sys.mjs",
});

/** A full path overrides the XDG location (tests; `~/` is expanded). */
const PATH_PREF = "vimma.config.path";
const POLL_PREF = "vimma.config.pollMs";
const DEFAULT_POLL_MS = 2000;

/** IOUtils rejects with a DOMException named NotFoundError for a missing file. */
const notFound = (/** @type {unknown} */ e) => /** @type {any} */ (e)?.name === "NotFoundError";

const home = () => Services.dirsvc.get("Home", Ci.nsIFile).path;

/** The config file: the pref, else `$XDG_CONFIG_HOME/vimma/config.toml` (absolute only). */
function configPath() {
  const pref = Services.prefs.getStringPref(PATH_PREF, "");
  if (pref.startsWith("~/")) return PathUtils.join(home(), ...pref.slice(2).split("/"));
  if (pref) return pref;
  const xdg = Services.env.get("XDG_CONFIG_HOME");
  // The XDG spec: a relative value is invalid and ignored.
  const base = xdg.startsWith("/") ? xdg : PathUtils.join(home(), ".config");
  return PathUtils.join(base, "vimma", "config.toml");
}

/** @type {ActiveConfig | null} the config in force; null until the first read */
let active = null;
/** @type {ConfigError[]} the last read's errors; [] when it was applied */
let errors = [];
/** What the file looked like at the last read; "" forces one. */
let signature = "";
/** @type {Promise<void> | null} */
let running = null;
/** Another read was asked for while one ran (`:source` during a poll). */
let again = false;
/** @type {unknown} */
let timer = null;
/** @type {Set<Window>} */
const windows = new Set();

/**
 * @param {string} path
 * @returns {Promise<string>} "missing", or the file's mtime and size
 */
async function stat(path) {
  try {
    const info = await IOUtils.stat(path);
    return `${info.lastModified}|${info.size}`;
  } catch (e) {
    if (notFound(e)) return "missing";
    throw e;
  }
}

/** @param {Window} win @param {ResolvedConfig} config */
function applyToWindow(win, config) {
  const view = PaneViews.get(win);
  if (view) view.max = config.panes.max;
}

/** @param {ActiveConfig} next */
function apply(next) {
  const { config, keymap } = next;
  VimmaHost.configure({ keymap, hintChars: config.hintChars, sites: config.sites });
  for (const win of windows) applyToWindow(win, config);
  ThemeHost.setConfig(config.theme);
}

/** @param {boolean} force  read even when the stat is unchanged (`:source`) */
async function check(force) {
  const path = configPath();
  const now = await stat(path);
  if (!force && now === signature) return;
  signature = now;
  let text = "";
  if (now !== "missing") {
    try {
      text = await IOUtils.readUTF8(path);
    } catch (e) {
      if (!notFound(e)) throw e;
      signature = "missing"; // removed between stat and read: the defaults, silently
    }
  }
  const previous = active;
  const r = reloadConfig(active, text);
  active = r.active;
  errors = r.errors;
  if (errors.length) {
    // Logged once per change of the file (or :source): the signature holds until then.
    const list = errors.map((e) => formatConfigError(e, path));
    console.error(
      `vimma: ${path} has ${errors.length} error(s); ${
        previous ? "keeping the previous config" : "using the defaults"
      }:\n  ${list.join("\n  ")}`,
    );
  }
  if (active !== previous) apply(active);
  VimmaHost.configure({ configErrors: errors });
}

/**
 * One read at a time. A forced read asked for during a running one runs after it, so `:source`
 * always sees the file as it is when it was typed.
 * @param {boolean} [force]
 * @returns {Promise<void>}
 */
function poll(force = false) {
  if (running) {
    if (force) again = true;
    return running;
  }
  running = check(force)
    .catch((e) => console.error("vimma: config check failed", e))
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        poll(true);
      }
    });
  return running;
}

function startTimer() {
  if (timer !== null) lazy.clearInterval(timer);
  const ms = Math.max(50, Services.prefs.getIntPref(POLL_PREF, DEFAULT_POLL_MS));
  timer = lazy.setInterval(() => poll(), ms);
}

/**
 * @param {unknown} _subject
 * @param {string} _topic
 * @param {string} pref
 */
function onPref(_subject, _topic, pref) {
  if (pref === POLL_PREF) startTimer();
  else ConfigHost.reload(); // another path: read it now
}

const reloadObserver = () => {
  ConfigHost.reload();
};

function start() {
  Services.prefs.addObserver(PATH_PREF, onPref);
  Services.prefs.addObserver(POLL_PREF, onPref);
  Services.obs.addObserver(reloadObserver, CONFIG_RELOAD_TOPIC);
  startTimer();
  // Never blocks startup: the windows start on the built-in keymap and swap when read.
  poll(true);
}

function stop() {
  if (timer !== null) lazy.clearInterval(timer);
  timer = null;
  Services.prefs.removeObserver(PATH_PREF, onPref);
  Services.prefs.removeObserver(POLL_PREF, onPref);
  Services.obs.removeObserver(reloadObserver, CONFIG_RELOAD_TOPIC);
}

export const ConfigHost = {
  /**
   * Once per browser window (vimma.js), after VimmaHost and PaneViews: the config in force now,
   * and polling while any window is open.
   * @param {Window} win
   */
  init(win) {
    if (windows.has(win)) return;
    const first = windows.size === 0;
    windows.add(win);
    if (active) applyToWindow(win, active.config);
    win.addEventListener(
      "unload",
      () => {
        windows.delete(win);
        if (!windows.size) stop();
      },
      { once: true },
    );
    if (first) start();
  },

  /**
   * Reads the file now, changed or not (`:source`, a new path).
   * @returns {Promise<void>} settled once the read is applied or reported
   */
  async reload() {
    await poll(true);
    // A read was running: ours was queued behind it.
    while (running) await running;
  },

  /** The resolved config in force (core's ResolvedConfig), null before the first read. */
  get config() {
    return active?.config ?? null;
  },

  /** The last read's errors, [] when it was applied (the status bar shows the first). */
  get errors() {
    return errors;
  },

  /** The file read now. */
  get path() {
    return configPath();
  },
};
