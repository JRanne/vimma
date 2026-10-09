/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tab rename (`prefix+shift+t`, spec m2-core-logic): a label override per tab id, and the label
 * every view shows (rename > title > URL). Persisted as the optional `tabLabels` field of the
 * state snapshot (schema v1, additive). No-ops return the input itself.
 */

/** @typedef {Readonly<Record<string, string>>} TabLabels */

export const MAX_TAB_LABEL = 100;

/** The snapshot field that carries the labels. */
export const TAB_LABELS_FIELD = "tabLabels";

export class TabLabelError extends Error {
  /**
   * @param {"invalid"} code
   * @param {string} path JSON path of the offending value
   * @param {string} message
   */
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.name = "TabLabelError";
    this.code = code;
    this.path = path;
  }
}

/**
 * Control characters and whitespace runs become one space; trimmed; at most MAX_TAB_LABEL code
 * points.
 * @param {string} text
 * @returns {string}
 */
export function normalizeTabLabel(text) {
  const flat = String(text)
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
  const points = [...flat];
  return points.length > MAX_TAB_LABEL ? points.slice(0, MAX_TAB_LABEL).join("").trimEnd() : flat;
}

/**
 * @param {Record<string, string>} labels
 * @returns {TabLabels}
 */
function freeze(labels) {
  return Object.freeze(labels);
}

/**
 * Sets a tab's label; a label that normalises to "" clears it.
 * @param {TabLabels} labels
 * @param {string} tabId
 * @param {string} text
 * @returns {TabLabels}
 */
export function setTabLabel(labels, tabId, text) {
  const label = normalizeTabLabel(text);
  if (!label) return clearTabLabel(labels, tabId);
  if (labels[tabId] === label) return labels;
  return freeze({ ...labels, [tabId]: label });
}

/**
 * @param {TabLabels} labels
 * @param {string} tabId
 * @returns {TabLabels}
 */
export function clearTabLabel(labels, tabId) {
  if (!Object.hasOwn(labels, tabId)) return labels;
  return freeze(Object.fromEntries(Object.entries(labels).filter(([id]) => id !== tabId)));
}

/**
 * @param {TabLabels} labels
 * @param {string} tabId
 * @returns {string | undefined}
 */
export function tabLabel(labels, tabId) {
  return Object.hasOwn(labels, tabId) ? labels[tabId] : undefined;
}

/**
 * Drops labels of tabs that no longer exist.
 * @param {TabLabels} labels
 * @param {Iterable<string>} liveTabIds
 * @returns {TabLabels}
 */
export function pruneTabLabels(labels, liveTabIds) {
  const live = new Set(liveTabIds);
  const kept = Object.entries(labels).filter(([id]) => live.has(id));
  return kept.length === Object.keys(labels).length ? labels : freeze(Object.fromEntries(kept));
}

/**
 * What the status bar, picker and side panel show: rename > non-blank title > URL > "New Tab".
 * @param {{ label?: string | null, title?: string | null, url?: string | null }} tab
 * @returns {string}
 */
export function displayLabel({ label, title, url }) {
  if (label) return label;
  if (title && title.trim()) return title;
  if (url) return url;
  return "New Tab";
}

/**
 * Plain JSON for the snapshot's `tabLabels` field, keys sorted; undefined when there are none,
 * so a snapshot without renames is unchanged.
 * @param {TabLabels} labels
 * @returns {Record<string, string> | undefined}
 */
export function writeTabLabels(labels) {
  const keys = Object.keys(labels).sort();
  if (!keys.length) return undefined;
  return Object.fromEntries(keys.map((k) => [k, /** @type {string} */ (labels[k])]));
}

/**
 * Validates the snapshot's `tabLabels` field (undefined = no renames).
 * @param {unknown} raw
 * @param {ReadonlySet<string>} tabIds every tab in the snapshot
 * @returns {TabLabels}
 */
export function readTabLabels(raw, tabIds) {
  if (raw === undefined) return freeze({});
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TabLabelError("invalid", TAB_LABELS_FIELD, "must be an object of tab id → label");
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const [id, value] of Object.entries(raw)) {
    const at = `${TAB_LABELS_FIELD}[${JSON.stringify(id)}]`;
    if (!tabIds.has(id)) throw new TabLabelError("invalid", at, "not a tab of this snapshot");
    if (typeof value !== "string" || !value || normalizeTabLabel(value) !== value) {
      throw new TabLabelError("invalid", at, "must be a non-empty, normalised label");
    }
    out[id] = value;
  }
  return freeze(out);
}
