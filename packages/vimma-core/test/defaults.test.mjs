import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { formatDefaultsToml } from "../src/defaults.mjs";

test("defaults.toml matches the snapshot", () => {
  expect(formatDefaultsToml()).toMatchSnapshot();
});

test("the committed defaults.toml is up to date (run npm run gen-docs)", () => {
  const committed = readFileSync(new URL("../defaults.toml", import.meta.url), "utf8");
  expect(committed).toBe(formatDefaultsToml());
});
