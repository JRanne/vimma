import { describe, test, expect } from "vitest";
import fc from "fast-check";
import {
  createPanes,
  split,
  closePane,
  focus,
  focusPane,
  swap,
  toggleZoom,
  resize,
  setPaneTab,
  layout,
  leaves,
  paneOfTab,
  MIN_RATIO,
  PaneError,
} from "../src/panes.mjs";

/** @param {any} node @returns {string} */
function shape(node) {
  return node.type === "leaf" ? node.pane : `${node.axis}[${node.children.map(shape).join(",")}]`;
}

/** @param {() => unknown} fn @param {string} code */
function expectPaneError(fn, code) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(PaneError);
  expect(/** @type {PaneError} */ (err).code).toBe(code);
}

/** x[p1, y[p2, p3]], focus on p3 */
function threePanes() {
  let s = createPanes("t1");
  s = split(s, "p1", "vertical", "t2");
  return split(s, "p2", "horizontal", "t3");
}

const RECT = { x: 0, y: 0, width: 100, height: 80 };

describe("split", () => {
  test("a single pane starts focused and unzoomed", () => {
    const s = createPanes("t1");
    expect(shape(s.root)).toBe("p1");
    expect(s.focus).toBe("p1");
    expect(s.zoom).toBeNull();
    expect(Object.isFrozen(s)).toBe(true);
  });

  test("split vertical puts the new pane to the right, 50/50, and focuses it", () => {
    const s = split(createPanes("t1"), "p1", "vertical", "t2");
    expect(shape(s.root)).toBe("x[p1,p2]");
    expect(s.root.type === "split" && s.root.ratios).toEqual([0.5, 0.5]);
    expect(s.focus).toBe("p2");
    expect(paneOfTab(s, "t2")).toBe("p2");
  });

  test("splitting along the parent's axis halves the pane's share instead of nesting", () => {
    let s = split(createPanes("t1"), "p1", "vertical", "t2");
    s = split(s, "p2", "vertical", "t3");
    expect(shape(s.root)).toBe("x[p1,p2,p3]");
    expect(s.root.type === "split" && s.root.ratios).toEqual([0.5, 0.25, 0.25]);
  });

  test("split horizontal across the parent's axis nests a y split", () => {
    expect(shape(threePanes().root)).toBe("x[p1,y[p2,p3]]");
  });

  test("the input state is not mutated", () => {
    const s = split(createPanes("t1"), "p1", "vertical", "t2");
    const before = JSON.stringify(s);
    split(s, "p1", "horizontal", "t3");
    expect(JSON.stringify(s)).toBe(before);
  });

  test("an unknown pane or a tab already shown is an error", () => {
    const s = createPanes("t1");
    expectPaneError(() => split(s, "p9", "vertical", "t2"), "unknown-pane");
    expectPaneError(() => split(s, "p1", "vertical", "t1"), "tab-shown");
    // @ts-expect-error bad direction
    expectPaneError(() => split(s, "p1", "diagonal", "t2"), "bad-direction");
  });
});

describe("closePane", () => {
  test("promotes the sibling when a split is left with one child", () => {
    const s = closePane(threePanes(), "p3");
    expect(shape(s.root)).toBe("x[p1,p2]");
    expect(s.focus).toBe("p2");
  });

  test("flattens a promoted split into a parent with the same axis", () => {
    let s = threePanes();
    s = split(s, "p3", "vertical", "t4");
    expect(shape(s.root)).toBe("x[p1,y[p2,x[p3,p4]]]");
    s = closePane(s, "p2");
    expect(shape(s.root)).toBe("x[p1,p3,p4]");
    expect(s.root.type === "split" && s.root.ratios).toEqual([0.5, 0.25, 0.25]);
  });

  test("gives the space to the previous sibling, or the next one if it was first", () => {
    let s = split(createPanes("t1"), "p1", "vertical", "t2");
    s = split(s, "p2", "vertical", "t3"); // [.5,.25,.25]
    const a = closePane(s, "p2");
    expect(a.root.type === "split" && a.root.ratios).toEqual([0.75, 0.25]);
    const b = closePane(s, "p1");
    expect(shape(b.root)).toBe("x[p2,p3]");
    expect(b.root.type === "split" && b.root.ratios).toEqual([0.75, 0.25]);
  });

  test("closing an unfocused pane keeps focus", () => {
    const s = closePane(threePanes(), "p1");
    expect(s.focus).toBe("p3");
    expect(shape(s.root)).toBe("y[p2,p3]");
  });

  test("focus goes to the first leaf of the absorbing sibling", () => {
    let s = threePanes();
    s = focusPane(s, "p1");
    s = closePane(s, "p1");
    expect(s.focus).toBe("p2");
  });

  test("closing the last pane is an error", () => {
    expectPaneError(() => closePane(createPanes("t1"), "p1"), "last-pane");
    expectPaneError(() => closePane(threePanes(), "p7"), "unknown-pane");
  });
});

