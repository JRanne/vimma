import { describe, test, expect } from "vitest";
import {
  isEditable,
  matchSiteRule,
  TEXT_INPUT_EXCLUDED_TYPES,
  EDITABLE_ROLES,
  KNOWN_EDITORS,
  INSERT_SITE_MODES,
} from "../src/editable.mjs";

const input = (type, extra = {}) => ({ tagName: "INPUT", type, ...extra });
const div = (extra = {}) => ({ tagName: "DIV", ...extra });

describe("isEditable: inputs", () => {
  test.each([
    [undefined, "input:text"],
    ["", "input:text"],
    ["text", "input:text"],
    ["SEARCH", "input:search"],
    ["email", "input:email"],
    ["password", "input:password"],
    ["number", "input:number"],
    ["date", "input:date"],
    ["datetime-local", "input:datetime-local"],
    ["tel", "input:tel"],
    ["url", "input:url"],
    ["foo", "input:foo"],
  ])("Given <input type=%s>, then editable with %s", (type, reason) => {
    expect(isEditable(input(type))).toEqual({ editable: true, reason });
  });

  test.each([
    "checkbox",
    "radio",
    "submit",
    "button",
    "file",
    "range",
    "color",
    "hidden",
    "image",
    "reset",
  ])("Given <input type=%s>, then not editable", (type) => {
    expect(isEditable(input(type))).toEqual({ editable: false, reason: `input:${type}` });
  });

  test("lowercase XHTML tag names are recognised", () => {
    expect(isEditable({ tagName: "input", type: "text" }).editable).toBe(true);
  });

  test("the excluded type list is the documented one", () => {
    expect([...TEXT_INPUT_EXCLUDED_TYPES].sort()).toEqual(
      [
        "button",
        "checkbox",
        "color",
        "file",
        "hidden",
        "image",
        "radio",
        "range",
        "reset",
        "submit",
      ].sort(),
    );
  });
});

describe("isEditable: disabled and read-only", () => {
  test.each([
    [{ disabled: true }, "disabled"],
    [{ readOnly: true }, "readonly"],
    [{ ariaDisabled: true }, "aria-disabled"],
    [{ disabled: true, readOnly: true }, "disabled"],
  ])("Given a text input with %o, then not editable (%s)", (extra, reason) => {
    expect(isEditable(input("text", extra))).toEqual({ editable: false, reason });
  });

  test("Given a readOnly textarea, then readonly", () => {
    expect(isEditable({ tagName: "TEXTAREA", readOnly: true })).toEqual({
      editable: false,
      reason: "readonly",
    });
  });

  test("Given an aria-disabled contenteditable, then not editable", () => {
    expect(isEditable(div({ isContentEditable: true, ariaDisabled: true })).editable).toBe(false);
  });

  test("Given a disabled checkbox, then disabled wins over the type", () => {
    expect(isEditable(input("checkbox", { disabled: true })).reason).toBe("disabled");
  });
});

describe("isEditable: other elements", () => {
  test.each([
    ["TEXTAREA", "textarea"],
    ["textarea", "textarea"],
    ["SELECT", "select"],
    ["EMBED", "embed"],
    ["object", "embed"],
  ])("Given <%s>, then editable (%s)", (tagName, reason) => {
    expect(isEditable({ tagName })).toEqual({ editable: true, reason });
  });

  test.each([
    [{ isContentEditable: true }, true],
    [{ isContentEditable: false, contentEditable: "true" }, false],
    [{ contentEditable: "true" }, true],
    [{ contentEditable: "" }, true],
    [{ contentEditable: "plaintext-only" }, true],
    [{ contentEditable: "PLAINTEXT-ONLY" }, true],
    [{ contentEditable: "false" }, false],
    [{ contentEditable: "inherit" }, false],
  ])("Given a div with %o, then editable is %s", (extra, editable) => {
    const r = isEditable(div(extra));
    expect(r).toEqual({ editable, reason: editable ? "contenteditable" : "none" });
  });

  test.each([
    ["textbox", "role:textbox"],
    ["searchbox", "role:searchbox"],
    ["combobox", "role:combobox"],
    ["spinbutton", "role:spinbutton"],
    ["application", "role:application"],
    ["TextBox", "role:textbox"],
    ["textbox foo", "role:textbox"],
    ["  searchbox ", "role:searchbox"],
  ])("Given a div with role %j, then editable (%s)", (role, reason) => {
    expect(isEditable(div({ role }))).toEqual({ editable: true, reason });
  });

  test.each(["button", "listbox", "option", "", null])("Given role %j, then none", (role) => {
    expect(isEditable(div({ role }))).toEqual({ editable: false, reason: "none" });
  });

  test("Given role textbox with aria-readonly, then aria-readonly", () => {
    expect(isEditable(div({ role: "textbox", ariaReadOnly: true }))).toEqual({
      editable: false,
      reason: "aria-readonly",
    });
  });

  test("the editable roles are the documented ones", () => {
    expect([...EDITABLE_ROLES]).toEqual([
      "textbox",
      "searchbox",
      "combobox",
      "spinbutton",
      "application",
    ]);
  });

  test("Given a plain div, a link, an svg, then none", () => {
    for (const tagName of ["DIV", "A", "svg", "BODY"]) {
      expect(isEditable({ tagName })).toEqual({ editable: false, reason: "none" });
    }
  });
});

