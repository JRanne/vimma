/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Theme tokens: CSS custom properties from a palette in Omarchy's colors.toml vocabulary.
 * See docs/specs/m5-core-config-and-theme.md § Theme tokens. The host applies them.
 */
import { trimBlanks } from "./strings.mjs";
import { formatPath, locateKeys, parseToml } from "./toml.mjs";

/** @typedef {Record<string, string>} Palette  PALETTE_KEYS → "#rrggbb", plus mode */
/** @typedef {Record<string, string>} Tokens   "--vimma-*" → CSS value */

/**
 * @typedef {object} ThemeError
 * @property {number} [line]
 * @property {number} [column]
 * @property {string} path
 * @property {string} message
 */

/**
 * @typedef {object} ThemeToken
 * @property {string} name          CSS custom property
 * @property {string} [from]        palette key the value comes from
 * @property {string} [textOn]      token this one is text on: the value is picked for contrast
 * @property {boolean} [readable]   text on every SURFACE_TOKENS: `from`, moved toward black or
 *   white just far enough to reach MIN_CONTRAST on each (spec m7-a11y)
 * @property {string} description
 */

/** Keys of an Omarchy 4 colors.toml, in its file order (docs/notes/omarchy-theming.md). */
export const PALETTE_KEYS = Object.freeze([
  "mode",
  "accent",
  "selection",
  "muted",
  "background",
  "dark_background",
  "darker_background",
  "lighter_background",
  "foreground",
  "dark_foreground",
  "light_foreground",
  "bright_foreground",
  "red",
  "yellow",
  "orange",
  "green",
  "cyan",
  "blue",
  "magenta",
  "brown",
  "bright_red",
  "bright_yellow",
  "bright_green",
  "bright_cyan",
  "bright_blue",
  "bright_magenta",
]);

/** Keys some stock Omarchy themes leave out, and the key standing in for each. */
const FALLBACKS = Object.freeze({ orange: "yellow", brown: "dark_foreground" });

/** The built-in palette: Omarchy's stock tokyo-night colors.toml. */
/** @type {Readonly<Palette>} */
export const TOKYO_NIGHT = Object.freeze({
  mode: "dark",
  accent: "#7aa2f7",
  selection: "#292e42",
  muted: "#414868",
  background: "#1a1b26",
  dark_background: "#13141c",
  darker_background: "#0e0e14",
  lighter_background: "#24283b",
  foreground: "#a9b1d6",
  dark_foreground: "#565f89",
  light_foreground: "#b4bee6",
  bright_foreground: "#c0caf5",
  red: "#f7768e",
  yellow: "#e0af68",
  orange: "#eb927b",
  green: "#9ece6a",
  cyan: "#449dab",
  blue: "#7aa2f7",
  magenta: "#ad8ee6",
  brown: "#75493d",
  bright_red: "#ff7a93",
  bright_yellow: "#ff9e64",
  bright_green: "#b9f27c",
  bright_cyan: "#0db9d7",
  bright_blue: "#7da6ff",
  bright_magenta: "#bb9af7",
});

/** Status-bar badge colour per mode, plus the pending prefix. */
const BADGE_COLORS = Object.freeze({
  normal: "accent",
  insert: "green",
  visual: "magenta",
  command: "yellow",
  hint: "orange",
  help: "cyan",
  panel: "blue",
  resize: "brown",
  prefix: "red",
});

/** Badges the status bar can show: every mode, and `prefix`. */
export const BADGES = Object.freeze(Object.keys(BADGE_COLORS));

const ANSI = ["red", "yellow", "orange", "green", "cyan", "blue", "magenta", "brown"];
const BRIGHT = ["red", "yellow", "green", "cyan", "blue", "magenta"];

