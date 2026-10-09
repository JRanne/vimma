/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * config.toml: parse, validate schema v1, migrate, merge with defaults, keep the last good one.
 * See docs/specs/m5-core-config-and-theme.md. Core does no I/O: the host passes file contents.
 */
import { closest, resolveActionName } from "./actions.mjs";
import { DEFAULT_CONFIG, WORKSPACE_DEFAULTS } from "./defaults.mjs";
import { KeymapError, compileKeymap } from "./keymap.mjs";
import { MODES, isMode } from "./modes.mjs";
import { PALETTE_KEYS, isHexColor, normalizeHex } from "./theme.mjs";
import { formatPath, locateKeys, parsePath, parseToml } from "./toml.mjs";

/** @import { Keymap } from "./keymap.mjs" */
/** @import { UserConfig } from "./defaults.mjs" */
/** @import { Path } from "./toml.mjs" */
/** @import { ThemeConfig } from "./theme.mjs" */

/**
 * @typedef {object} ConfigError
 * @property {number} [line]         1-based; absent when nothing in the file locates it
 * @property {number} [column]       syntax errors only
 * @property {string} path           config path (`keys.new_tab[1]`); "" for syntax errors
 * @property {string} message
 * @property {string} [suggestion]
 */

/**
 * @typedef {object} Workspace
 * @property {string} name
 * @property {string} color      canonical Firefox container colour
 * @property {string} icon
 * @property {string} [home]
 * @property {boolean} autofill
 */

/**
 * @typedef {object} ResolvedConfig
 * @property {number} schema
 * @property {Record<string, string | string[]>} keys     as written; compileKeymap merges
 * @property {Record<string, unknown>} modal              as written; compileKeymap merges
 * @property {Record<string, string[]>} unbind
 * @property {Workspace[]} workspaces                     file order = ctrl+i order
 * @property {ThemeConfig} theme
 */

/** @typedef {{ config: ResolvedConfig, keymap: Keymap }} ActiveConfig */
/** @typedef {(config: Record<string, unknown>) => Record<string, unknown>} Migration */

export const CONFIG_SCHEMA_VERSION = 1;

/**
 * Step `n` turns a schema-n object into a schema-(n+1) object. Pure; never mutates its input.
 * @type {Readonly<Record<number, Migration>>}
 */
export const MIGRATIONS = Object.freeze({
  // v0: configs without `schema`, written before M5. Same shape as v1.
  0: (config) => ({ ...config, schema: 1 }),
});

/**
 * @param {Record<string, unknown>} raw
 * @param {number} from
 * @param {number} [to]
 * @param {Readonly<Record<number, Migration>>} [registry]
 * @returns {{ config: Record<string, unknown>, applied: string[] }}
 */
export function migrate(raw, from, to = CONFIG_SCHEMA_VERSION, registry = MIGRATIONS) {
  if (from > to) throw new Error(`config schema ${from} is newer than ${to}`);
  let config = raw;
  /** @type {string[]} */
  const applied = [];
  for (let v = from; v < to; v++) {
    const step = registry[v];
    if (typeof step !== "function") throw new Error(`no migration from schema ${v} to ${v + 1}`);
    config = step(config);
    applied.push(`${v}→${v + 1}`);
  }
  return { config, applied };
}