describe("focus", () => {
  test.each(
    /** @type {Array<[string, import("../src/panes.mjs").Direction, string]>} */ ([
      ["p3", "left", "p1"],
      ["p2", "left", "p1"],
      ["p1", "right", "p2"], // covers p1's top edge
      ["p2", "down", "p3"],
      ["p3", "up", "p2"],
      ["p1", "up", "p1"], // no wrap
      ["p1", "left", "p1"],
      ["p3", "right", "p3"],
      ["p3", "down", "p3"],
    ]),
  )("from %s, focus %s → %s", (from, dir, to) => {
    const s = focusPane(threePanes(), from);
    const t = focus(s, dir);
    expect(t.focus).toBe(to);
    if (from === to) expect(t).toBe(s);
  });

  test("prefers the neighbour in line with the pane's start edge", () => {
    // y[x[p1,p2], p3] where p3 spans the bottom; from p3 up → p1 (covers left edge)
    let s = split(createPanes("t1"), "p1", "horizontal", "t3");
    s = split(s, "p1", "vertical", "t2");
    expect(shape(s.root)).toBe("y[x[p1,p3],p2]");
    s = focusPane(s, "p2");
    expect(focus(s, "up").focus).toBe("p1");
  });

  test("a bad direction is an error", () => {
    // @ts-expect-error bad direction
    expectPaneError(() => focus(threePanes(), "north"), "bad-direction");
  });

  test("focusPane focuses a pane directly and rejects unknown ids", () => {
    expect(focusPane(threePanes(), "p1").focus).toBe("p1");
    expectPaneError(() => focusPane(threePanes(), "nope"), "unknown-pane");
  });
});

describe("swap", () => {
  test("exchanges the focused leaf with its neighbour; focus moves with the pane", () => {
    let s = split(createPanes("t1"), "p1", "vertical", "t2");
    s = focusPane(s, "p1");
    s = swap(s, "right");
    expect(shape(s.root)).toBe("x[p2,p1]");
    expect(s.focus).toBe("p1");
    expect(layout(s, RECT)[1]).toEqual({
      pane: "p1",
      tab: "t1",
      rect: { x: 50, y: 0, width: 50, height: 80 },
    });
  });

  test("works across nesting levels", () => {
    const s = swap(threePanes(), "left");
    expect(shape(s.root)).toBe("x[p3,y[p2,p1]]");
    expect(s.focus).toBe("p3");
  });

  test("without a neighbour the state is unchanged", () => {
    const s = threePanes();
    expect(swap(s, "right")).toBe(s);
  });
});

describe("zoom", () => {
  test("layout of a zoomed state is the focused pane alone, filling the rect", () => {
    const s = toggleZoom(split(createPanes("t1"), "p1", "vertical", "t2"));
    expect(s.zoom).toBe("p2");
    expect(layout(s, RECT)).toEqual([{ pane: "p2", tab: "t2", rect: RECT }]);
    expect(toggleZoom(s).zoom).toBeNull();
  });

  test("focus, split, close, swap and resize clear the zoom", () => {
    const z = toggleZoom(threePanes());
    expect(focus(z, "up").zoom).toBeNull();
    expect(focus(z, "up").focus).toBe("p2");
    expect(focusPane(z, "p1").zoom).toBeNull();
    expect(split(z, "p3", "vertical", "t9").zoom).toBeNull();
    expect(closePane(z, "p1").zoom).toBeNull();
    expect(swap(z, "left").zoom).toBeNull();
    expect(resize(z, "wider", 0.1).zoom).toBeNull();
  });

  test("zooming a single pane is allowed and harmless", () => {
    const s = toggleZoom(createPanes("t1"));
    expect(layout(s, RECT)).toEqual([{ pane: "p1", tab: "t1", rect: RECT }]);
  });
});

