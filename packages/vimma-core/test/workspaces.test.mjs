import { describe, test, expect } from "vitest";
import fc from "fast-check";
import {
  createWorkspaces,
  addWorkspace,
  renameWorkspace,
  deleteWorkspace,
  switchWorkspace,
  nextWorkspace,
  previousWorkspace,
  openTab,
  closeTab,
  selectTab,
  moveTab,
  splitPane,
  withPanes,
  activeWorkspace,
  findWorkspace,
  workspaceOfTab,
  WorkspaceError,
} from "../src/workspaces.mjs";
import { closePane, focus, leaves, resize, setPaneTab, swap, toggleZoom } from "../src/panes.mjs";
import { toSnapshot, fromSnapshot } from "../src/snapshot.mjs";

/** @param {() => unknown} fn @param {string} code */
function expectWsError(fn, code) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(WorkspaceError);
  expect(/** @type {WorkspaceError} */ (err).code).toBe(code);
}

const two = () =>
  createWorkspaces([
    { name: "work", container: "c-work" },
    { name: "personal", container: "c-personal" },
  ]);

/** work with tabs a, b, c; `b` active */
function abc() {
  let s = two();
  for (const t of ["a", "b", "c"]) s = openTab(s, t);
  return selectTab(s, "b");
}

/** @param {any} s */
const ws = (s) => activeWorkspace(s);
/** @param {any} w */
const paneTabs = (w) => (w.panes ? leaves(w.panes).map((l) => l.tab) : []);

