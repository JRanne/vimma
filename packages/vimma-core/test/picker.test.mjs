import { describe, test, expect } from "vitest";
import fc from "fast-check";
import {
  TIER,
  filterItems,
  matchItem,
  openPicker,
  pickerItems,
  pickerKey,
  pickerSelection,
  scoreField,
  setPickerItems,
  workspaceItems,
} from "../src/picker.mjs";

/** @import { PickerState, PickerItem } from "../src/picker.mjs" */

const workspaces = {
  active: "w1",
  workspaces: [
    { id: "w1", name: "work", tabs: ["t1", "t2"], activeTab: "t2" },
    { id: "w2", name: "personal", tabs: ["t3", "t4"], activeTab: "t3" },
  ],
};
/** @type {Record<string, { title: string, url: string }>} */
const info = {
  t1: { title: "GitHub", url: "https://github.com/" },
  t2: { title: "Mail", url: "https://mail.example.com/" },
  t3: { title: "Recipes", url: "https://recipes.org/" },
  t4: { title: "Bank", url: "https://bank.fi/" },
};
const items = pickerItems(workspaces, (id) => info[id], { t3: "cook" });

/**
 * @param {PickerState} s
 * @param {string[]} keys
 */
function press(s, keys) {
  /** @type {ReturnType<typeof pickerKey>["effect"]} */
  let effect = null;
  for (const k of keys) ({ state: s, effect } = pickerKey(s, k));
  return { state: s, effect };
}

/** @param {PickerState} s */
const selectedTab = (s) => pickerSelection(s)?.item.tabId;

