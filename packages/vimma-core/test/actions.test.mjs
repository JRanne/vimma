import { describe, test, expect } from "vitest";
import { ACTIONS, getAction, resolveActionName } from "../src/actions.mjs";
import { compileKeymap } from "../src/keymap.mjs";

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
      "move_to_workspace",
      "route_rules",
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

  test("every M2 tab action of plan §2 exists with its default binding (m2-core-logic)", () => {
    const km = compileKeymap();
    /** @type {Record<string, string[]>} */
    const want = {
      show_keybinds: ["prefix+?"],
      new_tab: ["prefix+c", "t"],
      next_tab: ["prefix+n", "gt"],
      previous_tab: ["prefix+p", "gT"],
      ...Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [`select_tab_${i + 1}`, [`prefix+${i + 1}`]]),
      ),
      rename_tab: ["prefix+shift+t"],
      close_tab: ["prefix+shift+x", "x"],
      goto_picker: ["prefix+g", "b"],
    };
    for (const [name, bindings] of Object.entries(want)) {
      expect(getAction(name), name).toBeDefined();
      expect(km.bindingsFor(name), name).toEqual(bindings);
    }
    expect(getAction("select_tab_3")).toMatchObject({ id: "tab.goto", arg: 3 });
  });

  test("private_workspace: prefix+shift+p and ctrl+shift+p, in every mode (private-workspace)", () => {
    const km = compileKeymap();
    expect(getAction("private_workspace")).toMatchObject({
      id: "workspace.private",
      group: "Workspaces",
    });
    expect(km.bindingsFor("private_workspace")).toEqual(["prefix+shift+p", "ctrl+shift+p"]);
    for (const mode of /** @type {const} */ (["normal", "insert", "visual", "panel", "help"])) {
      const node = km.trie(mode).children.get("ctrl+shift+p");
      expect(node?.action?.id, mode).toBe("workspace.private");
    }
  });
});
