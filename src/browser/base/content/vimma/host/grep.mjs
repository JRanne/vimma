/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Live grep (docs/specs/live-grep.md): one session per window. It sends the query to every frame
// of every loaded tab in scope (`Vimma:Grep`), checks each reply (core parseGrepReply), merges
// them in tab order (core grepRows) and renders them in the picker (ui/grep.mjs); it asks the
// selected result's frame for the preview, jumps on Enter, and keeps the grep list for ]q / [q.
// Only this window's tabs are searched, so the private workspace (its own window) and normal
// windows never see each other's pages (decision 13).

import {
  GREP_CAPS,
  grepCountText,
  grepListText,
  grepPickerKey,
  grepRows,
  holdReply,
  openGrepPicker,
  parseGrepReply,
  parsePreviewReply,
  parseQuery,
  pruneGrepList,
  setGrepRows,
  stepGrepList,
} from "../core/grep.mjs";
import { PRIVATE_NAME } from "../core/privatews.mjs";
import { VimmaActors } from "../actors/VimmaActors.sys.mjs";
import { WorkspaceStore } from "../workspaces/WorkspaceStore.sys.mjs";
import { pickerWorkspaces, tabById } from "./goto.mjs";
import { isPrivateWorkspace } from "./private-ops.mjs";
import { GrepPicker } from "../ui/grep.mjs";

/** @import { GrepFrame, GrepList, GrepMatchRow, GrepPickerState, GrepRow, GrepTab } from "../core/grep.mjs" */
/** @import { GrepInfo } from "../ui/grep.mjs" */

const { clearTimeout, setTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs",
);

/** Decision 14: the debounce after a keystroke, tabs asked at a time, a frame's time to answer. */
const DEBOUNCE_MS = 80;
const PREVIEW_DEBOUNCE_MS = 40;
const CONCURRENT_TABS = 8;
const FRAME_TIMEOUT_MS = 2000;
const MAX_TABS = 200;

export const GONE_TEXT = "match no longer on the page";
export const NO_LIST_TEXT = "grep: no results to step through";

/**
 * @typedef {object} GrepHost
 * @property {(text: string) => void} notice
 * @property {() => void} emit  the mode may have changed (the picker opened or closed)
 */

/** @param {string} url */
function hostOf(url) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * @param {Window} win
 * @returns {any} gBrowser
 */
const gBrowserOf = (win) => /** @type {any} */ (win).gBrowser;

/**
 * Resolves once the tab switch in progress is done (Firefox's TabSwitchDone), so the page has
 * its viewport's size before the match is scrolled to its middle; after a second at most.
 * @param {Window} win
 * @returns {Promise<void>}
 */
function switchDone(win) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, 1000);
    function done() {
      clearTimeout(timer);
      win.removeEventListener("TabSwitchDone", done);
      resolve();
    }
    win.addEventListener("TabSwitchDone", done);
  });
}

/** @type {GrepInfo} */
const IDLE = Object.freeze({
  count: 0,
  literal: false,
  timedOut: false,
  busy: false,
  cut: false,
  tooLong: false,
});

export class GrepSession {
  /**
   * @param {Window} win
   * @param {GrepHost} host
   */
  constructor(win, host) {
    this.win = win;
    this.host = host;
    this.ui = new GrepPicker(win);
    /** @type {GrepPickerState | null} */
    this.state = null;
    /** @type {GrepInfo} */
    this.info = { ...IDLE };
    /** The generation of the newest search; replies for an older one are dropped. */
    this.gen = 0;
    /** @type {number | undefined} */
    this.timer = undefined;
    /** @type {number | undefined} */
    this.previewTimer = undefined;
    /** @type {Map<string, { bc: any, wg: any }>} each searched frame, by `${tabId}:${key}` */
    this.frames = new Map();
    /** @type {GrepList | null} the last jump's results (decision 8) */
    this.list = null;
    /** The query `:grep` alone resumes. */
    this.lastQuery = "";
    /** @type {Element | null} focused before open */
    this.opener = null;
    // A closed tab's lines leave the grep list at once (G5).
    this.onTabClose = (/** @type {Event} */ e) => {
      if (!this.list) return;
      const closed = /** @type {any} */ (e.target);
      this.list = pruneGrepList(this.list, (id) => tabById(win, id) !== closed);
    };
    win.addEventListener("TabClose", this.onTabClose);
  }