describe("scoring", () => {
  test("tiers", () => {
    expect(scoreField("GitHub", "github")?.tier).toBe(TIER.exact);
    expect(scoreField("GitHub", "git")?.tier).toBe(TIER.prefix);
    expect(scoreField("my-github", "git")?.tier).toBe(TIER.word);
    expect(scoreField("GitHub", "hub")?.tier).toBe(TIER.word);
    expect(scoreField("GitHub", "thub")?.tier).toBe(TIER.substring);
    expect(scoreField("GitHub", "ghb")).toMatchObject({
      tier: TIER.subsequence,
      ranges: [
        [0, 1],
        [3, 4],
        [5, 6],
      ],
    });
    expect(scoreField("GitHub", "xyz")).toBeNull();
    expect(scoreField("GitHub", "")).toBeNull();
  });

  test("case folds per character, so one special letter does not disable the rest", () => {
    expect(scoreField("İstanbul GitHub", "git")).toMatchObject({
      tier: TIER.word,
      ranges: [[9, 12]],
    });
    expect(scoreField("İstanbul", "i̇stanbul")?.tier).toBe(TIER.exact);
    expect(scoreField("GROSSE Straße", "straße")).toMatchObject({
      tier: TIER.word,
      ranges: [[7, 13]],
    });
    expect(scoreField("Straße", "STRAẞE")?.tier).toBe(TIER.exact);
  });

  test("text and query are compared in NFC, with ranges in the original text", () => {
    const nfd = "Ka\u0308ytta\u0308ja\u0308t";
    expect(scoreField(nfd, "kä")).toMatchObject({ tier: TIER.prefix, ranges: [[0, 3]] });
    expect(scoreField("Käyttäjät", "ka\u0308")).toMatchObject({
      tier: TIER.prefix,
      ranges: [[0, 2]],
    });
  });

  test("diacritics: exact letters first, a folded match ranks below every exact tier", () => {
    expect(scoreField("Käyttäjät", "ka")).toMatchObject({ tier: TIER.folded, ranges: [[0, 2]] });
    expect(scoreField("Käyttäjät", "kayttajat")?.tier).toBe(TIER.folded);
    const exact = /** @type {{ score: number }} */ (scoreField("Käyttäjät", "kä"));
    const folded = /** @type {{ score: number }} */ (scoreField("Käyttäjät", "ka"));
    expect(exact.score).toBeGreaterThan(folded.score);
    // a folded match in the best field still loses to an exact subsequence in the worst one
    const sub = /** @type {{ score: number }} */ (scoreField("x-k-y-a", "ka", "workspace"));
    expect(sub.score).toBeGreaterThan(folded.score);
    expect(scoreField("Käyttäjät", "kö")).toBeNull();
  });

  test("tiers beat fields: a URL prefix match outranks a title word match", () => {
    const url = /** @type {{ score: number }} */ (scoreField("github.com/x", "git", "url"));
    const title = /** @type {{ score: number }} */ (scoreField("My github", "git", "title"));
    expect(url.score).toBeGreaterThan(title.score);
  });

  test("subsequence prefers the tightest alignment", () => {
    expect(scoreField("a-x-b ab", "ab")?.tier).toBe(TIER.word);
    expect(scoreField("axxb ayb", "ab")?.ranges).toEqual([
      [5, 6],
      [7, 8],
    ]);
  });

  test("items list every tab in workspace order, with display labels", () => {
    expect(
      items.map((i) => [i.tabId, i.workspaceName, i.workspaceIndex, i.tabIndex, i.display]),
    ).toEqual([
      ["t1", "work", 1, 1, "GitHub"],
      ["t2", "work", 1, 2, "Mail"],
      ["t3", "personal", 2, 1, "cook"],
      ["t4", "personal", 2, 2, "Bank"],
    ]);
    expect(items.filter((i) => i.active).map((i) => i.tabId)).toEqual(["t2"]);
    const bare = pickerItems(workspaces, () => undefined, {});
    expect(bare[0]).toMatchObject({ title: "", url: "", label: null, display: "New Tab" });
  });

  test("matches rename, title, URL and workspace", () => {
    const cook = filterItems(items, "cook");
    expect(cook.map((m) => m.item.tabId)).toEqual(["t3"]);
    expect(cook[0]?.highlights.display).toEqual([[0, 4]]);
    expect(filterItems(items, "recipes")[0]?.item.tabId).toBe("t3");
    expect(filterItems(items, "recipes")[0]?.highlights.title).toEqual([[0, 7]]);
    expect(filterItems(items, "personal").map((m) => m.item.tabId)).toEqual(["t3", "t4"]);
    expect(filterItems(items, "  work   mail ").map((m) => m.item.tabId)).toEqual(["t2"]);
    expect(filterItems(items, "github.com")[0]?.highlights.url).toEqual([[8, 18]]);
    expect(matchItem(/** @type {PickerItem} */ (items[0]), "zzz")).toBeNull();
  });

  test("a blank query lists everything in order; ties keep input order", () => {
    expect(filterItems(items, " ").map((m) => [m.item.tabId, m.score])).toEqual([
      ["t1", 0],
      ["t2", 0],
      ["t3", 0],
      ["t4", 0],
    ]);
    const twins = pickerItems(
      {
        active: "w1",
        workspaces: [{ id: "w1", name: "a", tabs: ["x", "y", "z"], activeTab: "x" }],
      },
      () => ({ title: "Docs", url: "https://docs.rs/" }),
      {},
    );
    expect(filterItems(twins, "doc").map((m) => m.item.tabId)).toEqual(["x", "y", "z"]);
  });
});

