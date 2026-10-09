import { describe, test, expect } from "vitest";
import {
  COMMANDS,
  PENDING_ACTIONS,
  parseCommandLine,
  completeCommandLine,
  createHistory,
  pushHistory,
  historyPrevious,
  historyNext,
  resetHistoryCursor,
} from "../src/cmdline.mjs";
import { ACTIONS, getAction } from "../src/actions.mjs";

const run = (command, id, extra = {}) => ({
  kind: "run",
  command,
  action: { id, ...(extra.arg !== undefined ? { arg: extra.arg } : {}) },
  ...(extra.text !== undefined ? { text: extra.text } : {}),
});

describe("parseCommandLine: plan §2 commands", () => {
  test.each([
    [":tabnew", run("tabnew", "tab.new")],
    ["tabnew https://x.org/?q=1", run("tabnew", "tab.new", { text: "https://x.org/?q=1" })],
    [':tabrename "my  tab"', run("tabrename", "tab.rename", { text: "my  tab" })],
    [":tabrename my   tab ", run("tabrename", "tab.rename", { text: "my   tab" })],
    [":tabrename Juuso's tab", run("tabrename", "tab.rename", { text: "Juuso's tab" })],
    [":open https://x.com/?q=it's", run("open", "page.open", { text: "https://x.com/?q=it's" })],
    [":tabrename 'my tab'", run("tabrename", "tab.rename", { text: "my tab" })],
    [':workspace "my ws"', run("workspace", "workspace.switch", { text: "my ws" })],
    [':tabrename "a" and "b"', run("tabrename", "tab.rename", { text: '"a" and "b"' })],
    [':tabrename "oops', run("tabrename", "tab.rename", { text: '"oops' })],
    [":tabrename '", run("tabrename", "tab.rename", { text: "'" })],
    ["::q", run("q", "pane.close")],
    [" :: :tabnew x", run("tabnew", "tab.new", { text: "x" })],
    [":tabrename", run("tabrename", "tab.rename")],
    [":q", run("q", "pane.close")],
    [":quit", run("q", "pane.close")],
    [":vsplit", run("vsplit", "pane.split_vertical")],
    [":vs", run("vsplit", "pane.split_vertical")],
    [":split", run("split", "pane.split_horizontal")],
    [":sp", run("split", "pane.split_horizontal")],
    [":wsnext", run("wsnext", "workspace.next")],
    [":wsprev", run("wsprev", "workspace.previous")],
    [":workspace", run("workspace", "workspace.picker")],
    [":workspace work", run("workspace", "workspace.switch", { text: "work" })],
    [":ls", run("ls", "goto.picker")],
    [":sidebar", run("sidebar", "sidebar.toggle")],
    [":map", run("map", "help.show")],
    [":help", run("help", "help.show")],
    [":h", run("help", "help.show")],
    [":source", run("source", "config.reload")],
    [":open example.com", run("open", "page.open", { text: "example.com" })],
    ["  :  open   example.com  ", run("open", "page.open", { text: "example.com" })],
    [":TABNEW", run("tabnew", "tab.new")],
  ])("%j", (text, expected) => {
    expect(parseCommandLine(text)).toEqual(expected);
  });

  test.each([
    [":open", "missing-argument"],
    [':open ""', "missing-argument"],
    [":open ''", "missing-argument"],
    [":open    ", "missing-argument"],
    [":q now", "unexpected-argument"],
    [":map j k", "unexpected-argument"],
    [":ls x", "unexpected-argument"],
  ])("%j → %s", (text, code) => {
    const r = parseCommandLine(text);
    expect(r.kind).toBe("error");
    expect(r.error.code).toBe(code);
    expect(r.error.message).toEqual(expect.any(String));
    expect(r.error.suggestions).toEqual(expect.any(Array));
  });

  test(":map with arguments says bindings live in config.toml", () => {
    expect(parseCommandLine(":map j k").error.message).toMatch(/config\.toml/);
  });

  test.each(["", ":", "  :  ", "::"])("%j is empty", (text) => {
    expect(parseCommandLine(text)).toEqual({ kind: "empty" });
  });
});