/** @type {readonly ThemeToken[]} */
export const THEME_TOKENS = Object.freeze([
  { name: "--vimma-color-scheme", from: "mode", description: "dark or light, for color-scheme" },
  { name: "--vimma-font", description: "font family list from [theme] font" },
  { name: "--vimma-bg", from: "background", description: "window background" },
  { name: "--vimma-bg-dark", from: "dark_background", description: "darker surface" },
  { name: "--vimma-bg-darker", from: "darker_background", description: "darkest surface" },
  { name: "--vimma-bg-light", from: "lighter_background", description: "raised surface" },
  { name: "--vimma-fg", from: "foreground", description: "text" },
  {
    name: "--vimma-fg-dim",
    from: "dark_foreground",
    readable: true,
    description: "secondary text, readable on every surface",
  },
  { name: "--vimma-fg-light", from: "light_foreground", description: "light text" },
  { name: "--vimma-fg-bright", from: "bright_foreground", description: "emphasised text" },
  { name: "--vimma-accent", from: "accent", description: "accent, focus" },
  { name: "--vimma-muted", from: "muted", description: "borders, inactive" },
  { name: "--vimma-selection", from: "selection", description: "selected row background" },
  ...ANSI.map((c) => ({ name: `--vimma-${c}`, from: c, description: `${c}` })),
  ...BRIGHT.map((c) => ({
    name: `--vimma-bright-${c}`,
    from: `bright_${c}`,
    description: `bright ${c}`,
  })),
  { name: "--vimma-error", from: "red", description: "errors (config error indicator)" },
  { name: "--vimma-warning", from: "yellow", description: "warnings" },
  { name: "--vimma-success", from: "green", description: "success" },
  { name: "--vimma-statusbar-bg", from: "dark_background", description: "status bar" },
  { name: "--vimma-statusbar-fg", from: "foreground", description: "status bar text" },
  { name: "--vimma-hint-bg", from: "yellow", description: "link hint label" },
  { name: "--vimma-hint-fg", textOn: "--vimma-hint-bg", description: "link hint text" },
  ...Object.entries(BADGE_COLORS).flatMap(([badge, from]) => [
    { name: `--vimma-mode-${badge}`, from, description: `${badge} mode badge` },
    {
      name: `--vimma-mode-${badge}-fg`,
      textOn: `--vimma-mode-${badge}`,
      description: `${badge} mode badge text`,
    },
  ]),
  // Coloured text (spec m7-a11y): the palette colour, made readable on every surface. The colour
  // tokens above stay as the palette gives them, for dots, borders and a user's own CSS.
  ...[
    ["accent", "accent"],
    ["error", "red"],
    ["warning", "yellow"],
    ["success", "green"],
  ].map(([c, from]) => ({
    name: `--vimma-text-${c}`,
    from,
    readable: true,
    description: `${c} text, readable on every surface`,
  })),
  ...ANSI.map((c) => ({
    name: `--vimma-text-${c}`,
    from: c,
    readable: true,
    description: `${c} text, readable on every surface`,
  })),
  ...BRIGHT.map((c) => ({
    name: `--vimma-text-bright-${c}`,
    from: `bright_${c}`,
    readable: true,
    description: `bright ${c} text, readable on every surface`,
  })),
]);

/**
 * The backgrounds Vimma's chrome draws text on: windows and pages, panels, pickers, the
 * command line and the status bar, and a selected row.
 */
export const SURFACE_TOKENS = Object.freeze([
  "--vimma-bg",
  "--vimma-bg-dark",
  "--vimma-statusbar-bg",
  "--vimma-selection",
]);

/**
 * Every token Vimma's chrome draws text in, on any of SURFACE_TOKENS (spec m7-a11y). The CSS and
 * the status bar use no other colour for text (tools/test/chrome-css.test.mjs).
 */
export const TEXT_TOKENS = Object.freeze([
  "--vimma-fg",
  "--vimma-fg-dim",
  "--vimma-fg-bright",
  "--vimma-statusbar-fg",
  ...THEME_TOKENS.filter((t) => t.name.startsWith("--vimma-text-")).map((t) => t.name),
]);

/** Pairs (text, background) checked against WCAG AA. Badge text is picked to pass already. */
const CONTRAST_PAIRS = [
  ["--vimma-fg", "--vimma-bg"],
  ["--vimma-fg", "--vimma-selection"],
  ["--vimma-fg-bright", "--vimma-selection"],
  ["--vimma-statusbar-fg", "--vimma-statusbar-bg"],
  ["--vimma-hint-fg", "--vimma-hint-bg"],
  ...BADGES.map((b) => [`--vimma-mode-${b}-fg`, `--vimma-mode-${b}`]),
];

/** WCAG 2.x AA minimum for normal text. */
export const MIN_CONTRAST = 4.5;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * `#rgb` or `#rrggbb`. No alpha: contrast needs opaque colours.
 * @param {unknown} value
 * @returns {value is string}
 */
export function isHexColor(value) {
  return typeof value === "string" && HEX.test(value);
}

/**
 * @param {string} hex  a hex colour (isHexColor)
 * @returns {string} lowercase #rrggbb
 */
export function normalizeHex(hex) {
  const h = hex.toLowerCase();
  return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
}

