/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The always-visible status bar as plain data (spec m2-core-logic): segments with text and theme
 * token names, fitted to a character budget. The host renders them; no HTML here.
 */
import { formatConfigError } from "./config.mjs";
import { displayLabel } from "./tablabels.mjs";

/** @import { Mode } from "./modes.mjs" */
/** @import { ConfigError } from "./config.mjs" */

/**
 * @typedef {object} Segment
 * @property {string} id
 * @property {string} text
 * @property {string} fg            theme token name (`--vimma-…`)
 * @property {string | null} bg     theme token name, or null for the bar's background
 * @property {"left" | "right"} side
 * @property {number} priority      0 = most important; higher gives way first
 * @property {number} min           shortest width it may be shrunk to
 * @property {"end" | "middle" | "none"} cut
 */

/**
 * @typedef {object} StatusInput
 * @property {Mode} mode
 * @property {readonly string[]} [pending]      dispatcher.pending()
 * @property {{ name: string, index: number, color?: string } | null} [workspace]
 * @property {{ index: number, count: number, title?: string | null, url?: string | null,
 *   label?: string | null } | null} [tab]
 * @property {{ index: number, count: number } | null} [pane]
 * @property {boolean} [loading]
 * @property {number | null} [progress]          0..1
 * @property {readonly ConfigError[]} [configErrors]
 * @property {string} [configFile]
 */

/** `[workspaces.<name>] color` (Firefox container colours) → theme token. */
export const WORKSPACE_COLOR_TOKENS = Object.freeze({
  gray: "--vimma-fg-dim",
  yellow: "--vimma-yellow",
  orange: "--vimma-orange",
  red: "--vimma-red",
  pink: "--vimma-bright-magenta",
  purple: "--vimma-magenta",
  violet: "--vimma-bright-blue",
  blue: "--vimma-blue",
  cyan: "--vimma-cyan",
  green: "--vimma-green",
});

const ELLIPSIS = "…";

/**
 * Width in code points (East Asian wide characters are not counted twice).
 * @param {string} text
 */
export function textWidth(text) {
  return [...text].length;
}

/**
 * Total width with one separator column between neighbours.
 * @param {readonly Segment[]} segments
 */
export function statusWidth(segments) {
  if (!segments.length) return 0;
  return segments.reduce((n, s) => n + textWidth(s.text), 0) + segments.length - 1;
}

/**
 * Cuts `text` to `width` code points with one ellipsis; `middle` keeps head and tail.
 * @param {string} text
 * @param {number} width
 * @param {"end" | "middle"} how
 */
export function truncate(text, width, how) {
  const points = [...text];
  if (points.length <= width) return text;
  if (width <= 0) return "";
  const keep = width - 1;
  if (how === "end") return points.slice(0, keep).join("") + ELLIPSIS;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return points.slice(0, head).join("") + ELLIPSIS + (tail ? points.slice(-tail).join("") : "");
}

/**
 * The URL as the bar shows it: no `http(s)://`, no lone trailing `/`.
 * @param {string} url
 */
export function displayUrl(url) {
  const m = /^https?:\/\/(.*)$/i.exec(url);
  if (!m) return url;
  const rest = /** @type {string} */ (m[1]);
  const slash = rest.indexOf("/");
  return slash === rest.length - 1 ? rest.slice(0, -1) : rest;
}

/**
 * @param {Partial<Segment> & { id: string, text: string, fg: string, priority: number }} s
 * @returns {Segment}
 */
function seg(s) {
  return Object.freeze({ bg: null, side: "left", min: 0, cut: "none", ...s });
}

/**
 * Every segment the input calls for, untruncated, in on-screen order (left side, then right).
 * @param {StatusInput} input
 * @returns {Segment[]}
 */