describe("parseCommandLine: actions, abbreviations, errors", () => {
  test.each([
    [":scroll_down", run("scroll_down", "scroll.down")],
    [":tab.next", run("tab.next", "tab.next")],
    [":select_tab_3", run("select_tab_3", "tab.goto", { arg: 3 })],
    [":prev_workspace", run("prev_workspace", "workspace.previous")],
  ])("%j runs the action", (text, expected) => {
    expect(parseCommandLine(text)).toEqual(expected);
  });

  test("actions take no arguments", () => {
    expect(parseCommandLine(":scroll_down 3").error.code).toBe("unexpected-argument");
  });

  test("an ambiguous dotted id is unknown", () => {
    expect(parseCommandLine(":tab.goto").error.code).toBe("unknown-command");
  });

  test.each([
    [":tabr x", run("tabrename", "tab.rename", { text: "x" })],
    [":wsn", run("wsnext", "workspace.next")],
    [":sideb", run("sidebar", "sidebar.toggle")],
  ])("%j is a unique prefix", (text, expected) => {
    expect(parseCommandLine(text)).toEqual(expected);
  });

  test(":ws is ambiguous and lists the candidates", () => {
    const r = parseCommandLine(":ws");
    expect(r.error.code).toBe("ambiguous-command");
    expect([...r.error.suggestions].sort()).toEqual(["wsnext", "wsprev"]);
  });

  test(":tabnwe is unknown and suggests tabnew", () => {
    const r = parseCommandLine(":tabnwe");
    expect(r.error.code).toBe("unknown-command");
    expect(r.error.suggestions).toEqual(["tabnew"]);
    expect(r.error.message).toContain("tabnwe");
  });

  test(":scroll_dwn suggests scroll_down", () => {
    expect(parseCommandLine(":scroll_dwn").error.suggestions).toEqual(["scroll_down"]);
  });

  test("an unknown word with no near match suggests nothing", () => {
    expect(parseCommandLine(":xyzzyplugh").error.suggestions).toEqual([]);
  });

  test("results are frozen", () => {
    const r = parseCommandLine(":tabnew x");
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.action)).toBe(true);
  });
});

describe("command table", () => {
  const ids = new Set(ACTIONS.map((a) => a.id));

  test("every command maps to an action in actions.mjs or in PENDING_ACTIONS", () => {
    for (const c of COMMANDS) {
      for (const id of [c.action, c.textAction].filter(Boolean)) {
        expect(ids.has(id) || PENDING_ACTIONS.includes(id), `${c.name} → ${id}`).toBe(true);
      }
    }
  });

  test(":q's action says the last pane closes the tab (plan §2)", () => {
    expect(getAction("close_pane").description).toBe("Close pane; the last pane closes the tab");
  });

  test("PENDING_ACTIONS are exactly the missing ones, not yet in actions.mjs", () => {
    expect(PENDING_ACTIONS).toEqual([]);
    for (const id of PENDING_ACTIONS) expect(ids.has(id)).toBe(false);
  });

  test(":open's page.open is an action now (m1-cmdline): open_url, unbound by default", () => {
    expect(getAction("open_url")).toMatchObject({ id: "page.open", group: "Navigation" });
  });

  test("command names and aliases are unique and every command has a description", () => {
    const names = COMMANDS.flatMap((c) => [c.name, ...c.aliases]);
    expect(new Set(names).size).toBe(names.length);
    for (const c of COMMANDS) expect(c.description.length).toBeGreaterThan(0);
  });
});

