// Firefox's own shortcuts (docs/specs/key-handling-batch.md § 1): which <key> elements of
// #mainKeyset Vimma turns off.
import { describe, test, expect } from "vitest";
import { ALL_KEEP, OVERLAP_CHORDS, planFirefoxKeys, xulKeyChord } from "../src/firefox-keys.mjs";

describe("xulKeyChord", () => {
  test.each([
    [{ key: "W", modifiers: "accel" }, "ctrl+w"],
    [{ key: "w", modifiers: "accel" }, "ctrl+w"],
    [{ key: "T", modifiers: "accel,shift" }, "ctrl+shift+t"],
    [{ key: "1", modifiers: "alt" }, "alt+1"],
    [{ key: "M", modifiers: "control" }, "ctrl+m"],
    [{ key: "Z", modifiers: "control,alt" }, "ctrl+alt+z"],
    [{ key: "+", modifiers: "accel" }, "ctrl+plus"],
    [{ key: "-", modifiers: "accel" }, "ctrl+minus"],
    [{ key: "[", modifiers: "accel" }, "ctrl+["],
    [{ keycode: "VK_F5" }, "f5"],
    [{ keycode: "VK_F5", modifiers: "accel" }, "ctrl+f5"],
    [{ keycode: "VK_LEFT", modifiers: "alt" }, "alt+left"],
    [{ keycode: "VK_TAB", modifiers: "control,shift" }, "ctrl+shift+tab"],
    [{ keycode: "VK_ESCAPE", modifiers: "shift" }, "shift+esc"],
    [{ keycode: "VK_DELETE", modifiers: "accel,shift" }, "ctrl+shift+delete"],
    [{ keycode: "VK_BACK" }, "backspace"],
    [{ key: "W", modifiers: "accel" }, "meta+w", { mac: true }],
    [{ key: "M", modifiers: "control" }, "ctrl+m", { mac: true }],
    [{ key: "Q", modifiers: "meta" }, "meta+q"],
    [{ key: "R", modifiers: "os, accel" }, "ctrl+meta+r"],
  ])("<key %j> is %s", (el, chord, opts = {}) => {
    expect(xulKeyChord(el, opts)).toBe(chord);
  });

  test.each([
    [{ key: "", modifiers: "accel" }],
    [{}],
    [{ keycode: "VK_NOT_A_KEY" }],
    [{ key: "ab", modifiers: "accel" }],
  ])("<key %j> has no chord (not localized yet, or not one we can name)", (el) => {
    expect(xulKeyChord(el)).toBeNull();
  });
});

/** The Linux #mainKeyset keys the tests need, as the host reads them. */
const KEYS = [
  { id: "key_newNavigatorTab", chord: "ctrl+t" },
  { id: "focusURLBar", chord: "ctrl+l" },
  { id: "key_search", chord: "ctrl+k" },
  { id: "key_search2", chord: "ctrl+j" },
  { id: "openFileKb", chord: "ctrl+o" },
  { id: "key_close", chord: "ctrl+w" },
  { id: "key_viewSource", chord: "ctrl+u" },
  { id: "key_viewInfo", chord: "ctrl+i" },
  { id: "addBookmarkAsKb", chord: "ctrl+d" },
  { id: "viewBookmarksSidebarKb", chord: "ctrl+b" },
  { id: "key_gotoHistory", chord: "ctrl+h" },
  { id: "key_quitApplication", chord: "ctrl+q" },
  { id: "key_copy", chord: "ctrl+c", internal: true },
  { id: "key_reload2", chord: "f5" },
  { id: "key_stop", chord: "esc" },
  { id: "key_selectTab1", chord: "alt+1" },
  { id: "key_restoreLastClosedTabOrWindowOrSession", chord: "ctrl+shift+t" },
  { id: "", chord: "ctrl+minus" },
];
/** @param {{ off: readonly { id: string }[] }} plan */
const ids = (plan) => plan.off.map((k) => k.id);

describe("planFirefoxKeys", () => {
  test("the default list is exactly the chords Vimma or Vim use", () => {
    expect([...OVERLAP_CHORDS]).toEqual([
      "ctrl+b",
      "ctrl+d",
      "ctrl+e",
      "ctrl+h",
      "ctrl+i",
      "ctrl+k",
      "ctrl+o",
      "ctrl+u",
      "ctrl+w",
      "ctrl+y",
    ]);
  });

  test("the default turns off the overlapping keys and says which chords match nothing", () => {
    const plan = planFirefoxKeys(KEYS, { disable: OVERLAP_CHORDS, enable: [] });
    expect(ids(plan)).toEqual([
      "key_search",
      "openFileKb",
      "key_close",
      "key_viewSource",
      "key_viewInfo",
      "addBookmarkAsKb",
      "viewBookmarksSidebarKb",
      "key_gotoHistory",
    ]);
    expect(plan.unmatched).toEqual(["ctrl+e", "ctrl+y"]);
  });

  test("enable keeps a listed chord Firefox's", () => {
    const plan = planFirefoxKeys(KEYS, { disable: OVERLAP_CHORDS, enable: ["ctrl+w", "ctrl+k"] });
    expect(ids(plan)).not.toContain("key_close");
    expect(ids(plan)).not.toContain("key_search");
    expect(ids(plan)).toContain("key_viewSource");
  });

  test('"all" turns off every chord with ctrl, alt or meta but ctrl+q and the text keys', () => {
    const plan = planFirefoxKeys(KEYS, { disable: "all", enable: [] });
    expect(ids(plan)).toEqual(
      KEYS.filter((k) => !["ctrl+q", "ctrl+c", "f5", "esc"].includes(k.chord) && !k.internal).map(
        (k) => k.id,
      ),
    );
    expect(plan.unmatched).toEqual([]);
    expect(ALL_KEEP).toEqual(["ctrl+q"]);
  });

  test('"all" keeps cmd+q on macOS', () => {
    const keys = [
      { id: "key_quitApplication", chord: "meta+q" },
      { id: "key_close", chord: "meta+w" },
    ];
    expect(ids(planFirefoxKeys(keys, { disable: "all", enable: [] }, { mac: true }))).toEqual([
      "key_close",
    ]);
  });

  test('"all" with enable keeps those', () => {
    const plan = planFirefoxKeys(KEYS, { disable: "all", enable: ["ctrl+t", "alt+1"] });
    expect(ids(plan)).not.toContain("key_newNavigatorTab");
    expect(ids(plan)).not.toContain("key_selectTab1");
    expect(ids(plan)).toContain("key_close");
  });

  test("a list turns off only its chords, every key with that chord", () => {
    const keys = [...KEYS, { id: "goBackKb2", chord: "ctrl+[" }, { id: "x", chord: "ctrl+[" }];
    const plan = planFirefoxKeys(keys, { disable: ["ctrl+[", "f5"], enable: [] });
    expect(ids(plan)).toEqual(["key_reload2", "goBackKb2", "x"]);
  });

  test("an internal key is never turned off, even when listed", () => {
    const plan = planFirefoxKeys(KEYS, { disable: ["ctrl+c"], enable: [] });
    expect(ids(plan)).toEqual([]);
    expect(plan.unmatched).toEqual(["ctrl+c"]);
  });

  test("a key without a chord yet is left alone", () => {
    const plan = planFirefoxKeys([{ id: "late", chord: null }], { disable: "all", enable: [] });
    expect(ids(plan)).toEqual([]);
  });
});
