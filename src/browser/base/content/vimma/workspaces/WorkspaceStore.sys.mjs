/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The workspace definitions of the app (spec m3-workspaces, sub-spec 1): one per app, shared by
 * every window. Loads and saves `<profile>/vimma-workspaces.json` (JSONFile: debounced, atomic,
 * with a backup and a shutdown flush), reconciles it with `[workspaces]` and with Firefox's
 * containers, and owns the container lifecycle: create, adopt, update, and remove only through
 * an explicit, confirmed delete (decision 7). The pure part is core's workspacedefs.mjs.
 */

import {
  addRuntimeWorkspace,
  canWriteDefinitions,
  emptyDefinitions,
  newWorkspaceLooks,
  planContainers,
  readDefinitions,
  reconcileDefinitions,
  removeWorkspaceDefinition,
  renameWorkspaceDefinition,
  setLastActive,
  withContainer,
} from "../core/workspacedefs.mjs";

/** @import { Definitions, WorkspaceDefinition } from "../core/workspacedefs.mjs" */
/** @import { Workspace } from "../core/config.mjs" */

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  ContextualIdentityService:
    "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs",
  JSONFile: "resource://gre/modules/JSONFile.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

export const DEFINITIONS_FILE = "vimma-workspaces.json";
/** Observer topic: the definitions changed (subject null, data a JSON list of workspace ids). */
export const CHANGED_TOPIC = "vimma-workspaces-changed";
const CONTAINERS_PREF = "privacy.userContext.enabled";
/** `lastActive`'s container, so a start routes its first tab without reading the file. */
const STARTUP_PREF = "vimma.workspaces.startupUserContextId";

/** @param {string} code @param {string} message */
const storeError = (code, message) => Object.assign(new Error(message), { code });

/** @returns {string} */
const mintId = () => `ws-${Services.uuid.generateUUID().toString().slice(1, -1)}`;

export class WorkspaceStoreImpl {
  /** @type {Definitions} */
  definitions = emptyDefinitions();
  /** A newer vimma wrote the file: nothing is written, created or removed this session. */
  readOnly = false;
  /** Containers are off (`privacy.userContext.enabled`): no workspaces, upstream behaviour. */
  disabled = false;
  /** Names of workspaces whose container was gone or reused at startup and got a new one. */
  /** @type {string[]} */
  lostContainers = [];

  #path;
  #config;
  #enabled;
  /** @type {string | null} */
  #cachePref;
  /** @type {any} */
  #file = null;
  /** @type {Promise<void> | null} */
  #ready = null;
  /** Active workspace id per window (WindowWorkspaces sets it, sub-spec 2b). */
  /** @type {WeakMap<object, string>} */
  #active = new WeakMap();

  /**
   * @param {{ path?: string, config?: readonly Workspace[],
   *   enabled?: () => boolean, saveDelayMs?: number, cachePref?: string | null }} [options]
   *   `config` is the resolved `[workspaces]` (core `mergeWithDefaults(...).workspaces`); the M5
   *   host passes it once it reads `config.toml`. `enabled` reads the containers pref.
   *   `cachePref` (the app's store only) caches `lastActive`'s container for the next start.
   */
  constructor({
    path = PathUtils.join(PathUtils.profileDir, DEFINITIONS_FILE),
    config = [],
    enabled = () => Services.prefs.getBoolPref(CONTAINERS_PREF, true),
    saveDelayMs,
    cachePref = null,
  } = {}) {
    this.#cachePref = cachePref;
    this.#path = path;
    this.#config = config;
    this.#enabled = enabled;
    this.saveDelayMs = saveDelayMs;
  }

  get path() {
    return this.#path;
  }

  /** Loads, reconciles and checks containers, once; later calls return the same promise. */
  init() {
    this.#ready ??= this.#init();
    return this.#ready;
  }

  async #init() {
    if (!this.#enabled()) {
      this.disabled = true;
      return;
    }
    const file = this.#open();
    await file.load();
    this.definitions = await this.#parse(file.data);
    const { definitions, changed } = reconcileDefinitions(this.definitions, this.#config, mintId);
    // Read-only: keep what was read (lenient) plus config, in memory only, with no containers.
    this.definitions = definitions;
    if (this.readOnly) return;
    const containersChanged = this.#checkContainers();
    if (changed || containersChanged) this.#save();
  }

