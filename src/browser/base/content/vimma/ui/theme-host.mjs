/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The theme tokens for every window and start page (spec: docs/specs/m5-omarchy-theme.md).
// One per app: imported with ChromeUtils.importESModule, so every window shares this module.
// It starts on the built-in Tokyo Night and swaps in the user's Omarchy theme
// (colors.toml, light.mode) once the async read completes, then polls the file (plan §3:
// Firefox has no portable file watcher). vimma-core parses and validates (resolveTheme,
// tokensToCss); this module only does the I/O and the injection.

import { resolveTheme, tokensToCss } from "../core/theme.mjs";

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  clearInterval: "resource://gre/modules/Timer.sys.mjs",
  setInterval: "resource://gre/modules/Timer.sys.mjs",
});

const SOURCE_PREF = "vimma.theme.source";
const PATH_PREF = "vimma.theme.omarchyPath";
const POLL_PREF = "vimma.theme.pollMs";
const DEFAULT_PATH = "~/.local/state/omarchy/current/theme";
const DEFAULT_POLL_MS = 2000;
/** Notified after new tokens reach the windows, and when a theme file is rejected. */
const CHANGED_TOPIC = "vimma-theme-changed";
const ERROR_TOPIC = "vimma-theme-error";
const FONT = "monospace";

/** @param {string | null} omarchy  colors.toml text; null: the built-in theme */
function cssFor(omarchy, lightMode = false) {
  const source = omarchy === null ? "file" : "omarchy";
  const r = resolveTheme({
    theme: { source, font: FONT, colors: {} },
    omarchy,
    omarchyLightMode: lightMode,
  });
  return { css: tokensToCss(r.tokens, ":root"), errors: r.errors, warnings: r.warnings };
}

const BUILTIN_CSS = cssFor(null).css;

/** @param {string} css */
const sheetUri = (css) => `data:text/css;charset=utf-8,${encodeURIComponent(css)}`;

/** The theme directory from the pref, `~` resolved against the home directory. */
function themeDir() {
  const path = Services.prefs.getStringPref(PATH_PREF, DEFAULT_PATH);
  if (path !== "~" && !path.startsWith("~/")) return path;
  const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
  return PathUtils.join(home, ...path.slice(2).split("/").filter(Boolean));
}

/** IOUtils rejects with a DOMException named NotFoundError for a missing file. */
const notFound = (/** @type {unknown} */ e) => /** @type {any} */ (e)?.name === "NotFoundError";

let css = BUILTIN_CSS;
/** @type {Map<Window, string>} each window's token sheet (a data: URI of `css`) */
const windows = new Map();
/** @type {Set<WeakRef<HTMLStyleElement>>} start pages' token <style> elements */
const styles = new Set();
/** What the theme file looked like at the last check; "" forces a read. */
let signature = "";
/** An Omarchy theme was applied since the source or path last changed. */
let loaded = false;
/** @type {Promise<void> | null} */
let running = null;
/** @type {unknown} */
let timer = null;

/** @param {string} next */
function apply(next) {
  if (next === css) return;
  css = next;
  for (const [win, old] of windows) {
    const uri = sheetUri(css);
    // Load before remove: no frame without tokens.
    win.windowUtils.loadSheetUsingURIString(uri, win.windowUtils.AUTHOR_SHEET);
    win.windowUtils.removeSheetUsingURIString(old, win.windowUtils.AUTHOR_SHEET);
    windows.set(win, uri);
  }
  for (const ref of styles) {
    const style = ref.deref();
    if (style?.isConnected) style.textContent = css;
    else styles.delete(ref);
  }
  Services.obs.notifyObservers(null, CHANGED_TOPIC);
}

/**
 * The file's stat, cheap enough for every poll. It describes the file the path resolves to
 * now, so omarchy-theme-set's swap (a new current/theme directory or symlink) changes it too.
 * @param {string} dir
 * @returns {Promise<string | null>} null: no colors.toml
 */