  get isOpen() {
    return this.ui.isOpen;
  }

  /**
   * A frame's reply to one message; the test replaces it to hold replies back.
   * @param {any} bc
   * @param {object} data
   * @param {string} [name]
   * @returns {Promise<unknown>}
   */
  ask(bc, data, name = "Vimma:Grep") {
    return VimmaActors.grepAsk(bc, name, data, FRAME_TIMEOUT_MS);
  }

  /**
   * `ctrl+b f g` (empty) and `:grep text` (that query); `:grep` alone resumes (`resume`).
   * @param {string} [text]
   */
  open(text) {
    if (this.isOpen) return;
    this.opener = Services.focus.focusedElement;
    // Frames from earlier searches are kept only while the grep list can go back to them.
    const kept = new Set(
      (this.list?.rows ?? []).map((r) => `${r.tabId}:${r.kind === "match" ? r.frameKey : ""}`),
    );
    for (const key of this.frames.keys()) if (!kept.has(key)) this.frames.delete(key);
    const query = text ?? "";
    this.state = openGrepPicker(query);
    this.info = { ...IDLE };
    this.ui.open();
    this.state = { ...this.state, preview: this.ui.previewShown() };
    this.render();
    this.host.emit();
    if (query) this.search();
  }

  /** `:grep` alone: the last query, re-run (Telescope's resume). */
  resume() {
    this.open(this.lastQuery);
  }

