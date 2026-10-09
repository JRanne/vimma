import { describe, test, expect } from "vitest";
import fc from "fast-check";
import { compileKeymap } from "../src/keymap.mjs";
import { ACTIONS } from "../src/actions.mjs";
import { bindingTable } from "../src/help.mjs";
import { compareKeys, whichKey } from "../src/whichkey.mjs";
import { isRunnable } from "../src/actions.mjs";
import { formatKey, NAMED_KEYS } from "../src/keys.mjs";

const ALL = new Set(ACTIONS.map((a) => a.id));

/** @param {NonNullable<ReturnType<typeof whichKey>>} wk @param {string} group */
const keysIn = (wk, group) => wk.sections.find((s) => s.group === group)?.entries.map((e) => e.key);

describe("which-key", () => {
  const km = compileKeymap();

  test("prefix: sections in ACTIONS group order, keys alphanumeric", () => {
    const wk = /** @type {NonNullable<ReturnType<typeof whichKey>>} */ (
      whichKey(km, "normal", ["prefix"], { runnable: ALL })
    );
    expect(wk.pending).toEqual(["prefix"]);
    const groups = [...new Set(ACTIONS.map((a) => a.group))];
    const shown = wk.sections.map((s) => s.group);
    expect(shown).toEqual(groups.filter((g) => shown.includes(g)));
    expect(keysIn(wk, "Tabs")).toEqual([..."123456789", "c", "n", "p", "shift+t", "shift+x"]);
    expect(keysIn(wk, "Help")).toEqual(["?"]);
    expect(keysIn(wk, "Panes")).toEqual([
      "h",
      "shift+h",
      "j",
      "shift+j",
      "k",
      "shift+k",
      "l",
      "shift+l",
      "r",
      "v",
      "x",
      "z",
      "minus",
    ]);
    const c = wk.sections.flatMap((s) => s.entries).find((e) => e.key === "c");
    expect(c).toEqual({
      key: "c",
      kind: "action",
      name: "new_tab",
      id: "tab.new",
      description: "New tab",
      more: 0,
      runnable: true,
    });
  });

  test("null when nothing (or only a count) is pending, or the sequence is stale", () => {
    expect(whichKey(km, "normal", [], { runnable: ALL })).toBeNull();
    expect(whichKey(km, "normal", ["3"], { runnable: ALL })).toBeNull();
    expect(whichKey(km, "normal", ["prefix", "zz"], { runnable: ALL })).toBeNull();
    expect(whichKey(km, "normal", ["prefix", "c"], { runnable: ALL })).toBeNull();
  });

  test("runnable greys out unbuilt actions, the same rule as the help table", () => {
    const runnable = new Set(["tab.new"]);
    const wk = whichKey(km, "normal", ["prefix"], { runnable });
    const entries = wk?.sections.flatMap((s) => s.entries) ?? [];
    expect(entries.find((e) => e.key === "c")?.runnable).toBe(true);
    expect(entries.find((e) => e.key === "v")?.runnable).toBe(false);
    expect(isRunnable("tab.new", runnable)).toBe(true);
    expect(isRunnable("pane.zoom", runnable)).toBe(false);
    const rows = bindingTable(km, { runnable });
    expect(rows.find((r) => r.name === "new_tab")?.runnable).toBe(true);
    expect(rows.find((r) => r.name === "zoom")?.runnable).toBe(false);
  });

  test("runnable is optional: without a set nothing is greyed, in the strip and in help", () => {
    const entries = whichKey(km, "normal", ["prefix"])?.sections.flatMap((s) => s.entries) ?? [];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.runnable)).toBe(true);
    expect(bindingTable(km).every((r) => r.runnable === true)).toBe(true);
    expect(isRunnable("pane.zoom", undefined)).toBe(true);
  });

  test("ctrl+w in normal mode lists the window keys", () => {
    const wk = whichKey(km, "normal", ["ctrl+w"], { runnable: ALL });
    expect(keysIn(/** @type {any} */ (wk), "Panes")).toEqual([
      "h",
      "shift+h",
      "j",
      "shift+j",
      "k",
      "shift+k",
      "l",
      "shift+l",
      "o",
      "plus",
      "minus",
      "<",
      ">",
    ]);
  });

  test("a prefix with only one group's actions below is a +Group entry", () => {
    const user = compileKeymap({
      keys: {
        goto_picker: ["prefix+shift+g"],
        next_tab: ["prefix+g n"],
        previous_tab: ["prefix+g p"],
      },
    });
    const wk = whichKey(user, "normal", ["prefix"], { runnable: new Set(["tab.next"]) });
    const g = wk?.sections.find((s) => s.group === "Tabs")?.entries.find((e) => e.key === "g");
    expect(g).toEqual({ key: "g", kind: "group", description: "+Tabs", more: 2, runnable: true });
    const inner = whichKey(user, "normal", ["prefix", "g"], { runnable: ALL });
    expect(keysIn(/** @type {any} */ (inner), "Tabs")).toEqual(["n", "p"]);
  });

  test("mixed groups go to More as +n bindings; not runnable when nothing below is", () => {
    const user = compileKeymap({
      keys: { goto_picker: ["prefix+shift+g"], next_tab: ["prefix+g n"], zoom: ["prefix+g z"] },
    });
    const wk = whichKey(user, "normal", ["prefix"], { runnable: new Set() });
    const last = wk?.sections.at(-1);
    expect(last?.group).toBe("More");
    expect(last?.entries).toEqual([
      { key: "g", kind: "group", description: "+2 bindings", more: 2, runnable: false },
    ]);
  });

  test("a binding that is also a prefix is an action entry with more", () => {
    const user = compileKeymap({ keys: { close_tab: ["prefix+g x"] } });
    const g = whichKey(user, "normal", ["prefix"], { runnable: ALL })
      ?.sections.flatMap((s) => s.entries)
      .find((e) => e.key === "g");
    expect(g).toMatchObject({ kind: "action", name: "goto_picker", more: 1 });
  });

  test("a leading count is skipped like the dispatcher does", () => {
    const wk = whichKey(km, "normal", ["2", "g"], { runnable: ALL });
    expect(keysIn(/** @type {any} */ (wk), "Tabs")).toEqual(["t", "shift+t"]);
    expect(keysIn(/** @type {any} */ (wk), "Navigation")).toEqual(["g"]);
  });

  test("leader sequences resolve through the leader label", () => {
    const wk = whichKey(km, "normal", ["leader"], { runnable: ALL });
    expect(keysIn(/** @type {any} */ (wk), "Navigation")).toEqual(["n"]);
  });

  test("compareKeys orders digits, letters, symbols, named keys, then modifiers", () => {
    const keys = ["f1", "ctrl+a", "-", "shift+a", "a", "2", "esc", "B", "alt+a", "b", "9"];
    expect(keys.slice().sort(compareKeys)).toEqual([
      "2",
      "9",
      "a",
      "shift+a",
      "ctrl+a",
      "alt+a",
      "b",
      "B",
      "-",
      "esc",
      "f1",
    ]);
  });

  test("compareKeys puts text that is not a key last", () => {
    expect(["ctrl+", "f12", "a"].sort(compareKeys)).toEqual(["a", "f12", "ctrl+"]);
  });

  test("property: compareKeys is a total order over chords", () => {
    const chord = fc
      .record({
        key: fc.oneof(fc.constantFrom(..."abz0129-+<>?[]"), fc.constantFrom(...NAMED_KEYS)),
        ctrl: fc.boolean(),
        alt: fc.boolean(),
        shift: fc.boolean(),
        meta: fc.boolean(),
      })
      .map(formatKey);
    fc.assert(
      fc.property(chord, chord, chord, (a, b, c) => {
        expect(compareKeys(a, a)).toBe(0);
        expect(Math.sign(compareKeys(a, b)) + Math.sign(compareKeys(b, a))).toBe(0);
        if (compareKeys(a, b) === 0) expect(a).toBe(b);
        if (compareKeys(a, b) <= 0 && compareKeys(b, c) <= 0) {
          expect(compareKeys(a, c)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });
});
