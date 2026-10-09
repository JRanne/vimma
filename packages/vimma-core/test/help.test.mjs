import { describe, test, expect } from "vitest";
import { compileKeymap } from "../src/keymap.mjs";
import { bindingTable, filterBindings, renderHelpText } from "../src/help.mjs";
import { ACTIONS } from "../src/actions.mjs";

describe("help table", () => {
  test("has one row per action in ACTIONS order", () => {
    const rows = bindingTable(compileKeymap());
    expect(rows.map((r) => r.name)).toEqual(ACTIONS.map((a) => a.name));
  });

  test("shows prefix+? for show_keybinds", () => {
    const row = bindingTable(compileKeymap()).find((r) => r.name === "show_keybinds");
    expect(row?.bindings).toContain("prefix+?");
  });

  test("marks user overrides", () => {
    const rows = bindingTable(compileKeymap({ keys: { new_tab: ["ctrl+alt+c"] } }));
    expect(rows.find((r) => r.name === "new_tab")).toMatchObject({
      overridden: true,
      bindings: ["ctrl+alt+c", "t"],
    });
  });

  test("filter matches name, description and binding, case-insensitively", () => {
    const rows = bindingTable(compileKeymap());
    expect(filterBindings(rows, "RENAME").map((r) => r.name)).toEqual(
      expect.arrayContaining(["rename_tab", "rename_workspace"]),
    );
    expect(filterBindings(rows, "prefix+?").map((r) => r.name)).toContain("show_keybinds");
    expect(filterBindings(rows, "")).toHaveLength(rows.length);
    expect(filterBindings(rows, "zzzz")).toEqual([]);
  });

  test("help text for defaults matches the snapshot", () => {
    expect(renderHelpText(bindingTable(compileKeymap()))).toMatchSnapshot();
  });

  test("help text marks overrides with an asterisk", () => {
    const txt = renderHelpText(bindingTable(compileKeymap({ keys: { new_tab: ["ctrl+alt+c"] } })));
    expect(txt).toMatch(/\* new_tab/);
  });
});
