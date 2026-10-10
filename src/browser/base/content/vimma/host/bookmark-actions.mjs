/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What the bookmark keys do (docs/specs/bookmarks.md): `ctrl+b a` / `:bookmark` and the
// bookmarks panel's effects (open, add, rename, move, delete, copy), over the rename prompt,
// the notice, the split code and bookmark-ops.mjs (Places).

import {
  PLACES_ROOTS,
  completeFolder,
  folderPath,
  formatBookmarkPath,
} from "../core/bookmarks.mjs";
import {
  addBookmark,
  addFolder,
  currentPage,
  findBookmark,
  loadTree,
  moveItem,
  placeBookmark,
  removeItem,
  renameItem,
} from "./bookmark-ops.mjs";
import { splitPane } from "./pane-ops.mjs";

/** @import { BookmarksEffect, Folder } from "../core/bookmarks.mjs" */
/** @import { RenamePrompt } from "../ui/rename-prompt.mjs" */
/** @import { BookmarksPanel } from "../ui/bookmarks-panel.mjs" */

/**
 * @typedef {object} BookmarkContext
 * @property {Window} win
 * @property {RenamePrompt} prompt
 * @property {BookmarksPanel} panel
 * @property {(text: string) => void} say  the notice
 */

const NOT_BOOKMARKABLE = "bookmark: only http, https, file and about: pages";

/**
 * Runs a Places change and says its outcome (or its error) on the notice.
 * @param {BookmarkContext} ctx
 * @param {() => Promise<string | null | void>} change
 */
function apply(ctx, change) {
  change()
    .then((said) => said && ctx.say(said))
    .catch((e) => {
      console.error("vimma: bookmark change failed", e);
      ctx.say(`bookmark: ${e?.message ?? e}`);
    });
}

/**
 * `ctrl+b a` and `:bookmark [path]`: files the selected page under a typed path from the Menu
 * (a trailing `/`: under its own title). Already bookmarked, it says where and offers to move
 * or rename that bookmark instead (spec decision 7).
 * @param {BookmarkContext} ctx
 * @param {string} [text]
 */
export async function quickAdd(ctx, text) {
  const page = currentPage(ctx.win);
  if (!page) {
    ctx.say(NOT_BOOKMARKABLE);
    return;
  }
  const [existing, tree] = await Promise.all([findBookmark(page.url), loadTree()]);
  const complete = (/** @type {string} */ before) =>
    completeFolder(tree, PLACES_ROOTS.menu, before);
  if (existing) {
    ctx.say(`already bookmarked: ${existing.path}`);
    ctx.prompt.prompt({
      label: "move/rename: ",
      value: text || existing.path,
      complete,
      submit: (t) => apply(ctx, () => placeBookmark(existing.guid, t)),
    });
    return;
  }
  if (text) {
    apply(ctx, () => addBookmark(text, page));
    return;
  }
  ctx.prompt.prompt({
    label: "bookmark: ",
    value: page.title,
    caret: 0,
    placeholder: "folder/folder/title",
    complete,
    submit: (t) => apply(ctx, () => addBookmark(t, page)),
  });
}

/**
 * A folder's path for a prompt's label: `work/docs/`, or "" for the Menu.
 * @param {Folder} tree
 * @param {string} guid
 */
function where(tree, guid) {
  const names = folderPath(tree, guid);
  return names.length ? `${formatBookmarkPath(names)}/` : "";
}

/**
 * Loads `url` in the panel's window (spec decision 6): this tab, a background tab (the
 * workspace's container, by the m3 routing), or a new split pane.
 * @param {BookmarkContext} ctx
 * @param {string} url
 * @param {"current" | "tab" | "vertical" | "horizontal"} at
 */
function openBookmark(ctx, url, at) {
  const win = /** @type {any} */ (ctx.win);
  if (at === "tab") {
    win.openTrustedLinkIn(url, "tab", { inBackground: true });
    return;
  }
  ctx.panel.close();
  if (at !== "current") {
    const id = at === "vertical" ? "pane.split_vertical" : "pane.split_horizontal";
    const refused = splitPane(ctx.win, { id });
    if (refused) {
      ctx.say(refused);
      return;
    }
  }
  win.openTrustedLinkIn(url, "current", {});
  win.gBrowser.selectedBrowser.focus();
}

/**
 * One effect of the bookmarks panel's keys.
 * @param {BookmarkContext} ctx
 * @param {BookmarksEffect} effect
 */
export function runBookmarkEffect(ctx, effect) {
  const tree = ctx.panel.tree;
  if (!tree) return;
  switch (effect.type) {
    case "open":
      openBookmark(ctx, effect.url, effect.where);
      return;
    case "refuse":
      ctx.say(effect.text);
      return;
    case "yank":
      /** @type {any} */ (Cc["@mozilla.org/widget/clipboardhelper;1"])
        .getService(Ci.nsIClipboardHelper)
        .copyString(effect.url);
      ctx.say(`copied ${effect.url}`);
      return;
    case "add": {
      const page = currentPage(ctx.win);
      if (!page) {
        ctx.say(NOT_BOOKMARKABLE);
        return;
      }
      const base = effect.folder;
      ctx.prompt.prompt({
        label: `add in ${where(tree, base) || "bookmarks menu/"}: `,
        value: page.title,
        caret: 0,
        placeholder: "folder/title, or folder/ for a folder",
        complete: (before) => completeFolder(tree, base, before),
        submit: (t) => apply(ctx, () => addBookmark(t, page, { base, folderOnly: true })),
      });
      return;
    }
    case "add_folder": {
      const base = effect.folder;
      ctx.prompt.prompt({
        label: `new folder in ${where(tree, base) || "bookmarks menu/"}: `,
        complete: (before) => completeFolder(tree, base, before),
        submit: (t) => apply(ctx, () => addFolder(t, base)),
      });
      return;
    }
    case "rename":
      ctx.prompt.prompt({
        label: "rename: ",
        value: effect.title,
        submit: (t) => apply(ctx, () => renameItem(effect.guid, t)),
      });
      return;
    case "move":
      ctx.prompt.prompt({
        label: "move to: ",
        value: where(tree, effect.from),
        placeholder: "folder/folder/",
        complete: (before) => completeFolder(tree, PLACES_ROOTS.menu, before),
        submit: (t) => apply(ctx, () => moveItem(effect.guid, t)),
      });
      return;
    case "delete": {
      const what =
        effect.kind === "folder"
          ? `folder ${effect.title} and its ${effect.count} items`
          : effect.title;
      ctx.prompt.ask(`delete ${what}? y/N`, () => apply(ctx, () => removeItem(effect.guid)));
    }
  }
}