describe("completeCommandLine", () => {
  const values = (text, opts) => completeCommandLine(text, opts).candidates.map((c) => c.value);

  test("tab → tabnew, tabrename first, then actions", () => {
    const v = values(":tab");
    expect(v.slice(0, 2)).toEqual(["tabnew", "tabrename"]);
    expect(completeCommandLine(":tab").word).toBe("tab");
    expect(completeCommandLine(":tab").candidates[2].kind).toBe("action");
  });

  test("wsp → wsprev", () => {
    expect(values("wsp")[0]).toBe("wsprev");
    expect(values("::wsp")[0]).toBe("wsprev");
  });

  test("fuzzy scd → scroll_down before scroll_half_down", () => {
    const v = values(":scd");
    expect(v).toContain("scroll_down");
    expect(v.indexOf("scroll_down")).toBeLessThan(v.indexOf("scroll_half_down"));
  });

  test("prefix matches come before fuzzy matches", () => {
    const v = values(":sp");
    expect(v[0]).toBe("sp");
    const firstFuzzy = v.findIndex((x) => !x.startsWith("sp"));
    expect(v.slice(firstFuzzy).every((x) => !x.startsWith("sp"))).toBe(true);
  });

  test("an empty word lists commands then actions, cut at limit", () => {
    const all = completeCommandLine(":", { limit: 1000 }).candidates;
    const commandCount = COMMANDS.reduce((n, c) => n + 1 + c.aliases.length, 0);
    expect(all).toHaveLength(commandCount + new Set(ACTIONS.map((a) => a.name)).size);
    expect(all.slice(0, commandCount).every((c) => c.kind === "command")).toBe(true);
    expect(values("")).toHaveLength(20);
    expect(values("", { limit: 3 })).toEqual(["open", "tabnew", "tabrename"]);
  });

  test("case-insensitive", () => {
    expect(values("TABN")[0]).toBe("tabnew");
  });

  test("after the command word there is nothing to complete", () => {
    expect(completeCommandLine(":tabnew x")).toEqual({ word: "tabnew", candidates: [] });
    expect(completeCommandLine(":tabnew ").candidates).toEqual([]);
  });

  test("each candidate has a description; an alias says what it is short for", () => {
    for (const c of completeCommandLine("", { limit: 1000 }).candidates) {
      expect(c.description.length).toBeGreaterThan(0);
    }
    const vs = completeCommandLine(":vs").candidates.find((c) => c.value === "vs");
    expect(vs.description).toContain("vsplit");
  });

  test("no match gives no candidates", () => {
    expect(values(":qqqqqqqq")).toEqual([]);
  });
});

describe("history", () => {
  const push = (h, ...lines) => lines.reduce(pushHistory, h);

  test("push trims, drops empty lines, dedupes to newest, honours limit", () => {
    let h = push(createHistory({ limit: 3 }), "a", "  ", " b ", "c", "a");
    expect(h.entries).toEqual(["b", "c", "a"]);
    h = pushHistory(h, "d");
    expect(h.entries).toEqual(["c", "a", "d"]);
    expect(createHistory().limit).toBe(100);
  });

  test("Up walks back saving the draft; Down returns to it", () => {
    let h = push(createHistory(), "tabnew", "ls", "source");
    let out = historyPrevious(h, "");
    expect(out.text).toBe("source");
    out = historyPrevious(out.history, out.text);
    expect(out.text).toBe("ls");
    out = historyNext(out.history, out.text);
    expect(out.text).toBe("source");
    out = historyNext(out.history, out.text);
    expect(out.text).toBe("");
    expect(out.history.index).toBe(null);
  });

  test("Up recalls only lines starting with the draft, and does not wrap", () => {
    const h = push(createHistory(), "tabnew a", "ls", "tabnew b");
    let out = historyPrevious(h, "tab");
    expect(out.text).toBe("tabnew b");
    out = historyPrevious(out.history, out.text);
    expect(out.text).toBe("tabnew a");
    out = historyPrevious(out.history, out.text);
    expect(out.text).toBe("tabnew a");
    out = historyNext(out.history, out.text);
    expect(out.text).toBe("tabnew b");
    out = historyNext(out.history, out.text);
    expect(out.text).toBe("tab");
  });

  test("Up with no match keeps the current text; Down with no cursor returns it", () => {
    const h = push(createHistory(), "ls");
    expect(historyPrevious(h, "zz").text).toBe("zz");
    expect(historyNext(h, "typed")).toEqual({ history: h, text: "typed" });
    expect(historyPrevious(createHistory(), "x").text).toBe("x");
  });

  test("reset clears the cursor; push resets it too", () => {
    const h = push(createHistory(), "ls", "q");
    const up = historyPrevious(h, "").history;
    expect(up.index).not.toBe(null);
    expect(resetHistoryCursor(up)).toMatchObject({ index: null, draft: "" });
    expect(pushHistory(up, "x")).toMatchObject({ index: null, draft: "" });
  });

  test("histories are frozen and never mutated", () => {
    const h = createHistory();
    pushHistory(h, "a");
    expect(h.entries).toEqual([]);
    expect(Object.isFrozen(h)).toBe(true);
  });

  test("a bad limit throws", () => {
    expect(() => createHistory({ limit: 0 })).toThrow(RangeError);
    expect(() => createHistory({ limit: 1.5 })).toThrow(RangeError);
  });
});
