import { describe, test, expect } from "vitest";
import {
  PLACES_ROOTS,
  RENDER_CAP,
  bookmarksKey,
  completeFolder,
  filterBookmarks,
  flattenTree,
  folderPath,
  formatBookmarkPath,
  fromPlaces,
  isOpenable,
  openBookmarks,
  parseBookmarkPath,
  refreshBookmarks,
  renderStart,
  resolveFolders,
  setBookmarksQuery,
} from "../src/bookmarks.mjs";
import { compileKeymap } from "../src/keymap.mjs";
import { createDispatcher } from "../src/dispatcher.mjs";
import { parseKey } from "../src/keys.mjs";
import { parseCommandLine } from "../src/cmdline.mjs";

/** @import { BookmarksState, Folder } from "../src/bookmarks.mjs" */

const bm = (guid, title, uri) => ({ guid, typeCode: 1, title, uri });
const folder = (guid, title, children = []) => ({ guid, typeCode: 2, title, children });

/** What PlacesUtils.promiseBookmarksTree("") gives, cut down. */
const places = {
  guid: "root________",
  typeCode: 2,
  children: [
    folder(PLACES_ROOTS.menu, "menu", [
      folder("work", "work", [
        folder("docs", "docs", [bm("mdn", "MDN", "https://developer.mozilla.org/")]),
        bm("jira", "Jira", "https://jira.example/"),
        { guid: "sep", typeCode: 3 },
      ]),
      folder("Work2", "Workshop", []),
      bm("lua", "", "https://lua.org/"),
      bm("js", "Bookmarklet", "javascript:alert(1)"),
    ]),
    folder(PLACES_ROOTS.toolbar, "toolbar", [bm("gh", "GitHub", "https://github.com/")]),
    folder(PLACES_ROOTS.unfiled, "unfiled", []),
    folder(PLACES_ROOTS.mobile, "mobile", []),
  ],
};

const root = /** @type {Folder} */ (fromPlaces(places));

describe("parseBookmarkPath", () => {
  test("folders and a leaf", () => {
    expect(parseBookmarkPath("work/docs/My page")).toEqual({
      folders: ["work", "docs"],
      leaf: "My page",
    });
  });
  test("a trailing slash means folders only", () => {
    expect(parseBookmarkPath("work/docs/")).toEqual({ folders: ["work", "docs"], leaf: null });
  });
  test("segments are trimmed; empty ones and a leading slash are dropped", () => {
    expect(parseBookmarkPath(" /work// docs / My page ")).toEqual({
      folders: ["work", "docs"],
      leaf: "My page",
    });
  });
  test("\\/ is a slash inside a name, \\\\ a backslash", () => {
    expect(parseBookmarkPath("a\\/b/c\\\\d")).toEqual({ folders: ["a/b"], leaf: "c\\d" });
  });
  test("a bare name is a leaf at the top", () => {
    expect(parseBookmarkPath("Title")).toEqual({ folders: [], leaf: "Title" });
  });
  test("empty", () => {
    expect(parseBookmarkPath("  / ")).toEqual({ folders: [], leaf: null });
  });
  test("formatBookmarkPath escapes what parseBookmarkPath unescapes", () => {
    expect(formatBookmarkPath(["a/b", "c\\d"])).toBe("a\\/b/c\\\\d");
    expect(parseBookmarkPath(formatBookmarkPath(["a/b", "c\\d"]))).toEqual({
      folders: ["a/b"],
      leaf: "c\\d",
    });
  });
});

describe("fromPlaces", () => {
  test("rooted at the menu: toolbar and other first, empty mobile left out", () => {
    expect(root.guid).toBe(PLACES_ROOTS.menu);
    expect(root.children.map((c) => c.title)).toEqual([
      "toolbar",
      "other",
      "work",
      "Workshop",
      "",
      "Bookmarklet",
    ]);
    expect(root.children[0]).toMatchObject({ kind: "folder", root: "toolbar" });
  });
  test("mobile shows once it has something", () => {
    const withMobile = structuredClone(places);
    withMobile.children[3].children.push(bm("m1", "Phone", "https://m.example/"));
    expect(
      fromPlaces(withMobile)
        .children.map((c) => c.title)
        .slice(0, 3),
    ).toEqual(["toolbar", "other", "mobile"]);
  });
  test("separators are dropped", () => {
    const work = /** @type {Folder} */ (root.children[2]);
    expect(work.children.map((c) => c.guid)).toEqual(["docs", "jira"]);
  });
});

