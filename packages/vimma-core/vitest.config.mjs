// The core's tests alone, for Stryker (stryker.config.mjs). `npm test` uses the root config, which
// also runs tools/ tests; those spawn processes and do not exercise packages/vimma-core/src.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["test/**/*.test.mjs"],
  },
});
