// Config schema 2 (spec m3-m4-core-prep): [panes] max, [modal] hint_chars, [sites."<host>"].
import { describe, test, expect } from "vitest";
import fc from "fast-check";
import { CONFIG_SCHEMA_VERSION, MIGRATIONS, migrate, parseConfig } from "../src/config.mjs";
import { DEFAULT_CONFIG, formatDefaultsToml } from "../src/defaults.mjs";
import { DEFAULT_HINT_CHARS } from "../src/hints.mjs";
import { PANES_MAX_DEFAULT, PANES_MAX_LIMIT } from "../src/panes.mjs";

/** @param {string[]} lines */
const toml = (...lines) => lines.join("\n") + "\n";
/** @param {string[]} lines */
const v2 = (...lines) => toml("schema = 2", ...lines);

/** @param {string} text */
function ok(text) {
  const r = parseConfig(text);
  expect(r.errors).toEqual([]);
  return /** @type {import("../src/config.mjs").ResolvedConfig} */ (r.config);
}

/** @param {string} text */
function errors(text) {
  const r = parseConfig(text);
  expect(r.config).toBeNull();
  return r.errors.map((e) => ({
    line: e.line,
    path: e.path,
    message: e.message,
    ...(e.suggestion ? { suggestion: e.suggestion } : {}),
  }));
}

describe("schema 2", () => {
  test("is the current schema; 1 → 2 is the identity plus schema = 2", () => {
    expect(CONFIG_SCHEMA_VERSION).toBe(2);
    const raw = { schema: 1, keys: { new_tab: ["prefix+c"] } };
    expect(migrate(raw, 1)).toEqual({
      config: { schema: 2, keys: { new_tab: ["prefix+c"] } },
      applied: ["1→2"],
    });
    expect(raw.schema).toBe(1);
    expect(MIGRATIONS[1]).toBeTypeOf("function");
  });

  test("a v1 file still loads, migrated, with the new sections at their defaults", () => {
    const r = parseConfig(toml("schema = 1", "[modal]", "timeout_ms = 500"));
    expect(r.errors).toEqual([]);
    expect(r.migratedFrom).toBe(1);
    expect(r.config).toMatchObject({
      schema: 2,
      panes: { max: PANES_MAX_DEFAULT },
      hintChars: DEFAULT_HINT_CHARS,
      sites: [],
    });
  });

  test("defaults: panes.max 4, hint_chars the home row, no sites; defaults.toml is schema 2", () => {
    expect(PANES_MAX_DEFAULT).toBe(4);
    expect(DEFAULT_CONFIG.panes).toEqual({ max: 4 });
    const text = formatDefaultsToml();
    expect(text).toMatch(/^schema = 2$/m);
    expect(text).toMatch(/^\[panes\]\nmax = 4$/m);
    expect(text).toMatch(/^hint_chars = "asdfghjkl"$/m);
    expect(text).toMatch(/^# \[sites\."docs\.google\.com"\]$/m);
    expect(parseConfig(text).migratedFrom).toBeNull();
  });

  test("a schema 3 file is from a newer vimma", () => {
    expect(errors(toml("schema = 3"))).toEqual([
      { line: 1, path: "schema", message: expect.stringMatching(/newer vimma.*up to 2/) },
    ]);
  });
});

describe("[panes] max", () => {
  test.each([[1], [4], [7], [PANES_MAX_LIMIT]])("max = %i is accepted", (max) => {
    expect(ok(v2("[panes]", `max = ${max}`)).panes).toEqual({ max });
  });

  test.each([
    ["0", "must be an integer between 1 and 16"],
    ["17", "must be an integer between 1 and 16"],
    ["-4", "must be an integer between 1 and 16"],
    ["4.0", "expected an integer, got a float"],
    ['"4"', "expected an integer, got a string"],
  ])("max = %s is an error at its line", (v, message) => {
    expect(errors(v2("", "[panes]", `max = ${v}`))).toEqual([
      { line: 4, path: "panes.max", message },
    ]);
  });

  test("an unknown key suggests max; panes must be a table", () => {
    expect(errors(v2("[panes]", "maks = 4"))).toEqual([
      { line: 3, path: "panes.maks", message: 'unknown key "maks"', suggestion: "max" },
    ]);
    expect(errors(v2("panes = 4"))).toEqual([
      { line: 2, path: "panes", message: "expected a table, got an integer" },
    ]);
  });

  test("property: any integer max is accepted iff it is within 1..16", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), (max) => {
        const r = parseConfig(v2("[panes]", `max = ${max}`));
        expect(r.config !== null).toBe(max >= 1 && max <= PANES_MAX_LIMIT);
        if (r.config) expect(r.config.panes.max).toBe(max);
      }),
    );
  });
});

