/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The binding table behind `prefix+?`, `:map` and docs/bindings.md. Rendered from the same
 * compiled keymap the dispatcher uses, so help cannot drift from behaviour.
 */
import { ACTIONS } from "./actions.mjs";
import { isRunnable } from "./whichkey.mjs";

/** @import { Keymap } from "./keymap.mjs" */
/**
 * @typedef {object} BindingRow
 * @property {string} id
 * @property {string} name
 * @property {string} group
 * @property {string} description
 * @property {string[]} bindings
 * @property {boolean} overridden
 * @property {boolean} [runnable]   only when `bindingTable` is given a runnable set
 */

/**
 * @param {Keymap} keymap
 * @param {{ runnable?: ReadonlySet<string> }} [options] action ids the host implements; rows
 *   then carry `runnable`, the same rule the which-key strip uses
 * @returns {BindingRow[]}
 */
export function bindingTable(keymap, { runnable } = {}) {
  return ACTIONS.map((a) => ({
    id: a.id,
    name: a.name,
    group: a.group,
    description: a.description,
    bindings: keymap.bindingsFor(a.name),
    overridden: keymap.isOverridden(a.name),
    ...(runnable ? { runnable: isRunnable(a.id, runnable) } : {}),
  }));
}

/**
 * Case-insensitive substring filter over name, description and bindings.
 * @param {BindingRow[]} rows
 * @param {string} query
 * @returns {BindingRow[]}
 */
export function filterBindings(rows, query) {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.name, r.description, ...r.bindings].some((s) => s.toLowerCase().includes(q)),
  );
}

/**
 * Plain-text table grouped by action group. `*` marks user overrides.
 * @param {BindingRow[]} rows
 * @returns {string}
 */
export function renderHelpText(rows) {
  const nameW = Math.max(...rows.map((r) => r.name.length));
  const keysW = Math.max(...rows.map((r) => r.bindings.join(", ").length));
  /** @type {string[]} */
  const out = [];
  let group = "";
  for (const r of rows) {
    if (r.group !== group) {
      if (group) out.push("");
      out.push(r.group);
      group = r.group;
    }
    const keys = r.bindings.length ? r.bindings.join(", ") : "(unbound)";
    out.push(
      `${r.overridden ? "*" : " "} ${r.name.padEnd(nameW)}  ${keys.padEnd(keysW)}  ${r.description}`.trimEnd(),
    );
  }
  return out.join("\n") + "\n";
}
