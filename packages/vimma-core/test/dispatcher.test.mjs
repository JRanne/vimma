import { describe, test, expect } from "vitest";
import { createDispatcher } from "../src/dispatcher.mjs";
import { compileKeymap } from "../src/keymap.mjs";
import { parseKey } from "../src/keys.mjs";

/** Feed space-separated chords; return all results. */
function feed(d, mode, keys) {
  return keys.split(" ").map((k) => d.dispatch(mode, parseKey(k)));
}
const last = (arr) => arr[arr.length - 1];
const make = (cfg) => createDispatcher(compileKeymap(cfg));

describe("dispatcher (spec acceptance criteria)", () => {
  test("ctrl+b then ? in normal mode shows help after pending", () => {
    const r = feed(make(), "normal", "ctrl+b ?");
    expect(r[0]).toEqual({ kind: "pending" });
    expect(r[1]).toEqual({ kind: "action", action: { id: "help.show" } });
  });

  test("ctrl+b then ? in insert mode shows help (prefix layer is global)", () => {
    expect(last(feed(make(), "insert", "ctrl+b ?"))).toEqual({
      kind: "action",
      action: { id: "help.show" },
    });
  });

  test("j in insert mode passes through", () => {
    expect(feed(make(), "insert", "j")[0]).toEqual({ kind: "pass" });
  });

  test("esc in insert mode returns to normal", () => {
    expect(feed(make(), "insert", "esc")[0]).toEqual({
      kind: "action",
      action: { id: "mode.normal" },
    });
  });

  test("ctrl+b then 3 jumps to tab 3", () => {
    expect(last(feed(make(), "normal", "ctrl+b 3"))).toEqual({
      kind: "action",
      action: { id: "tab.goto", arg: 3 },
    });
  });

  test("3 g t carries a count; g t alone does not", () => {
    const d = make();
    expect(last(feed(d, "normal", "3 g t"))).toEqual({
      kind: "action",
      action: { id: "tab.next", count: 3 },
    });
    expect(last(feed(d, "normal", "g t"))).toEqual({
      kind: "action",
      action: { id: "tab.next" },
    });
  });

  test("multi-digit counts accumulate including zero", () => {
    expect(last(feed(make(), "normal", "1 0 j"))).toEqual({
      kind: "action",
      action: { id: "scroll.down", count: 10 },
    });
  });

  test("0 without a count is not a count", () => {
    expect(feed(make(), "normal", "0")[0]).toEqual({ kind: "pass" });
  });

  test("a count followed by an unbound key cancels", () => {
    expect(last(feed(make(), "normal", "3 y"))).toEqual({ kind: "cancel" });
  });

  test("ctrl+b then an unbound key cancels", () => {
    expect(last(feed(make(), "normal", "ctrl+b y"))).toEqual({ kind: "cancel" });
  });

  test("ctrl+b then esc cancels", () => {
    expect(last(feed(make(), "normal", "ctrl+b esc"))).toEqual({ kind: "cancel" });
  });

  test("with prefix ctrl+a, ctrl+b passes and ctrl+a c opens a tab", () => {
    const d = make({ keys: { prefix: "ctrl+a" } });
    expect(feed(d, "normal", "ctrl+b")[0]).toEqual({ kind: "pass" });
    expect(last(feed(d, "normal", "ctrl+a c"))).toEqual({
      kind: "action",
      action: { id: "tab.new" },
    });
  });

  test("an ambiguous sequence resolves to the shorter binding on flush", () => {
    const d = make({ modal: { normal: { g: "tab.new", gg: "scroll.top" } } });
    expect(feed(d, "normal", "g")[0]).toEqual({ kind: "pending" });
    expect(d.flush()).toEqual({ kind: "action", action: { id: "tab.new" } });
    expect(d.pending()).toEqual([]);
  });

  test("an ambiguous sequence resolves to the longer binding when the next key completes it", () => {
    const d = make({ modal: { normal: { g: "tab.new", gg: "scroll.top" } } });
    expect(last(feed(d, "normal", "g g"))).toEqual({
      kind: "action",
      action: { id: "scroll.top" },
    });
  });

  test("an ambiguous sequence followed by a non-continuing key runs the shorter and asks for replay", () => {
    const d = make({ modal: { normal: { g: "tab.new", gg: "scroll.top" } } });
    feed(d, "normal", "g");
    // j does not continue "g": the pending "g" resolves and the host must replay j
    const r = d.dispatch("normal", parseKey("j"));
    expect(r).toEqual({ kind: "action", action: { id: "tab.new" }, replay: true });
    expect(d.pending()).toEqual([]);
    expect(d.dispatch("normal", parseKey("j"))).toEqual({
      kind: "action",
      action: { id: "scroll.down" },
    });
  });

  test("ambiguous() is true only while flush() would resolve to an action", () => {
    const d = make({ modal: { normal: { g: "tab.new", gg: "scroll.top" } } });
    expect(d.ambiguous()).toBe(false);
    feed(d, "normal", "g");
    expect(d.ambiguous()).toBe(true);
    d.dispatch("normal", parseKey("g"));
    expect(d.ambiguous()).toBe(false);
  });

  test("a bare prefix, a dead modal prefix and a count are pending but not ambiguous", () => {
    const d = make();
    feed(d, "insert", "ctrl+b");
    expect(d.pending()).toEqual(["prefix"]);
    expect(d.ambiguous()).toBe(false);
    d.reset();
    feed(d, "normal", "g");
    expect(d.ambiguous()).toBe(false);
    d.reset();
    feed(d, "normal", "3");
    expect(d.ambiguous()).toBe(false);
  });

  test("flush with nothing pending returns null; flush on a dead prefix cancels", () => {
    const d = make();
    expect(d.flush()).toBeNull();
    feed(d, "normal", "g");
    expect(d.flush()).toEqual({ kind: "cancel" });
  });

  test("space n toggles the side panel in normal mode", () => {
    expect(last(feed(make(), "normal", "space n"))).toEqual({
      kind: "action",
      action: { id: "sidebar.toggle" },
    });
  });

  test("leader bindings from [keys] do not fire in insert mode", () => {
    expect(feed(make(), "insert", "space")[0]).toEqual({ kind: "pass" });
  });

  test("replacing new_tab's chords removes prefix+c", () => {
    const d = make({ keys: { new_tab: ["ctrl+alt+c"] } });
    expect(last(feed(d, "normal", "ctrl+b c"))).toEqual({ kind: "cancel" });
    expect(last(feed(d, "normal", "ctrl+alt+c"))).toEqual({
      kind: "action",
      action: { id: "tab.new" },
    });
  });

  test("a dead modal sequence cancels", () => {
    expect(last(feed(make(), "normal", "g z"))).toEqual({ kind: "cancel" });
  });

  test("esc during a pending sequence cancels", () => {
    expect(last(feed(make(), "normal", "g esc"))).toEqual({ kind: "cancel" });
  });

  test("modal bindings override globals in their mode", () => {
    const d = make({ modal: { normal: { "<C-i>": "scroll.down" } } });
    expect(feed(d, "normal", "ctrl+i")[0]).toEqual({
      kind: "action",
      action: { id: "scroll.down" },
    });
    expect(feed(d, "insert", "ctrl+i")[0]).toEqual({
      kind: "action",
      action: { id: "workspace.next" },
    });
  });

  test("ctrl+i switches workspace in every mode", () => {
    for (const mode of ["normal", "insert", "visual", "panel"]) {
      expect(feed(make(), mode, "ctrl+i")[0].action?.id).toBe("workspace.next");
    }
  });

  test("help mode: esc closes, / filters", () => {
    const d = make();
    expect(feed(d, "help", "esc")[0]).toEqual({ kind: "action", action: { id: "help.close" } });
    expect(feed(d, "help", "/")[0]).toEqual({ kind: "action", action: { id: "help.filter" } });
  });

  test("reset clears pending state", () => {
    const d = make();
    feed(d, "normal", "ctrl+b");
    expect(d.pending().length).toBe(1);
    d.reset();
    expect(d.pending()).toEqual([]);
    expect(feed(d, "normal", "c")[0]).toEqual({ kind: "pass" });
  });

  test("pending() reports the buffered chords for the status bar", () => {
    const d = make();
    feed(d, "normal", "ctrl+b");
    expect(d.pending()).toEqual(["prefix"]);
    d.reset();
    feed(d, "normal", "2 g");
    expect(d.pending()).toEqual(["2", "g"]);
  });

  test("a mode switch mid-sequence starts fresh", () => {
    const d = make();
    feed(d, "normal", "g");
    expect(feed(d, "insert", "t")[0]).toEqual({ kind: "pass" });
  });

  test("an unknown mode is rejected", () => {
    expect(() => make().dispatch(/** @type {any} */ ("bogus"), parseKey("j"))).toThrow(/mode/);
  });
});