describe("resize", () => {
  const two = () => focusPane(split(createPanes("t1"), "p1", "vertical", "t2"), "p1");
  /** @param {any} s */
  const ratios = (s) => s.root.ratios;

  test("wider grows the focused pane, taking from its next sibling", () => {
    expect(ratios(resize(two(), "wider", 0.1))).toEqual([0.6, 0.4]);
    expect(ratios(resize(two(), "narrower", 0.1))).toEqual([0.4, 0.6]);
  });

  test("the last child takes from its previous sibling", () => {
    const s = focusPane(two(), "p2");
    expect(ratios(resize(s, "wider", 0.1))).toEqual([0.4, 0.6]);
  });

  test("clamps at MIN_RATIO and 1 − MIN_RATIO instead of rejecting", () => {
    expect(ratios(resize(two(), "wider", 1))).toEqual([1 - MIN_RATIO, MIN_RATIO]);
    expect(ratios(resize(two(), "narrower", 1))).toEqual([MIN_RATIO, 1 - MIN_RATIO]);
    const atMax = resize(two(), "wider", 1);
    expect(resize(atMax, "wider", 0.1)).toBe(atMax);
  });

  test("without an ancestor on that axis the state is unchanged", () => {
    const s = two();
    expect(resize(s, "taller", 0.1)).toBe(s);
    expect(resize(s, "shorter", 0.1)).toBe(s);
  });

  test("resizes the nearest ancestor with the matching axis", () => {
    const s = resize(threePanes(), "narrower", 0.2); // p3 is inside y, inside x
    expect(ratios(s)).toEqual([0.7, 0.3]);
    const t = resize(threePanes(), "taller", 0.2);
    expect(/** @type {any} */ (t.root).children[1].ratios).toEqual([0.3, 0.7]);
  });

  test("a bad direction or a non-positive amount is an error", () => {
    // @ts-expect-error bad direction
    expectPaneError(() => resize(two(), "fatter", 0.1), "bad-direction");
    expectPaneError(() => resize(two(), "wider", -0.1), "bad-amount");
  });
});

describe("layout, setPaneTab, leaves", () => {
  test("x[p1, y[p2, p3]] in a 100×80 rect", () => {
    expect(layout(threePanes(), RECT)).toEqual([
      { pane: "p1", tab: "t1", rect: { x: 0, y: 0, width: 50, height: 80 } },
      { pane: "p2", tab: "t2", rect: { x: 50, y: 0, width: 50, height: 40 } },
      { pane: "p3", tab: "t3", rect: { x: 50, y: 40, width: 50, height: 40 } },
    ]);
  });

  test("setPaneTab shows another tab in a pane", () => {
    const s = setPaneTab(threePanes(), "p1", "t9");
    expect(paneOfTab(s, "t9")).toBe("p1");
    expect(paneOfTab(s, "t1")).toBeUndefined();
    expect(setPaneTab(s, "p1", "t9")).toBe(s);
    expectPaneError(() => setPaneTab(s, "p1", "t2"), "tab-shown");
    expectPaneError(() => setPaneTab(s, "p8", "t8"), "unknown-pane");
  });

  test("leaves are in reading order", () => {
    expect(leaves(threePanes()).map((l) => l.pane)).toEqual(["p1", "p2", "p3"]);
  });
});

// --- properties --------------------------------------------------------------------------------

const DIRS = /** @type {const} */ (["left", "down", "up", "right"]);
const RESIZES = /** @type {const} */ (["wider", "narrower", "taller", "shorter"]);

const opArb = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      op: fc.constant("split"),
      pick: fc.nat(),
      dir: fc.constantFrom("vertical", "horizontal"),
    }),
  },
  { weight: 2, arbitrary: fc.record({ op: fc.constant("close"), pick: fc.nat() }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant("focus"), dir: fc.constantFrom(...DIRS) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("swap"), dir: fc.constantFrom(...DIRS) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("zoom") }) },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant("resize"),
      dir: fc.constantFrom(...RESIZES),
      amount: fc.double({ min: 0.001, max: 1, noNaN: true }),
    }),
  },
);

/** @param {any[]} ops */
function run(ops) {
  let s = createPanes("t0");
  let n = 1;
  for (const o of ops) {
    const ls = leaves(s);
    const target = /** @type {any} */ (ls[(o.pick ?? 0) % ls.length]).pane;
    switch (o.op) {
      case "split":
        s = split(s, target, o.dir, `t${n++}`);
        break;
      case "close":
        if (ls.length > 1) s = closePane(s, target);
        break;
      case "focus":
        s = focus(s, o.dir);
        break;
      case "swap":
        s = swap(s, o.dir);
        break;
      case "zoom":
        s = toggleZoom(s);
        break;
      case "resize":
        s = resize(s, o.dir, o.amount);
        break;
    }
  }
  return s;
}

const stateArb = fc.array(opArb, { maxLength: 40 }).map(run);

/** @param {any} node @param {(n: any, parent: any) => void} visit @param {any} [parent] */
function walk(node, visit, parent = null) {
  visit(node, parent);
  if (node.type === "split") for (const c of node.children) walk(c, visit, node);
}