describe("flattenTree", () => {
  test("collapsed: the top level only", () => {
    const rows = flattenTree(root, new Set());
    expect(rows.map((r) => r.title)).toEqual([
      "toolbar",
      "other",
      "work",
      "Workshop",
      "https://lua.org/",
      "Bookmarklet",
    ]);
    expect(rows[2]).toMatchObject({ kind: "folder", depth: 0, open: false, size: 2 });
  });
  test("expanded folders list their children one level deeper", () => {
    const rows = flattenTree(root, new Set(["work", "docs"]));
    expect(rows.slice(2, 6).map((r) => [r.title, r.depth, r.parent])).toEqual([
      ["work", 0, PLACES_ROOTS.menu],
      ["docs", 1, "work"],
      ["MDN", 2, "docs"],
      ["Jira", 1, "work"],
    ]);
  });
  test("folderPath names a folder from the top", () => {
    expect(folderPath(root, "docs")).toEqual(["work", "docs"]);
    expect(folderPath(root, PLACES_ROOTS.toolbar)).toEqual(["toolbar"]);
    expect(folderPath(root, PLACES_ROOTS.menu)).toEqual([]);
  });
});

describe("resolveFolders and completeFolder", () => {
  test("existing folders resolve; the rest are missing", () => {
    expect(resolveFolders(root, PLACES_ROOTS.menu, ["work", "docs", "new", "deeper"])).toEqual({
      guid: "docs",
      missing: ["new", "deeper"],
    });
  });
  test("root aliases at the top level, relative to a base folder", () => {
    expect(resolveFolders(root, PLACES_ROOTS.menu, ["toolbar"])).toEqual({
      guid: PLACES_ROOTS.toolbar,
      missing: [],
    });
    expect(resolveFolders(root, "work", ["docs"])).toEqual({ guid: "docs", missing: [] });
  });
  test("case-insensitive when one folder matches", () => {
    expect(resolveFolders(root, PLACES_ROOTS.menu, ["WORK"]).guid).toBe("work");
  });
  test("Tab candidates: child folders of the typed path starting with the last segment", () => {
    expect(completeFolder(root, PLACES_ROOTS.menu, "wo")).toEqual(["work/", "Workshop/"]);
    expect(completeFolder(root, PLACES_ROOTS.menu, "work/d")).toEqual(["work/docs/"]);
    expect(completeFolder(root, PLACES_ROOTS.menu, "nope/x")).toEqual([]);
    expect(completeFolder(root, "work", "")).toEqual(["docs/"]);
  });
});

describe("isOpenable", () => {
  test.each([
    ["https://a.example/", true],
    ["http://a.example/", true],
    ["file:///tmp/x.html", true],
    ["about:config", true],
    ["javascript:alert(1)", false],
    [" JavaScript:alert(1)", false],
    ["data:text/html,hi", false],
    ["chrome://browser/content/browser.xhtml", false],
    ["place:sort=8", false],
  ])("%s → %s", (url, ok) => expect(isOpenable(url)).toBe(ok));
});

describe("filterBookmarks", () => {
  test("bookmarks only, flat, best first, with their folder path", () => {
    const rows = filterBookmarks(root, "mdn");
    expect(rows.map((r) => [r.title, r.path, r.depth])).toEqual([["MDN", "work/docs", 0]]);
  });
  test("matches the URL and the folder path too", () => {
    expect(filterBookmarks(root, "github").map((r) => r.guid)).toEqual(["gh"]);
    expect(filterBookmarks(root, "docs").map((r) => r.guid)).toEqual(["mdn"]);
  });
  test("fuzzy: letters in order", () => {
    expect(filterBookmarks(root, "jrx").map((r) => r.guid)).toEqual(["jira"]);
  });
});

/**
 * @param {BookmarksState} s
 * @param {Array<{ id: string, arg?: number }>} actions
 */
function press(s, actions) {
  /** @type {ReturnType<typeof bookmarksKey>["effect"]} */
  let effect = null;
  for (const a of actions) ({ state: s, effect } = bookmarksKey(s, a));
  return { state: s, effect };
}
const sel = (/** @type {BookmarksState} */ s) => s.rows[s.selected];
const at = (/** @type {string} */ guid, opts = {}) =>
  openBookmarks(root, { selectedGuid: guid, ...opts });