// Firefox container colours and icons (ContextualIdentityService.sys.mjs).
const COLORS = [
  "gray",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
  "violet",
  "blue",
  "cyan",
  "green",
];
/** @type {Record<string, string>} */
const COLOR_ALIASES = { turquoise: "cyan", toolbar: "gray" };
const ICONS = [
  "fingerprint",
  "briefcase",
  "dollar",
  "cart",
  "vacation",
  "gift",
  "food",
  "fruit",
  "pet",
  "tree",
  "chill",
  "circle",
  "fence",
];
const TOP_KEYS = ["schema", "keys", "modal", "unbind", "workspaces", "theme"];
const KEYMAP_SECTIONS = new Set(["keys", "modal", "unbind"]);
const WORKSPACE_KEYS = ["color", "icon", "home", "autofill"];
const THEME_KEYS = ["source", "font", "colors"];
const THEME_SOURCES = ["omarchy", "file"];
const MAX_TIMEOUT_MS = 10000;
const MAX_WORKSPACE_NAME = 32;
const MAX_FONT = 200;
const FONT_FORBIDDEN = /["';{}\\<>]/;
const HOME = /^(?:https?:\/\/|about:)\S+$/;

/** @param {string} s */
const hasControl = (s) =>
  [...s].some((ch) => /** @type {number} */ (ch.codePointAt(0)) < 0x20 || ch === "\x7f");

/** @param {unknown} v */
function typeName(v) {
  if (Array.isArray(v)) return "an array";
  if (v instanceof Date) return "a date";
  if (typeof v === "object") return "a table";
  // parsed with integersAsBigInt: TOML integers are BigInt, TOML floats are numbers
  if (typeof v === "bigint") return "an integer";
  if (typeof v === "number") return "a float";
  return typeof v === "string" ? "a string" : "a boolean";
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isTable = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

/** @typedef {{ path: Path, message: string, suggestion?: string }} Problem */

/**
 * Checks schema v1 and returns every problem; keymap contents are left to compileKeymap.
 * @param {Record<string, unknown>} raw  migrated to v1
 * @returns {Problem[]}
 */
function validate(raw) {
  /** @type {Problem[]} */
  const problems = [];
  /** @param {Path} path @param {string} message @param {string} [suggestion] */
  const fail = (path, message, suggestion) =>
    problems.push(suggestion ? { path, message, suggestion } : { path, message });
  /** @param {Path} path @param {unknown} v @param {string} expected */
  const typeError = (path, v, expected) => fail(path, `expected ${expected}, got ${typeName(v)}`);
  /**
   * @param {Path} path
   * @param {unknown} v
   * @returns {v is Record<string, unknown>}
   */
  const table = (path, v) => {
    if (isTable(v)) return true;
    typeError(path, v, "a table");
    return false;
  };
  /** @param {Path} path @param {string} key @param {readonly string[]} known */
  const unknownKey = (path, key, known) => fail(path, `unknown key "${key}"`, closest(key, known));

  for (const [key, v] of Object.entries(raw)) {
    if (!TOP_KEYS.includes(key)) unknownKey([key], key, TOP_KEYS);
    else if (key !== "schema") table([key], v);
  }

  if (isTable(raw.modal)) {
    for (const [key, v] of Object.entries(raw.modal)) {
      const path = ["modal", key];
      if (key === "leader") {
        if (typeof v !== "string") typeError(path, v, "a key string");
      } else if (key === "timeout_ms") {
        if (typeof v !== "bigint") typeError(path, v, "an integer");
        else if (v < 0n || v > BigInt(MAX_TIMEOUT_MS)) {
          fail(path, `must be an integer between 0 and ${MAX_TIMEOUT_MS}`);
        }
      } else if (isMode(key)) {
        table(path, v);
      } else {
        unknownKey(path, key, [...MODES, "leader", "timeout_ms"]);
      }
    }
  }

  if (isTable(raw.unbind)) {
    for (const [mode, v] of Object.entries(raw.unbind)) {
      if (!isMode(mode)) fail(["unbind", mode], `unknown mode "${mode}"`, closest(mode, MODES));
      else if (!Array.isArray(v)) typeError(["unbind", mode], v, "a list of key strings");
    }
  }

  if (isTable(raw.workspaces)) {
    for (const [name, ws] of Object.entries(raw.workspaces)) {
      const path = ["workspaces", name];
      const length = [...name].length;
      if (length < 1 || length > MAX_WORKSPACE_NAME) {
        fail(path, `workspace name must be 1 to ${MAX_WORKSPACE_NAME} characters`);
        continue;
      }
      if (hasControl(name)) {
        fail(path, "workspace name must not contain control characters");
        continue;
      }
      if (!table(path, ws)) continue;
      for (const [key, v] of Object.entries(ws)) {
        const at = [...path, key];
        if (key === "color") {
          if (typeof v !== "string") typeError(at, v, "a string");
          else if (!COLORS.includes(v) && !(v in COLOR_ALIASES)) {
            fail(
              at,
              `unknown colour "${v}"`,
              closest(v, [...COLORS, ...Object.keys(COLOR_ALIASES)]),
            );
          }
        } else if (key === "icon") {
          if (typeof v !== "string") typeError(at, v, "a string");
          else if (!ICONS.includes(v)) fail(at, `unknown icon "${v}"`, closest(v, ICONS));
        } else if (key === "home") {
          if (typeof v !== "string") typeError(at, v, "a string");
          else if (!HOME.test(v))
            fail(at, "must be an http://, https:// or about: URL without spaces");
        } else if (key === "autofill") {
          if (typeof v !== "boolean") typeError(at, v, "a boolean");
        } else {
          unknownKey(at, key, WORKSPACE_KEYS);
        }
      }
    }
  }

  if (isTable(raw.theme)) {
    for (const [key, v] of Object.entries(raw.theme)) {
      const path = ["theme", key];
      if (key === "source") {
        if (typeof v !== "string") typeError(path, v, "a string");
        else if (!THEME_SOURCES.includes(v)) {
          fail(path, `must be "omarchy" or "file"`, closest(v, THEME_SOURCES));
        }
      } else if (key === "font") {
        if (typeof v !== "string") typeError(path, v, "a string");
        else if (v.length < 1 || v.length > MAX_FONT)
          fail(path, `must be 1 to ${MAX_FONT} characters`);
        else if (FONT_FORBIDDEN.test(v) || hasControl(v)) {
          fail(path, `must not contain quotes, ; { } \\ < > or control characters`);
        }
      } else if (key === "colors") {
        if (!table(path, v)) continue;
        for (const [name, c] of Object.entries(v)) {
          const at = [...path, name];
          if (!PALETTE_KEYS.includes(name)) {
            fail(at, `unknown colour key "${name}"`, closest(name, PALETTE_KEYS));
          } else if (name === "mode") {
            if (c !== "dark" && c !== "light") fail(at, `must be "dark" or "light"`);
          } else if (!isHexColor(c)) {
            fail(at, `must be a hex colour like "#7aa2f7"`);
          }
        }
      } else {
        unknownKey(path, key, THEME_KEYS);
      }
    }
  }
  return problems;
}

/**
 * TOML integers parsed as BigInt back to numbers, once validation has bounded them.
 * @param {unknown} v
 * @returns {any}
 */
function toNumbers(v) {
  if (typeof v === "bigint") return Number(v);
  if (Array.isArray(v)) return v.map(toNumbers);
  if (!isTable(v)) return v;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    Object.defineProperty(out, k, { value: toNumbers(x), enumerable: true, writable: true });
  }
  return out;
}

/**
 * Fill every section of a valid v1 config (as parsed) with defaults and normalise values.
 * @param {UserConfig} user
 * @param {string[]} [workspaceOrder]  workspace names in file order; JS objects list
 *   number-like keys first, so parseConfig passes the order it read from the text
 * @returns {ResolvedConfig}
 */
export function mergeWithDefaults(user, workspaceOrder) {
  const theme = user.theme ?? {};
  const defTheme = /** @type {Required<NonNullable<UserConfig["theme"]>>} */ (DEFAULT_CONFIG.theme);
  /** @type {Record<string, string>} */
  const colors = {};
  for (const [k, v] of Object.entries(theme.colors ?? {}))
    colors[k] = isHexColor(v) ? normalizeHex(v) : v;
  return {
    schema: CONFIG_SCHEMA_VERSION,
    keys: user.keys ?? {},
    modal: user.modal ?? {},
    unbind: user.unbind ?? {},
    workspaces: (workspaceOrder ?? Object.keys(user.workspaces ?? {})).map((name) => {
      const w = /** @type {NonNullable<UserConfig["workspaces"]>} */ (user.workspaces)[name] ?? {};
      const color = w.color ?? WORKSPACE_DEFAULTS.color;
      return {
        name,
        color: COLOR_ALIASES[color] ?? color,
        icon: w.icon ?? WORKSPACE_DEFAULTS.icon,
        ...(w.home === undefined ? {} : { home: w.home }),
        autofill: w.autofill ?? WORKSPACE_DEFAULTS.autofill,
      };
    }),
    theme: {
      source: theme.source ?? defTheme.source,
      font: theme.font ?? defTheme.font,
      colors,
    },
  };
}

/**
 * @typedef {object} ParseResult
 * @property {ResolvedConfig | null} config   null whenever errors is non-empty
 * @property {Keymap | null} keymap
 * @property {ConfigError[]} errors           in file order
 * @property {number | null} migratedFrom     the file's schema when older than the current one
 */

/**
 * @param {string} text  contents of config.toml
 * @returns {ParseResult}
 */
export function parseConfig(text) {
  /** @param {ConfigError[]} errors @returns {ParseResult} */
  const failed = (errors) => ({ config: null, keymap: null, errors, migratedFrom: null });

  const parsed = parseToml(text, { integersAsBigInt: true });
  if (!parsed.ok) return failed([{ path: "", ...parsed.error }]);
  const raw = parsed.value;
  const lineOf = locateKeys(text);
  /** @param {Problem[]} problems @returns {ConfigError[]} */
  const located = (problems) =>
    problems
      .map(({ path, message, suggestion }) => {
        const line = lineOf(path);
        return {
          ...(line === undefined ? {} : { line }),
          path: formatPath(path),
          message,
          ...(suggestion ? { suggestion } : {}),
        };
      })
      .sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));

  const rawSchema = raw.schema ?? 0n;
  if (typeof rawSchema === "number") {
    return failed(located([{ path: ["schema"], message: "must be an integer, got a float" }]));
  }
  if (typeof rawSchema !== "bigint" || rawSchema < 0n) {
    return failed(located([{ path: ["schema"], message: "must be a non-negative integer" }]));
  }
  const schema = rawSchema > BigInt(CONFIG_SCHEMA_VERSION) ? Infinity : Number(rawSchema);
  if (schema > CONFIG_SCHEMA_VERSION) {
    const message = `schema ${rawSchema} is from a newer vimma; this one reads up to ${CONFIG_SCHEMA_VERSION}`;
    return failed(located([{ path: ["schema"], message }]));
  }
  const migrated = migrate(raw, schema).config;
  const problems = validate(migrated);
  const user = /** @type {UserConfig} */ (toNumbers(migrated));

  /** @type {Keymap | null} */
  let keymap = null;
  if (!problems.some((p) => KEYMAP_SECTIONS.has(/** @type {string} */ (p.path[0])))) {
    try {
      keymap = compileKeymap({ keys: user.keys, modal: user.modal, unbind: user.unbind });
    } catch (e) {
      /* c8 ignore next */
      if (!(e instanceof KeymapError)) throw e;
      // compileKeymap names actions canonically; say what the user wrote (prev_workspace)
      let path = parsePath(e.path);
      let message = e.detail;
      for (const written of Object.keys(user.keys ?? {})) {
        const name = resolveActionName(written)?.name;
        if (!name || name === written) continue;
        if (path[0] === "keys" && path[1] === name) path = ["keys", written, ...path.slice(2)];
        message = message.replace(new RegExp(`\\b${name}\\b`, "g"), written);
      }
      problems.push({ path, message, ...(e.suggestion ? { suggestion: e.suggestion } : {}) });
    }
  }
  if (problems.length) return failed(located(problems));
  return {
    config: mergeWithDefaults(
      user,
      Object.keys(user.workspaces ?? {}).sort(
        (a, b) =>
          /** @type {number} */ (lineOf(["workspaces", a])) -
          /** @type {number} */ (lineOf(["workspaces", b])),
      ),
    ),
    keymap,
    errors: [],
    migratedFrom: schema === CONFIG_SCHEMA_VERSION ? null : schema,
  };
}