describe("pane tree properties", () => {
  test("every split has ≥ 2 children whose ratios are positive and sum to 1, in canonical form", () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        walk(s.root, (n, parent) => {
          if (n.type !== "split") return;
          expect(n.children.length).toBeGreaterThanOrEqual(2);
          expect(n.ratios.length).toBe(n.children.length);
          for (const r of n.ratios) expect(r).toBeGreaterThan(0);
          expect(Math.abs(n.ratios.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-9);
          if (parent) expect(n.axis).not.toBe(parent.axis);
        });
      }),
    );
  });

  test("every leaf is reachable, pane and tab ids are unique, focus and zoom name existing leaves", () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        const panes = [];
        const tabs = [];
        walk(s.root, (n) => {
          if (n.type === "leaf") {
            panes.push(n.pane);
            tabs.push(n.tab);
          }
        });
        expect(leaves(s).map((l) => l.pane)).toEqual(panes);
        expect(new Set(panes).size).toBe(panes.length);
        expect(new Set(tabs).size).toBe(tabs.length);
        expect(panes).toContain(s.focus);
        if (s.zoom !== null) expect(panes).toContain(s.zoom);
      }),
    );
  });

  test("closePane(split(s, p)) restores s exactly, with focus on p", () => {
    fc.assert(
      fc.property(stateArb, fc.nat(), fc.constantFrom("vertical", "horizontal"), (s, pick, dir) => {
        const ls = leaves(s);
        const p = /** @type {any} */ (ls[pick % ls.length]).pane;
        const t = split(s, p, /** @type {any} */ (dir), "fresh-tab");
        const back = closePane(t, t.focus);
        expect(back.root).toEqual(s.root);
        expect(back.focus).toBe(p);
      }),
    );
  });

  const rectArb = fc.record({
    x: fc.integer({ min: -500, max: 500 }),
    y: fc.integer({ min: -500, max: 500 }),
    width: fc.integer({ min: 1, max: 4000 }),
    height: fc.integer({ min: 1, max: 4000 }),
  });

  test("layout tiles the rect: inside it, areas sum to it, every point in exactly one pane", () => {
    fc.assert(
      fc.property(
        stateArb,
        rectArb,
        fc.array(
          fc.tuple(
            fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
            fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
          ),
          { minLength: 1, maxLength: 20 },
        ),
        (s, r, points) => {
          const ls = layout(s, r);
          const eps = 1e-6 * Math.max(r.width, r.height);
          let area = 0;
          for (const { rect } of ls) {
            expect(rect.x).toBeGreaterThanOrEqual(r.x - eps);
            expect(rect.y).toBeGreaterThanOrEqual(r.y - eps);
            expect(rect.x + rect.width).toBeLessThanOrEqual(r.x + r.width + eps);
            expect(rect.y + rect.height).toBeLessThanOrEqual(r.y + r.height + eps);
            area += rect.width * rect.height;
          }
          expect(Math.abs(area - r.width * r.height)).toBeLessThan(1e-6 * r.width * r.height);
          for (const [u, v] of points) {
            const px = r.x + u * r.width;
            const py = r.y + v * r.height;
            // u < 1 can still round onto the far edge (-3 + 0.9999999999999998 === -2)
            if (px >= r.x + r.width || py >= r.y + r.height) continue;
            const hits = ls.filter(
              ({ rect }) =>
                px >= rect.x &&
                px < rect.x + rect.width &&
                py >= rect.y &&
                py < rect.y + rect.height,
            );
            expect(hits.length).toBe(1);
          }
        },
      ),
    );
  });

  test("focus(d) lands on a pane touching the start pane's d edge, and stays only when none does", () => {
    const unit = { x: 0, y: 0, width: 1, height: 1 };
    fc.assert(
      fc.property(stateArb, fc.constantFrom(...DIRS), (s0, d) => {
        const s = s0.zoom ? toggleZoom(s0) : s0;
        const rects = new Map(layout(s, unit).map((l) => [l.pane, l.rect]));
        const a = /** @type {any} */ (rects.get(s.focus));
        const eps = 1e-9;
        /** @param {any} b */
        const touches = (b) => {
          const ov = (
            /** @type {number} */ a0,
            /** @type {number} */ a1,
            /** @type {number} */ b0,
            /** @type {number} */ b1,
          ) => Math.min(a1, b1) - Math.max(a0, b0) > eps;
          if (d === "left")
            return (
              Math.abs(b.x + b.width - a.x) < eps && ov(a.y, a.y + a.height, b.y, b.y + b.height)
            );
          if (d === "right")
            return (
              Math.abs(a.x + a.width - b.x) < eps && ov(a.y, a.y + a.height, b.y, b.y + b.height)
            );
          if (d === "up")
            return (
              Math.abs(b.y + b.height - a.y) < eps && ov(a.x, a.x + a.width, b.x, b.x + b.width)
            );
          return Math.abs(a.y + a.height - b.y) < eps && ov(a.x, a.x + a.width, b.x, b.x + b.width);
        };
        const t = focus(s, d);
        const any = [...rects].some(([p, b]) => p !== s.focus && touches(b));
        if (t.focus === s.focus) expect(any).toBe(false);
        else expect(touches(rects.get(t.focus))).toBe(true);
      }),
    );
  });
});
