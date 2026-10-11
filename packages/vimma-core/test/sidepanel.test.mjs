import { describe, test, expect } from "vitest";
import {
  PINNED_MARK_TEXT,
  inRange,
  markSummary,
  markedRows,
  openPanel,
  panelKey,
  refreshPanel,
} from "../src/sidepanel.mjs";
import { compileKeymap } from "../src/keymap.mjs";
import { createDispatcher } from "../src/dispatcher.mjs";
import { parseKey } from "../src/keys.mjs";

/** @import { PanelState, PanelTabInfo } from "../src/sidepanel.mjs" */

const model = {
  active: "w2",
  next: 4,
  workspaces: [
    { id: "w1", name: "work", container: "1", tabs: ["t1"], activeTab: "t1", panes: null },
    {
      id: "w2",
      name: "admin",
      container: "2",
      tabs: ["t2", "t3", "t4"],
      activeTab: "t3",
      panes: null,
    },
    { id: "w3", name: "personal", container: "3", tabs: [], activeTab: null, panes: null },
  ],
};

/** @type {Record<string, PanelTabInfo>} */
const tabs = {
  t1: { title: "GitHub", url: "https://github.com/" },
  t2: { title: "Mail", url: "https://mail.example.com/inbox" },
  t3: { title: "", url: "about:blank", label: "scratch", playing: true },
  t4: { title: "Bank", url: "https://bank.fi/", foreign: true },
};
const info = (/** @type {string} */ id) => tabs[id];

/**
 * @param {PanelState} s
 * @param {{ id: string, arg?: number }[]} actions
 */
function press(s, actions) {
  /** @type {ReturnType<typeof panelKey>["effect"]} */
  let effect = null;
  for (const a of actions) ({ state: s, effect } = panelKey(s, a));
  return { state: s, effect };
}

describe("openPanel", () => {
  test("Given the active workspace, then the header names it and its ctrl+u / ctrl+i neighbours", () => {
    const s = openPanel(model, info, { color: "green" });
    expect(s.workspace).toEqual({ id: "w2", name: "admin", index: 2, color: "green" });
    expect(s.previous).toBe("work");
    expect(s.next).toBe("personal");
  });

  test("Given its tabs, then one numbered row each: label, host, active, foreign, playing", () => {
    const s = openPanel(model, info);
    expect(s.rows).toEqual([
      {
        tabId: "t2",
        number: 1,
        display: "Mail",
        host: "mail.example.com",
        active: false,
        foreign: false,
        playing: false,
        pinned: false,
      },
      {
        tabId: "t3",
        number: 2,
        display: "scratch",
        host: "about:blank",
        active: true,
        foreign: false,
        playing: true,
        pinned: false,
      },
      {
        tabId: "t4",
        number: 3,
        display: "Bank",
        host: "bank.fi",
        active: false,
        foreign: true,
        playing: false,
        pinned: false,
      },
    ]);
  });

  test("Given no selection asked for, then the active tab's row is highlighted", () => {
    expect(openPanel(model, info).selected).toBe(1);
  });

  test("Given the last workspace, then the neighbours wrap as ctrl+i / ctrl+u do", () => {
    const s = openPanel({ ...model, active: "w3" }, info);
    expect([s.previous, s.next]).toEqual(["admin", "work"]);
    expect(s.rows).toEqual([]);
    expect(s.selected).toBe(0);
  });

  test("Given one workspace, then it has no neighbours", () => {
    const one = { ...model, active: "w1", workspaces: [model.workspaces[0]] };
    const s = openPanel(one, info);
    expect([s.previous, s.next]).toEqual([null, null]);
  });

  test("Given the private workspace, then its head says so and its neighbours are the host's", () => {
    const priv = {
      active: "◆ private",
      next: 1,
      workspaces: [
        {
          id: "◆ private",
          name: "private",
          container: "",
          tabs: ["t1", "t2"],
          activeTab: "t2",
          panes: null,
        },
      ],
    };
    const s = openPanel(priv, info, { private: true, neighbours: ["home", "work"] });
    expect(s.workspace).toMatchObject({ id: "◆ private", name: "private", private: true });
    expect([s.previous, s.next]).toEqual(["home", "work"]);
    expect(s.rows.map((r) => r.tabId)).toEqual(["t1", "t2"]);
    const again = refreshPanel(s, priv, info, { private: true, neighbours: ["home", "work"] });
    expect(again.workspace.private).toBe(true);
    expect([again.previous, again.next]).toEqual(["home", "work"]);
  });

  test("Given a tab the host no longer knows, then its row still says something", () => {
    const s = openPanel({ ...model, active: "w1" }, () => undefined);
    expect(s.rows[0]).toMatchObject({ display: "New Tab", host: "" });
  });
});

