/**
 * Modes the host can report to the dispatcher. `prefix` is not a mode here: the dispatcher
 * tracks a pending prefix itself and the host shows it in the status bar via `pending()`.
 * @typedef {"normal" | "insert" | "visual" | "command" | "hint" | "help" | "panel"} Mode
 */

/** @type {readonly Mode[]} */
export const MODES = Object.freeze([
  "normal",
  "insert",
  "visual",
  "command",
  "hint",
  "help",
  "panel",
]);

/** Modes in which leading digits are a count (`3gt`). */
/** @type {ReadonlySet<Mode>} */
export const COUNT_MODES = new Set(["normal", "visual"]);

/**
 * @param {string} mode
 * @returns {mode is Mode}
 */
export function isMode(mode) {
  return /** @type {readonly string[]} */ (MODES).includes(mode);
}