describe("picker state machine", () => {
  test("opens in browse mode on the active tab; j/k/arrows/ctrl-n/p move and clamp", () => {
    const s = openPicker(items, { activeId: "t2" });
    expect(s.mode).toBe("browse");
    expect(s.query).toBe("");
    expect(selectedTab(s)).toBe("t2");
    expect(selectedTab(press(s, ["j"]).state)).toBe("t3");
    expect(selectedTab(press(s, ["j", "down", "ctrl+n"]).state)).toBe("t4");
    expect(selectedTab(press(s, ["k", "up"]).state)).toBe("t1");
    const top = press(s, ["ctrl+p"]).state;
    expect(selectedTab(top)).toBe("t1");
    expect(pickerKey(top, "ctrl+p").state).toBe(top);
    expect(selectedTab(openPicker(items, {}))).toBe("t1");
  });

  test("left/right jump between workspace sections", () => {
    const s = openPicker(items, { activeId: "t1" });
    const r = press(s, ["right"]).state;
    expect(selectedTab(r)).toBe("t3");
    expect(pickerKey(r, "right").state).toBe(r);
    expect(selectedTab(press(r, ["left"]).state)).toBe("t1");
    expect(selectedTab(press(r, ["j", "left"]).state)).toBe("t3");
    expect(pickerKey(s, "left").state).toBe(s);
    const filtered = press(s, ["/", "a", "esc"]).state;
    expect(pickerKey(filtered, "right").state).toBe(filtered);
  });

  test("/ searches; typing filters; editing keys; esc backs out then closes", () => {
    const s = openPicker(items, { activeId: "t1" });
    let r = press(s, ["/", "g", "i", "t"]).state;
    expect(r.mode).toBe("search");
    expect(r.query).toBe("git");
    expect(r.matches.map((m) => m.item.tabId)).toEqual(["t1"]);
    r = press(r, ["backspace"]).state;
    expect(r.query).toBe("gi");
    r = press(r, ["ctrl+w"]).state;
    expect(r.query).toBe("");
    r = press(r, ["w", "o", "r", "k", "space", "shift+m", "a", "i", "l"]).state;
    expect(r.query).toBe("work Mail");
    expect(selectedTab(r)).toBe("t2");
    expect(press(r, ["ctrl+w"]).state.query).toBe("work ");
    expect(press(r, ["ctrl+u"]).state.query).toBe("");
    const back = press(r, ["esc"]);
    expect(back.effect).toBeNull();
    expect(back.state.mode).toBe("browse");
    expect(back.state.query).toBe("work Mail");
    expect(press(back.state, ["esc"]).effect).toEqual({ type: "close" });
    expect(press(s, ["q"]).effect).toEqual({ type: "close" });
  });

  test("in search, j and k type; arrows and ctrl-n/p move", () => {
    const s = press(openPicker(items, {}), ["/", "j", "k"]).state;
    expect(s.query).toBe("jk");
    const t = press(openPicker(items, {}), ["/", "a", "down"]).state;
    expect(t.selected).toBe(1);
    expect(press(t, ["ctrl+p"]).state.selected).toBe(0);
  });

  test("enter selects; nothing to select is a no-op; unknown keys are ignored", () => {
    const s = openPicker(items, { activeId: "t1" });
    expect(press(s, ["j", "enter"]).effect).toEqual({ type: "select", id: "t2" });
    expect(press(s, ["/", "c", "o", "o", "k", "enter"]).effect).toEqual({
      type: "select",
      id: "t3",
    });
    const none = press(s, ["/", "z", "z", "z"]).state;
    expect(none.matches).toEqual([]);
    expect(pickerSelection(none)).toBeUndefined();
    expect(pickerKey(none, "enter")).toEqual({ state: none, effect: null });
    expect(pickerKey(none, "down").state).toBe(none);
    expect(pickerKey(s, "x").state).toBe(s);
    expect(pickerKey(s, "ctrl+x").state).toBe(s);
    const searching = press(s, ["/"]).state;
    expect(pickerKey(searching, "ctrl+x").state).toBe(searching);
    expect(pickerKey(searching, "backspace").state).toBe(searching);
    expect(pickerKey(searching, "f5").state).toBe(searching);
  });

  test("setPickerItems keeps the selected tab, or clamps", () => {
    const s = openPicker(items, { activeId: "t3" });
    const without1 = setPickerItems(
      s,
      items.filter((i) => i.tabId !== "t1"),
    );
    expect(selectedTab(without1)).toBe("t3");
    const last = openPicker(items, { activeId: "t4" });
    expect(selectedTab(setPickerItems(last, items.slice(0, 2)))).toBe("t2");
    expect(setPickerItems(last, []).selected).toBe(0);
  });
});

