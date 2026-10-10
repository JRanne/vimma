import { describe, test, expect } from "vitest";
import { compileKeymap } from "../src/keymap.mjs";
import { bindingTable, filterBindings, keyLegend, renderHelpText } from "../src/help.mjs";
import { ACTIONS } from "../src/actions.mjs";
import { DEFAULT_CONFIG } from "../src/defaults.mjs";

/** [keys] lists that drop every default leader binding, so no binding uses the leader. */
const NO_LEADER_KEYS = Object.fromEntries(
  Object.entries(DEFAULT_CONFIG.keys)
    .filter(([, v]) => [v].flat().some((b) => /<leader>/i.test(b)))
    .map(([k, v]) => [k, [v].flat().filter((b) => !/<leader>/i.test(b))]),
);

describe("help table", () => {
  test("has one row per action in ACTIONS order", () => {
    const rows = bindingTable(compileKeymap());
    expect(rows.map((r) => r.name)).toEqual(ACTIONS.map((a) => a.name));
  });

  test("shows the keys a user presses, not config notation", () => {
    // An explicit sidebar list, so the leader binding does not hang on the defaults.
    const km = compileKeymap({ keys: { toggle_sidebar: ["prefix+b", "<leader>n"] } });
    const rows = bindingTable(km);
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
    const km = compileKeymap({
      keys: { prefix: "ctrl+a", toggle_sidebar: ["prefix+b", "<leader>n"] },
      modal: { leader: "," },
    });
    const row = bindingTable(km).find((r) => r.name === "toggle_sidebar");
    expect(row?.bindings).toEqual(["ctrl+a b", ", n"]);
  });

  test("the legend always names the prefix", () => {
    expect(keyLegend(compileKeymap())).toMatch(/^prefix = ctrl\+b\b/);
    expect(keyLegend(compileKeymap({ keys: { prefix: "ctrl+a" } }))).toMatch(/^prefix = ctrl\+a\b/);
  });

  test("the legend leaves the leader out when nothing is bound to it", () => {
    const km = compileKeymap({ keys: NO_LEADER_KEYS });
    expect(ACTIONS.flatMap((a) => km.bindingsFor(a.name)).join(" ")).not.toMatch(/<leader>/i);
    expect(keyLegend(km)).toBe("prefix = ctrl+b");
  });

  test("the legend leaves the leader out when its only binding is unbound", () => {
    const km = compileKeymap({
      modal: { normal: { "<leader>ff": "goto.picker" } },
      keys: NO_LEADER_KEYS,
      unbind: { normal: ["<leader>ff"] },
    });
    expect(keyLegend(km)).toBe("prefix = ctrl+b");
  });

  test("the legend names the leader once a user binds a key to it", () => {
    const km = compileKeymap({
      keys: { ...NO_LEADER_KEYS, prefix: "ctrl+a" },
      modal: { leader: ",", normal: { "<leader>ff": "goto.picker" } },
    });
    expect(keyLegend(km)).toBe("prefix = ctrl+a · leader = ,");
    expect(bindingTable(km).find((r) => r.name === "goto_picker")?.bindings).toContain(", ff");
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
