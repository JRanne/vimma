/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Insert-mode detection over a plain descriptor of the focused element, built by the content
 * actor. See docs/specs/m1-core-logic.md § Insert detection for the rules and their sources.
 */

/**
 * @typedef {object} EditableDescriptor
 * @property {string} tagName              any case (XHTML is lowercase)
 * @property {string} [type]               `<input type>`, any case; missing or "" = "text"
 * @property {boolean} [readOnly]          the IDL property (input, textarea)
 * @property {boolean} [disabled]          `element.matches(":disabled")`
 * @property {boolean} [isContentEditable] the computed IDL property (inherits)
 * @property {string} [contentEditable]    the attribute, used only when isContentEditable is absent
 * @property {string | null} [role]        the role attribute (its first token is used)
 * @property {boolean} [ariaReadOnly]      aria-readonly="true" on the element
 * @property {boolean} [ariaDisabled]      aria-disabled="true" on the element or an ancestor
 * @property {boolean} [designMode]        `ownerDocument.designMode === "on"`
 * @property {readonly string[]} [ancestorClasses] class tokens of the element and its ancestors
 */
/** @typedef {{ editable: boolean, reason: string }} EditableResult */
/** @typedef {"auto" | "never" | "always"} InsertSiteMode */
/** @typedef {{ match: string, insert: InsertSiteMode }} InsertSiteRule */

/** `<input>` types that take no typed characters. Every other type, known or not, is text. */
export const TEXT_INPUT_EXCLUDED_TYPES = Object.freeze([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);
const EXCLUDED = new Set(TEXT_INPUT_EXCLUDED_TYPES);

/** ARIA roles of widgets that take typed characters. */
export const EDITABLE_ROLES = Object.freeze([
  "textbox",
  "searchbox",
  "combobox",
  "spinbutton",
  "application",
]);
const ROLES = new Set(EDITABLE_ROLES);

/** Code and rich-text editors recognised by a class on the element or an ancestor. */
export const KNOWN_EDITORS = Object.freeze(
  [
    { name: "monaco", className: "monaco-editor" },
    { name: "codemirror6", className: "cm-editor" },
    { name: "codemirror5", className: "CodeMirror" },
    { name: "ace", className: "ace_editor" },
    { name: "prosemirror", className: "ProseMirror" },
    { name: "quill", className: "ql-editor" },
  ].map((e) => Object.freeze(e)),
);
const EDITOR_BY_CLASS = new Map(KNOWN_EDITORS.map((e) => [e.className, e.name]));

/** @type {readonly InsertSiteMode[]} */
export const INSERT_SITE_MODES = Object.freeze(["auto", "never", "always"]);

const EDITABLE_CE = new Set(["true", "", "plaintext-only"]);

/**
 * @param {boolean} editable
 * @param {string} reason
 * @returns {EditableResult}
 */
const result = (editable, reason) => Object.freeze({ editable, reason });

/**
 * Whether keys typed into the described element belong to the page (insert mode).
 * @param {EditableDescriptor} d
 * @param {{ site?: InsertSiteMode }} [options] the matched `[[insert.sites]]` rule's mode
 * @returns {EditableResult}
 */
export function isEditable(d, { site = "auto" } = {}) {
  if (!INSERT_SITE_MODES.includes(site)) throw new TypeError(`unknown insert site mode "${site}"`);
  if (site === "never") return result(false, "site:never");
  if (site === "always") return result(true, "site:always");
  if (d.designMode) return result(true, "design-mode");
  if (d.disabled) return result(false, "disabled");
  if (d.ariaDisabled) return result(false, "aria-disabled");
  if (d.readOnly) return result(false, "readonly");

  const tag = d.tagName.toLowerCase();
  if (tag === "input") {
    const type = (d.type ?? "").toLowerCase() || "text";
    return result(!EXCLUDED.has(type), `input:${type}`);
  }
  if (tag === "textarea" || tag === "select") return result(true, tag);
  if (tag === "embed" || tag === "object") return result(true, "embed");

  const ce =
    d.isContentEditable ??
    (d.contentEditable !== undefined && EDITABLE_CE.has(d.contentEditable.toLowerCase()));
  if (ce) return result(true, "contenteditable");

  for (const cls of d.ancestorClasses ?? []) {
    const editor = EDITOR_BY_CLASS.get(cls);
    if (editor) return result(true, `editor:${editor}`);
  }

  const role = (d.role ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (ROLES.has(role)) {
    return d.ariaReadOnly ? result(false, "aria-readonly") : result(true, `role:${role}`);
  }
  return result(false, "none");
}

/** @param {string} host */
const normaliseHost = (host) => host.toLowerCase().replace(/\.$/, "");

/**
 * The `[[insert.sites]]` rule for a host: the one whose `match` is the host or a dot-suffix of
 * it, the longest match winning, the earlier rule on a tie.
 * @param {string} host
 * @param {readonly InsertSiteRule[]} rules
 * @returns {InsertSiteRule | undefined}
 */
export function matchSiteRule(host, rules) {
  const h = normaliseHost(host);
  /** @type {InsertSiteRule | undefined} */
  let best;
  let bestLength = -1;
  for (const rule of rules) {
    const m = normaliseHost(rule.match);
    if (!m) continue;
    if ((h === m || h.endsWith(`.${m}`)) && m.length > bestLength) {
      best = rule;
      bestLength = m.length;
    }
  }
  return best;
}
