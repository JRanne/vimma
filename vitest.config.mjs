import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.mjs", "tools/**/test/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      include: ["packages/vimma-core/src/**/*.mjs"],
      // Third-party code we do not write: its coverage would move our gate on every upstream
      // update. toml-conformance.test.mjs still exercises it.
      exclude: ["packages/vimma-core/src/vendor/**"],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
