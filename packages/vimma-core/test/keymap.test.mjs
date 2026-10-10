import { describe, test, expect } from "vitest";
import { compileKeymap, KeymapError } from "../src/keymap.mjs";

describe("compileKeymap", () => {
  test("compiles defaults without errors", () => {
    const km = compileKeymap();
    expect(km.prefix).toEqual({ key: "b", ctrl: true, alt: false, shift: false, meta: false });
    expect(km.leader.key).toBe("space");
  });

  test("an unknown action in [keys] fails with a suggestion", () => {
    let err;
    try {
      compileKeymap({ keys: { new_tabb: ["prefix+c"] } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KeymapError);
    expect(err.path).toBe("keys.new_tabb");
    expect(err.suggestion).toBe("new_tab");
    expect(err.message).toMatch(/did you mean "new_tab"/);
  });

  test("an unknown action in [modal.normal] fails with a suggestion", () => {
    expect(() => compileKeymap({ modal: { normal: { j: "scroll.dwn" } } })).toThrow(/scroll\.down/);
  });

  test("bad key notation reports the config path with index", () => {
    let err;
    try {
      compileKeymap({ keys: { new_tab: ["prefix+c", "ctrl+bogus"] } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KeymapError);
    expect(err.path).toBe("keys.new_tab[1]");
  });

  test("a single string is accepted where a list is expected", () => {
    const km = compileKeymap({ keys: { new_tab: "ctrl+alt+c" } });
    // [keys] replaces only the prefix-layer chords; the modal "t" binding is a separate layer
    expect(km.bindingsFor("new_tab")).toEqual(["ctrl+alt+c", "t"]);
  });

  test("the same sequence bound to two actions in one mode is an error", () => {
    expect(() => compileKeymap({ keys: { new_tab: ["prefix+n"] } })).toThrow(KeymapError);
  });

  test("an unknown mode table is an error", () => {
    expect(() => compileKeymap({ modal: { nromal: { j: "scroll.down" } } })).toThrow(/normal/);
  });

  test("unknown top-level keys in [keys] other than prefix are actions, prefix is a chord", () => {
    expect(() => compileKeymap({ keys: { prefix: "ctrl+nope" } })).toThrow(KeymapError);
    expect(compileKeymap({ keys: { prefix: "ctrl+a" } }).prefix.key).toBe("a");
  });

  test("a non-string, non-list binding value is an error", () => {
    expect(() => compileKeymap({ keys: { new_tab: 3 } })).toThrow(KeymapError);
    expect(() => compileKeymap({ modal: { normal: { j: 3 } } })).toThrow(KeymapError);
  });

  test("unbind removes a default modal binding", () => {
    const km = compileKeymap({ unbind: { normal: ["x"] } });
    expect(km.bindingsFor("close_tab")).not.toContain("x");
  });

  test("unbind in an unknown mode or with bad notation is an error", () => {
    expect(() => compileKeymap({ unbind: { nope: ["x"] } })).toThrow(KeymapError);
    expect(() => compileKeymap({ unbind: { normal: ["<Bad>"] } })).toThrow(KeymapError);
  });

  test("overriding a [keys] action marks it overridden", () => {
    const km = compileKeymap({ keys: { new_tab: ["ctrl+alt+c"] } });
    expect(km.isOverridden("new_tab")).toBe(true);
    expect(km.isOverridden("next_tab")).toBe(false);
  });

  test("modal bindings are listed with their mode", () => {
    const km = compileKeymap();
    expect(km.bindingsFor("scroll_down")).toContain("j");
  });

  test("leader and timeout come from [modal]", () => {
    const km = compileKeymap({ modal: { leader: ",", timeout_ms: 300 } });
    expect(km.leader.key).toBe(",");
    expect(km.timeoutMs).toBe(300);
  });

  test("invalid timeout_ms is an error", () => {
    expect(() => compileKeymap({ modal: { timeout_ms: -1 } })).toThrow(KeymapError);
  });
});

describe("normal-mode extras (yy, p, P, gi, gu, gU, gf)", () => {
  /**
   * The action a key sequence reaches in `mode`, or undefined.
   * @param {string} mode
   * @param {string[]} keys
   */
  const actionAt = (mode, keys) => {
    let node = compileKeymap().trie(/** @type {any} */ (mode));
    for (const k of keys) node = node?.children.get(k);
    return node?.action?.id;
  };

  test.each([
    [["y", "y"], "page.yank_url"],
    [["p"], "page.open_clipboard"],
    [["shift+p"], "page.open_clipboard_new_tab"],
    [["g", "i"], "page.focus_input"],
    [["g", "u"], "page.url_up"],
    [["g", "shift+u"], "page.url_root"],
    [["g", "f"], "page.view_source"],
  ])("normal %j runs %s", (keys, id) => {
    expect(actionAt("normal", keys)).toBe(id);
  });

  test("y alone is a prefix in normal mode, not an action of its own", () => {
    const y = compileKeymap().trie("normal").children.get("y");
    expect(y?.action).toBeFalsy();
    expect([...(y?.children.keys() ?? [])]).toEqual(["y"]);
  });

  test("copy mode keeps y and Y for the selection", () => {
    expect(actionAt("visual", ["y"])).toBe("selection.yank");
    expect(actionAt("visual", ["shift+y"])).toBe("selection.yank_lines");
    expect(actionAt("visual", ["p"])).toBeUndefined();
  });

  test("the keys are normal-only: insert mode has none of them", () => {
    for (const key of ["y", "p", "shift+p", "g"]) {
      expect(compileKeymap().trie("insert").children.get(key)).toBeUndefined();
    }
  });

  test("z stays unbound in normal mode (the pass-through key the tests rely on)", () => {
    expect(compileKeymap().trie("normal").children.get("z")).toBeUndefined();
  });
});

describe("I focuses the address bar", () => {
  /**
   * The action one key reaches in `mode`, or undefined.
   * @param {string} mode
   * @param {string} key
   */
  const at = (mode, key) =>
    compileKeymap()
      .trie(/** @type {any} */ (mode))
      .children.get(key)?.action?.id;

  test.each(["normal", "visual", "panel"])("%s mode: I runs urlbar.focus", (mode) => {
    expect(at(mode, "shift+i")).toBe("urlbar.focus");
  });

  test("insert mode leaves I to the text field", () => {
    expect(at("insert", "shift+i")).toBeUndefined();
  });

  test("lower-case i keeps its own meaning", () => {
    expect(at("normal", "i")).toBe("mode.insert");
    expect(compileKeymap().trie("visual").children.get("i")?.children.has("w")).toBe(true);
  });

  test("the action is named focus_urlbar", () => {
    expect(compileKeymap().bindingsFor("focus_urlbar")).toContain("I");
  });
});