describe("properties", () => {
  const text = fc.string({ minLength: 1, maxLength: 24 });
  const field = fc.constantFrom("display", "title", "url", "workspace");

  /** @param {string} q @param {string} s */
  const isSubsequence = (q, s) => {
    let i = 0;
    for (const ch of s.toLowerCase()) if (ch === q.toLowerCase()[i]) i++;
    return i === q.length;
  };

  /** @param {[number, number][]} ranges @param {string} s */
  const wellFormed = (ranges, s) => {
    for (let i = 0; i < ranges.length; i++) {
      const [a, b] = /** @type {[number, number]} */ (ranges[i]);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(s.length);
      expect(a).toBeLessThan(b);
      if (i > 0) expect(a).toBeGreaterThan(/** @type {[number, number]} */ (ranges[i - 1])[1]);
    }
  };

  test("a substring always matches with tier ≥ substring, and its range spells it", () => {
    fc.assert(
      fc.property(text, fc.nat(), fc.nat(), field, (s, x, y, f) => {
        const i = x % s.length;
        const j = i + 1 + (y % (s.length - i));
        const q = s.slice(i, j);
        fc.pre(!/\s/.test(q));
        const m = scoreField(s, q, f);
        expect(m).not.toBeNull();
        expect(m?.tier).toBeGreaterThanOrEqual(TIER.substring);
        expect(m?.ranges.length).toBe(1);
        const [a, b] = /** @type {[number, number]} */ (m && m.ranges[0]);
        expect(s.slice(a, b).toLowerCase()).toBe(q.toLowerCase());
      }),
    );
  });

  test("matches iff the term is a subsequence; ranges are well formed and spell the term", () => {
    fc.assert(
      fc.property(text, fc.string({ minLength: 1, maxLength: 4 }), (s, q) => {
        fc.pre(!/\s/.test(q));
        const m = scoreField(s, q);
        expect(m !== null).toBe(isSubsequence(q, s));
        if (m) {
          wellFormed(m.ranges, s);
          const spelled = m.ranges.map(([a, b]) => s.slice(a, b)).join("");
          expect(spelled.toLowerCase()).toBe(q.toLowerCase());
        }
      }),
    );
  });

  test("a better tier always scores higher, whatever the field; exact beats everything", () => {
    const pair = fc
      .tuple(text, fc.array(fc.nat(), { minLength: 1, maxLength: 5 }), field)
      .map(([s, picks, f]) => {
        const idx = [...new Set(picks.map((p) => p % s.length))].sort((a, b) => a - b);
        return { s, q: idx.map((i) => s[i]).join(""), f };
      })
      .filter(({ q }) => !/\s/.test(q));
    fc.assert(
      fc.property(pair, pair, (a, b) => {
        const ma = scoreField(a.s, a.q, a.f);
        const mb = scoreField(b.s, b.q, b.f);
        if (!ma || !mb) return;
        if (ma.tier > mb.tier) expect(ma.score).toBeGreaterThan(mb.score);
        expect(Math.floor(ma.score / 1000)).toBe(ma.tier);
        fc.pre(!/\s/.test(a.s));
        const exact = /** @type {{ score: number }} */ (scoreField(a.s, a.s, a.f));
        if (a.q.toLowerCase() !== a.s.toLowerCase()) expect(exact.score).toBeGreaterThan(ma.score);
      }),
    );
  });

  test("filterItems is sorted by score, ties in input order", () => {
    const alpha = fc.string({ unit: fc.constantFrom(..."abc "), maxLength: 8 });
    fc.assert(
      fc.property(
        fc.array(fc.record({ title: alpha, url: alpha }), { maxLength: 8 }),
        fc.string({ unit: fc.constantFrom(..."abc "), maxLength: 4 }),
        (rows, query) => {
          const ws = {
            active: "w1",
            workspaces: [
              { id: "w1", name: "ws", tabs: rows.map((_, i) => `t${i}`), activeTab: null },
            ],
          };
          const list = pickerItems(ws, (id) => rows[Number(id.slice(1))], {});
          const out = filterItems(list, query);
          for (let i = 1; i < out.length; i++) {
            const p = /** @type {any} */ (out[i - 1]);
            const c = /** @type {any} */ (out[i]);
            expect(p.score).toBeGreaterThanOrEqual(c.score);
            if (p.score === c.score)
              expect(list.indexOf(p.item)).toBeLessThan(list.indexOf(c.item));
          }
          for (const m of out)
            for (const [k, r] of Object.entries(m.highlights)) {
              wellFormed(r, /** @type {any} */ (m.item)[k === "workspace" ? "workspaceName" : k]);
            }
        },
      ),
    );
  });
});

