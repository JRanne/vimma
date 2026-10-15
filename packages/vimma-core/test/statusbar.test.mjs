import { describe, test, expect } from "vitest";
import fc from "fast-check";
import {
  WORKSPACE_COLOR_TOKENS,
  displayUrl,
  fitStatus,
  renderStatusBar,
  statusSegments,
  statusWidth,
  textWidth,
  truncate,
} from "../src/statusbar.mjs";
import { THEME_TOKENS } from "../src/theme.mjs";

/** @import { Segment } from "../src/statusbar.mjs" */

const base = {
  mode: /** @type {const} */ ("normal"),
  workspace: { name: "work", index: 1, color: "blue" },
  tab: { index: 2, count: 5, title: "GitHub", url: "https://github.com/" },
};

/** @param {Segment[]} segs */
const texts = (segs) => Object.fromEntries(segs.map((s) => [s.id, s.text]));

describe("status bar segments", () => {
  test("mode, workspace, tab position, title and host", () => {
    const segs = statusSegments(base);
    expect(segs.map((s) => [s.id, s.text, s.side])).toEqual([
      ["mode", "NORMAL", "left"],
      ["workspace", "● 1:work", "left"],
      ["tab", "tab 2/5", "left"],
      ["title", "GitHub", "left"],
      ["url", "github.com", "right"],
    ]);
    expect(segs[0]).toMatchObject({ fg: "--vimma-mode-normal-fg", bg: "--vimma-mode-normal" });
    expect(segs[1]?.fg).toBe("--vimma-text-blue");
  });

  test("every token named is a theme token", () => {
    const names = new Set(THEME_TOKENS.map((t) => t.name));
    const segs = statusSegments({
      ...base,
      pending: ["prefix"],
      pane: { index: 1, count: 2 },
      loading: true,
      configErrors: [{ line: 3, path: "keys.x", message: "bad" }],
    });
    for (const s of segs) {
      expect(names.has(s.fg), s.fg).toBe(true);
      if (s.bg) expect(names.has(s.bg), s.bg).toBe(true);
    }
    for (const t of Object.values(WORKSPACE_COLOR_TOKENS)) expect(names.has(t), t).toBe(true);
    for (const mode of ["insert", "visual", "command", "hint", "help", "panel"]) {
      const m = statusSegments({ mode: /** @type {any} */ (mode) })[0];
      expect(names.has(/** @type {string} */ (m?.bg))).toBe(true);
    }
  });

  test("pending keys: prefix colours for a prefix, plain otherwise", () => {
    const p = statusSegments({ mode: "normal", pending: ["prefix"] })[1];
    expect(p).toMatchObject({
      id: "pending",
      text: "prefix",
      fg: "--vimma-mode-prefix-fg",
      bg: "--vimma-mode-prefix",
    });
    const g = statusSegments({ mode: "normal", pending: ["2", "g"] })[1];
    expect(g).toMatchObject({ text: "2 g", fg: "--vimma-fg-bright", bg: null });
  });

  test("the title shows the rename; a missing title falls back to the URL once", () => {
    expect(texts(statusSegments({ ...base, tab: { ...base.tab, label: "code" } })).title).toBe(
      "code",
    );
    const noTitle = texts(
      statusSegments({ ...base, tab: { index: 1, count: 1, title: "", url: "https://a.org/x" } }),
    );
    expect(noTitle.title).toBe("https://a.org/x");
    expect(noTitle.url).toBeUndefined();
    expect(texts(statusSegments({ mode: "normal", tab: { index: 1, count: 1 } })).title).toBe(
      "New Tab",
    );
  });

  test("loading, progress and panes", () => {
    expect(texts(statusSegments({ ...base, loading: true, progress: 0.42 })).loading).toBe("42%");
    expect(texts(statusSegments({ ...base, loading: true })).loading).toBe("loading");
    expect(texts(statusSegments({ ...base, progress: 0.5 })).loading).toBeUndefined();
    expect(texts(statusSegments({ ...base, pane: { index: 1, count: 1 } })).pane).toBeUndefined();
    expect(texts(statusSegments({ ...base, pane: { index: 1, count: 2 } })).pane).toBe("pane 1/2");
  });

  test("a hidden view (side-panel-unsplit decision 27): split N hidden, dim, cut first", () => {
    const segs = statusSegments({ ...base, pane: { index: 2, count: 3, hidden: true } });
    expect(texts(segs).pane).toBe("split 3 hidden");
    const pane = segs.find((s) => s.id === "pane");
    expect(pane?.fg).toBe("--vimma-fg-dim");
    const title = segs.find((s) => s.id === "title");
    expect(/** @type {any} */ (pane).priority).toBeGreaterThan(/** @type {any} */ (title).priority);
  });

  test("config errors show file:line, and the count when there are more", () => {
    const one = [
      {
        line: 3,
        path: "keys.new_tabb",
        message: 'unknown action "new_tabb"',
        suggestion: "new_tab",
      },
    ];
    expect(texts(statusSegments({ mode: "normal", configErrors: one })).error).toBe(
      'config.toml:3: keys.new_tabb: unknown action "new_tabb" (did you mean "new_tab"?)',
    );
    const two = [...one, { line: 7, path: "theme.font", message: "bad" }];
    const seg = statusSegments({ mode: "normal", configErrors: two, configFile: "~/c.toml" }).find(
      (s) => s.id === "error",
    );
    expect(seg?.text.startsWith("2 errors: ~/c.toml:3: keys.new_tabb:")).toBe(true);
    expect(seg?.fg).toBe("--vimma-text-error");
  });

  test("alerts (workspaces off) show as a persistent error, after config errors", () => {
    const text = "workspaces off: containers are disabled";
    const seg = statusSegments({ mode: "normal", alerts: [text] }).find((s) => s.id === "alert");
    expect(seg).toMatchObject({ text, fg: "--vimma-text-error", side: "right" });
    const both = statusSegments({
      mode: "normal",
      alerts: [text],
      configErrors: [{ line: 1, path: "x", message: "bad" }],
    }).map((s) => s.id);
    expect(both.indexOf("error")).toBeLessThan(both.indexOf("alert"));
    expect(texts(statusSegments({ mode: "normal", alerts: [] })).alert).toBeUndefined();
  });

  test("a workspace without a known colour uses the accent", () => {
    const s = statusSegments({ mode: "normal", workspace: { name: "x", index: 2 } });
    expect(s[1]).toMatchObject({ text: "● 2:x", fg: "--vimma-text-accent" });
  });

  test("the private workspace shows ◆ private in the theme's magenta, with no number", () => {
    const s = statusSegments({
      mode: "normal",
      workspace: { name: "private", index: 0, private: true, color: "blue" },
    });
    expect(s[1]).toMatchObject({ id: "workspace", text: "◆ private", fg: "--vimma-text-magenta" });
  });

  // docs/specs/vimma-mcp.md decision 24: glyph and word carry it without colour.
  test("the agent segment: ◇ agent, ◇ agent 2?, ◇ agent 14m, ◇ agent · in cyan, on the right", () => {
    const at = (/** @type {any} */ agent) =>
      statusSegments({ ...base, agent }).find((s) => s.id === "agent");
    expect(at(null)).toBeUndefined();
    expect(at({ waiting: 0, minutes: null, ran: false })).toMatchObject({
      text: "◇ agent",
      fg: "--vimma-text-cyan",
      bg: null,
      side: "right",
    });
    expect(at({ waiting: 2, minutes: 14, ran: false })?.text).toBe("◇ agent 2?");
    expect(at({ waiting: 0, minutes: 14, ran: false })?.text).toBe("◇ agent 14m");
    // A question waiting says so even just after a request ran: the question comes first.
    expect(at({ waiting: 1, minutes: null, ran: true })?.text).toBe("◇ agent 1?");
    expect(at({ waiting: 0, minutes: 14, ran: true })).toMatchObject({
      text: "◇ agent ·",
      fg: "--vimma-mode-normal-fg",
      bg: "--vimma-mode-normal",
    });
  });

  test("the agent segment gives way just after the workspace's", () => {
    const all = statusSegments({ ...base, agent: { waiting: 1, minutes: null, ran: false } });
    const p = (/** @type {string} */ id) => /** @type {Segment} */ (all.find((s) => s.id === id));
    expect(p("agent").priority).toBeGreaterThan(p("workspace").priority);
    expect(p("agent").priority).toBeLessThan(p("tab").priority);
    // Narrow: the URL and title go before it, the workspace stays longer.
    const fitted = fitStatus(all, 30).map((s) => s.id);
    expect(fitted).toContain("agent");
    expect(fitted).toContain("workspace");
    expect(fitted).not.toContain("url");
  });

  test("displayUrl drops http(s) and a lone trailing slash", () => {
    expect(displayUrl("https://github.com/")).toBe("github.com");
    expect(displayUrl("http://a.org/b/")).toBe("a.org/b/");
    expect(displayUrl("about:preferences")).toBe("about:preferences");
    expect(displayUrl("")).toBe("");
  });
});

