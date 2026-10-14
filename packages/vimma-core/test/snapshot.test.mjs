import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SCHEMA_VERSION,
  SNAPSHOT_MIGRATIONS,
  toSnapshot,
  fromSnapshot,
  migrateSnapshot,
  canWrite,
  SnapshotError,
} from "../src/snapshot.mjs";
import { activeWorkspace } from "../src/workspaces.mjs";

const fixture = (/** @type {string} */ name) =>
  readFileSync(new URL(`../../../tests/contract/state/v1/${name}`, import.meta.url), "utf8");

/** @param {() => unknown} fn */
function snapshotError(fn) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SnapshotError);
    return /** @type {SnapshotError} */ (e);
  }
  throw new Error("expected a SnapshotError");
}

describe("contract fixtures, schema v1", () => {
  test("valid.json loads and round-trips through toSnapshot", () => {
    const s = fromSnapshot(fixture("valid.json"));
    expect(activeWorkspace(s).name).toBe("personal");
    expect(activeWorkspace(s).panes?.zoom).toBe("p1");
    expect(toSnapshot(s)).toEqual(JSON.parse(fixture("valid.json")));
    expect(SCHEMA_VERSION).toBe(1);
  });

  test("invalid.json fails with a SnapshotError naming the path", () => {
    const e = snapshotError(() => fromSnapshot(fixture("invalid.json")));
    expect(e.path).toBe("workspaces[0].panes.root.ratios");
    expect(e.message).toMatch(/workspaces\[0\]\.panes\.root\.ratios/);
  });
});

/** @param {(raw: any) => void} mutate */
function mutated(mutate) {
  const raw = JSON.parse(fixture("valid.json"));
  mutate(raw);
  return raw;
}

describe("validation", () => {
  test.each(
    /** @type {Array<[string, (raw: any) => void, string]>} */ ([
      ["schema missing", (r) => delete r.schema, "schema"],
      ["no workspaces", (r) => (r.workspaces = []), "workspaces"],
      ["workspaces not an array", (r) => (r.workspaces = {}), "workspaces"],
      ["unknown active", (r) => (r.active = "w9"), "active"],
      ["next too small", (r) => (r.next = 3), "next"],
      ["workspace not an object", (r) => (r.workspaces[2] = 7), "workspaces[2]"],
      ["duplicate workspace id", (r) => (r.workspaces[1].id = "w1"), "workspaces[1].id"],
      ["workspace id too long", (r) => (r.workspaces[1].id = "x".repeat(129)), "workspaces[1].id"],
      ["workspace id with a space", (r) => (r.workspaces[1].id = "w 2"), "workspaces[1].id"],
      ["duplicate name", (r) => (r.workspaces[1].name = "work"), "workspaces[1].name"],
      ["empty name", (r) => (r.workspaces[1].name = " "), "workspaces[1].name"],
      [
        "duplicate container",
        (r) => (r.workspaces[2].container = "vimma-work"),
        "workspaces[2].container",
      ],
      ["tab in two workspaces", (r) => (r.workspaces[1].tabs = ["tab-a"]), "workspaces[1].tabs[0]"],
      ["non-string tab", (r) => (r.workspaces[0].tabs[1] = 5), "workspaces[0].tabs[1]"],
      [
        "active tab not in tabs",
        (r) => (r.workspaces[0].activeTab = "tab-z"),
        "workspaces[0].activeTab",
      ],
      [
        "active tab not focused",
        (r) => (r.workspaces[0].activeTab = "tab-a"),
        "workspaces[0].activeTab",
      ],
      [
        "empty workspace with an active tab",
        (r) => (r.workspaces[2].activeTab = "tab-x"),
        "workspaces[2].activeTab",
      ],
      [
        "empty workspace with panes",
        (r) => (r.workspaces[2].panes = r.workspaces[1].panes),
        "workspaces[2].panes",
      ],
      ["tabs without panes", (r) => (r.workspaces[1].panes = null), "workspaces[1].panes"],
      [
        "unknown node type",
        (r) => (r.workspaces[1].panes.root.type = "tree"),
        "workspaces[1].panes.root.type",
      ],
      ["bad axis", (r) => (r.workspaces[0].panes.root.axis = "z"), "workspaces[0].panes.root.axis"],
      [
        "one-child split",
        (r) => r.workspaces[0].panes.root.children.pop(),
        "workspaces[0].panes.root.children",
      ],
      [
        "ratios count",
        (r) => r.workspaces[0].panes.root.ratios.push(0),
        "workspaces[0].panes.root.ratios",
      ],
      [
        "negative ratio",
        (r) => (r.workspaces[0].panes.root.ratios = [1.5, -0.5]),
        "workspaces[0].panes.root.ratios",
      ],
      [
        "nested split on the same axis",
        (r) => (r.workspaces[0].panes.root.children[1].axis = "x"),
        "workspaces[0].panes.root.children[1].axis",
      ],
      [
        "pane tab not in the workspace",
        (r) => (r.workspaces[0].panes.root.children[0].tab = "tab-d"),
        "workspaces[0].panes.root.children[0].tab",
      ],
      [
        "tab shown twice",
        (r) => (r.workspaces[0].panes.root.children[0].tab = "tab-b"),
        "workspaces[0].panes.root.children[1].children[0].tab",
      ],
      [
        "duplicate pane id",
        (r) => (r.workspaces[0].panes.root.children[0].pane = "p2"),
        "workspaces[0].panes.root.children[1].children[0].pane",
      ],
      [
        "name with surrounding spaces",
        (r) => (r.workspaces[1].name = " personal"),
        "workspaces[1].name",
      ],
      [
        "mru missing a pane",
        (r) => (r.workspaces[0].panes.mru = ["p3", "p2"]),
        "workspaces[0].panes.mru",
      ],
      [
        "mru not led by focus",
        (r) => (r.workspaces[0].panes.mru = ["p2", "p3", "p1"]),
        "workspaces[0].panes.mru",
      ],
      [
        "mru repeats a pane",
        (r) => (r.workspaces[0].panes.mru = ["p3", "p3", "p1"]),
        "workspaces[0].panes.mru",
      ],
      [
        "focus not a leaf",
        (r) => (r.workspaces[0].panes.focus = "p9"),
        "workspaces[0].panes.focus",
      ],
      ["zoom not a leaf", (r) => (r.workspaces[0].panes.zoom = "p9"), "workspaces[0].panes.zoom"],
      ["pane next too small", (r) => (r.workspaces[0].panes.next = 2), "workspaces[0].panes.next"],
      ["panes not an object", (r) => (r.workspaces[0].panes = "x"), "workspaces[0].panes"],
    ]),
  )("%s → %s", (_, mutate, path) => {
    expect(snapshotError(() => fromSnapshot(mutated(mutate))).path).toBe(path);
  });

  test("a same-axis child split is accepted when flattening would squeeze a pane below MIN_RATIO", () => {
    const raw = mutated((r) => {
      const inner = r.workspaces[0].panes.root.children[1];
      inner.axis = "x";
      inner.ratios = [0.15, 0.85]; // 0.15 × 0.5 < MIN_RATIO
    });
    expect(fromSnapshot(raw).workspaces[0]?.panes?.root).toMatchObject({
      children: [{ type: "leaf" }, { axis: "x", ratios: [0.15, 0.85] }],
    });
  });

  test("broken JSON and non-objects are rejected", () => {
    expect(snapshotError(() => fromSnapshot("{")).code).toBe("bad-json");
    expect(snapshotError(() => fromSnapshot("[]")).path).toBe("");
    expect(snapshotError(() => fromSnapshot(null)).code).toBe("invalid");
  });
});