describe("isEditable: known editors", () => {
  test.each([
    ["monaco-editor", "editor:monaco"],
    ["cm-editor", "editor:codemirror6"],
    ["CodeMirror", "editor:codemirror5"],
    ["ace_editor", "editor:ace"],
    ["ProseMirror", "editor:prosemirror"],
    ["ql-editor", "editor:quill"],
  ])("Given a div inside .%s, then %s", (cls, reason) => {
    expect(isEditable(div({ ancestorClasses: ["view-line", cls, "app"] }))).toEqual({
      editable: true,
      reason,
    });
  });

  test("Given a class that only contains a marker, then none", () => {
    expect(isEditable(div({ ancestorClasses: ["monaco-editorx", "xcm-editor"] })).reason).toBe(
      "none",
    );
  });

  test("Given a read-only textarea inside an editor, then readonly wins", () => {
    expect(
      isEditable({ tagName: "TEXTAREA", readOnly: true, ancestorClasses: ["monaco-editor"] }),
    ).toEqual({ editable: false, reason: "readonly" });
  });

  test("every known editor has a name and a class", () => {
    for (const e of KNOWN_EDITORS) {
      expect(e.name).toMatch(/^[a-z0-9]+$/);
      expect(e.className).toMatch(/^[A-Za-z_-]+$/);
    }
  });
});

describe("isEditable: designMode and site overrides", () => {
  test("Given designMode on a body, then design-mode", () => {
    expect(isEditable({ tagName: "BODY", designMode: true })).toEqual({
      editable: true,
      reason: "design-mode",
    });
  });

  test("Given designMode and a disabled input, then designMode wins", () => {
    expect(isEditable(input("text", { disabled: true, designMode: true })).reason).toBe(
      "design-mode",
    );
  });

  test("Given site never and designMode, then site:never", () => {
    expect(isEditable({ tagName: "BODY", designMode: true }, { site: "never" })).toEqual({
      editable: false,
      reason: "site:never",
    });
  });

  test("Given site never and a text input, then not editable", () => {
    expect(isEditable(input("text"), { site: "never" }).editable).toBe(false);
  });

  test("Given site always and a div, then site:always", () => {
    expect(isEditable(div(), { site: "always" })).toEqual({
      editable: true,
      reason: "site:always",
    });
  });

  test("Given site auto, then the heuristic decides", () => {
    expect(isEditable(div(), { site: "auto" })).toEqual(isEditable(div()));
    expect(isEditable(input("text"), { site: "auto" })).toEqual(isEditable(input("text")));
  });

  test("an unknown site mode throws", () => {
    expect(() => isEditable(div(), { site: /** @type {any} */ ("sometimes") })).toThrow(TypeError);
  });

  test("the site modes are auto, never, always", () => {
    expect([...INSERT_SITE_MODES]).toEqual(["auto", "never", "always"]);
  });
});

describe("matchSiteRule", () => {
  const rules = [
    { match: "example.com", insert: "never" },
    { match: "docs.example.com", insert: "always" },
    { match: "Other.org", insert: "always" },
    { match: "other.org", insert: "never" },
  ];

  test.each([
    ["example.com", 0],
    ["www.example.com", 0],
    ["docs.example.com", 1],
    ["a.docs.example.com", 1],
    ["EXAMPLE.COM", 0],
    ["example.com.", 0],
    ["other.org", 2],
    ["sub.other.org", 2],
  ])("Given host %s, then rule %i", (host, index) => {
    expect(matchSiteRule(host, rules)).toBe(rules[index]);
  });

  test.each(["badexample.com", "example.co", "com", "", "example.com.evil"])(
    "Given host %j, then no rule",
    (host) => {
      expect(matchSiteRule(host, rules)).toBeUndefined();
    },
  );

  test("Given no rules, then undefined", () => {
    expect(matchSiteRule("example.com", [])).toBeUndefined();
  });

  test("a rule with a trailing dot or uppercase still matches", () => {
    const r = { match: "Example.COM.", insert: "never" };
    expect(matchSiteRule("www.example.com", [r])).toBe(r);
  });
});