describe("bookmarksKey", () => {
  test("j / k move within the rows", () => {
    const s = openBookmarks(root);
    expect(sel(s)?.title).toBe("toolbar");
    expect(sel(press(s, [{ id: "panel.down" }, { id: "panel.down" }]).state)?.title).toBe("work");
    expect(press(s, [{ id: "panel.up" }]).state.selected).toBe(0);
  });
  test("l opens a folder, again goes to its first item; h closes, then goes up", () => {
    let { state } = press(at("work"), [{ id: "bookmarks.expand" }]);
    expect(state.expanded).toContain("work");
    expect(sel(state)?.title).toBe("work");
    ({ state } = press(state, [{ id: "bookmarks.expand" }]));
    expect(sel(state)?.title).toBe("docs");
    ({ state } = press(state, [{ id: "bookmarks.collapse" }]));
    expect(sel(state)?.title).toBe("work");
    expect(state.expanded).not.toContain("work");
    expect(press(state, [{ id: "bookmarks.collapse" }]).state).toBe(state);
  });
  test("l and Enter on a bookmark open it in this tab", () => {
    const s = at("jira", { expanded: ["work"] });
    for (const id of ["bookmarks.expand", "panel.open"]) {
      expect(press(s, [{ id }]).effect).toEqual({
        type: "open",
        url: "https://jira.example/",
        where: "current",
      });
    }
  });
  test("Enter on a folder toggles it", () => {
    const { state } = press(at("work"), [{ id: "panel.open" }]);
    expect(state.expanded).toContain("work");
    expect(press(state, [{ id: "panel.open" }]).state.expanded).not.toContain("work");
  });
  test("t, s, S open in a tab and in splits", () => {
    const s = at("gh", { expanded: [PLACES_ROOTS.toolbar] });
    expect(press(s, [{ id: "bookmarks.open_tab" }]).effect).toMatchObject({ where: "tab" });
    expect(press(s, [{ id: "bookmarks.open_vsplit" }]).effect).toMatchObject({
      where: "vertical",
    });
    expect(press(s, [{ id: "bookmarks.open_hsplit" }]).effect).toMatchObject({
      where: "horizontal",
    });
  });
  test("a javascript: bookmark is listed but refuses to open", () => {
    const { effect } = press(at("js"), [{ id: "panel.open" }]);
    expect(effect).toEqual({
      type: "refuse",
      text: "javascript: bookmarks don't open from Vimma (only http, https, file, about)",
    });
  });
  test("a, A add in the folder or the bookmark's folder", () => {
    expect(press(at("work"), [{ id: "bookmarks.add" }]).effect).toEqual({
      type: "add",
      folder: "work",
    });
    expect(
      press(at("jira", { expanded: ["work"] }), [{ id: "bookmarks.add_folder" }]).effect,
    ).toEqual({ type: "add_folder", folder: "work" });
    expect(press(at("lua"), [{ id: "bookmarks.add" }]).effect).toEqual({
      type: "add",
      folder: PLACES_ROOTS.menu,
    });
  });
  test("r, m, d, y name the item; the roots refuse", () => {
    const s = at("jira", { expanded: ["work"] });
    expect(press(s, [{ id: "bookmarks.rename" }]).effect).toEqual({
      type: "rename",
      guid: "jira",
      title: "Jira",
    });
    expect(press(s, [{ id: "bookmarks.move" }]).effect).toEqual({
      type: "move",
      guid: "jira",
      from: "work",
    });
    expect(press(at("work"), [{ id: "bookmarks.delete" }]).effect).toEqual({
      type: "delete",
      guid: "work",
      kind: "folder",
      title: "work",
      count: 3,
    });
    expect(press(s, [{ id: "bookmarks.yank" }]).effect).toEqual({
      type: "yank",
      url: "https://jira.example/",
    });
    for (const id of ["bookmarks.rename", "bookmarks.move", "bookmarks.delete"]) {
      expect(press(at(PLACES_ROOTS.toolbar), [{ id }]).effect).toEqual({
        type: "refuse",
        text: "toolbar is a root folder: it can't be changed",
      });
    }
    expect(press(at("work"), [{ id: "bookmarks.yank" }]).effect?.type).toBe("refuse");
  });
  test("/ asks for the filter; Esc clears a filter, then closes", () => {
    const s = openBookmarks(root);
    expect(press(s, [{ id: "bookmarks.filter" }]).effect).toEqual({ type: "filter" });
    const filtered = setBookmarksQuery(s, "jira");
    expect(filtered.rows.map((r) => r.guid)).toEqual(["jira"]);
    const { state, effect } = press(filtered, [{ id: "panel.close" }]);
    expect(effect).toBeNull();
    expect(state.query).toBe("");
    expect(press(state, [{ id: "panel.close" }]).effect).toEqual({ type: "close" });
  });
  test("digits do nothing; an empty panel ignores keys", () => {
    const s = openBookmarks(root);
    expect(press(s, [{ id: "panel.select", arg: 2 }])).toEqual({ state: s, effect: null });
    const empty = openBookmarks(fromPlaces({ guid: "r", children: [] }));
    expect(press(empty, [{ id: "panel.open" }, { id: "bookmarks.delete" }]).effect).toBeNull();
  });
});