describe("workspace picker (m3-workspaces 5)", () => {
  const model = {
    active: "w2",
    workspaces: [
      { id: "w1", name: "work", tabs: ["t1", "t2"], activeTab: "t2" },
      { id: "w2", name: "personal", tabs: ["t3"], activeTab: "t3" },
      { id: "w3", name: "admin", tabs: [], activeTab: null },
    ],
  };
  const ws = workspaceItems(model, (id) => id === "t1");
  /** @param {PickerState} s */
  const selectedWs = (s) => /** @type {any} */ (pickerSelection(s)?.item)?.workspaceId;

  test("one item per workspace in order, with its tab and foreign counts; the active marked", () => {
    expect(ws).toEqual([
      {
        kind: "workspace",
        workspaceId: "w1",
        workspaceName: "work",
        workspaceIndex: 1,
        tabCount: 2,
        foreignCount: 1,
        display: "work",
        active: false,
      },
      expect.objectContaining({ workspaceId: "w2", tabCount: 1, foreignCount: 0, active: true }),
      expect.objectContaining({ workspaceId: "w3", workspaceIndex: 3, tabCount: 0 }),
    ]);
    expect(Object.isFrozen(ws[0])).toBe(true);
    expect(workspaceItems(model)[0]?.foreignCount).toBe(0);
  });

  test("filters by name only, with highlights", () => {
    const m = filterItems(ws, "ad");
    expect(m.map((x) => /** @type {any} */ (x.item).workspaceId)).toEqual(["w3"]);
    expect(m[0]?.highlights).toEqual({ display: [[0, 2]] });
    expect(filterItems(ws, "github")).toEqual([]);
  });

  test("opens on the active workspace; enter switches; m moves; m types in search", () => {
    const s = openPicker(ws, { activeId: "w2" });
    expect(selectedWs(s)).toBe("w2");
    expect(press(s, ["k", "enter"]).effect).toEqual({ type: "select", id: "w1" });
    expect(press(s, ["j", "m"]).effect).toEqual({ type: "move", id: "w3" });
    const typed = press(s, ["/", "m"]);
    expect(typed.effect).toBeNull();
    expect(typed.state.query).toBe("m");
    expect(press(s, ["/", "w", "o", "enter"]).effect).toEqual({ type: "select", id: "w1" });
    expect(press(s, ["esc"]).effect).toEqual({ type: "close" });
  });

  test("m in the goto picker does nothing", () => {
    const s = openPicker(items, { activeId: "t1" });
    expect(pickerKey(s, "m")).toEqual({ state: s, effect: null });
  });

  test("setPickerItems keeps the selected workspace", () => {
    const s = openPicker(ws, { activeId: "w3" });
    const [a, b, c] = model.workspaces;
    const reordered = workspaceItems({ ...model, workspaces: [c, a, b].map((w) => ({ ...w })) });
    expect(selectedWs(setPickerItems(s, reordered))).toBe("w3");
  });
});
