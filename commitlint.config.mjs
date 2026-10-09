export default {
  extends: ["@commitlint/config-conventional"],
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
  },
};