describe("refreshBookmarks", () => {
  test("keeps the highlight on its item, expanded folders and the filter", () => {
    const s = at("jira", { expanded: ["work"] });
    const more = structuredClone(places);
    more.children[0].children[0].children.unshift(bm("new", "New", "https://new.example/"));
    const next = refreshBookmarks(s, fromPlaces(more));
    expect(sel(next)?.guid).toBe("jira");
    expect(next.rows.map((r) => r.guid)).toContain("new");
  });
  test("an item gone: the highlight stays at its place; a folder gone leaves expanded", () => {
    const s = at("Work2", { expanded: ["work"] });
    const less = structuredClone(places);
    less.children[0].children.splice(1, 1);
    const next = refreshBookmarks(s, fromPlaces(less));
    expect(next.selected).toBe(s.selected);
    const noWork = structuredClone(places);
    noWork.children[0].children.splice(0, 1);
    expect(refreshBookmarks(s, fromPlaces(noWork)).expanded).not.toContain("work");
  });
});

describe("renderStart", () => {
  test("everything fits: from 0", () => expect(renderStart(10, 5, 0)).toBe(0));
  test("the window stays while the selection is inside it", () => {
    expect(renderStart(2000, 50, 0)).toBe(0);
    expect(renderStart(2000, 120, 100)).toBe(100);
  });
  test("leaving it re-centres, within bounds", () => {
    expect(renderStart(2000, RENDER_CAP, 0)).toBe(RENDER_CAP / 2);
    expect(renderStart(2000, 1999, 0)).toBe(2000 - RENDER_CAP);
    expect(renderStart(2000, 3, 500)).toBe(0);
  });
});

describe("keymap and command line", () => {
  const keymap = compileKeymap();
  const run = (
    /** @type {import("../src/modes.mjs").Mode} */ mode,
    /** @type {string[]} */ keys,
  ) => {
    const d = createDispatcher(keymap);
    let r;
    for (const k of keys) r = d.dispatch(mode, parseKey(k));
    return r?.kind === "action" ? r.action.id : r?.kind;
  };
  test("ctrl+b shift+b toggles, from panel mode too; ctrl+b a adds", () => {
    expect(run("normal", ["ctrl+b", "shift+b"])).toBe("bookmarks.toggle");
    expect(run("panel", ["ctrl+b", "shift+b"])).toBe("bookmarks.toggle");
    expect(run("insert", ["ctrl+b", "a"])).toBe("bookmark.add");
  });
  test("the neo-tree keys in panel mode", () => {
    const keys = {
      h: "bookmarks.collapse",
      l: "bookmarks.expand",
      t: "bookmarks.open_tab",
      s: "bookmarks.open_vsplit",
      "shift+s": "bookmarks.open_hsplit",
      a: "bookmarks.add",
      "shift+a": "bookmarks.add_folder",
      r: "bookmarks.rename",
      m: "bookmarks.move",
      d: "bookmarks.delete",
      y: "bookmarks.yank",
      "/": "bookmarks.filter",
    };
    for (const [k, id] of Object.entries(keys)) expect(run("panel", [k])).toBe(id);
  });
  test(":bookmark [path] and :bookmarks", () => {
    expect(parseCommandLine("bookmark work/x")).toMatchObject({
      action: { id: "bookmark.add" },
      text: "work/x",
    });
    expect(parseCommandLine("bookmark")).toMatchObject({ action: { id: "bookmark.add" } });
    expect(parseCommandLine("bookmarks")).toMatchObject({ action: { id: "bookmarks.toggle" } });
  });
});
