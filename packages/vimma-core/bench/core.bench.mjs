// plan §5: key-to-action in core < 50 µs. `npm run bench`; not a CI gate yet.
import { test, expect } from "vitest";
import { createDispatcher } from "../src/dispatcher.mjs";
import { compileKeymap } from "../src/keymap.mjs";
import { parseKey } from "../src/keys.mjs";
import { createPanes, focus, split } from "../src/panes.mjs";
import { createWorkspaces, openTab, selectTab, splitPane, withPanes } from "../src/workspaces.mjs";

const BUDGET_MS = 0.05;

const d = createDispatcher(compileKeymap());
const ctrlB = parseKey("ctrl+b");
const c = parseKey("c");
const g = parseKey("g");
const t = parseKey("t");

let panes = createPanes("t0");
for (let i = 1; i < 8; i++) {
  panes = split(panes, panes.focus, i % 2 ? "vertical" : "horizontal", `t${i}`);
}

let ws = createWorkspaces([
  { name: "work", container: "c1" },
  { name: "personal", container: "c2" },
]);
for (let i = 0; i < 30; i++) ws = openTab(ws, `tab${i}`);
ws = splitPane(ws, "vertical", "split-tab");

test("key to action stays under 50 µs", async ({ bench }) => {
  const r = await bench.compare(
    bench("prefix chord: ctrl+b c → tab.new", () => {
      d.dispatch("normal", ctrlB);
      d.dispatch("normal", c);
    }),
    bench("modal sequence: g t → tab.next", () => {
      d.dispatch("normal", g);
      d.dispatch("normal", t);
    }),
  );
  expect(r.get("prefix chord: ctrl+b c → tab.new").latency.mean).toBeLessThan(BUDGET_MS);
  expect(r.get("modal sequence: g t → tab.next").latency.mean).toBeLessThan(BUDGET_MS);
});

test("pane and workspace updates stay under 50 µs", async ({ bench }) => {
  const r = await bench.compare(
    bench("pane focus left in an 8-pane tree", () => {
      focus(panes, "left");
    }),
    bench("withPanes focus + selectTab in a 30-tab workspace", () => {
      selectTab(
        withPanes(ws, (p) => focus(p, "left")),
        "tab3",
      );
    }),
  );
  expect(r.get("pane focus left in an 8-pane tree").latency.mean).toBeLessThan(BUDGET_MS);
  expect(r.get("withPanes focus + selectTab in a 30-tab workspace").latency.mean).toBeLessThan(
    BUDGET_MS,
  );
});
