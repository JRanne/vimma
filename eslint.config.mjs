import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/",
      "coverage/",
      "engine/",
      ".surfer/",
      "dist/",
      // copies of packages/vimma-core/src, linted there (npm run sync-core)
      "src/browser/base/content/vimma/core/",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: globals.node },
  },
  {
    // ADR-005: vimma-core must stay pure. Do not disable this rule.
    files: ["packages/vimma-core/src/**"],
    languageOptions: { globals: {} },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["resource://*", "chrome://*", "moz-src://*"],
              message: "vimma-core imports nothing from Firefox (ADR-005).",
            },
            {
              group: ["node:*", "fs", "path", "os"],
              message: "vimma-core is host-agnostic; no Node built-ins.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        "ChromeUtils",
        "Services",
        "gBrowser",
        "Cc",
        "Ci",
        "Cu",
        "window",
        "document",
      ],
    },
  },
  {
    // Chrome-privileged code inside the Firefox window.
    files: ["src/**/vimma/**"],
    languageOptions: {
      globals: { ...globals.browser, ChromeUtils: "readonly", Services: "readonly" },
    },
  },
  {
    files: ["src/**/vimma/**/*.js"],
    languageOptions: { sourceType: "script" },
  },
  {
    // mochitest browser-chrome: runs in the browser window scope.
    files: ["tests/browser/**"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        ChromeUtils: "readonly",
        Services: "readonly",
        add_task: "readonly",
        registerCleanupFunction: "readonly",
        Assert: "readonly",
        BrowserTestUtils: "readonly",
        EventUtils: "readonly",
        SpecialPowers: "readonly",
        SimpleTest: "readonly",
        gBrowser: "readonly",
        gURLBar: "readonly",
        SidebarController: "readonly",
      },
    },
  },
];
