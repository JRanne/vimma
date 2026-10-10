import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  BADGES,
  PALETTE_KEYS,
  THEME_TOKENS,
  TOKYO_NIGHT,
  contrastRatio,
  isHexColor,
  normalizeHex,
  parseOmarchyColors,
  resolveTheme,
  tokensToCss,
} from "../src/theme.mjs";
import { mergeWithDefaults } from "../src/config.mjs";
import { MODES } from "../src/modes.mjs";

/** @param {string} name */
const fixture = (name) =>
  readFileSync(new URL(`../../../tests/contract/theme/${name}`, import.meta.url), "utf8");

const defaults = mergeWithDefaults({}).theme;
/** @param {Partial<typeof defaults>} over */
const themeCfg = (over = {}) => ({ ...defaults, ...over });

describe("hex colours", () => {
  test.each(["#fff", "#FFF", "#1a1b26", "#A9B1D6"])("%s is a hex colour", (c) => {
    expect(isHexColor(c)).toBe(true);
  });
  test.each(["#xyz", "#12345", "#1234567", "fff", "rgba(0,0,0,1)", "#1a1b26ff", "", 3])(
    "%j is not a hex colour",
    (c) => {
      expect(isHexColor(c)).toBe(false);
    },
  );
  test("normalises to lowercase #rrggbb", () => {
    expect(normalizeHex("#FFF")).toBe("#ffffff");
    expect(normalizeHex("#A9B1D6")).toBe("#a9b1d6");
  });
});

describe("contrastRatio (WCAG 2.x)", () => {
  test("black on white is 21:1 and symmetric", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 5);
  });
  test("equal colours are 1:1", () => {
    expect(contrastRatio("#7aa2f7", "#7aa2f7")).toBeCloseTo(1, 5);
  });
  test("#777 on white is just under 4.5:1", () => {
    const r = contrastRatio("#777777", "#ffffff");
    expect(r).toBeLessThan(4.5);
    expect(r).toBeGreaterThan(4.4);
  });
});

describe("parseOmarchyColors", () => {
  test("the Tokyo Night fixture parses to the built-in palette", () => {
    const r = parseOmarchyColors(fixture("tokyo-night.colors.toml"));
    expect(r.errors).toEqual([]);
    expect(r.palette).toEqual(TOKYO_NIGHT);
  });

  test("a light theme without orange and brown fills them, ignoring extra keys", () => {
    const r = parseOmarchyColors(fixture("light.colors.toml"));
    expect(r.errors).toEqual([]);
    expect(r.palette?.mode).toBe("light");
    expect(r.palette?.orange).toBe(r.palette?.yellow);
    expect(r.palette?.brown).toBe(r.palette?.dark_foreground);
    expect(r.palette).not.toHaveProperty("hyprland_active_border");
  });

  test("an invalid colour and a missing key are errors; the invalid one has its line", () => {
    const r = parseOmarchyColors(fixture("invalid.colors.toml"));
    expect(r.palette).toBeNull();
    expect(r.errors).toEqual([
      expect.objectContaining({ path: "accent", line: 4, message: expect.stringMatching(/hex/) }),
      expect.objectContaining({ path: "foreground", message: expect.stringMatching(/missing/) }),
    ]);
  });

  test("a syntax error is reported with its line", () => {
    const r = parseOmarchyColors('mode = "dark"\naccent = #7aa2f7\n');
    expect(r.palette).toBeNull();
    expect(r.errors[0]?.line).toBe(2);
  });

  test("a bad mode is an error; no mode is dark, or light with lightMode", () => {
    const base = fixture("tokyo-night.colors.toml").replace('mode = "dark"\n', "");
    expect(parseOmarchyColors(base).palette?.mode).toBe("dark");
    expect(parseOmarchyColors(base, { lightMode: true }).palette?.mode).toBe("light");
    expect(parseOmarchyColors(`mode = "dim"\n${base}`).errors[0]?.path).toBe("mode");
  });
});