export function statusSegments(input) {
  const {
    mode,
    pending = [],
    workspace = null,
    tab = null,
    pane = null,
    loading = false,
    progress = null,
    configErrors = [],
    configFile = "config.toml",
  } = input;
  /** @type {Segment[]} */
  const left = [];
  /** @type {Segment[]} */
  const right = [];
  left.push(
    seg({
      id: "mode",
      text: mode.toUpperCase(),
      fg: `--vimma-mode-${mode}-fg`,
      bg: `--vimma-mode-${mode}`,
      priority: 0,
      min: 1,
      cut: "end",
    }),
  );
  if (pending.length) {
    const prefix = pending[0] === "prefix";
    left.push(
      seg({
        id: "pending",
        text: pending.join(" "),
        fg: prefix ? "--vimma-mode-prefix-fg" : "--vimma-fg-bright",
        bg: prefix ? "--vimma-mode-prefix" : null,
        priority: 1,
      }),
    );
  }
  if (workspace) {
    const tokens = /** @type {Record<string, string>} */ (WORKSPACE_COLOR_TOKENS);
    left.push(
      seg({
        id: "workspace",
        text: `● ${workspace.index}:${workspace.name}`,
        fg: (workspace.color && tokens[workspace.color]) || "--vimma-accent",
        priority: 3,
        min: 6,
        cut: "end",
      }),
    );
  }
  let urlShownAsTitle = false;
  if (tab) {
    left.push(
      seg({
        id: "tab",
        text: `tab ${tab.index}/${tab.count}`,
        fg: "--vimma-statusbar-fg",
        priority: 4,
      }),
    );
  }
  if (pane && pane.count > 1) {
    left.push(
      seg({
        id: "pane",
        text: `pane ${pane.index}/${pane.count}`,
        fg: "--vimma-statusbar-fg",
        priority: 7,
      }),
    );
  }
  if (tab) {
    const title = displayLabel(tab);
    urlShownAsTitle = !!tab.url && title === tab.url;
    left.push(
      seg({ id: "title", text: title, fg: "--vimma-fg-bright", priority: 5, min: 8, cut: "end" }),
    );
  }
  if (loading) {
    const text = typeof progress === "number" ? `${Math.round(progress * 100)}%` : "loading";
    right.push(seg({ id: "loading", text, fg: "--vimma-fg-dim", side: "right", priority: 6 }));
  }
  if (configErrors.length) {
    const first = formatConfigError(/** @type {ConfigError} */ (configErrors[0]), configFile);
    const n = configErrors.length;
    right.push(
      seg({
        id: "error",
        text: n > 1 ? `${n} errors: ${first}` : first,
        fg: "--vimma-error",
        side: "right",
        priority: 2,
        min: 16,
        cut: "end",
      }),
    );
  }
  if (tab?.url && !urlShownAsTitle) {
    right.push(
      seg({
        id: "url",
        text: displayUrl(tab.url),
        fg: "--vimma-fg-dim",
        side: "right",
        priority: 8,
        min: 12,
        cut: "middle",
      }),
    );
  }
  return [...left, ...right];
}

/**
 * Fits segments into `width` columns: least important first, each is shrunk as far as needed
 * (down to its `min`), else dropped; `mode` (priority 0) is cut, never dropped. Returns the input
 * itself when it fits.
 * @param {readonly Segment[]} segments
 * @param {number} width
 * @returns {Segment[]}
 */
export function fitStatus(segments, width) {
  if (statusWidth(segments) <= width) return /** @type {Segment[]} */ (segments);
  /** @type {(Segment | null)[]} */
  const out = segments.slice();
  const visit = segments
    .map((s, i) => i)
    .sort(
      (a, b) =>
        /** @type {Segment} */ (segments[b]).priority -
          /** @type {Segment} */ (segments[a]).priority || b - a,
    );
  const current = () => /** @type {Segment[]} */ (out.filter(Boolean));
  for (const i of visit) {
    const excess = statusWidth(current()) - width;
    if (excess <= 0) break;
    const s = /** @type {Segment} */ (segments[i]);
    const w = textWidth(s.text);
    if (s.priority === 0) {
      // never dropped: cut as far as needed
      const room = Math.max(0, w - excess);
      out[i] =
        room === w
          ? s
          : { ...s, text: truncate(s.text, room, s.cut === "middle" ? "middle" : "end") };
      continue;
    }
    if (s.cut !== "none" && w - Math.min(s.min, w) >= excess) {
      out[i] = { ...s, text: truncate(s.text, w - excess, s.cut) };
    } else {
      out[i] = null;
    }
  }
  return current();
}

/**
 * @param {StatusInput} input
 * @param {number} width columns available
 */
export function renderStatusBar(input, width) {
  return fitStatus(statusSegments(input), width);
}
