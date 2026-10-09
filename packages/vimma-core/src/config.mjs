/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * config.toml: parse, validate schema v2, migrate, merge with defaults, keep the last good one.
 * See docs/specs/m5-core-config-and-theme.md (v1) and docs/specs/m3-m4-core-prep.md (v2).
 * Core does no I/O: the host passes file contents.
 */
import { closest, resolveActionName } from "./actions.mjs";
import { DEFAULT_CONFIG, WORKSPACE_DEFAULTS } from "./defaults.mjs";
import { INSERT_SITE_MODES } from "./editable.mjs";
import { DEFAULT_HINT_CHARS, hintLabels } from "./hints.mjs";
import { KeymapError, compileKeymap } from "./keymap.mjs";
import { MODES, isMode } from "./modes.mjs";
import { PANES_MAX_DEFAULT, PANES_MAX_LIMIT } from "./panes.mjs";
import { PALETTE_KEYS, isHexColor, normalizeHex } from "./theme.mjs";
import { formatPath, locateKeys, parsePath, parseToml } from "./toml.mjs";

/** @import { Keymap } from "./keymap.mjs" */
/** @import { UserConfig } from "./defaults.mjs" */
/** @import { Path } from "./toml.mjs" */
/** @import { ThemeConfig } from "./theme.mjs" */
/** @import { InsertSiteMode, InsertSiteRule } from "./editable.mjs" */

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
 * @property {{ max: number }} panes                     `[panes]` (schema 2)
 * @property {string} hintChars                          `[modal] hint_chars` (schema 2)
 * @property {InsertSiteRule[]} sites                    `[sites."<host>"]` in file order (schema 2)
 */

/** @typedef {{ config: ResolvedConfig, keymap: Keymap }} ActiveConfig */
/** @typedef {(config: Record<string, unknown>) => Record<string, unknown>} Migration */

export const CONFIG_SCHEMA_VERSION = 2;

/**
 * Step `n` turns a schema-n object into a schema-(n+1) object. Pure; never mutates its input.
 * @type {Readonly<Record<number, Migration>>}
 */
