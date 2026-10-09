/**
 * Compile defaults + user config into per-mode tries for the dispatcher.
 * See docs/specs/m0-core-dispatcher.md § Dispatcher contract, § Config input.
 */
import { resolveActionName, suggestAction } from "./actions.mjs";
import { DEFAULT_CONFIG } from "./defaults.mjs";
import { KeyNotationError, formatKey, parseBinding, parseKey } from "./keys.mjs";
import { MODES, isMode } from "./modes.mjs";

/** @import { Chord } from "./keys.mjs" */
/** @import { BindingElement } from "./keys.mjs" */
/** @import { ActionDef } from "./actions.mjs" */
/** @import { Mode } from "./modes.mjs" */
/** @import { UserConfig } from "./defaults.mjs" */

/**
 * @typedef {object} TrieNode
 * @property {Map<string, TrieNode>} children   keyed by formatKey(chord)
 * @property {ActionDef} [action]
 * @property {string} label                     display text for pending() ("prefix", "g", ...)
 */

/**
 * @typedef {object} Entry
 * @property {string} text        as written in config
 * @property {ActionDef} action
 * @property {string} seq         canonical concrete sequence, e.g. "ctrl+b c"
 * @property {Chord[]} chords
 * @property {string[]} labels
 * @property {"keys" | "modal"} layer
 * @property {Set<Mode>} modes
 */

export class KeymapError extends Error {
  /**
   * @param {string} message
   * @param {string} path         config path, e.g. keys.new_tab[1]
   * @param {string} [suggestion]
   */
  constructor(message, path, suggestion) {
    super(`${path}: ${message}${suggestion ? ` (did you mean "${suggestion}"?)` : ""}`);
    this.name = "KeymapError";
    this.path = path;
    this.suggestion = suggestion;
  }
}

/**
 * @param {string} text
 * @param {string} path
 * @returns {ActionDef}
 */
function resolveOrThrow(text, path) {
  const a = resolveActionName(text);
  if (!a) throw new KeymapError(`unknown action "${text}"`, path, suggestAction(text));
  return a;
}

/**
 * @template T
 * @param {() => T} fn
 * @param {string} path
 * @returns {T}
 */
function notation(fn, path) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof KeyNotationError) throw new KeymapError(e.message, path);
    /* c8 ignore next */
    throw e;
  }
}

/**
 * @param {unknown} v
 * @param {string} path
 * @returns {string[]}
 */
function asList(v, path) {
  if (typeof v === "string") return [v];
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
  throw new KeymapError("expected a key string or a list of key strings", path);
}

/**
 * @param {UserConfig} [user]
 */
