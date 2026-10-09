import bodyRequired from "./tools/commitlint/body-required.mjs";

export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [bodyRequired],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "perf",
        "refactor",
        "test",
        "docs",
        "chore",
        "deps",
        "upstream",
        "ci",
        "build",
        "revert",
      ],
    ],
    // The body is the changelog line (CLAUDE.md); feat and fix must have one.
    "body-required-for-types": [2, "always", ["feat", "fix"]],
  },
};