describe("panes.layout (docs/specs/tiling-layouts.md): optional, no schema bump", () => {
  /** @param {unknown} layout */
  const withLayout = (layout) =>
    mutated((r) => {
      const w = r.workspaces.find((/** @type {any} */ x) => x.panes?.root.type === "split");
      w.panes.layout = layout;
    });
  const read = (/** @type {any} */ raw) =>
    /** @type {any} */ (fromSnapshot(raw)).workspaces.find(
      (/** @type {any} */ w) => w.panes?.root.type === "split",
    ).panes;

  test("a preset name is kept and written back", () => {
    const raw = withLayout("tiled");
    const panes = read(raw);
    expect(panes.layout).toBe("tiled");
    expect(toSnapshot(fromSnapshot(raw))).toEqual(raw);
    expect(raw.schema).toBe(SCHEMA_VERSION);
  });

  test.each([["grid"], [3], [null]])("%s is dropped without failing the restore", (bad) => {
    const panes = read(withLayout(bad));
    expect("layout" in panes).toBe(false);
  });

  test("a snapshot without it reads as before (no layout key)", () => {
    expect("layout" in read(JSON.parse(fixture("valid.json")))).toBe(false);
  });
});

describe("migrations", () => {
  test("a newer schema is unsupported", () => {
    const e = snapshotError(() => fromSnapshot(mutated((r) => (r.schema = 2))));
    expect(e.code).toBe("unsupported-schema");
    expect(e.path).toBe("schema");
  });

  test("an older schema without a migration step is unsupported", () => {
    expect(snapshotError(() => fromSnapshot(mutated((r) => (r.schema = 0)))).code).toBe(
      "unsupported-schema",
    );
    expect(Object.keys(SNAPSHOT_MIGRATIONS)).toEqual([]);
  });

  test("an injected 0 → 1 step migrates a v0 file", () => {
    // pretend v0 called containers "identity"
    const v0 = mutated((r) => {
      r.schema = 0;
      for (const w of r.workspaces) {
        w.identity = w.container;
        delete w.container;
      }
    });
    const migrations = {
      /** @param {any} raw */
      0: (raw) => ({
        ...raw,
        schema: 1,
        workspaces: raw.workspaces.map((/** @type {any} */ { identity, ...w }) => ({
          ...w,
          container: identity,
        })),
      }),
    };
    expect(migrateSnapshot(v0, migrations).schema).toBe(1);
    expect(toSnapshot(fromSnapshot(v0, { migrations }))).toEqual(JSON.parse(fixture("valid.json")));
  });

  test("a migration that does not advance the schema throws instead of looping", () => {
    const v0 = mutated((r) => (r.schema = 0));
    const stuck = { 0: (/** @type {any} */ raw) => raw };
    const e = snapshotError(() => migrateSnapshot(v0, stuck));
    expect(e.code).toBe("bad-migration");
    expect(e.path).toBe("schema");
    const garbage = { 0: () => 42 };
    expect(snapshotError(() => migrateSnapshot(v0, garbage)).code).toBe("bad-migration");
  });

  test("a current snapshot passes through migrateSnapshot untouched", () => {
    const raw = JSON.parse(fixture("valid.json"));
    expect(migrateSnapshot(raw)).toBe(raw);
  });
});

