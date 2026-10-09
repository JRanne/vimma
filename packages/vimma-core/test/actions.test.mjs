import { describe, test, expect } from "vitest";
import { ACTIONS, getAction, resolveActionName } from "../src/actions.mjs";

describe("actions", () => {
  test("every action has a unique id+arg, a unique config name, a group and a description", () => {
    const names = new Set();
    const ids = new Set();
    for (const a of ACTIONS) {
      expect(a.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(a.id).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
      expect(a.description.length).toBeGreaterThan(3);
      expect(a.group.length).toBeGreaterThan(0);
      expect(names.has(a.name)).toBe(false);
      names.add(a.name);
      const key = `${a.id}:${a.arg ?? ""}`;
      expect(ids.has(key)).toBe(false);
      ids.add(key);
    }
  });

  test("Herdr's documented action names exist", () => {
    for (const n of [
      "new_tab",
      "split_vertical",
      "split_horizontal",
      "focus_pane_left",
      "zoom",
      "resize_mode",
      "copy_mode",
      "next_tab",
      "previous_tab",
      "rename_tab",
      "close_tab",
      "new_workspace",
      "rename_workspace",
      "close_workspace",
      "goto_picker",
      "toggle_sidebar",
    ]) {
      expect(getAction(n), n).toBeDefined();
    }
  });

  test("actions resolve by config name, by dotted id and by alias", () => {
    expect(resolveActionName("new_tab")?.id).toBe("tab.new");
    expect(resolveActionName("tab.new")?.name).toBe("new_tab");
    expect(resolveActionName("prev_workspace")?.name).toBe("previous_workspace");
    expect(resolveActionName("select_tab_3")).toMatchObject({ id: "tab.goto", arg: 3 });
    expect(resolveActionName("nope")).toBeUndefined();
  });

  test("ACTIONS is frozen so the closed set cannot be extended at runtime", () => {
    expect(Object.isFrozen(ACTIONS)).toBe(true);
  });
});