describe("workspace lifecycle", () => {
  test("createWorkspaces makes the first workspace active, empty, with stable ids", () => {
    const s = two();
    expect(ws(s)).toMatchObject({
      id: "w1",
      name: "work",
      container: "c-work",
      tabs: [],
      activeTab: null,
      panes: null,
    });
    expect(s.workspaces.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(Object.isFrozen(s)).toBe(true);
    expectWsError(() => createWorkspaces([]), "last-workspace");
  });

  test("next/previous wrap around in ctrl+i order", () => {
    let s = two();
    s = nextWorkspace(s);
    expect(ws(s).name).toBe("personal");
    s = nextWorkspace(s);
    expect(ws(s).name).toBe("work");
    expect(ws(previousWorkspace(s)).name).toBe("personal");
  });

  test("switch by index, by name or by id", () => {
    expect(ws(switchWorkspace(two(), { index: 2 })).name).toBe("personal");
    expect(ws(switchWorkspace(two(), { name: "personal" })).name).toBe("personal");
    expect(ws(switchWorkspace(two(), { id: "w2" })).name).toBe("personal");
    const s = two();
    expect(switchWorkspace(s, { index: 1 })).toBe(s);
    expectWsError(() => switchWorkspace(two(), { index: 3 }), "unknown-workspace");
    expectWsError(() => switchWorkspace(two(), { name: "nope" }), "unknown-workspace");
    expect(findWorkspace(two(), { index: 0 })).toBeUndefined();
  });

  test("addWorkspace appends and activates unless asked not to", () => {
    const s = addWorkspace(two(), { name: "admin", container: "c-admin" });
    expect(ws(s)).toMatchObject({ id: "w3", name: "admin" });
    expect(findWorkspace(s, { index: 3 })?.name).toBe("admin");
    const t = addWorkspace(two(), { name: "admin", container: "c-admin" }, { activate: false });
    expect(ws(t).name).toBe("work");
  });

  test.each([
    [{ name: "work", container: "c-x" }, "duplicate-name"],
    [{ name: "  ", container: "c-x" }, "empty-name"],
    [{ name: "x", container: "c-work" }, "duplicate-container"],
    [{ name: "x", container: "" }, "empty-container"],
  ])("addWorkspace(%o) fails with %s", (def, code) => {
    expectWsError(() => addWorkspace(two(), def), code);
  });

  test("names are trimmed", () => {
    expect(ws(addWorkspace(two(), { name: " admin ", container: "c" })).name).toBe("admin");
  });

  test("renameWorkspace keeps id and container; duplicate or empty names fail", () => {
    const s = renameWorkspace(two(), { name: "work" }, "job");
    expect(ws(s)).toMatchObject({ id: "w1", name: "job", container: "c-work" });
    expect(renameWorkspace(s, { id: "w1" }, "job")).toBe(s);
    expectWsError(() => renameWorkspace(two(), { index: 1 }, "personal"), "duplicate-name");
    expectWsError(() => renameWorkspace(two(), { index: 1 }, ""), "empty-name");
    expectWsError(() => renameWorkspace(two(), { index: 9 }, "x"), "unknown-workspace");
  });

  test("deleteWorkspace returns its tabs to close and activates the previous workspace", () => {
    let s = switchWorkspace(abc(), { index: 2 });
    s = openTab(s, "d");
    const r = deleteWorkspace(s, { name: "personal" });
    expect(r.closedTabs).toEqual(["d"]);
    expect(ws(r.state).name).toBe("work");
    expect(r.state.workspaces.length).toBe(1);
  });

  test("deleting the first, active workspace activates the next; the last one cannot go", () => {
    const r = deleteWorkspace(abc(), { index: 1 });
    expect(r.closedTabs).toEqual(["a", "b", "c"]);
    expect(ws(r.state).name).toBe("personal");
    expectWsError(() => deleteWorkspace(r.state, { index: 1 }), "last-workspace");
  });

  test("deleting an inactive workspace keeps the active one", () => {
    const r = deleteWorkspace(abc(), { index: 2 });
    expect(ws(r.state).name).toBe("work");
    expect(r.closedTabs).toEqual([]);
  });
});

describe("tab bookkeeping", () => {
  test("the first tab creates the pane layout; activating shows it in the focused pane", () => {
    const s = abc();
    expect(ws(s).tabs).toEqual(["a", "b", "c"]);
    expect(ws(s).activeTab).toBe("b");
    expect(paneTabs(ws(s))).toEqual(["b"]);
    expect(workspaceOfTab(s, "c")?.name).toBe("work");
    expect(workspaceOfTab(s, "zz")).toBeUndefined();
  });

  test("openTab after a tab, unactivated, or into another workspace", () => {
    let s = selectTab(abc(), "a");
    s = openTab(s, "d", { after: "a" });
    expect(ws(s).tabs).toEqual(["a", "d", "b", "c"]);
    expect(ws(s).activeTab).toBe("d");
    s = openTab(s, "e", { activate: false });
    expect(ws(s).activeTab).toBe("d");
    s = openTab(s, "f", { workspace: { name: "personal" }, activate: false });
    expect(ws(s).name).toBe("work");
    expect(findWorkspace(s, { index: 2 })).toMatchObject({ tabs: ["f"], activeTab: "f" });
    expectWsError(() => openTab(s, "a"), "duplicate-tab");
    expectWsError(() => openTab(s, "g", { after: "zz" }), "unknown-tab");
  });

  test("closing the active tab activates its right neighbour, else its left", () => {
    let s = closeTab(abc(), "b");
    expect(ws(s).activeTab).toBe("c");
    expect(paneTabs(ws(s))).toEqual(["c"]);
    s = closeTab(s, "c");
    expect(ws(s).activeTab).toBe("a");
    s = closeTab(s, "a");
    expect(ws(s)).toMatchObject({ tabs: [], activeTab: null, panes: null });
    expectWsError(() => closeTab(s, "a"), "unknown-tab");
  });

  test("closing a hidden tab changes nothing else", () => {
    const s = closeTab(abc(), "a");
    expect(ws(s)).toMatchObject({ tabs: ["b", "c"], activeTab: "b" });
  });

  test("closing a focused tab shown in a split shows the new active tab in that pane", () => {
    let s = selectTab(abc(), "a");
    s = splitPane(s, "vertical", "d"); // tabs a, d, b, c; panes x[a, d], focus d
    expect(ws(s).tabs).toEqual(["a", "d", "b", "c"]);
    expect(paneTabs(ws(s))).toEqual(["a", "d"]);
    s = closeTab(s, "d");
    expect(ws(s).activeTab).toBe("b");
    expect(paneTabs(ws(s))).toEqual(["a", "b"]);
  });

  test("closing a focused tab when its right neighbour is shown elsewhere focuses that pane", () => {
    let s = selectTab(abc(), "a");
    s = splitPane(s, "vertical", "d"); // a, d, b, c
    s = withPanes(s, (p) => focus(p, "left")); // focus a
    s = closeTab(s, "a"); // right neighbour d is shown in the other pane
    expect(paneTabs(ws(s))).toEqual(["d"]);
    expect(ws(s).activeTab).toBe("d");
  });

  test("closing an unfocused tab shown in a pane shows a hidden tab there, else closes the pane", () => {
    let s = selectTab(abc(), "a");
    s = splitPane(s, "vertical", "d"); // x[a, d], focus d; hidden b, c
    s = closeTab(s, "a");
    expect(paneTabs(ws(s))).toEqual(["b", "d"]);
    expect(ws(s).activeTab).toBe("d");
    s = closeTab(closeTab(s, "c"), "b"); // no hidden tab left
    expect(paneTabs(ws(s))).toEqual(["d"]);
  });

  test("selectTab switches to the tab's workspace and focuses its pane if shown", () => {
    let s = openTab(abc(), "p", { workspace: { index: 2 }, activate: false });
    s = selectTab(s, "p");
    expect(ws(s).name).toBe("personal");
    expect(ws(s).activeTab).toBe("p");
    s = switchWorkspace(s, { index: 1 });
    s = splitPane(s, "horizontal", "d"); // x? y[b, d], focus d
    s = selectTab(s, "b");
    expect(paneTabs(ws(s))).toEqual(["b", "d"]);
    expect(ws(s).panes?.focus).toBe("p1");
    expect(selectTab(s, "b")).toBe(s);
    expectWsError(() => selectTab(s, "zz"), "unknown-tab");
  });

  test("moveTab reopens the tab at the end of the target and stays put", () => {
    const s = moveTab(abc(), "a", { name: "personal" }, { newTabId: "a2" });
    expect(ws(s).name).toBe("work");
    expect(ws(s).tabs).toEqual(["b", "c"]);
    expect(findWorkspace(s, { index: 2 })).toMatchObject({ tabs: ["a2"], activeTab: "a2" });
    const t = moveTab(abc(), "b", { index: 2 });
    expect(ws(t).activeTab).toBe("c");
    expect(findWorkspace(t, { index: 2 })?.tabs).toEqual(["b"]);
    const u = abc();
    expect(moveTab(u, "a", { index: 1 })).toBe(u);
    expectWsError(() => moveTab(u, "a", { index: 2 }, { newTabId: "b" }), "duplicate-tab");
  });

  test("moveTab accepts a new tab the host already registered in the target (TabOpen first)", () => {
    // the host reopens the page in the target container; its TabOpen handler registers it there
    let s = openTab(abc(), "a2", { workspace: { name: "personal" }, activate: false });
    s = moveTab(s, "a", { name: "personal" }, { newTabId: "a2" });
    expect(ws(s).tabs).toEqual(["b", "c"]);
    expect(findWorkspace(s, { name: "personal" })).toMatchObject({ tabs: ["a2"], activeTab: "a2" });
  });

  test("moveTab still rejects a new tab registered anywhere but the target", () => {
    let s = addWorkspace(abc(), { name: "admin", container: "c-admin" }, { activate: false });
    s = openTab(s, "x", { workspace: { name: "admin" } });
    expectWsError(() => moveTab(s, "a", { name: "personal" }, { newTabId: "x" }), "duplicate-tab");
    expectWsError(() => moveTab(s, "a", { name: "personal" }, { newTabId: "c" }), "duplicate-tab");
  });

  test("moveTab appends to a target that already has tabs without changing its active tab", () => {
    let s = openTab(abc(), "p", { workspace: { index: 2 } });
    s = moveTab(s, "a", { index: 2 });
    expect(findWorkspace(s, { index: 2 })).toMatchObject({ tabs: ["p", "a"], activeTab: "p" });
  });
});

describe("panes inside workspaces", () => {
  test("splitPane opens the tab after the active one and focuses it", () => {
    const s = splitPane(abc(), "vertical", "d");
    expect(ws(s).tabs).toEqual(["a", "b", "d", "c"]);
    expect(ws(s).activeTab).toBe("d");
    expect(paneTabs(ws(s))).toEqual(["b", "d"]);
  });

  test("withPanes applies a pane op and syncs the active tab", () => {
    let s = splitPane(abc(), "vertical", "d");
    s = withPanes(s, (p) => focus(p, "left"));
    expect(ws(s).activeTab).toBe("b");
    const z = withPanes(s, toggleZoom);
    expect(ws(z).panes?.zoom).toBe("p1");
    expect(withPanes(s, (p) => p)).toBe(s);
  });

  test("a pane op that shows a tab of no workspace's list is rejected", () => {
    expectWsError(() => withPanes(abc(), (p) => setPaneTab(p, p.focus, "stray")), "unknown-tab");
  });

  test("pane ops on an empty workspace fail; splitPane in one opens a single pane", () => {
    expectWsError(() => withPanes(two(), (p) => p), "no-tab");
    const s = splitPane(two(), "vertical", "x");
    expect(paneTabs(ws(s))).toEqual(["x"]);
  });
});

// --- properties --------------------------------------------------------------------------------

const opArb = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record({
      op: fc.constant("open"),
      w: fc.nat(),
      activate: fc.boolean(),
      after: fc.boolean(),
    }),
  },
  { weight: 3, arbitrary: fc.record({ op: fc.constant("close"), pick: fc.nat() }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant("select"), pick: fc.nat() }) },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant("move"),
      pick: fc.nat(),
      w: fc.nat(),
      id: fc.constantFrom("same", "new", "registered"),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      op: fc.constant("pane"),
      kind: fc.constantFrom("close", "swap", "zoom", "resize"),
      pick: fc.nat(),
      dir: fc.constantFrom("left", "down", "up", "right"),
      grow: fc.constantFrom("wider", "narrower", "taller", "shorter"),
      amount: fc.double({ min: 0.01, max: 1, noNaN: true }),
    }),
  },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("previous") }) },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant("split"),
      dir: fc.constantFrom("vertical", "horizontal"),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant("focus"),
      dir: fc.constantFrom("left", "down", "up", "right"),
    }),
  },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("switch"), w: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("next") }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("add") }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("delete"), w: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("rename"), w: fc.nat() }) },
);

