import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { versionFiles, writeVersionFiles } from "../version-files.mjs";

/**
 * @param {string | undefined} firefox
 * @param {string | undefined} display
 */
const surfer = (firefox, display) => ({
  version: { product: "firefox", version: firefox },
  brands: { vimma: { release: { displayVersion: display } } },
});

describe("versionFiles", () => {
  it("puts the Firefox version in version.txt and Vimma's in version_display.txt", () => {
    expect(versionFiles(surfer("157.0.1", "0.1.0"))).toEqual({
      "version.txt": "157.0.1\n",
      "version_display.txt": "0.1.0\n",
    });
  });

  it("accepts a two-part Firefox version and a pre-release display version", () => {
    expect(versionFiles(surfer("158.0", "0.2.0-nightly.20261009"))).toEqual({
      "version.txt": "158.0\n",
      "version_display.txt": "0.2.0-nightly.20261009\n",
    });
  });

  it("reads the named brand", () => {
    const config = surfer("157.0.1", "0.1.0");
    config.brands = { ...config.brands, other: { release: { displayVersion: "2.0.0" } } };
    expect(versionFiles(config, "other")["version_display.txt"]).toBe("2.0.0\n");
  });

  it.each([
    ["a missing Firefox version", undefined, "0.1.0", /version\.version/],
    ["a malformed Firefox version", "157.0.1\n", "0.1.0", /version\.version/],
    ["a missing display version", "157.0.1", undefined, /displayVersion/],
    ["a display version that is not semver", "157.0.1", "0.1", /displayVersion/],
  ])("throws on %s", (_name, firefox, display, message) => {
    expect(() => versionFiles(surfer(firefox, display))).toThrow(message);
  });

  it("throws when the brand is missing", () => {
    expect(() => versionFiles(surfer("157.0.1", "0.1.0"), "nope")).toThrow(/brands\.nope/);
  });
});

describe("writeVersionFiles", () => {
  it("writes both files into the directory, creating it", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "vimma-version-")), "browser/config/vimma");
    writeVersionFiles(surfer("157.0.1", "0.1.0"), dir);
    expect(readFileSync(join(dir, "version.txt"), "utf8")).toBe("157.0.1\n");
    expect(readFileSync(join(dir, "version_display.txt"), "utf8")).toBe("0.1.0\n");
  });
});
