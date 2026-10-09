/**
 * commitlint rule `body-required-for-types`: commits of the listed types must have a non-empty
 * body, because the body is the changelog line (CLAUDE.md). Usage in commitlint.config.mjs:
 * `"body-required-for-types": [2, "always", ["feat", "fix"]]`.
 *
 * @param {{ type?: string | null, body?: string | null }} parsed
 * @param {"always" | "never"} [when]
 * @param {string[]} [types]
 * @returns {[boolean, string?]}
 */
export function bodyRequiredForTypes(parsed, when = "always", types = []) {
  if (when !== "always" || !parsed.type || !types.includes(parsed.type)) return [true];
  if ((parsed.body ?? "").trim() !== "") return [true];
  return [
    false,
    `${parsed.type} commits need a body: it is the changelog line (types: ${types.join(", ")})`,
  ];
}

export default {
  rules: { "body-required-for-types": bodyRequiredForTypes },
};