describe("truncation", () => {
  test("truncate end and middle with one ellipsis", () => {
    expect(truncate("abcdef", 4, "end")).toBe("abc…");
    expect(truncate("abcdef", 4, "middle")).toBe("ab…f");
    expect(truncate("abcdef", 6, "end")).toBe("abcdef");
    expect(truncate("abcdef", 1, "middle")).toBe("a");
    expect(truncate("家族", 1, "end")).toBe("…");
    expect(truncate("abcdef", 0, "end")).toBe("");
    expect(truncate("😀😀😀", 3, "end")).toBe("😀…");
    expect(truncate("😀😀😀", 2, "end")).toBe("…");
  });

  test("width is terminal columns over grapheme clusters", () => {
    expect(textWidth("家族の写真")).toBe(10);
    expect(textWidth("😀a")).toBe(3);
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}";
    expect(textWidth(family)).toBe(2);
    expect(textWidth("\u{1F1EB}\u{1F1EE}")).toBe(2);
    expect(textWidth("e\u0301a\u0308")).toBe(2);
    expect(textWidth("\u2764\uFE0F")).toBe(2);
    expect(textWidth("●")).toBe(1);
    expect(textWidth("ｆｕｌｌ")).toBe(8);
    expect(textWidth("a\u200Bb")).toBe(2);
    expect(textWidth("")).toBe(0);
  });

  test("truncation never splits a grapheme cluster", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    expect(truncate(family.repeat(3), 3, "end")).toBe(`${family}…`);
    expect(truncate("e\u0301".repeat(4), 3, "middle")).toBe("e\u0301…e\u0301");
    expect(truncate("家族の写真", 5, "end")).toBe("家族…");
    expect(truncate("家族の写真", 6, "middle")).toBe("家…真");
    expect(truncate("\u{1F1EB}\u{1F1EE}\u{1F1F8}\u{1F1EA}", 3, "end")).toBe("\u{1F1EB}\u{1F1EE}…");
  });

  test("fits: identity", () => {
    const segs = statusSegments(base);
    expect(fitStatus(segs, 200)).toBe(segs);
    expect(statusWidth(segs)).toBe(6 + 8 + 7 + 6 + 10 + 4);
  });

  test("least important gives way first: the URL shrinks, then goes, then the title shrinks", () => {
    const input = {
      ...base,
      tab: { ...base.tab, title: "A fairly long page title", url: "https://example.com/a/b/c/d" },
    };
    const full = statusSegments(input);
    const w = statusWidth(full);
    const a = renderStatusBar(input, w - 4);
    expect(texts(a).url).toBe("example…a/b/c/d");
    expect(texts(a).title).toBe("A fairly long page title");
    const b = renderStatusBar(input, w - 20);
    expect(texts(b).url).toBeUndefined();
    expect(texts(b).title).toBe("A fairly long page title");
    const c = renderStatusBar(input, statusWidth(full.filter((s) => s.id !== "url")) - 5);
    expect(texts(c).title).toBe("A fairly long page…");
    expect(renderStatusBar(input, 3).map((s) => s.text)).toEqual(["NO…"]);
    expect(renderStatusBar(input, 1).map((s) => s.text)).toEqual(["N"]);
    expect(renderStatusBar(input, 0)).toEqual([]);
  });

  test("properties: fits, keeps mode and order, gives way least important first", () => {
    const seg = fc.record({
      text: fc.string({
        unit: fc.constantFrom("a", "b", " ", "家", "e\u0301", "😀"),
        minLength: 1,
        maxLength: 30,
      }),
      priority: fc.integer({ min: 1, max: 9 }),
      min: fc.integer({ min: 1, max: 12 }),
      cut: fc.constantFrom("end", "middle", "none"),
      side: fc.constantFrom("left", "right"),
    });
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.array(seg, { maxLength: 8 }),
        fc.integer({ min: 1, max: 120 }),
        (modeText, rest, width) => {
          /** @type {Segment[]} */
          const segs = [
            {
              id: "mode",
              text: modeText,
              fg: "--vimma-fg",
              bg: null,
              side: "left",
              priority: 0,
              min: 1,
              cut: "end",
            },
            ...rest.map((r, i) => ({ id: `s${i}`, fg: "--vimma-fg", bg: null, ...r })),
          ].map((s) => /** @type {Segment} */ (s));
          const out = fitStatus(segs, width);
          expect(statusWidth(out)).toBeLessThanOrEqual(width);
          if (statusWidth(segs) <= width) expect(out).toBe(segs);
          expect(out[0]?.id).toBe("mode");
          const idx = out.map((o) => segs.findIndex((s) => s.id === o.id));
          expect(idx).toEqual(idx.slice().sort((x, y) => x - y));
          const kept = new Map(out.map((o) => [o.id, o]));
          for (const s of segs.slice(1)) {
            const o = kept.get(s.id);
            if (o && o.text !== s.text) {
              expect(s.cut).not.toBe("none");
              // a wide character that does not fit may leave one column unused
              expect(textWidth(o.text)).toBeGreaterThanOrEqual(
                Math.min(s.min, textWidth(s.text)) - 1,
              );
              // a segment is shortened only as far as needed: no space is left unused
              expect(statusWidth(out)).toBeGreaterThanOrEqual(width - 1);
            }
            if (!o || o.text !== s.text) {
              // every less important segment (ties: later ones) is gone
              for (const t of segs.slice(1)) {
                const lessImportant =
                  t.priority > s.priority ||
                  (t.priority === s.priority && segs.indexOf(t) > segs.indexOf(s));
                if (lessImportant) expect(kept.has(t.id)).toBe(false);
              }
            }
          }
        },
      ),
    );
  });
});