async function stat(dir) {
  try {
    const info = await IOUtils.stat(PathUtils.join(dir, "colors.toml"));
    const light = await IOUtils.exists(PathUtils.join(dir, "light.mode"));
    return `${dir}|${info.lastModified}|${info.creationTime ?? ""}|${info.size}|${light}`;
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

async function check() {
  if (Services.prefs.getStringPref(SOURCE_PREF, "omarchy") === "builtin") {
    signature = "builtin";
    apply(BUILTIN_CSS);
    return;
  }
  const dir = themeDir();
  const now = await stat(dir);
  if (now === null) {
    // Omarchy absent: Tokyo Night. Once a theme is showing, a missing file is far more likely
    // omarchy-theme-set between its rm and mv: keep the theme until the next one appears.
    signature = "missing";
    if (!loaded) apply(BUILTIN_CSS);
    return;
  }
  if (now === signature) return;
  signature = now;
  let text;
  try {
    text = await IOUtils.readUTF8(PathUtils.join(dir, "colors.toml"));
  } catch (e) {
    if (notFound(e)) signature = "";
    else throw e;
    return;
  }
  const lightMode = now.endsWith("|true");
  const r = cssFor(text, lightMode);
  if (r.errors.length) {
    // Logged once: the signature holds until the file changes again.
    const where = PathUtils.join(dir, "colors.toml");
    const list = r.errors.map((e) => `${e.line ? `line ${e.line}: ` : ""}${e.path} ${e.message}`);
    console.warn(`vimma: ${where} rejected, keeping the current theme:\n  ${list.join("\n  ")}`);
    Services.obs.notifyObservers(null, ERROR_TOPIC);
    return;
  }
  for (const w of r.warnings) console.info(`vimma: theme: ${w}`);
  loaded = true;
  apply(r.css);
}

/** One check at a time; a tick that finds one running is skipped. */
function poll() {
  if (running) return running;
  running = check()
    .catch((e) => console.error("vimma: theme check failed", e))
    .finally(() => {
      running = null;
    });
  return running;
}

function startTimer() {
  if (timer !== null) lazy.clearInterval(timer);
  const ms = Math.max(50, Services.prefs.getIntPref(POLL_PREF, DEFAULT_POLL_MS));
  timer = lazy.setInterval(poll, ms);
}

function stopTimer() {
  if (timer !== null) lazy.clearInterval(timer);
  timer = null;
}

/**
 * @param {unknown} _subject
 * @param {string} _topic
 * @param {string} pref
 */
function onPref(_subject, _topic, pref) {
  if (pref === POLL_PREF) {
    if (timer !== null) startTimer();
    return;
  }
  signature = "";
  loaded = false;
  // A check already running read the old prefs: check again once it is done.
  (running ?? Promise.resolve()).then(poll);
}

function start() {
  if (timer !== null) return;
  Services.prefs.addObserver(SOURCE_PREF, onPref);
  Services.prefs.addObserver(PATH_PREF, onPref);
  Services.prefs.addObserver(POLL_PREF, onPref);
  startTimer();
  // Never blocks startup: the windows already show Tokyo Night; this swaps when read.
  poll();
}

function stopIfIdle() {
  if (windows.size || timer === null) return;
  stopTimer();
  Services.prefs.removeObserver(SOURCE_PREF, onPref);
  Services.prefs.removeObserver(PATH_PREF, onPref);
  Services.prefs.removeObserver(POLL_PREF, onPref);
}

export const ThemeHost = {
  /**
   * Once per browser window (vimma.js), before its UI is built: the current tokens as an author
   * sheet, swapped in place on every theme change.
   * @param {Window} win
   */
  init(win) {
    if (windows.has(win)) return;
    const uri = sheetUri(css);
    win.windowUtils.loadSheetUsingURIString(uri, win.windowUtils.AUTHOR_SHEET);
    windows.set(win, uri);
    win.addEventListener(
      "unload",
      () => {
        windows.delete(win);
        stopIfIdle();
      },
      { once: true },
    );
    start();
  },

  /**
   * A start page's tokens: a <style> in its head, rewritten on every theme change.
   * @param {Document} doc
   */
  attachDocument(doc) {
    const style = /** @type {HTMLStyleElement} */ (doc.createElement("style"));
    style.textContent = css;
    doc.head.append(style);
    styles.add(new WeakRef(style));
  },

  /** The token stylesheet in force (tests, about:vimma later). */
  get css() {
    return css;
  },
};