describe("canWrite: never overwrite a file from a newer vimma", () => {
  test.each([
    ["no file", null, true],
    ["a v1 file", fixture("valid.json"), true],
    ["a v1 object", JSON.parse(fixture("valid.json")), true],
    ["an older file", JSON.stringify({ schema: 0 }), true],
    ["a newer file", JSON.stringify({ schema: 2, anything: true }), false],
    ["a newer object", { schema: 7 }, false],
    ["unreadable JSON", "{ not json", true],
    ["no schema", JSON.stringify({ workspaces: [] }), true],
  ])("%s → %s", (_, existing, expected) => {
    expect(canWrite(existing)).toBe(expected);
  });
});

// docs/specs/side-panel-unsplit.md decision 24: a hidden view and the tab shown alone over it.
describe("panes.hidden and alone: optional, no schema bump", () => {
  /** w1's split hidden, tab-z shown alone; activeTab stays the focused pane's tab (tab-c). */
  const hidden = (/** @type {(w: any) => void} */ more = () => {}) =>
    mutated((r) => {
      const w = r.workspaces[0];
      w.tabs.push("tab-z");
      w.panes.hidden = true;
      w.alone = "tab-z";
      more(w);
    });
  const w1 = (/** @type {any} */ raw) => /** @type {any} */ (fromSnapshot(raw)).workspaces[0];

  test("a hidden view reads with the alone tab as the active one, and writes back", () => {
    const raw = hidden();
    const w = w1(raw);
    expect(w.panes.hidden).toBe(true);
    expect(w.activeTab).toBe("tab-z");
    expect(toSnapshot(fromSnapshot(raw))).toEqual(raw);
    expect(raw.schema).toBe(SCHEMA_VERSION);
  });

  test("the file keeps activeTab on the focused pane, so an older reader shows the split", () => {
    const raw = hidden();
    expect(raw.workspaces[0].activeTab).toBe("tab-c");
    const written = toSnapshot(fromSnapshot(raw));
    expect(written.workspaces[0].activeTab).toBe("tab-c");
    expect(written.workspaces[0].alone).toBe("tab-z");
  });

  test.each([
    ["no alone tab", (/** @type {any} */ w) => delete w.alone],
    ["an alone tab not in the workspace", (/** @type {any} */ w) => (w.alone = "tab-d")],
    ["an alone tab that is a pane's", (/** @type {any} */ w) => (w.alone = "tab-a")],
    ["hidden not true", (/** @type {any} */ w) => (w.panes.hidden = "yes")],
  ])("%s: the view reads as shown, without failing", (_, change) => {
    const w = w1(hidden(change));
    expect("hidden" in w.panes).toBe(false);
    expect(w.activeTab).toBe("tab-c");
  });

  test("a one-pane tree is never hidden", () => {
    const raw = mutated((r) => {
      r.workspaces[1].panes.hidden = true;
    });
    expect("hidden" in /** @type {any} */ (fromSnapshot(raw)).workspaces[1].panes).toBe(false);
  });

  test("a snapshot without them reads as before", () => {
    const w = w1(JSON.parse(fixture("valid.json")));
    expect("hidden" in w.panes).toBe(false);
    expect(toSnapshot(fromSnapshot(fixture("valid.json"))).workspaces[0]).not.toHaveProperty(
      "alone",
    );
  });
});