describe("panelKey", () => {
  const s = openPanel(model, info);

  test("j / k move the highlight and stop at the ends", () => {
    expect(press(s, [{ id: "panel.down" }]).state.selected).toBe(2);
    expect(press(s, [{ id: "panel.down" }, { id: "panel.down" }]).state.selected).toBe(2);
    expect(press(s, [{ id: "panel.up" }, { id: "panel.up" }]).state.selected).toBe(0);
  });

  test("Enter selects the highlighted tab", () => {
    expect(press(s, [{ id: "panel.up" }, { id: "panel.open" }]).effect).toEqual({
      type: "select",
      id: "t2",
    });
  });

  test("a digit selects that row's tab", () => {
    expect(press(s, [{ id: "panel.select", arg: 3 }]).effect).toEqual({ type: "select", id: "t4" });
  });

  test("a digit past the last row selects nothing and says so", () => {
    const { state, effect } = press(s, [{ id: "panel.select", arg: 4 }]);
    expect(state).toBe(s);
    expect(effect).toEqual({ type: "refuse", text: "no tab 4 in admin" });
  });

  test("Enter in an empty workspace does nothing", () => {
    const empty = openPanel({ ...model, active: "w3" }, info);
    expect(press(empty, [{ id: "panel.open" }]).effect).toBeNull();
  });

  test("Esc closes", () => {
    expect(press(s, [{ id: "panel.close" }]).effect).toEqual({ type: "close" });
  });

  test("an action that is not the panel's leaves it as it is", () => {
    expect(press(s, [{ id: "tab.new" }])).toEqual({ state: s, effect: null });
  });

  // docs/specs/key-handling-batch.md § 4
  test("x closes the highlighted tab and moves the highlight to the next row", () => {
    const { state, effect } = press(s, [{ id: "panel.up" }, { id: "panel.close_tab" }]);
    expect(effect).toEqual({ type: "closeTab", id: "t2" });
    expect(state.rows[state.selected].tabId).toBe("t3");
  });

  test("x on the last row moves the highlight to the row before it", () => {
    const { state, effect } = press(s, [{ id: "panel.down" }, { id: "panel.close_tab" }]);
    expect(effect).toEqual({ type: "closeTab", id: "t4" });
    expect(state.rows[state.selected].tabId).toBe("t3");
  });

  test("x after the refresh closes the next tab: three x close three rows", () => {
    let state = press(s, [{ id: "panel.up" }]).state;
    const closed = [];
    let left = model;
    for (let i = 0; i < 3; i++) {
      const r = panelKey(state, { id: "panel.close_tab" });
      closed.push(/** @type {any} */ (r.effect).id);
      left = {
        ...left,
        workspaces: left.workspaces.map((w) =>
          w.id === "w2" ? { ...w, tabs: w.tabs.filter((t) => t !== closed.at(-1)) } : w,
        ),
      };
      state = refreshPanel(r.state, left, info);
    }
    expect(closed).toEqual(["t2", "t3", "t4"]);
    expect(state.rows).toEqual([]);
  });

  test("x on a pinned tab refuses and closes nothing", () => {
    const pinned = openPanel(model, (id) => ({ ...tabs[id], pinned: id === "t3" }));
    expect(pinned.rows[1].pinned).toBe(true);
    const { state, effect } = press(pinned, [{ id: "panel.close_tab" }]);
    expect(state).toBe(pinned);
    expect(effect).toEqual({ type: "refuse", text: "pinned tab: unpin it to close it" });
  });

  test("x in an empty workspace does nothing", () => {
    const empty = openPanel({ ...model, active: "w3" }, info);
    expect(press(empty, [{ id: "panel.close_tab" }]).effect).toBeNull();
  });
});

