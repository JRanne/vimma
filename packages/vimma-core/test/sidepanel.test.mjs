import { describe, test, expect } from "vitest";
import { openPanel, panelKey, refreshPanel } from "../src/sidepanel.mjs";
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
      },
      {
        tabId: "t3",
        number: 2,
        display: "scratch",
        host: "about:blank",
        active: true,
        foreign: false,
        playing: true,
      },
      {
        tabId: "t4",
        number: 3,
        display: "Bank",
        host: "bank.fi",
        active: false,
        foreign: true,
        playing: false,
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

  test("leader bindings still do not fire in insert mode", () => {
    expect(feed("insert", "space")[0]).toEqual({ kind: "pass" });
  });
});