/** @param {any[]} ops */
function run(ops) {
  let s = two();
  let n = 0;
  for (const o of ops) {
    const all = s.workspaces.flatMap((w) => w.tabs);
    const tab = all.length ? all[(o.pick ?? 0) % all.length] : undefined;
    const wref = { index: ((o.w ?? 0) % s.workspaces.length) + 1 };
    switch (o.op) {
      case "open": {
        const target = /** @type {any} */ (findWorkspace(s, wref));
        const after = o.after && target.activeTab ? target.activeTab : undefined;
        s = openTab(s, `t${n++}`, { workspace: wref, activate: o.activate, after });
        break;
      }
      case "close":
        if (tab) s = closeTab(s, tab);
        break;
      case "select":
        if (tab) s = selectTab(s, tab);
        break;
      case "move": {
        if (!tab) break;
        if (o.id === "same") s = moveTab(s, tab, wref);
        else if (o.id === "new") s = moveTab(s, tab, wref, { newTabId: `t${n++}` });
        else if (workspaceOfTab(s, tab) !== findWorkspace(s, wref)) {
          const id = `t${n++}`;
          s = openTab(s, id, { workspace: wref, activate: false });
          s = moveTab(s, tab, wref, { newTabId: id });
        }
        break;
      }
      case "pane": {
        if (!activeWorkspace(s).panes) break;
        s = withPanes(s, (p) => {
          const ls = leaves(p);
          const target = /** @type {any} */ (ls[o.pick % ls.length]).pane;
          if (o.kind === "close") return ls.length > 1 ? closePane(p, target) : p;
          if (o.kind === "swap") return swap(p, o.dir);
          if (o.kind === "zoom") return toggleZoom(p);
          return resize(p, o.grow, o.amount);
        });
        break;
      }
      case "previous":
        s = previousWorkspace(s);
        break;
      case "split":
        s = splitPane(s, o.dir, `t${n++}`);
        break;
      case "focus":
        if (activeWorkspace(s).panes) s = withPanes(s, (p) => focus(p, o.dir));
        break;
      case "switch":
        s = switchWorkspace(s, wref);
        break;
      case "next":
        s = nextWorkspace(s);
        break;
      case "add":
        s = addWorkspace(s, { name: `ws${n}`, container: `c${n}` }, { activate: false });
        n++;
        break;
      case "delete":
        if (s.workspaces.length > 1) s = deleteWorkspace(s, wref).state;
        break;
      case "rename":
        s = renameWorkspace(s, wref, `renamed${n++}`);
        break;
    }
  }
  return s;
}