describe("refreshPanel", () => {
  test("Given the highlighted tab is still listed, then the highlight stays on it", () => {
    const s = press(openPanel(model, info), [{ id: "panel.down" }]).state;
    const moved = {
      ...model,
      workspaces: model.workspaces.map((w) =>
        w.id === "w2" ? { ...w, tabs: ["t5", "t2", "t3", "t4"] } : w,
      ),
    };
    const next = refreshPanel(s, moved, info);
    expect(next.rows[next.selected].tabId).toBe("t4");
  });

  test("Given another workspace (ctrl+i), then it lists that one, its active tab highlighted", () => {
    const s = press(openPanel(model, info), [{ id: "panel.down" }]).state;
    const next = refreshPanel(s, { ...model, active: "w1" }, info, { color: "blue" });
    expect(next.workspace).toEqual({ id: "w1", name: "work", index: 1, color: "blue" });
    expect(next.rows.map((r) => r.tabId)).toEqual(["t1"]);
    expect(next.selected).toBe(0);
  });
});

describe("panel keys in the keymap", () => {
  const keymap = compileKeymap();
  /**
   * @param {string} mode
   * @param {string} keys
   */
  const feed = (mode, keys) => {
    const d = createDispatcher(keymap);
    return keys.split(" ").map((k) => d.dispatch(/** @type {any} */ (mode), parseKey(k)));
  };

  test("space n (a leader binding from config.toml) closes the panel from panel mode", () => {
    const d = createDispatcher(
      compileKeymap({ keys: { toggle_sidebar: ["prefix+b", "<leader>n"] } }),
    );
    const r = ["space", "n"].map((k) => d.dispatch("panel", parseKey(k)));
    expect(r.at(-1)).toEqual({
      kind: "action",
      action: { id: "sidebar.toggle" },
    });
  });

  test("prefix b toggles it from panel mode", () => {
    expect(feed("panel", "ctrl+b b").at(-1)).toMatchObject({ action: { id: "sidebar.toggle" } });
  });

  test("x closes the tab and ctrl+shift+t reopens one in panel mode; 3 still selects row 3", () => {
    expect(feed("panel", "x")[0]).toEqual({ kind: "action", action: { id: "panel.close_tab" } });
    expect(feed("panel", "ctrl+shift+t")[0]).toEqual({
      kind: "action",
      action: { id: "tab.restore" },
    });
    expect(feed("panel", "3 x")).toEqual([
      { kind: "action", action: { id: "panel.select", arg: 3 } },
      { kind: "action", action: { id: "panel.close_tab" } },
    ]);
  });

  test("leader bindings still do not fire in insert mode", () => {
    expect(feed("insert", "space")[0]).toEqual({ kind: "pass" });
  });
});

