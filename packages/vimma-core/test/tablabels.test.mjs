import { describe, test, expect } from "vitest";
import fc from "fast-check";
import {
  MAX_TAB_LABEL,
  TabLabelError,
  clearTabLabel,
  displayLabel,
  normalizeTabLabel,
  pruneTabLabels,
  readTabLabels,
  setTabLabel,
  tabLabel,
  writeTabLabels,
} from "../src/tablabels.mjs";

describe("tab labels", () => {
  test("setTabLabel normalises whitespace and control characters", () => {
    const l = setTabLabel({}, "t1", "  my\n\t mail\u0007 ");
    expect(l).toEqual({ t1: "my mail" });
    expect(Object.isFrozen(l)).toBe(true);
    expect(tabLabel(l, "t1")).toBe("my mail");
    expect(tabLabel(l, "t2")).toBeUndefined();
  });

  test("an empty label clears the rename; the same label is a no-op", () => {
    const l = setTabLabel({}, "t1", "mail");
    expect(setTabLabel(l, "t1", "   ")).toEqual({});
    expect(setTabLabel(l, "t1", " mail ")).toBe(l);
    expect(setTabLabel(l, "t2", "")).toBe(l);
    expect(clearTabLabel(l, "t1")).toEqual({});
    expect(clearTabLabel(l, "t9")).toBe(l);
  });

  test("labels are cut to MAX_TAB_LABEL code points", () => {
    expect(MAX_TAB_LABEL).toBe(100);
    expect([...normalizeTabLabel("é".repeat(150))].length).toBe(100);
    expect([...normalizeTabLabel("😀".repeat(150))].length).toBe(100);
  });

  test("pruneTabLabels keeps live tabs only", () => {
    const l = { t1: "a", t2: "b" };
    expect(pruneTabLabels(l, ["t1"])).toEqual({ t1: "a" });
    expect(pruneTabLabels(l, new Set(["t1", "t2", "t3"]))).toBe(l);
  });

  test("display label precedence: rename > title > URL > New Tab", () => {
    expect(displayLabel({ label: "mail", title: "Inbox", url: "https://x.org" })).toBe("mail");
    expect(displayLabel({ title: "Inbox", url: "https://x.org" })).toBe("Inbox");
    expect(displayLabel({ label: null, title: "  ", url: "https://x.org" })).toBe("https://x.org");
    expect(displayLabel({ label: "", title: "", url: "" })).toBe("New Tab");
    expect(displayLabel({})).toBe("New Tab");
  });

  test("writeTabLabels: undefined when empty, keys sorted", () => {
    expect(writeTabLabels({})).toBeUndefined();
    expect(
      Object.keys(/** @type {object} */ (writeTabLabels({ t2: "b", t10: "c", t1: "a" }))),
    ).toEqual(["t1", "t10", "t2"]);
  });

  test("readTabLabels validates with a JSON path", () => {
    const ids = new Set(["t1", "t2"]);
    expect(readTabLabels(undefined, ids)).toEqual({});
    expect(readTabLabels({ t1: "mail" }, ids)).toEqual({ t1: "mail" });
    const cases = [
      [[], "tabLabels"],
      [null, "tabLabels"],
      [{ t9: "x" }, 'tabLabels["t9"]'],
      [{ t1: 3 }, 'tabLabels["t1"]'],
      [{ t1: "" }, 'tabLabels["t1"]'],
      [{ t1: " padded " }, 'tabLabels["t1"]'],
    ];
    for (const [raw, path] of cases) {
      let err;
      try {
        readTabLabels(raw, ids);
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(raw)).toBeInstanceOf(TabLabelError);
      expect(/** @type {TabLabelError} */ (err).path).toBe(path);
      expect(/** @type {TabLabelError} */ (err).code).toBe("invalid");
    }
  });

  test("property: normalizeTabLabel is idempotent and labels round-trip", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const n = normalizeTabLabel(s);
        expect(normalizeTabLabel(n)).toBe(n);
      }),
    );
    fc.assert(
      fc.property(fc.dictionary(fc.constantFrom("t1", "t2", "t3"), fc.string()), (raw) => {
        let l = {};
        for (const [k, v] of Object.entries(raw)) l = setTabLabel(l, k, v);
        expect(readTabLabels(writeTabLabels(l), new Set(["t1", "t2", "t3"]))).toEqual(l);
      }),
    );
  });
});
