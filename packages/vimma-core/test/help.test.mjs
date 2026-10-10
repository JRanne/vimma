import { describe, test, expect } from "vitest";
import { compileKeymap } from "../src/keymap.mjs";
import { bindingTable, filterBindings, keyLegend, renderHelpText } from "../src/help.mjs";
import { ACTIONS } from "../src/actions.mjs";

describe("help table", () => {
  test("has one row per action in ACTIONS order", () => {
    const rows = bindingTable(compileKeymap());
    expect(rows.map((r) => r.name)).toEqual(ACTIONS.map((a) => a.name));
  });

  test("shows the keys a user presses, not config notation", () => {
    const rows = bindingTable(compileKeymap());
    const keys = (name) => rows.find((r) => r.name === name)?.bindings;
    expect(keys("show_keybinds")).toContain("ctrl+b ?");
    expect(keys("toggle_sidebar")).toEqual(["ctrl+b b", "space n"]);
    expect(keys("close_tab")).toEqual(["ctrl+b shift+x", "x"]);
    expect(keys("focus_pane_left")).toEqual(["ctrl+b h", "ctrl+w h"]);
    for (const r of rows) {
      for (const b of r.bindings) expect(b, r.name).not.toMatch(/prefix|<leader>|<[a-z]/i);
    }
  });

  test("mode-scoped bindings keep their mode", () => {
    const rows = bindingTable(compileKeymap());
    const all = rows.flatMap((r) => r.bindings);
    expect(all).toContain("esc [panel]");
    expect(all).toContain("enter [resize]");
    expect(all).toContain("< [resize]");
  });

  test("follows a remapped prefix and leader", () => {
    const km = compileKeymap({ keys: { prefix: "ctrl+a" }, modal: { leader: "," } });
    const row = bindingTable(km).find((r) => r.name === "toggle_sidebar");
    expect(row?.bindings).toEqual(["ctrl+a b", ", n"]);
  });

  test("the legend names the prefix and leader keys", () => {
    expect(keyLegend(compileKeymap())).toBe("prefix = ctrl+b · leader = space");
    expect(keyLegend(compileKeymap({ keys: { prefix: "ctrl+a" }, modal: { leader: "," } }))).toBe(
      "prefix = ctrl+a · leader = ,",
    );
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
    expect(filterBindings(rows, "ctrl+b ?").map((r) => r.name)).toContain("show_keybinds");
    expect(filterBindings(rows, "ctrl+b b").map((r) => r.name)).toContain("toggle_sidebar");
    expect(filterBindings(rows, "sidebar").map((r) => r.name)).toContain("toggle_sidebar");
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
