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
