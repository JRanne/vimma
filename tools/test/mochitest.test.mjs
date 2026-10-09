import { describe, expect, it } from "vitest";
import { mochitestCommand } from "../mochitest.mjs";

const ENGINE = "/repo/engine/";
const TESTS = "browser/base/zen-components/tests/browser/";

describe("mochitestCommand", () => {
  it("runs the whole suite headless by default, against the full build", () => {
    const { args, env } = mochitestCommand([], ENGINE);
    expect(args).toEqual(["mochitest", "--headless", TESTS]);
    expect(env).toEqual({});
  });

  it("maps repo paths under the engine's symlinked tests/", () => {
    const { args } = mochitestCommand(["./tests/browser/browser_vimma_key_capture.js"], ENGINE);
    expect(args.at(-1)).toBe(`${TESTS}browser_vimma_key_capture.js`);
  });

  it("drops --headless with --headed and passes other flags through", () => {
    const { args } = mochitestCommand(["--headed", "--verbose", "tests/browser/"], ENGINE);
    expect(args).toEqual(["mochitest", "--verbose", TESTS]);
  });

  it("with --artifact uses the artifact mozconfig and our application.ini (ADR-010)", () => {
    const { args, env } = mochitestCommand(["--artifact", "tests/browser/"], ENGINE);
    expect(env).toEqual({ MOZCONFIG: "/repo/engine/mozconfig.artifact" });
    expect(args).toEqual([
      "mochitest",
      "--headless",
      "--setenv=XUL_APP_FILE=/repo/engine/obj-artifact/dist/bin/browser/application.ini",
      TESTS,
    ]);
  });
});