export function compileKeymap(user = {}) {
  const defKeys = /** @type {Record<string, string | string[]>} */ (DEFAULT_CONFIG.keys);
  const defModal = /** @type {Record<string, unknown>} */ (DEFAULT_CONFIG.modal);
  const userKeys = user.keys ?? {};
  const userModal = /** @type {Record<string, unknown>} */ (user.modal ?? {});
  /** @type {Set<string>} */
  const overridden = new Set();

  const prefix = notation(
    () => parseKey(/** @type {string} */ (userKeys.prefix ?? defKeys.prefix)),
    "keys.prefix",
  );
  const leaderText = /** @type {string} */ (userModal.leader ?? defModal.leader);
  const leader = notation(() => parseKey(leaderText), "modal.leader");
  const timeoutMs = userModal.timeout_ms ?? defModal.timeout_ms;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new KeymapError("must be a non-negative number of milliseconds", "modal.timeout_ms");
  }

  /**
   * @param {BindingElement[]} els
   * @returns {{ chords: Chord[], labels: string[] }}
   */
  const concretise = (els) => {
    const chords = els.map((e) =>
      "special" in e ? (e.special === "prefix" ? prefix : leader) : e,
    );
    const labels = els.map((e) => ("special" in e ? e.special : formatKey(e)));
    return { chords, labels };
  };

  /** @type {Entry[]} */
  const entries = [];

  // [keys] layer: user lists replace default lists per action (Herdr semantics).
  /** @type {Record<string, string | string[]>} */
  const keyTable = { ...defKeys };
  for (const [name, value] of Object.entries(userKeys)) {
    if (name === "prefix") continue;
    const action = resolveOrThrow(name, `keys.${name}`);
    asList(value, `keys.${name}`);
    delete keyTable[action.name];
    keyTable[name] = value;
    overridden.add(action.name);
  }
  for (const [name, value] of Object.entries(keyTable)) {
    if (name === "prefix") continue;
    const action = resolveOrThrow(name, `keys.${name}`);
    asList(value, `keys.${name}`).forEach((text, i) => {
      const path = Array.isArray(value) ? `keys.${name}[${i}]` : `keys.${name}`;
      const els = notation(() => parseBinding(text), path);
      const first = els[0];
      const global =
        !!first &&
        ("special" in first ? first.special === "prefix" : first.ctrl || first.alt || first.meta);
      const { chords, labels } = concretise(els);
      entries.push({
        text,
        action,
        seq: chords.map(formatKey).join(" "),
        chords,
        labels,
        layer: "keys",
        modes: new Set(global ? MODES : ["normal"]),
      });
    });
  }

  // [modal.<mode>] layer: user entries are merged over default entries per sequence.
  for (const key of Object.keys(userModal)) {
    if (key === "leader" || key === "timeout_ms") continue;
    if (!isMode(key)) {
      throw new KeymapError(
        `unknown mode "${key}"`,
        `modal.${key}`,
        MODES.find((m) => m[0] === key[0]),
      );
    }
  }
  for (const mode of MODES) {
    /** @type {Map<string, Entry>} */
    const bySeq = new Map();
    const tables = [
      [/** @type {Record<string, unknown>} */ (defModal[mode] ?? {}), false],
      [/** @type {Record<string, unknown>} */ (userModal[mode] ?? {}), true],
    ];
    for (const [table, isUser] of /** @type {[Record<string, unknown>, boolean][]} */ (tables)) {
      for (const [text, value] of Object.entries(table)) {
        const path = `modal.${mode}.${JSON.stringify(text)}`;
        if (typeof value !== "string") throw new KeymapError("expected an action name", path);
        const action = resolveOrThrow(value, path);
        const { chords, labels } = concretise(notation(() => parseBinding(text), path));
        const seq = chords.map(formatKey).join(" ");
        const prev = bySeq.get(seq);
        if (isUser) {
          overridden.add(action.name);
          if (prev) overridden.add(prev.action.name);
        } else if (prev && prev.action !== action) {
          throw new KeymapError(`"${text}" is already bound to ${prev.action.name}`, path);
        }
        bySeq.set(seq, {
          text,
          action,
          seq,
          chords,
          labels,
          layer: "modal",
          modes: new Set([mode]),
        });
      }
    }
    for (const e of bySeq.values()) {
      // A modal binding shadows a [keys] binding with the same sequence in its mode.
      for (const k of entries) if (k.layer === "keys" && k.seq === e.seq) k.modes.delete(mode);
      entries.push(e);
    }
  }

  // [unbind]
  for (const [mode, list] of Object.entries(user.unbind ?? {})) {
    if (!isMode(mode)) throw new KeymapError(`unknown mode "${mode}"`, `unbind.${mode}`);
    asList(list, `unbind.${mode}`).forEach((text, i) => {
      const els = notation(() => parseBinding(text), `unbind.${mode}[${i}]`);
      const seq = concretise(els).chords.map(formatKey).join(" ");
      for (const e of entries) {
        if (e.seq === seq && e.modes.delete(mode)) overridden.add(e.action.name);
      }
    });
  }

  // Build one trie per mode; detect conflicts within a mode.
  /** @type {Record<string, TrieNode>} */
  const tries = {};
  /** @type {Record<string, Entry[]>} */
  const perMode = {};
  for (const mode of MODES) {
    /** @type {Map<string, Entry>} */
    const seen = new Map();
    for (const e of entries) {
      if (!e.modes.has(mode)) continue;
      const prev = seen.get(e.seq);
      if (prev && prev.action !== e.action) {
        throw new KeymapError(
          `"${e.text}" is already bound to ${prev.action.name} in ${mode} mode`,
          `keys.${e.action.name}`,
        );
      }
      if (!prev) seen.set(e.seq, e);
    }
    /** @type {TrieNode} */
    const root = { children: new Map(), label: "" };
    for (const e of seen.values()) {
      let node = root;
      e.chords.forEach((c, i) => {
        const k = formatKey(c);
        let next = node.children.get(k);
        if (!next) {
          next = { children: new Map(), label: /** @type {string} */ (e.labels[i]) };
          node.children.set(k, next);
        }
        node = next;
      });
      node.action = e.action;
    }
    tries[mode] = root;
    perMode[mode] = [...seen.values()];
  }

  return {
    prefix,
    leader,
    timeoutMs,
    /** @param {Mode} mode */
    trie: (mode) => /** @type {TrieNode} */ (tries[mode]),
    /** @param {Mode} mode */
    sequences: (mode) =>
      /** @type {Entry[]} */ (perMode[mode]).map((e) => ({ seq: e.seq, name: e.action.name })),
    /**
     * Binding texts as written, for help. Modal bindings outside normal mode carry their mode.
     * @param {string} name
     */
    bindingsFor(name) {
      /** @type {string[]} */
      const out = [];
      for (const e of entries) {
        if (e.action.name !== name || e.modes.size === 0) continue;
        const mode = /** @type {Mode} */ ([...e.modes][0]);
        const text = e.layer === "modal" && mode !== "normal" ? `${e.text} [${mode}]` : e.text;
        if (!out.includes(text)) out.push(text);
      }
      return out;
    },
    /** @param {string} name */
    isOverridden: (name) => overridden.has(name),
  };
}

/** @typedef {ReturnType<typeof compileKeymap>} Keymap */