describe("[modal] hint_chars", () => {
  test("a valid charset is resolved; the keymap ignores the key", () => {
    const r = parseConfig(
      v2("[modal]", 'hint_chars = "jfkdls"', "[modal.normal]", '"j" = "scroll.down"'),
    );
    expect(r.errors).toEqual([]);
    expect(r.config?.hintChars).toBe("jfkdls");
    expect(r.keymap).not.toBeNull();
  });

  test.each([['"aa"'], ['"a"'], ['"ABC"'], ['"a b"'], ['""']])(
    "hint_chars = %s is an error",
    (v) => {
      expect(errors(v2("[modal]", `hint_chars = ${v}`))).toEqual([
        {
          line: 3,
          path: "modal.hint_chars",
          message: "must be at least 2 distinct characters, none uppercase or whitespace",
        },
      ]);
    },
  );

  test("a non-string hint_chars is a type error", () => {
    expect(errors(v2("[modal]", "hint_chars = 5"))[0]).toMatchObject({
      path: "modal.hint_chars",
      message: "expected a string, got an integer",
    });
  });

  test("an unknown [modal] key now also suggests hint_chars", () => {
    expect(errors(v2("[modal]", 'hint_char = "asdf"'))[0]).toMatchObject({
      path: "modal.hint_char",
      suggestion: "hint_chars",
    });
  });
});

describe('[sites."<host>"]', () => {
  test("rules are resolved in file order, insert defaulting to auto", () => {
    const config = ok(
      v2(
        '[sites."docs.google.com"]',
        'insert = "always"',
        '[sites."Example.COM."]',
        '[sites."10.0.0.1"]',
        'insert = "never"',
        '[sites."[::1]"]',
        'insert = "auto"',
        "[sites.localhost]",
        'insert = "never"',
      ),
    );
    expect(config.sites).toEqual([
      { match: "docs.google.com", insert: "always" },
      { match: "Example.COM.", insert: "auto" },
      { match: "10.0.0.1", insert: "never" },
      { match: "[::1]", insert: "auto" },
      { match: "localhost", insert: "never" },
    ]);
  });

  test.each([
    ["https://docs.google.com/document", "docs.google.com"],
    ["*.example.com", "example.com"],
    ["example.com:8080", "example.com"],
    ["exa mple.com", undefined],
    ["", undefined],
    ["-bad-.com", undefined],
  ])("site %j is not a hostname", (host, suggestion) => {
    expect(errors(v2(`[sites.${JSON.stringify(host)}]`, 'insert = "never"'))).toEqual([
      {
        line: 2,
        path: `sites.${JSON.stringify(host)}`,
        message: 'must be a hostname like "docs.google.com", without scheme, port, path or *',
        ...(suggestion ? { suggestion } : {}),
      },
    ]);
  });

  test("insert must be auto, never or always; unknown keys suggest insert", () => {
    expect(errors(v2('[sites."a.com"]', 'insert = "allways"', "insrt = 1"))).toEqual([
      {
        line: 3,
        path: 'sites."a.com".insert',
        message: 'must be "auto", "never" or "always"',
        suggestion: "always",
      },
      {
        line: 4,
        path: 'sites."a.com".insrt',
        message: 'unknown key "insrt"',
        suggestion: "insert",
      },
    ]);
    expect(errors(v2('[sites."a.com"]', "insert = true"))[0]?.message).toBe(
      "expected a string, got a boolean",
    );
  });

  test("the same host twice (case and a trailing dot ignored) is an error on the second", () => {
    expect(errors(v2('[sites."a.com"]', '[sites."A.com."]'))).toEqual([
      { line: 3, path: 'sites."A.com."', message: 'same host as "a.com"' },
    ]);
  });

  test("a site must be a table", () => {
    expect(errors(v2("[sites]", '"a.com" = "always"'))).toEqual([
      { line: 3, path: 'sites."a.com"', message: "expected a table, got a string" },
    ]);
  });
});

describe("schema 2 keys need schema = 2", () => {
  test.each([
    [["schema = 1", "[panes]", "max = 2"], 2, "panes"],
    [["[panes]", "max = 2"], 1, "panes"],
    [["schema = 1", '[sites."a.com"]'], 2, "sites"],
    [["schema = 1", "[modal]", 'hint_chars = "asdf"'], 3, "modal.hint_chars"],
  ])("%j is an error naming the key", (lines, line, path) => {
    expect(errors(toml(...lines))).toEqual([
      {
        line,
        path,
        message: "is new in schema 2: put schema = 2 at the top of the file",
      },
    ]);
  });
});