// docs/specs/m4-side-panel-multiselect.md: marks, a line-wise range, and Enter showing the
// marked tabs together as panes.
describe("marks", () => {
  const five = {
    ...model,
    workspaces: model.workspaces.map((w) =>
      w.id === "w2" ? { ...w, tabs: ["t2", "t3", "t4", "t5", "t6"], activeTab: "t2" } : w,
    ),
  };
  /** @type {Record<string, PanelTabInfo>} */
  const more = { ...tabs, t5: { title: "Docs" }, t6: { title: "Pinned", pinned: true } };
  const info5 = (/** @type {string} */ id) => more[id];
  const open = () => openPanel(five, info5);
  /**
   * @param {string[]} list
   * @returns {typeof five}
   */
  const withTabs = (list) => ({
    ...five,
    workspaces: five.workspaces.map((w) => (w.id === "w2" ? { ...w, tabs: list } : w)),
  });
  const SPACE = { id: "panel.mark" };
  const V = { id: "panel.visual" };
  const J = { id: "panel.down" };
  const K = { id: "panel.up" };
  const ENTER = { id: "panel.open" };
  const ESC = { id: "panel.close" };

  test("a new panel has no marks and no range", () => {
    const s = open();
    expect(s.marked).toEqual([]);
    expect(s.anchor).toBeNull();
    expect(markSummary(s)).toBe("");
  });

  test("space marks the highlighted row and moves down; space again on it unmarks", () => {
    let { state } = press(open(), [SPACE, SPACE]);
    expect(state.marked).toEqual(["t2", "t3"]);
    expect(state.selected).toBe(2);
    expect(markSummary(state)).toBe("2 marked");
    ({ state } = press(state, [K, SPACE]));
    expect(state.marked).toEqual(["t2"]);
    expect(markSummary(state)).toBe("1 marked");
  });

  test("space on the last row marks it and stays there", () => {
    const once = press(openPanel(model, info), [J, SPACE]).state;
    expect(once.marked).toEqual(["t4"]);
    expect(once.selected).toBe(2);
    expect(press(once, [SPACE]).state.marked).toEqual([]);
  });

  test("space on a pinned row refuses and marks nothing", () => {
    const { state, effect } = press(open(), [J, J, J, J, SPACE]);
    expect(state.marked).toEqual([]);
    expect(effect).toEqual({ type: "refuse", text: PINNED_MARK_TEXT });
  });

  test("V starts a range that j / k stretch; V again marks every row in it", () => {
    let { state } = press(open(), [J, V, J, J]);
    expect(state.anchor).toBe("t3");
    expect(inRange(state, 0)).toBe(false);
    expect([1, 2, 3].map((i) => inRange(state, i))).toEqual([true, true, true]);
    expect(inRange(state, 4)).toBe(false);
    expect(markSummary(state)).toBe("range: 3");
    ({ state } = press(state, [V]));
    expect(state.anchor).toBeNull();
    expect(state.marked).toEqual(["t3", "t4", "t5"]);
    expect(markSummary(state)).toBe("3 marked");
  });

  test("a range upward, ended by space, adds to the marks already there", () => {
    const { state } = press(open(), [SPACE, J, V, K, SPACE]);
    expect(state.marked).toEqual(["t2", "t3", "t4"]);
    expect(state.anchor).toBeNull();
    expect(state.selected).toBe(1);
  });

  test("a range skips a pinned row", () => {
    const { state, effect } = press(open(), [J, J, J, V, J, V]);
    expect(state.marked).toEqual(["t5"]);
    expect(effect).toBeNull();
  });

  test("the summary counts the range and the marks while both exist", () => {
    const { state } = press(open(), [SPACE, V, J]);
    expect(markSummary(state)).toBe("range: 2 · 1 marked");
  });

  test("Esc ends the range first, then clears the marks, then closes", () => {
    let r = press(open(), [SPACE, V, J, ESC]);
    expect(r.state.anchor).toBeNull();
    expect(r.state.marked).toEqual(["t2"]);
    expect(r.effect).toBeNull();
    r = press(r.state, [ESC]);
    expect(r.state.marked).toEqual([]);
    expect(r.effect).toBeNull();
    r = press(r.state, [ESC]);
    expect(r.effect).toEqual({ type: "close" });
  });

  test("Enter with two marks or more shows them together, in row order", () => {
    const { effect } = press(open(), [J, J, SPACE, K, K, K, SPACE, ENTER]);
    expect(effect).toEqual({ type: "together", ids: ["t2", "t4"], focus: "t2" });
  });

  test("Enter focuses the highlighted row when it is marked, else the first marked", () => {
    const on = press(open(), [SPACE, SPACE, SPACE, K, K, ENTER]).effect;
    expect(on).toEqual({ type: "together", ids: ["t2", "t3", "t4"], focus: "t3" });
    const off = press(open(), [J, SPACE, SPACE, ENTER]).effect;
    expect(off).toEqual({ type: "together", ids: ["t3", "t4"], focus: "t3" });
  });

  test("Enter with one mark goes to that tab, as Enter on its row", () => {
    const { effect } = press(open(), [J, SPACE, J, ENTER]);
    expect(effect).toEqual({ type: "select", id: "t3" });
  });

  test("Enter in a range marks it, then shows the marks together", () => {
    const { effect } = press(open(), [V, J, J, ENTER]);
    expect(effect).toEqual({ type: "together", ids: ["t2", "t3", "t4"], focus: "t4" });
  });

  test("Enter without marks still goes to the highlighted tab; a digit ignores the marks", () => {
    expect(press(open(), [J, ENTER]).effect).toEqual({ type: "select", id: "t3" });
    expect(press(open(), [SPACE, SPACE, { id: "panel.select", arg: 4 }]).effect).toEqual({
      type: "select",
      id: "t5",
    });
  });

  test("x keeps the marks of the other rows; the refresh drops a closed tab's mark", () => {
    let { state } = press(open(), [SPACE, SPACE, K]);
    expect(state.marked).toEqual(["t2", "t3"]);
    ({ state } = press(state, [{ id: "panel.close_tab" }]));
    state = refreshPanel(state, withTabs(["t2", "t4", "t5", "t6"]), info5);
    expect(state.marked).toEqual(["t2"]);
  });

  test("a refresh in the same workspace keeps marks and the range on listed tabs", () => {
    const s = press(open(), [SPACE, V]).state;
    const next = refreshPanel(s, five, info5);
    expect(next.marked).toEqual(["t2"]);
    expect(next.anchor).toBe("t3");
  });

  test("a refresh whose range anchor closed ends the range", () => {
    const s = press(open(), [J, V, J]).state;
    expect(refreshPanel(s, withTabs(["t2", "t4", "t5", "t6"]), info5).anchor).toBeNull();
  });

  test("marks follow their tabs when the order changes, and stay in row order", () => {
    const s = press(open(), [SPACE, J, SPACE]).state;
    expect(s.marked).toEqual(["t2", "t4"]);
    expect(refreshPanel(s, withTabs(["t4", "t3", "t2", "t5", "t6"]), info5).marked).toEqual([
      "t4",
      "t2",
    ]);
  });

  test("another workspace (ctrl+b )) clears the marks and the range", () => {
    const s = press(open(), [SPACE, V]).state;
    const next = refreshPanel(s, { ...five, active: "w1" }, info5);
    expect(next.marked).toEqual([]);
    expect(next.anchor).toBeNull();
  });

  test("markedRows lists the marked rows in row order", () => {
    const s = press(open(), [J, J, SPACE, K, K, K, SPACE]).state;
    expect(markedRows(s).map((r) => r.tabId)).toEqual(["t2", "t4"]);
  });

  test("the default keys: space marks, V starts a range, in panel mode", () => {
    const d = createDispatcher(compileKeymap());
    expect(d.dispatch("panel", parseKey("space"))).toEqual({
      kind: "action",
      action: { id: "panel.mark" },
    });
    expect(d.dispatch("panel", parseKey("V"))).toEqual({
      kind: "action",
      action: { id: "panel.visual" },
    });
  });

  test("they are rebindable under [modal.panel]", () => {
    const d = createDispatcher(
      compileKeymap({ modal: { panel: { m: "panel_mark", v: "panel_visual" } } }),
    );
    expect(d.dispatch("panel", parseKey("m"))).toEqual({
      kind: "action",
      action: { id: "panel.mark" },
    });
    expect(d.dispatch("panel", parseKey("v"))).toEqual({
      kind: "action",
      action: { id: "panel.visual" },
    });
  });

  test("with a leader binding added, space waits for the next key and then marks", () => {
    const d = createDispatcher(
      compileKeymap({ keys: { toggle_sidebar: ["prefix+b", "<leader>n"] } }),
    );
    expect(d.dispatch("panel", parseKey("space"))).toEqual({ kind: "pending" });
    expect(d.ambiguous()).toBe(true);
    expect(d.flush()).toEqual({ kind: "action", action: { id: "panel.mark" } });
  });
});
