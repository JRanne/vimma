import { describe, test, expect } from "vitest";
import {
  parseKey,
  formatKey,
  parseBinding,
  formatBinding,
  displayBinding,
  chordFromEvent,
  KeyNotationError,
} from "../src/keys.mjs";

const chord = (key, mods = {}) => ({
  key,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  ...mods,
});

describe("parseKey", () => {
  test.each([
    ["ctrl+b", chord("b", { ctrl: true })],
    ["c", chord("c")],
    ["shift+t", chord("t", { shift: true })],
    ["T", chord("t", { shift: true })],
    ["?", chord("?")],
    ["shift+?", chord("?")],
    ["ctrl+alt+]", chord("]", { ctrl: true, alt: true })],
    ["minus", chord("-")],
    ["plus", chord("+")],
    ["-", chord("-")],
    ["esc", chord("esc")],
    ["Escape", chord("esc")],
    ["Enter", chord("enter")],
    ["space", chord("space")],
    ["shift+tab", chord("tab", { shift: true })],
    ["F5", chord("f5")],
    ["meta+k", chord("k", { meta: true })],
    ["Ctrl+Shift+X", chord("x", { ctrl: true, shift: true })],
    ["cmd+k", chord("k", { meta: true })],
    ["control+option+k", chord("k", { ctrl: true, alt: true })],
  ])("a chord written %s parses to its canonical chord", (text, expected) => {
    expect(parseKey(text)).toEqual(expected);
  });

  test.each(["", "ctrl+", "ctrl+foo", "hyper+k", "ctrl+ctrl+k", "ab"])(
    "invalid chord %j throws KeyNotationError",
    (text) => {
      expect(() => parseKey(text)).toThrow(KeyNotationError);
    },
  );
});

describe("formatKey", () => {
  test.each([
    [chord("b", { ctrl: true }), "ctrl+b"],
    [chord("t", { shift: true }), "shift+t"],
    [chord("k", { ctrl: true, alt: true, shift: true, meta: true }), "ctrl+alt+shift+meta+k"],
    [chord("-"), "minus"],
    [chord("+", { ctrl: true }), "ctrl+plus"],
    [chord("space"), "space"],
  ])("formats %j as %s", (c, text) => {
    expect(formatKey(c)).toBe(text);
  });
});

describe("parseBinding", () => {
  test("Herdr prefix notation becomes the symbolic prefix plus a chord", () => {
    expect(parseBinding("prefix+shift+t")).toEqual([
      { special: "prefix" },
      chord("t", { shift: true }),
    ]);
    expect(parseBinding("prefix+minus")).toEqual([{ special: "prefix" }, chord("-")]);
    expect(parseBinding("prefix+?")).toEqual([{ special: "prefix" }, chord("?")]);
  });

  test("space-separated chords form a sequence", () => {
    expect(parseBinding("ctrl+w h")).toEqual([chord("w", { ctrl: true }), chord("h")]);
  });

  test("Vim notation: bare characters are one chord each", () => {
    expect(parseBinding("gt")).toEqual([chord("g"), chord("t")]);
    expect(parseBinding("gT")).toEqual([chord("g"), chord("t", { shift: true })]);
    expect(parseBinding("G")).toEqual([chord("g", { shift: true })]);
  });

  test("Vim angle-bracket notation", () => {
    expect(parseBinding("<leader>ff")).toEqual([{ special: "leader" }, chord("f"), chord("f")]);
    expect(parseBinding("<C-w>h")).toEqual([chord("w", { ctrl: true }), chord("h")]);
    expect(parseBinding("<Esc>")).toEqual([chord("esc")]);
    expect(parseBinding("<S-Tab>")).toEqual([chord("tab", { shift: true })]);
    expect(parseBinding("<C-A-x>")).toEqual([chord("x", { ctrl: true, alt: true })]);
    expect(parseBinding("<M-x>")).toEqual([chord("x", { alt: true })]);
    expect(parseBinding("<D-x>")).toEqual([chord("x", { meta: true })]);
    expect(parseBinding("<Space>")).toEqual([chord("space")]);
    expect(parseBinding("<lt>")).toEqual([chord("<")]);
    expect(parseBinding("<")).toEqual([chord("<")]);
    expect(parseBinding("<C-w><")).toEqual([chord("w", { ctrl: true }), chord("<")]);
  });

  test.each(["", "<leader", "<Foo>", "prefix", "<C-ctrl>", "prefix+prefix+c"])(
    "invalid binding %j throws",
    (text) => {
      expect(() => parseBinding(text)).toThrow(KeyNotationError);
    },
  );
});