  /**
   * One key (formatKey text) while the picker is open.
   * @param {string} key
   */
  key(key) {
    if (!this.state) return;
    const before = this.state;
    const { state, effect } = grepPickerKey({ ...before, preview: this.ui.previewShown() }, key);
    this.state = state;
    if (effect?.type === "close") {
      this.close();
      return;
    }
    if (effect?.type === "select") {
      this.choose(effect.row);
      return;
    }
    if (effect?.type === "preview") this.ui.scrollPreview(effect.by);
    if (effect?.type === "query" || effect?.type === "scope") {
      // Until the new search answers, the rows on screen are the old query's.
      this.info = { ...this.info, busy: !!this.state.query };
    }
    if (effect?.type === "query") {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.search(), DEBOUNCE_MS);
    }
    if (effect?.type === "scope") {
      clearTimeout(this.timer);
      this.search();
    }
    if (state !== before) this.render();
  }

  /** Renders the state, and asks for the preview when the selected result changed. */
  render() {
    if (!this.state || !this.isOpen) return;
    this.ui.render(this.state, this.info);
    const row = this.state.rows[this.state.selected] ?? null;
    const id = row?.kind === "match" ? row.id : null;
    if (id === this.ui.previewOf) return;
    clearTimeout(this.previewTimer);
    if (!row || row.kind !== "match") {
      this.ui.setPreview(null, null);
      return;
    }
    this.previewTimer = setTimeout(() => this.preview(row), PREVIEW_DEBOUNCE_MS);
  }

  /** @param {GrepMatchRow} row */
  async preview(row) {
    const frame = this.frames.get(`${row.tabId}:${row.frameKey}`);
    if (!frame || frame.bc.currentWindowGlobal !== frame.wg) return;
    const raw = await this.ask(frame.bc, { start: row.start, end: row.end }, "Vimma:GrepPreview");
    const current = this.state?.rows[this.state.selected];
    if (!this.isOpen || current?.id !== row.id) return;
    this.ui.setPreview(row.id, parsePreviewReply(raw));
  }

  /**
   * The tabs in the scope, in the order the list shows them (decision 10).
   * @param {GrepPickerState["scope"]} scope
   * @returns {{ tab: GrepTab, browser: any }[]}
   */
  scopeTabs(scope) {
    const win = this.win;
    const model = pickerWorkspaces(win);
    const agentId = WorkspaceStore.agent?.id ?? null;
    const priv = isPrivateWorkspace(win);
    const selected = gBrowserOf(win).selectedTab;
    /** @type {{ tab: GrepTab, browser: any }[]} */
    const out = [];
    for (const w of model.workspaces) {
      if (scope !== "window" && w.id !== model.active) continue;
      w.tabs.forEach((id, i) => {
        const tab = /** @type {any} */ (tabById(win, id));
        if (!tab || tab.closing) return;
        if (scope === "tab" && tab !== selected) return;
        const browser = tab.linkedBrowser;
        const loaded =
          !!tab.linkedPanel && !tab.hasAttribute("pending") && !!browser?.browsingContext;
        const url = browser?.currentURI?.spec ?? "";
        out.push({
          browser,
          tab: {
            tabId: id,
            index: i + 1,
            title: browser?.contentTitle || tab.label || url,
            host: hostOf(url),
            workspace: priv ? PRIVATE_NAME : w.name,
            agent: w.id === agentId,
            loaded,
          },
        });
      });
    }
    return out.slice(0, MAX_TABS);
  }

  /** Runs the current query in the current scope; replies stream into the list. */
  async search() {
    if (!this.state) return;
    const gen = ++this.gen;
    const { query, scope } = this.state;
    const parsed = parseQuery(query);
    const live = () => this.gen === gen && this.isOpen;
    if (query) this.lastQuery = query;
    /** @type {Map<string, (GrepFrame | null)[]>} */
    const slots = new Map();
    // A query no frame would take is not sent (G6); the prompt says why.
    const tooLong = query.length > GREP_CAPS.query;
    const scoped = parsed && !tooLong ? this.scopeTabs(scope) : [];
    const tabs = scoped.map((s) => s.tab);
    this.info = {
      ...IDLE,
      literal: !!parsed?.literal,
      busy: !!parsed && !tooLong,
      tooLong,
    };
    /** Matches kept for this search: past the row cap, replies keep their counts only. */
    let held = 0;
    let pending = false;
    const update = () => {
      if (!live() || !this.state) return;
      /** @type {Map<string, GrepFrame[]>} */
      const frames = new Map();
      for (const [id, list] of slots) {
        frames.set(id, /** @type {GrepFrame[]} */ (list.filter(Boolean)));
      }
      const { rows, count, tabsWithMatches } = grepRows(tabs, frames);
      this.info = { ...this.info, count };
      this.state = setGrepRows(this.state, rows);
      this.render();
      if (!this.info.busy) {
        const listed = rows.filter((r) => r.kind === "match").length;
        this.ui.announce(query ? grepCountText(listed, count, tabsWithMatches) : "");
      }
    };
    // Coalesces replies that arrive together into one render.
    const schedule = () => {
      if (pending) return;
      pending = true;
      Services.tm.dispatchToMainThread(() => {
        pending = false;
        update();
      });
    };
    update();
    const queue = scoped.filter((s) => s.tab.loaded);
    const worker = async () => {
      for (let next = queue.shift(); next && live(); next = queue.shift()) {
        const { tab, browser } = next;
        const { frames: bcs, cut } = VimmaActors.grepFrames(browser, GREP_CAPS.frames);
        if (cut) this.info = { ...this.info, cut: true };
        const topSite = bcs[0]?.currentWindowGlobal?.documentPrincipal?.siteOrigin;
        /** @type {(GrepFrame | null)[]} */
        const list = bcs.map(() => null);
        slots.set(tab.tabId, list);
        await Promise.all(
          bcs.map(async (bc, i) => {
            const wg = bc.currentWindowGlobal;
            const key = String(bc.id);
            // Recorded as it is asked, so the frame is told to drop its text at close even
            // if it never answers in time (G5).
            this.frames.set(`${tab.tabId}:${key}`, { bc, wg });
            const raw = await this.ask(bc, { query, gen });
            if (!live()) return;
            if (raw === null) {
              if (wg && !wg.isClosed) this.info = { ...this.info, timedOut: true };
              return;
            }
            const parsedReply = parseGrepReply(raw);
            if (!parsedReply) return;
            if (parsedReply.timedOut) this.info = { ...this.info, timedOut: true };
            if (parsedReply.cut) this.info = { ...this.info, cut: true };
            const kept = holdReply(parsedReply, held);
            held = kept.held;
            const reply = kept.reply;
            const principal = wg?.documentPrincipal;
            const host =
              i > 0 && principal && principal.siteOrigin !== topSite
                ? hostOf(wg.documentURI?.spec ?? "")
                : null;
            list[i] = { key, host, reply };
            if (reply.count) schedule();
          }),
        );
      }
    };
    await Promise.all(Array.from({ length: CONCURRENT_TABS }, worker));
    if (!live()) return;
    this.info = { ...this.info, busy: false };
    update();
  }

  /**
   * Enter on a row: closes the picker and goes there (decision 7, 11).
   * @param {GrepRow} row
   */
  async choose(row) {
    const state = this.state;
    this.close({ keepFrames: true });
    if (row.kind === "unloaded") {
      const tab = tabById(this.win, row.tabId);
      if (tab) gBrowserOf(this.win).selectedTab = tab;
      this.endFrames();
      return;
    }
    const rows = (state?.all ?? []).filter((r) => r.kind === "match");
    this.list = { query: state?.query ?? "", rows, index: Math.max(0, rows.indexOf(row)) };
    await this.jump(row, state?.query ?? "");
    this.endFrames();
    // Only the frames the grep list can go back to are kept.
    const kept = new Set(rows.map((r) => `${r.tabId}:${/** @type {GrepMatchRow} */ (r).frameKey}`));
    for (const key of this.frames.keys()) if (!kept.has(key)) this.frames.delete(key);
  }

  /**
   * Selects the row's tab and asks its frame to select the match.
   * @param {GrepMatchRow} row
   * @param {string} query
   */
  async jump(row, query) {
    const win = this.win;
    const tab = /** @type {any} */ (tabById(win, row.tabId));
    if (!tab) {
      this.host.notice(GONE_TEXT);
      return;
    }
    const gBrowser = gBrowserOf(win);
    if (gBrowser.selectedTab !== tab) {
      const shown = switchDone(win);
      gBrowser.selectedTab = tab;
      await shown;
    }
    tab.linkedBrowser?.focus();
    const frame = this.frames.get(`${row.tabId}:${row.frameKey}`);
    const bc = frame?.bc;
    // Only the document that was searched: a frame that navigated since gets nothing.
    const inTab =
      bc &&
      !bc.isDiscarded &&
      bc.top === tab.linkedBrowser?.browsingContext &&
      bc.currentWindowGlobal === frame.wg;
    const text = row.context.slice(row.at[0], row.at[1]);
    const data = { query, start: row.start, end: row.end, ordinal: row.ordinal, text };
    const done = inTab ? await this.ask(bc, data, "Vimma:GrepJump") : false;
    if (done !== true) this.host.notice(GONE_TEXT);
  }

  /**
   * `]q` / `[q`: the next or previous result of the grep list (decision 8).
   * @param {1 | -1} dir
   */
  async step(dir) {
    if (!this.list) {
      this.host.notice(NO_LIST_TEXT);
      return;
    }
    const alive = (/** @type {string} */ id) => {
      const tab = /** @type {any} */ (tabById(this.win, id));
      return !!tab && !tab.closing;
    };
    const next = stepGrepList(this.list, dir, alive);
    if (!next) {
      this.list = null;
      this.host.notice(NO_LIST_TEXT);
      return;
    }
    this.list = next;
    const row = /** @type {GrepMatchRow} */ (next.rows[next.index]);
    this.host.notice(grepListText(next));
    await this.jump(row, next.query);
    const frame = this.frames.get(`${row.tabId}:${row.frameKey}`);
    if (frame) await this.ask(frame.bc, {}, "Vimma:GrepEnd");
  }

  /** Tells every searched frame to drop its text model (decision 14). */
  endFrames() {
    for (const { bc } of this.frames.values()) {
      this.ask(bc, {}, "Vimma:GrepEnd").catch(() => {});
    }
  }

  /**
   * Closes the picker; focus returns where it was.
   * @param {{ keepFrames?: boolean, tabChanged?: boolean }} [options]
   */
  close({ keepFrames = false, tabChanged = false } = {}) {
    if (!this.isOpen) return;
    clearTimeout(this.timer);
    clearTimeout(this.previewTimer);
    this.gen++;
    this.ui.close();
    this.state = null;
    if (!keepFrames) this.endFrames();
    const opener = this.opener;
    this.opener = null;
    if (!keepFrames) {
      if (tabChanged || !opener?.isConnected) gBrowserOf(this.win).selectedBrowser.focus();
      else /** @type {HTMLElement} */ (opener).focus();
    }
    this.host.emit();
  }

  /** VimmaHost.uninit */
  destroy() {
    this.close();
    this.win.removeEventListener("TabClose", this.onTabClose);
    this.ui.destroy();
    this.frames.clear();
    this.list = null;
  }
}

export { GREP_CAPS };