describe("resolveTheme", () => {
  test("the default source without an Omarchy file is Tokyo Night, with a warning", () => {
    const r = resolveTheme({ theme: themeCfg() });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([expect.stringMatching(/Omarchy theme not found.*Tokyo Night/)]);
    expect(r.mode).toBe("dark");
    expect(r.tokens["--vimma-bg"]).toBe("#1a1b26");
    expect(r.tokens["--vimma-fg"]).toBe("#a9b1d6");
    expect(r.tokens["--vimma-accent"]).toBe("#7aa2f7");
    expect(r.tokens["--vimma-color-scheme"]).toBe("dark");
    expect(r.tokens["--vimma-font"]).toBe("monospace");
  });

  test("source = file is Tokyo Night without a warning, even when Omarchy text is given", () => {
    const light = fixture("light.colors.toml");
    const r = resolveTheme({ theme: themeCfg({ source: "file" }), omarchy: light });
    expect(r.warnings).toEqual([]);
    expect(r.tokens["--vimma-bg"]).toBe("#1a1b26");
  });

  test("Omarchy Tokyo Night has the expected tokens and passes every contrast check", () => {
    const r = resolveTheme({ theme: themeCfg(), omarchy: fixture("tokyo-night.colors.toml") });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.tokens).toMatchObject({
      "--vimma-bg": "#1a1b26",
      "--vimma-bg-dark": "#13141c",
      "--vimma-muted": "#414868",
      "--vimma-selection": "#292e42",
      "--vimma-statusbar-bg": "#13141c",
      "--vimma-statusbar-fg": "#a9b1d6",
      "--vimma-mode-normal": "#7aa2f7",
      "--vimma-mode-insert": "#9ece6a",
      "--vimma-mode-prefix": "#f7768e",
      "--vimma-hint-bg": "#e0af68",
      "--vimma-hint-fg": "#1a1b26",
      "--vimma-error": "#f7768e",
      "--vimma-bright-magenta": "#bb9af7",
    });
  });

  test("a light Omarchy theme is light and every badge stays readable", () => {
    const r = resolveTheme({ theme: themeCfg(), omarchy: fixture("light.colors.toml") });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.mode).toBe("light");
    expect(r.tokens["--vimma-color-scheme"]).toBe("light");
    expect(r.tokens["--vimma-bg"]).toBe("#eff1f5");
    for (const badge of BADGES) {
      const bg = /** @type {string} */ (r.tokens[`--vimma-mode-${badge}`]);
      const fg = /** @type {string} */ (r.tokens[`--vimma-mode-${badge}-fg`]);
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    }
    // neither palette text colour reaches 4.5:1 on this yellow, so the text falls back to black
    expect(r.tokens["--vimma-hint-fg"]).toBe("#000000");
  });

  test("an invalid Omarchy file gives errors and the Tokyo Night tokens", () => {
    const r = resolveTheme({ theme: themeCfg(), omarchy: fixture("invalid.colors.toml") });
    expect(r.errors.map((e) => e.path)).toEqual(["accent", "foreground"]);
    expect(r.tokens["--vimma-bg"]).toBe("#1a1b26");
  });

  test("[theme.colors] overlays the Omarchy palette", () => {
    const r = resolveTheme({
      theme: themeCfg({ colors: { accent: "#ff0000" } }),
      omarchy: fixture("light.colors.toml"),
    });
    expect(r.tokens["--vimma-accent"]).toBe("#ff0000");
    expect(r.tokens["--vimma-mode-normal"]).toBe("#ff0000");
    expect(r.tokens["--vimma-bg"]).toBe("#eff1f5");
  });

  test("[theme.colors] mode switches the colour scheme", () => {
    const r = resolveTheme({ theme: themeCfg({ source: "file", colors: { mode: "light" } }) });
    expect(r.mode).toBe("light");
  });

  test("omarchyLightMode makes a palette without mode light", () => {
    const text = fixture("light.colors.toml").replace('mode = "light"\n', "");
    const r = resolveTheme({ theme: themeCfg(), omarchy: text, omarchyLightMode: true });
    expect(r.mode).toBe("light");
  });

  test("low fg/bg contrast warns, naming both tokens and the ratio", () => {
    const r = resolveTheme({
      theme: themeCfg({ source: "file", colors: { foreground: "#777777", background: "#ffffff" } }),
    });
    expect(r.warnings).toContainEqual(
      expect.stringMatching(/--vimma-fg on --vimma-bg: 4\.4\d?:1 is below 4\.5:1/),
    );
  });

  test("a named font is quoted with a generic fallback; a generic family is not quoted", () => {
    const named = resolveTheme({ theme: themeCfg({ source: "file", font: "Caskaydia Mono" }) });
    expect(named.tokens["--vimma-font"]).toBe('"Caskaydia Mono", monospace');
    const generic = resolveTheme({ theme: themeCfg({ source: "file", font: "sans-serif" }) });
    expect(generic.tokens["--vimma-font"]).toBe("sans-serif");
  });
});