/** @param {string} hex */
function luminance(hex) {
  const h = normalizeHex(hex);
  /** @param {number} at */
  const channel = (at) => {
    const c = parseInt(h.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * WCAG 2.x contrast ratio, 1 to 21.
 * @param {string} a  hex colour
 * @param {string} b  hex colour
 */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** @param {unknown} v */
const describe = (v) => (typeof v === "string" ? JSON.stringify(v) : `a ${typeof v}`);

/**
 * Read an Omarchy colors.toml. Unknown keys (hyprland_*, …) are ignored; Omarchy owns them.
 * @param {string} text
 * @param {{ lightMode?: boolean }} [options]  lightMode: the theme ships a light.mode file
 * @returns {{ palette: Palette | null, errors: ThemeError[] }}
 */
export function parseOmarchyColors(text, { lightMode = false } = {}) {
  const parsed = parseToml(text);
  if (!parsed.ok) return { palette: null, errors: [{ path: "", ...parsed.error }] };
  const raw = parsed.value;
  const lineOf = locateKeys(text);
  /** @type {ThemeError[]} */
  const errors = [];
  /** @type {Palette} */
  const palette = {};
  for (const key of PALETTE_KEYS) {
    const v = raw[key];
    const at = { line: lineOf([key]), path: formatPath([key]) };
    if (key === "mode") {
      if (v === undefined) palette.mode = lightMode ? "light" : "dark";
      else if (v === "dark" || v === "light") palette.mode = v;
      else errors.push({ ...at, message: `must be "dark" or "light", got ${describe(v)}` });
    } else if (v === undefined) {
      if (!(key in FALLBACKS)) errors.push({ ...at, message: `missing key "${key}"` });
    } else if (isHexColor(v)) {
      palette[key] = normalizeHex(v);
    } else {
      errors.push({ ...at, message: `must be a hex colour like "#7aa2f7", got ${describe(v)}` });
    }
  }
  if (errors.length) return { palette: null, errors };
  for (const [key, from] of Object.entries(FALLBACKS)) {
    palette[key] ??= /** @type {string} */ (palette[from]);
  }
  return { palette, errors };
}

const GENERIC_FONTS = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

/**
 * `Caskaydia Mono` → `"Caskaydia Mono", monospace`; generic families stay bare. The config
 * validator has already rejected quotes, semicolons, braces and backslashes.
 * @param {string} font
 */
function cssFontFamily(font) {
  const families = font.split(",").map(trimBlanks).filter(Boolean);
  const out = families.map((f) => (GENERIC_FONTS.has(f) ? f : cssString(f)));
  if (!GENERIC_FONTS.has(/** @type {string} */ (families.at(-1)))) out.push("monospace");
  return out.join(", ");
}

/**
 * A CSS string literal; defensive even though the config validator rejects these characters.
 * @param {string} s
 */
function cssString(s) {
  let body = "";
  for (const c of s) {
    const code = /** @type {number} */ (c.codePointAt(0));
    if (c === "\\" || c === '"') body += `\\${c}`;
    else if (code < 0x20 || code === 0x7f) body += `\\${code.toString(16)} `;
    else body += c;
  }
  return `"${body}"`;
}

/**
 * Text colour for `bg`: the palette's background or foreground, whichever contrasts more;
 * black or white if neither reaches MIN_CONTRAST (one of them always does, at ≥ 4.58:1).
 * @param {string} bg
 * @param {Palette} palette
 */
function textOn(bg, palette) {
  /** @param {string[]} candidates */
  const best = (candidates) =>
    /** @type {string} */ (
      candidates.reduce((a, b) => (contrastRatio(b, bg) > contrastRatio(a, bg) ? b : a))
    );
  const pick = best([
    /** @type {string} */ (palette.background),
    /** @type {string} */ (palette.foreground),
  ]);
  return contrastRatio(pick, bg) >= MIN_CONTRAST ? pick : best(["#000000", "#ffffff"]);
}

/**
 * @param {Palette} palette  complete: every PALETTE_KEYS entry
 * @param {string} font
 * @returns {Tokens}
 */
function paletteToTokens(palette, font) {
  /** @type {Tokens} */
  const tokens = {};
  for (const t of THEME_TOKENS) {
    if (t.textOn) tokens[t.name] = textOn(/** @type {string} */ (tokens[t.textOn]), palette);
    else if (t.from) tokens[t.name] = /** @type {string} */ (palette[t.from]);
    else tokens[t.name] = cssFontFamily(font);
  }
  // Once every surface has its value.
  const surfaces = SURFACE_TOKENS.map((s) => /** @type {string} */ (tokens[s]));
  for (const t of THEME_TOKENS) {
    if (t.readable) tokens[t.name] = readable(/** @type {string} */ (tokens[t.name]), surfaces);
  }
  return tokens;
}

/**
 * `color`, or the first step of 5% toward black or white (whichever contrasts more with the
 * surfaces) that reaches MIN_CONTRAST on every one of them: the hue stays, the text reads.
 * @param {string} color  #rrggbb
 * @param {readonly string[]} surfaces  #rrggbb
 * @returns {string} #rrggbb
 */
function readable(color, surfaces) {
  /** @param {string} c */
  const worst = (c) => Math.min(...surfaces.map((s) => contrastRatio(c, s)));
  if (worst(color) >= MIN_CONTRAST) return color;
  const target = worst("#000000") >= worst("#ffffff") ? "#000000" : "#ffffff";
  for (let step = 1; step < 20; step++) {
    const c = mix(color, target, step / 20);
    if (worst(c) >= MIN_CONTRAST) return c;
  }
  return target;
}

/**
 * @param {string} a  #rrggbb
 * @param {string} b  #rrggbb
 * @param {number} t  0 is `a`, 1 is `b`
 */
function mix(a, b, t) {
  let out = "#";
  for (const at of [1, 3, 5]) {
    const x = parseInt(a.slice(at, at + 2), 16);
    const y = parseInt(b.slice(at, at + 2), 16);
    out += Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  }
  return out;
}

/**
 * @typedef {object} ThemeConfig
 * @property {"omarchy" | "file"} source
 * @property {string} font
 * @property {Record<string, string>} colors   [theme.colors], validated
 */

/**
 * Tokens for the configured theme. On errors the tokens are Tokyo Night's (overlaid by
 * [theme.colors]); a host that already shows a theme keeps it, as for config.
 * @param {{ theme: ThemeConfig, omarchy?: string | null, omarchyLightMode?: boolean }} input
 *   omarchy: the text of the current Omarchy colors.toml, or null when there is none
 * @returns {{ tokens: Tokens, mode: "dark" | "light", errors: ThemeError[], warnings: string[] }}
 */
export function resolveTheme({ theme, omarchy = null, omarchyLightMode = false }) {
  /** @type {Palette} */
  let base = { ...TOKYO_NIGHT };
  /** @type {ThemeError[]} */
  let errors = [];
  /** @type {string[]} */
  const warnings = [];
  if (theme.source === "omarchy") {
    if (omarchy === null) {
      warnings.push("Omarchy theme not found; using the built-in Tokyo Night");
    } else {
      const r = parseOmarchyColors(omarchy, { lightMode: omarchyLightMode });
      if (r.palette) base = r.palette;
      errors = r.errors;
    }
  }
  /** @type {Palette} */
  const palette = { ...base };
  // Validated again here: these values become CSS, and callers other than parseConfig exist.
  for (const [key, v] of Object.entries(theme.colors)) {
    const path = formatPath(["theme", "colors", key]);
    if (!PALETTE_KEYS.includes(key)) {
      errors.push({ path, message: `unknown colour key "${key}"` });
    } else if (key === "mode") {
      if (v === "dark" || v === "light") palette.mode = v;
      else errors.push({ path, message: `must be "dark" or "light", got ${describe(v)}` });
    } else if (isHexColor(v)) {
      palette[key] = normalizeHex(v);
    } else {
      errors.push({ path, message: `must be a hex colour like "#7aa2f7", got ${describe(v)}` });
    }
  }
  const tokens = paletteToTokens(palette, theme.font);
  for (const [fg, bg] of CONTRAST_PAIRS) {
    const ratio = contrastRatio(
      /** @type {string} */ (tokens[/** @type {string} */ (fg)]),
      /** @type {string} */ (tokens[/** @type {string} */ (bg)]),
    );
    if (ratio < MIN_CONTRAST) {
      const shown = Math.floor(ratio * 100) / 100;
      warnings.push(`${fg} on ${bg}: ${shown}:1 is below ${MIN_CONTRAST}:1 (WCAG AA)`);
    }
  }
  const mode = palette.mode === "light" ? "light" : "dark";
  return { tokens, mode, errors, warnings };
}

const CSS_STRING = String.raw`"(?:[^"\\\n]|\\.)*"`;
const FONT_ITEM = `(?:${CSS_STRING}|[a-z-]+)`;
const FONT_LIST = new RegExp(`^${FONT_ITEM}(?:, ${FONT_ITEM})*$`);

/**
 * Only values resolveTheme can produce: #rrggbb, a color-scheme keyword, a quoted font list.
 * @param {string} name
 * @param {unknown} value
 */
function safeToken(name, value) {
  if (!/^--vimma-[a-z0-9-]+$/.test(name) || typeof value !== "string") return false;
  if (name === "--vimma-color-scheme") return value === "dark" || value === "light";
  if (name === "--vimma-font") return FONT_LIST.test(value);
  return /^#[0-9a-f]{6}$/.test(value);
}

/**
 * The stylesheet the host injects. Throws TypeError on a value resolveTheme could not have made,
 * so a caller passing untrusted tokens cannot inject CSS.
 * @param {Tokens} tokens
 * @param {string} [selector]
 */
export function tokensToCss(tokens, selector = ":root") {
  if (!/^[^{};]+$/.test(selector))
    throw new TypeError(`unsafe selector ${JSON.stringify(selector)}`);
  const body = Object.entries(tokens)
    .map(([k, v]) => {
      if (!safeToken(k, v)) throw new TypeError(`unsafe token ${k}: ${JSON.stringify(v)}`);
      return `  ${k}: ${v};\n`;
    })
    .join("");
  return `${selector} {\n${body}}\n`;
}