  #open() {
    this.#file ??= new lazy.JSONFile({
      path: this.#path,
      backupTo: `${this.#path}.bak`,
      saveDelayMs: this.saveDelayMs,
      // A second guard: never replace a file a newer vimma wrote meanwhile.
      beforeSave: async () => {
        const text = await IOUtils.readUTF8(this.#path).catch(() => null);
        if (!canWriteDefinitions(text)) {
          throw storeError("read-only", `${this.#path} was written by a newer vimma`);
        }
      },
    });
    return this.#file;
  }

  /**
   * @param {unknown} raw JSONFile's data: `{}` for a missing file
   * @returns {Promise<Definitions>}
   */
  async #parse(raw) {
    if (raw && typeof raw === "object" && Object.keys(raw).length === 0) {
      return emptyDefinitions();
    }
    if (!canWriteDefinitions(raw)) {
      this.readOnly = true;
      console.warn(`vimma: ${this.#path} is from a newer vimma; workspaces are read-only`);
      try {
        return readDefinitions({ .../** @type {object} */ (raw), schema: 1 });
      } catch {
        return emptyDefinitions();
      }
    }
    try {
      return readDefinitions(raw);
    } catch (e) {
      // Valid JSON, invalid definitions: keep it aside rather than silently emptying it (Zen
      // #12460). JSONFile itself moves unparsable files to `.corrupt` and restores the backup.
      const aside = `${this.#path}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      console.error(`vimma: ${this.#path} is invalid, moved to ${aside}:`, e);
      await IOUtils.copy(this.#path, aside).catch(console.error);
      return emptyDefinitions();
    }
  }

  /** The startup container check. @returns {boolean} whether the definitions changed */
  #checkContainers() {
    const CIS = lazy.ContextualIdentityService;
    const plan = planContainers(this.definitions, CIS.getPublicIdentities());
    const before = this.definitions;
    for (const id of plan.create) {
      const w = this.#def(id);
      if (w.userContextId !== null) this.lostContainers.push(w.name);
      this.#createContainer(w);
    }
    for (const id of plan.update) {
      const w = this.#def(id);
      CIS.update(w.userContextId, w.name, w.icon, w.color);
    }
    return this.definitions !== before;
  }

  /** @param {WorkspaceDefinition} w */
  #createContainer(w) {
    const identity = lazy.ContextualIdentityService.create(w.name, w.icon, w.color);
    this.definitions = withContainer(this.definitions, w.id, identity.userContextId);
    return identity.userContextId;
  }

  /** @param {string} id */
  #def(id) {
    return /** @type {WorkspaceDefinition} */ (
      this.definitions.workspaces.find((w) => w.id === id)
    );
  }

  #save() {
    if (this.readOnly || this.disabled) return;
    const file = this.#open();
    file.data = this.definitions;
    file.saveSoon();
    if (this.#cachePref) {
      const last = this.definitions.workspaces.find((w) => w.id === this.definitions.lastActive);
      Services.prefs.setIntPref(this.#cachePref, last?.userContextId ?? 0);
    }
  }

  /** @param {string[]} ids */
  #notify(ids) {
    Services.obs.notifyObservers(null, CHANGED_TOPIC, JSON.stringify(ids));
  }

  #writable() {
    if (this.disabled) throw storeError("disabled", "workspaces are disabled (containers are off)");
    if (this.readOnly) {
      throw storeError("read-only", "workspaces are read-only (a newer vimma wrote them)");
    }
  }

  /**
   * Creates a runtime workspace with its own new container (decision 1).
   * @param {{ name: string, color: string, icon: string, home?: string }} w
   * @returns {WorkspaceDefinition}
   */
  addWorkspace(w) {
    this.#writable();
    const id = mintId();
    // Validates first, so a bad name never leaves a stray container behind.
    this.definitions = addRuntimeWorkspace(this.definitions, { ...w, id });
    this.#createContainer(this.#def(id));
    this.#save();
    this.#notify([id]);
    return this.#def(id);
  }

  /**
   * Deletes a runtime workspace and its container, which deletes the container's cookies and
   * site data (decision 7). Only with `confirmed: true`, which the caller passes after the user
   * said yes (the prompt is sub-spec 4a). Closes the container's tabs first. A container whose
   * name is no longer the workspace's (reused after a reset) is not ours and is left alone.
   * @param {string} id
   * @param {{ confirmed?: boolean }} [options]
   */
  async deleteWorkspace(id, { confirmed = false } = {}) {
    if (confirmed !== true) {
      throw storeError("not-confirmed", "deleting a workspace needs the user's confirmation");
    }
    this.#writable();
    const { definitions, removed } = removeWorkspaceDefinition(this.definitions, id);
    const CIS = lazy.ContextualIdentityService;
    const ucid = removed.userContextId;
    const ours = ucid !== null && CIS.getPublicIdentityFromId(ucid)?.name === removed.name;
    this.definitions = definitions;
    this.#save();
    if (ours) {
      await CIS.closeContainerTabs(ucid);
      CIS.remove(ucid);
    }
    this.#notify([id]);
  }

  /**
   * `prefix+shift+n` / `:wsnew name` (sub-spec 4a): a runtime workspace in the first colour no
   * workspace uses.
   * @param {string} name
   * @returns {WorkspaceDefinition}
   */
  newWorkspace(name) {
    return this.addWorkspace({ name, ...newWorkspaceLooks(this.definitions) });
  }

  /**
   * Renames a runtime workspace and its container (whose name must stay the workspace's: the
   * startup check adopts a container by id and name). Throws `config-workspace` for a config
   * one, `bad-name`, `duplicate-name`.
   * @param {string} id
   * @param {string} name
   */
  renameWorkspace(id, name) {
    this.#writable();
    const before = this.definitions;
    this.definitions = renameWorkspaceDefinition(before, id, name);
    if (this.definitions === before) return;
    const w = this.#def(id);
    const CIS = lazy.ContextualIdentityService;
    const old = before.workspaces.find((d) => d.id === id);
    const ucid = w.userContextId;
    if (ucid !== null && CIS.getPublicIdentityFromId(ucid)?.name === old?.name) {
      CIS.update(ucid, w.name, w.icon, w.color);
    }
    this.#save();
    this.#notify([id]);
  }

  /**
   * Closes a workspace after the user said yes (decision 7): a runtime one is deleted with its
   * container and site data (deleteWorkspace); a config one only loses its tabs, in every
   * window, and stays with its container. The last workspace stays (`last-workspace`).
   * @param {string} id
   * @param {{ confirmed?: boolean }} [options]
   */
  async closeWorkspace(id, { confirmed = false } = {}) {
    const w = this.definitions.workspaces.find((d) => d.id === id);
    if (w?.source !== "config") return this.deleteWorkspace(id, { confirmed });
    if (confirmed !== true) {
      throw storeError("not-confirmed", "closing a workspace needs the user's confirmation");
    }
    if (this.definitions.workspaces.length === 1) {
      throw storeError("last-workspace", "cannot close the last workspace");
    }
    if (w.userContextId !== null) {
      await lazy.ContextualIdentityService.closeContainerTabs(w.userContextId);
    }
    return undefined;
  }

  /**
   * The config's `[workspaces]` changed (ConfigHost, m5-config-load): reconciles the definitions
   * with it as init does (a workspace gone from the file becomes runtime; nothing is removed),
   * gives new ones a container, saves and tells the windows.
   * @param {readonly Workspace[]} config  core `mergeWithDefaults(...).workspaces`
   */
  async setConfig(config) {
    this.#config = config;
    if (!this.#ready) return; // init() reads it
    await this.#ready;
    if (this.disabled || this.readOnly) return;
    const before = this.definitions;
    const { definitions, changed } = reconcileDefinitions(before, this.#config, mintId);
    this.definitions = definitions;
    const containersChanged = this.#checkContainers();
    if (!changed && !containersChanged) return;
    this.#save();
    this.#notify(this.definitions.workspaces.map((w) => w.id));
  }

  /**
   * Records the workspace a window switched to; it becomes `lastActive` for the next start.
   * @param {object | null} win
   * @param {string} id
   */
  setActive(win, id) {
    if (win) this.#active.set(win, id);
    const next = setLastActive(this.definitions, id);
    if (next !== this.definitions) {
      this.definitions = next;
      this.#save();
    }
  }

  /**
   * The container a tab or window opened without one takes (decision 3): the window's active
   * workspace's, else the most recent browser window's, else `lastActive`'s. Null for private
   * windows and popups, and when workspaces are disabled, so upstream behaviour stays there.
   * Before init has loaded the file it reads it synchronously (as ContextualIdentityService does).
   * @param {any} win
   * @returns {number | null}
   */
  defaultUserContextId(win) {
    if (this.disabled || !this.#enabled()) return null;
    if (win && (lazy.PrivateBrowsingUtils.isWindowPrivate(win) || win.toolbar?.visible === false)) {
      return null;
    }
    const top = lazy.BrowserWindowTracker.getTopWindow({ private: false });
    const active = (win && this.#active.get(win)) ?? (top && this.#active.get(top));
    // Also while init() is still loading: a window's first tab at startup is set up before it
    // ends. The container cached at the last save spares the synchronous read.
    if (!this.#file?.dataReady) {
      const cached = this.#cachePref ? Services.prefs.getIntPref(this.#cachePref, 0) : 0;
      if (!active && cached > 0) return cached;
      this.#readSync();
    }
    const id = active ?? this.definitions.lastActive;
    return this.definitions.workspaces.find((w) => w.id === id)?.userContextId ?? null;
  }

  #readSync() {
    const file = this.#open();
    file.ensureDataReady();
    try {
      this.definitions = readDefinitions(file.data);
    } catch {
      // Missing, newer or invalid: init() sorts it out; until then, no default.
    }
  }

  /** Flushes a pending save and stops saving (shutdown does this on its own). */
  async finalize() {
    if (this.#file) await this.#file.finalize();
  }
}

/** The app's store. */
export const WorkspaceStore = new WorkspaceStoreImpl({ cachePref: STARTUP_PREF });