export const MIGRATIONS = Object.freeze({
  // v0: configs without `schema`, written before M5. Same shape as v1.
  0: (config) => ({ ...config, schema: 1 }),
  // v1 → v2 only adds keys ([panes], [sites], [modal] hint_chars). A file must say schema = 2 to
  // use them, so an older vimma reports "from a newer vimma" instead of an unknown key.
  1: (config) => ({ ...config, schema: 2 }),
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

// Firefox container colours and icons (ContextualIdentityService.sys.mjs); workspacedefs.mjs too.
export const CONTAINER_COLORS = [
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
export const CONTAINER_ICONS = [
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
const TOP_KEYS = ["schema", "keys", "modal", "unbind", "workspaces", "theme", "panes", "sites"];
const KEYMAP_SECTIONS = new Set(["keys", "modal", "unbind"]);
const WORKSPACE_KEYS = ["color", "icon", "home", "autofill"];
const THEME_KEYS = ["source", "font", "colors"];
const THEME_SOURCES = ["omarchy", "file"];
const PANES_KEYS = ["max"];
const SITE_KEYS = ["insert"];
const MODAL_KEYS = ["leader", "timeout_ms", "hint_chars"];
/** Keys a file may use only when it declares `schema = 2`, by config path. */
const SCHEMA_2_KEYS = ["panes", "sites", "modal.hint_chars"];
const NEEDS_SCHEMA_2 = "is new in schema 2: put schema = 2 at the top of the file";
const LABEL = "[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?";
const DOMAIN = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*\\.?$`, "i");
const IPV6 = /^(?:\[[0-9a-f:.]*:[0-9a-f:.]*\]|[0-9a-f.]*:[0-9a-f:.]*)$/i;
const BAD_HOST = 'must be a hostname like "docs.google.com", without scheme, port, path or *';
const MAX_TIMEOUT_MS = 10000;
export const MAX_WORKSPACE_NAME = 32;
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
 * A `[sites."<host>"]` key: a hostname as `URL.hostname` gives it (a domain, an IPv4 address or
 * an IPv6 address, bracketed or not), optionally with a trailing dot.
 * @param {string} host
 */
const isSiteHost = (host) => DOMAIN.test(host) || IPV6.test(host);

/**
 * The same host as matchSiteRule compares it: case, a trailing dot and IPv6 brackets ignored.
 * @param {string} host
 */
const siteKey = (host) =>
  host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[(.*)\]$/, "$1");

/**
 * What the user probably meant by a key that is not a hostname: the host of a URL, a host
 * without its port, a wildcard domain without `*.` (a rule already covers subdomains).
 * @param {string} key
 * @returns {string | undefined}
 */
function hostSuggestion(key) {
  const host = key
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^\*\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d*$/, "");
  return host !== key && isSiteHost(host) ? host : undefined;
}

/**
 * @param {unknown} chars
 * @returns {boolean}
 */
function isHintCharset(chars) {
  try {
    hintLabels(0, /** @type {string} */ (chars));
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks the current schema and returns every problem; keymap contents are left to compileKeymap.
 * @param {Record<string, unknown>} raw  migrated to the current schema
 * @param {number} declared  the schema the file declared (0 without `schema`)
 * @returns {Problem[]}
 */
function validate(raw, declared) {
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

  /**
   * A schema-2 key in a file that declares an older schema: reported once, then skipped.
   * @param {Path} path
   */
  const gated = (path) => {
    if (declared >= 2 || !SCHEMA_2_KEYS.includes(path.join("."))) return false;
    fail(path, NEEDS_SCHEMA_2);
    return true;
  };

  for (const [key, v] of Object.entries(raw)) {
    if (!TOP_KEYS.includes(key)) unknownKey([key], key, TOP_KEYS);
    else if (key !== "schema" && !gated([key])) table([key], v);
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
      } else if (key === "hint_chars") {
        if (gated(path)) continue;
        if (typeof v !== "string") typeError(path, v, "a string");
        else if (!isHintCharset(v)) {
          fail(path, "must be at least 2 distinct characters, none uppercase or whitespace");
        }
      } else if (isMode(key)) {
        table(path, v);
      } else {
        unknownKey(path, key, [...MODES, ...MODAL_KEYS]);
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
          else if (!CONTAINER_COLORS.includes(v) && !(v in COLOR_ALIASES)) {
            fail(
              at,
              `unknown colour "${v}"`,
              closest(v, [...CONTAINER_COLORS, ...Object.keys(COLOR_ALIASES)]),
            );
          }
        } else if (key === "icon") {
          if (typeof v !== "string") typeError(at, v, "a string");
          else if (!CONTAINER_ICONS.includes(v))
            fail(at, `unknown icon "${v}"`, closest(v, CONTAINER_ICONS));
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

  if (declared >= 2 && isTable(raw.panes)) {
    for (const [key, v] of Object.entries(raw.panes)) {
      const path = ["panes", key];
      if (key !== "max") unknownKey(path, key, PANES_KEYS);
      else if (typeof v !== "bigint") typeError(path, v, "an integer");
      else if (v < 1n || v > BigInt(PANES_MAX_LIMIT)) {
        fail(path, `must be an integer between 1 and ${PANES_MAX_LIMIT}`);
      }
    }
  }

  if (declared >= 2 && isTable(raw.sites)) {
    /** @type {Map<string, string>} */
    const seen = new Map();
    for (const [host, site] of Object.entries(raw.sites)) {
      const path = ["sites", host];
      if (!isSiteHost(host)) {
        fail(path, BAD_HOST, hostSuggestion(host));
        continue;
      }
      const first = seen.get(siteKey(host));
      if (first !== undefined) {
        fail(path, `same host as ${JSON.stringify(first)}`);
        continue;
      }
      seen.set(siteKey(host), host);
      if (!table(path, site)) continue;
      for (const [key, v] of Object.entries(site)) {
        const at = [...path, key];
        if (key !== "insert") unknownKey(at, key, SITE_KEYS);
        else if (typeof v !== "string") typeError(at, v, "a string");
        else if (!INSERT_SITE_MODES.includes(/** @type {InsertSiteMode} */ (v))) {
          fail(at, 'must be "auto", "never" or "always"', closest(v, INSERT_SITE_MODES));
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
 * Fill every section of a valid config (as parsed) with defaults and normalise values.
 * @param {UserConfig} user
 * @param {string[]} [workspaceOrder]  workspace names in file order; JS objects list
 *   number-like keys first, so parseConfig passes the order it read from the text
 * @param {string[]} [siteOrder]  `[sites]` hosts in file order, for the same reason
 * @returns {ResolvedConfig}
 */
export function mergeWithDefaults(user, workspaceOrder, siteOrder) {
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
    panes: { max: user.panes?.max ?? PANES_MAX_DEFAULT },
    hintChars: /** @type {string | undefined} */ (user.modal?.hint_chars) ?? DEFAULT_HINT_CHARS,
    sites: (siteOrder ?? Object.keys(user.sites ?? {})).map((match) => ({
      match,
      insert: /** @type {NonNullable<UserConfig["sites"]>} */ (user.sites)[match]?.insert ?? "auto",
    })),
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
  const problems = validate(migrated, schema);
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
  /** @param {"workspaces" | "sites"} table */
  const fileOrder = (table) =>
    Object.keys(user[table] ?? {}).sort(
      (a, b) =>
        /** @type {number} */ (lineOf([table, a])) - /** @type {number} */ (lineOf([table, b])),
    );
  return {
    config: mergeWithDefaults(user, fileOrder("workspaces"), fileOrder("sites")),
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