const stateArb = fc.array(opArb, { maxLength: 60 }).map(run);

describe("workspace properties", () => {
  test("every tab is in exactly one workspace; active tab, panes and tabs agree", () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        const all = s.workspaces.flatMap((w) => w.tabs);
        expect(new Set(all).size).toBe(all.length);
        expect(s.workspaces.map((w) => w.id)).toContain(s.active);
        const names = s.workspaces.map((w) => w.name);
        const containers = s.workspaces.map((w) => w.container);
        expect(new Set(names).size).toBe(names.length);
        expect(new Set(containers).size).toBe(containers.length);
        for (const w of s.workspaces) {
          if (w.tabs.length === 0) {
            expect(w.activeTab).toBeNull();
            expect(w.panes).toBeNull();
            continue;
          }
          expect(w.panes).not.toBeNull();
          const p = /** @type {import("../src/panes.mjs").Panes} */ (w.panes);
          expect(w.tabs).toContain(w.activeTab);
          const shown = leaves(p);
          expect(shown.find((l) => l.pane === p.focus)?.tab).toBe(w.activeTab);
          for (const l of shown) expect(w.tabs).toContain(l.tab);
        }
      }),
    );
  });

  test("fromSnapshot(toSnapshot(s)) restores s", () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        const back = fromSnapshot(JSON.stringify(toSnapshot(s)));
        expect(back).toEqual(s);
      }),
    );
  });
});