describe("untrusted input cannot inject CSS", () => {
  const evil = "red; } * { background: url(http://evil/) } :root {";

  test("resolveTheme drops a non-hex overlay colour with an error", () => {
    const r = resolveTheme({ theme: themeCfg({ source: "file", colors: { accent: evil } }) });
    expect(r.errors).toEqual([
      expect.objectContaining({
        path: "theme.colors.accent",
        message: expect.stringMatching(/hex/),
      }),
    ]);
    expect(r.tokens["--vimma-accent"]).toBe("#7aa2f7");
    expect(tokensToCss(r.tokens)).not.toContain("evil");
  });

  test("resolveTheme drops unknown overlay keys and a bad mode with errors", () => {
    const r = resolveTheme({
      theme: themeCfg({ source: "file", colors: { "--x": "#fff", mode: evil } }),
    });
    expect(r.errors.map((e) => e.path)).toEqual(["theme.colors.--x", "theme.colors.mode"]);
    expect(r.mode).toBe("dark");
    expect(r.tokens["--vimma-color-scheme"]).toBe("dark");
  });

  test("a font with a long run of blanks is trimmed in linear time (CodeQL js/polynomial-redos)", () => {
    const font = `x${" ".repeat(200_000)}y`;
    const start = performance.now();
    const r = resolveTheme({ theme: themeCfg({ source: "file", font }) });
    expect(performance.now() - start).toBeLessThan(1000);
    expect(r.tokens["--vimma-font"]).toBe(`"${font}", monospace`);
  });

  test("a hostile font stays inside one quoted CSS string", () => {
    const font = 'x"; } * { background: url(http://evil/) } :root { --a: "\\\n';
    const r = resolveTheme({ theme: themeCfg({ source: "file", font }) });
    expect(r.tokens["--vimma-font"]).toBe(
      '"x\\"; } * { background: url(http://evil/) } :root { --a: \\"\\\\\\a ", monospace',
    );
    expect(() => tokensToCss(r.tokens)).not.toThrow();
  });

  test.each([
    [{ "--vimma-bg": evil }],
    [{ "--vimma-bg": "#fff" }],
    [{ "--vimma-bg; } * {": "#ffffff" }],
    [{ "--vimma-color-scheme": "dark; }" }],
    [{ "--vimma-font": "x; } * { color: red" }],
    [{ "--vimma-font": '"a" } b' }],
  ])("tokensToCss rejects %j", (tokens) => {
    expect(() => tokensToCss(tokens)).toThrow(TypeError);
  });

  test.each([["dark"], ["light"]])("tokensToCss accepts color-scheme %s", (v) => {
    expect(tokensToCss({ "--vimma-color-scheme": v })).toContain(`: ${v};`);
  });

  test("tokensToCss rejects a selector that could close the rule", () => {
    expect(() => tokensToCss({}, ":root } * {")).toThrow(TypeError);
  });
});

describe("tokens", () => {
  test("every mode, and the pending prefix, has a status-bar badge", () => {
    expect([...BADGES].sort()).toEqual([...MODES, "prefix"].sort());
  });

  test("every palette key has a token, and every token has a value", () => {
    const r = resolveTheme({ theme: themeCfg({ source: "file" }) });
    const names = THEME_TOKENS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(r.tokens).sort()).toEqual([...names].sort());
    for (const key of PALETTE_KEYS) {
      if (key === "mode") continue;
      expect(THEME_TOKENS.some((t) => t.from === key)).toBe(true);
    }
  });

  test("tokensToCss emits one declaration per token inside the selector", () => {
    const r = resolveTheme({ theme: themeCfg({ source: "file" }) });
    const css = tokensToCss(r.tokens);
    expect(css.startsWith(":root {\n")).toBe(true);
    expect(css).toContain("  --vimma-bg: #1a1b26;\n");
    expect(css.match(/--vimma-[a-z-]+:/g)).toHaveLength(THEME_TOKENS.length);
    expect(tokensToCss({ "--vimma-bg": "#000000" }, "#vimma-root")).toBe(
      "#vimma-root {\n  --vimma-bg: #000000;\n}\n",
    );
  });
});
