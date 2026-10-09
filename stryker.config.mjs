// Spec ci-quality-gates: weekly mutation testing of vimma-core (plan §5, unit layer). Survivors
// become one tracking issue (.github/workflows/mutation.yml); they never fail a build, so there is
// no `thresholds.break`. Local run: `npm run mutation`; reading the report: docs/runbook.md.
//
// Test runner: Stryker's built-in `command` runner, which runs the core's Vitest suite once per
// mutant with the mutant chosen by environment variable. @stryker-mutator/vitest-runner 10.0.0
// does not work with Vitest 5: it filters tests by a name joined with spaces, Vitest 5 matches the
// filter against names joined with " > ", so tests inside a describe() never run and every mutant
// they would kill is reported as survived. Revisit when a vitest-runner release supports Vitest 5;
// it would add per-test coverage, which makes runs faster.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "command",
  commandRunner: {
    // The core's tests alone (tools/ tests do not import packages/vimma-core/src); stop at the
    // first failure, since one failing test already kills the mutant.
    command:
      "node node_modules/vitest/vitest.mjs run --config packages/vimma-core/vitest.config.mjs --bail 1 --pool threads --no-isolate --maxWorkers 1",
  },
  coverageAnalysis: "off",
  mutate: [
    "packages/vimma-core/src/**/*.mjs",
    // Vendored smol-toml: third-party code we do not change (same exclusion as coverage).
    "!packages/vimma-core/src/vendor/**",
  ],
  // Kept out of the sandbox copy. tsconfig.json: Stryker rewrites it with TypeScript's JS API,
  // which TypeScript 7 (native) no longer has, and Vitest does not need it. The rest: the engine,
  // the browser sources, docs and mochitests, which the core's tests never read.
  ignorePatterns: [
    "/tsconfig.json",
    "/engine",
    "/.surfer",
    "/src",
    "/docs",
    "/tests/browser",
    "/reports",
  ],
  // Incremental mode: the workflow restores this file from the Actions cache, so a week in which
  // a few core files changed re-tests only the mutants in those files and those whose tests changed.
  incremental: true,
  incrementalFile: "reports/mutation/stryker-incremental.json",
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/mutation.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
};