describe("formatBinding", () => {
  test.each([
    ["prefix+shift+t", "prefix+shift+t"],
    ["prefix+-", "prefix+minus"],
    ["gt", "g t"],
    ["<leader>ff", "<leader> f f"],
    ["<C-w>h", "ctrl+w h"],
  ])("%s formats canonically as %s", (input, out) => {
    expect(formatBinding(parseBinding(input))).toBe(out);
  });
});

describe("displayBinding", () => {
  const defaults = { prefix: parseKey("ctrl+b"), leader: parseKey("space") };
  test.each([
    ["prefix+b", "ctrl+b b"],
    ["<leader>n", "space n"],
    ["prefix+shift+x", "ctrl+b shift+x"],
    ["prefix+?", "ctrl+b ?"],
    ["prefix+minus", "ctrl+b -"],
    ["prefix+-", "ctrl+b -"],
    ["prefix+1", "ctrl+b 1"],
    ["<C-w>h", "ctrl+w h"],
    ["<C-w><", "ctrl+w <"],
    ["<C-w>-", "ctrl+w -"],
    ["<Esc>", "esc"],
    ["<CR>", "enter"],
    ["<lt>", "<"],
    ["gg", "gg"],
    ["gT", "gT"],
    ["G", "G"],
    ["$", "$"],
    ["ctrl+i", "ctrl+i"],
    ["Ctrl+Alt+c", "ctrl+alt+c"],
    ["<leader>ff", "space ff"],
    ["prefix+g prefix+x", "ctrl+b g ctrl+b x"],
    ["g <leader>x", "g space x"],
  ])("%s shows as %s with the default prefix and leader", (input, out) => {
    expect(displayBinding(input, defaults)).toBe(out);
  });

  test.each([
    ["prefix+b", "ctrl+a b"],
    ["prefix+shift+x", "ctrl+a shift+x"],
    ["<leader>n", ", n"],
    ["<Leader>n", ", n"],
  ])("%s follows a remapped prefix and leader as %s", (input, out) => {
    expect(displayBinding(input, { prefix: parseKey("ctrl+a"), leader: parseKey(",") })).toBe(out);
  });

  test("a minus prefix or leader shows as the character", () => {
    expect(displayBinding("<leader>n", { ...defaults, leader: parseKey("minus") })).toBe("- n");
  });
});

describe("chordFromEvent", () => {
  const ev = (key, mods = {}) => ({
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  });

  test.each([
    [ev("b", { ctrlKey: true }), "ctrl+b"],
    [ev("T", { shiftKey: true }), "shift+t"],
    [ev("?", { shiftKey: true }), "?"],
    [ev(" "), "space"],
    [ev("Escape"), "esc"],
    [ev("ArrowDown"), "down"],
    [ev("PageUp"), "pageup"],
    [ev("Tab", { shiftKey: true }), "shift+tab"],
    [ev("-"), "minus"],
  ])("a keydown %j is the chord %s", (e, text) => {
    expect(formatKey(/** @type {any} */ (chordFromEvent(e)))).toBe(text);
  });

  test.each(["Shift", "Control", "Alt", "Meta", "Dead", "Unidentified", "Process"])(
    "modifier-only or unusable key %s yields null",
    (key) => {
      expect(chordFromEvent(ev(key))).toBeNull();
    },
  );
});