/**
 * Apply new config text atomically: on any error the previous config stays active (plan M5).
 * @param {ActiveConfig | null} active  the config in use, null before the first load
 * @param {string} text
 * @returns {{ active: ActiveConfig, errors: ConfigError[], kept: boolean }}
 *   kept: the text was not applied; `active` is the previous config, or the defaults
 */
export function reloadConfig(active, text) {
  const r = parseConfig(text);
  if (r.config && r.keymap)
    return { active: { config: r.config, keymap: r.keymap }, errors: [], kept: false };
  const fallback = active ?? { config: mergeWithDefaults({}), keymap: compileKeymap() };
  return { active: fallback, errors: r.errors, kept: true };
}

/**
 * `config.toml:12:5: keys.new_tabb: unknown action "new_tabb" (did you mean "new_tab"?)`
 * @param {ConfigError} e
 * @param {string} file  as the user should see it, e.g. ~/.config/vimma/config.toml
 */
export function formatConfigError(e, file) {
  const where = e.line ? `:${e.line}${e.column ? `:${e.column}` : ""}` : "";
  const path = e.path ? `${e.path}: ` : "";
  const hint = e.suggestion ? ` (did you mean "${e.suggestion}"?)` : "";
  return `${file}${where}: ${path}${e.message}${hint}`;
}
