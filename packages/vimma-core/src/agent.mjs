/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Local AI agents and the agent workspace (docs/specs/vimma-mcp.md). Pure: `:mcp on|off|forget`
 * and their questions (decisions 8 and 26), and the agent workspace's glyph. The agent role's
 * queue, grants and prompt (sub-PR 2) come here too.
 */

/** The agent workspace's glyph; with the word, it carries the meaning without colour (24). */
export const AGENT_GLYPH = "◇";

/** `:mcp forget` (decision 8): the container's cookies and site data go; the workspace stays. */
export const MCP_FORGET_QUESTION =
  "Delete the agent workspace's cookies and site data (its logins)? y/N";

/**
 * @typedef {{ kind: "status" } | { kind: "on" } | { kind: "off" } | { kind: "forget" }
 *   | { kind: "refuse", text: string }} McpCommand
 */

/**
 * `:mcp [on|off|forget]`.
 * @param {string | undefined} text
 * @returns {McpCommand}
 */
export function parseMcpCommand(text) {
  const word = (text ?? "").trim().toLowerCase();
  if (!word) return { kind: "status" };
  if (word === "on" || word === "off" || word === "forget") return { kind: word };
  return { kind: "refuse", text: ":mcp takes on, off or forget" };
}

/**
 * What `:mcp on|off` does (decision 26): with `[mcp] enabled` in config.toml (`config`), nothing
 * but say so; `on` asks first (the pref is the command's, and so is the question); `off` sets
 * the pref at once.
 * @param {"on" | "off"} word
 * @param {{ pref: boolean, config?: boolean }} state  the pref, and the file's value if it sets one
 * @returns {{ kind: "say", text: string } | { kind: "ask" }
 *   | { kind: "set", value: boolean, text: string }}
 */
export function planMcpSwitch(word, { pref, config }) {
  if (config !== undefined) {
    return {
      kind: "say",
      text: `mcp: config.toml sets [mcp] enabled = ${config}; change it there`,
    };
  }
  const on = word === "on";
  if (pref === on) return { kind: "say", text: `mcp is already ${word}` };
  if (on) return { kind: "ask" };
  return { kind: "set", value: false, text: "mcp off: agents cannot reach Vimma" };
}

/**
 * `:mcp on`'s question. `adopted`: the agent workspace is one Vimma did not make (yours, or a
 * `[workspaces]` one), with its tabs: agents would read what is already there (decision 8).
 * @param {string} name  the agent workspace
 * @param {{ tabs: number } | null} adopted
 */
export function mcpOnQuestion(name, adopted) {
  if (!adopted) {
    return `Let local AI agents ask to use the "${name}" workspace? Every request asks you first. y/N`;
  }
  const tabs = `${adopted.tabs} tab${adopted.tabs === 1 ? "" : "s"}`;
  return (
    `"${name}" is your own workspace (${tabs}, its own logins). Agents will be able to read ` +
    "it. y/N"
  );
}

/**
 * `:mcp` without a word: on or off (and whether config.toml says so), and the workspace.
 * @param {{ enabled: boolean, from: "config" | "pref", workspace: string }} state
 */
export function mcpStatus({ enabled, from, workspace }) {
  const where = from === "config" ? " (config.toml)" : "";
  const what = enabled ? "every request asks you first" : ":mcp on lets agents ask to use it";
  return `mcp ${enabled ? "on" : "off"}${where} · agent workspace "${workspace}" · ${what}`;
}
