/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Bookmarks over Firefox's Places (docs/specs/bookmarks.md, decision 1): reading the tree,
// filing a page under a typed path, renaming, moving and deleting. Paths and the tree's shape
// are core bookmarks.mjs; this only talks to PlacesUtils.

import {
  PLACES_ROOTS,
  folderPath,
  formatBookmarkPath,
  fromPlaces,
  isOpenable,
  parseBookmarkPath,
  resolveFolders,
} from "../core/bookmarks.mjs";

/** @import { Folder } from "../core/bookmarks.mjs" */

/** @returns {any} PlacesUtils */
function places() {
  return ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs").PlacesUtils;
}

/** Places events that change what the panel lists (PlacesEvent.webidl). */
export const BOOKMARK_EVENTS = Object.freeze([
  "bookmark-added",
  "bookmark-removed",
  "bookmark-moved",
  "bookmark-title-changed",
  "bookmark-url-changed",
]);

/**
 * The whole tree, rooted at the Menu (core fromPlaces).
 * @returns {Promise<Folder>}
 */
export async function loadTree() {
  return fromPlaces(await places().promiseBookmarksTree(""));
}

/**
 * Makes `missing` folders, one inside the next, under `parentGuid`.
 * @param {string} parentGuid
 * @param {readonly string[]} missing
 * @returns {Promise<string>} the guid of the deepest
 */
async function makeFolders(parentGuid, missing) {
  const PU = places();
  let guid = parentGuid;
  for (const title of missing) {
    ({ guid } = await PU.bookmarks.insert({
      parentGuid: guid,
      type: PU.bookmarks.TYPE_FOLDER,
      title,
    }));
  }
  return guid;
}

/**
 * The folder `names` lead to from `base`, made where missing.
 * @param {Folder} tree
 * @param {string} base
 * @param {readonly string[]} names
 */
async function ensureFolders(tree, base, names) {
  const { guid, missing } = resolveFolders(tree, base, names);
  return makeFolders(guid, missing);
}

/**
 * The page a key bookmarks: the selected tab's URL and title, when the panel could open it.
 * @param {Window} win
 * @returns {{ url: string, title: string } | null}
 */
export function currentPage(win) {
  const browser = /** @type {any} */ (win).gBrowser.selectedBrowser;
  const url = browser.currentURI?.spec ?? "";
  if (!isOpenable(url) || url === "about:blank") return null;
  return { url, title: browser.contentTitle || url };
}

/**
 * The most recently changed bookmark of `url`, with its path from the Menu, or null.
 * @param {string} url
 * @returns {Promise<{ guid: string, path: string } | null>}
 */
export async function findBookmark(url) {
  const bm = await places().bookmarks.fetch({ url });
  if (!bm) return null;
  const tree = await loadTree();
  return {
    guid: bm.guid,
    path: formatBookmarkPath([...folderPath(tree, bm.parentGuid), bm.title]),
  };
}

/**
 * Files `page` under `text` from folder `base` (spec decision 5). `folderOnly`: a trailing
 * `/` makes the folders and no bookmark (the panel's `a`, neo-tree); else the page goes into
 * them under its own title.
 * @param {string} text
 * @param {{ url: string, title: string }} page
 * @param {{ base?: string, folderOnly?: boolean }} [options]
 * @returns {Promise<string>} what to tell the user
 */
export async function addBookmark(
  text,
  page,
  { base = PLACES_ROOTS.menu, folderOnly = false } = {},
) {
  const { folders, leaf } = parseBookmarkPath(text);
  if (!leaf && !folders.length) return "bookmark: empty name";
  const tree = await loadTree();
  const parentGuid = await ensureFolders(tree, base, folders);
  if (!leaf && folderOnly) return `made ${formatBookmarkPath(folders)}/`;
  const title = leaf ?? page.title;
  await places().bookmarks.insert({ parentGuid, url: page.url, title });
  return `bookmarked: ${formatBookmarkPath([...folderPath(await loadTree(), parentGuid), title])}`;
}

/**
 * A folder named by `text` (its last segment; the ones before are made too) under `base`.
 * @param {string} text
 * @param {string} base
 */
export async function addFolder(text, base) {
  const { folders, leaf } = parseBookmarkPath(text);
  const names = leaf ? [...folders, leaf] : folders;
  if (!names.length) return "folder: empty name";
  await ensureFolders(await loadTree(), base, names);
  return `made ${formatBookmarkPath(names)}/`;
}

/**
 * Moves and renames bookmark `guid` to `text` from the Menu (the already-bookmarked prompt):
 * a trailing `/` keeps its title.
 * @param {string} guid
 * @param {string} text
 */
export async function placeBookmark(guid, text) {
  const { folders, leaf } = parseBookmarkPath(text);
  if (!leaf && !folders.length) return "bookmark: empty name";
  const PU = places();
  const parentGuid = await ensureFolders(await loadTree(), PLACES_ROOTS.menu, folders);
  const bm = await PU.bookmarks.fetch(guid);
  if (!bm) return "bookmark: it is gone";
  const title = leaf ?? bm.title;
  /** @type {Record<string, unknown>} */
  const change = { guid, title };
  if (bm.parentGuid !== parentGuid) {
    change.parentGuid = parentGuid;
    change.index = PU.bookmarks.DEFAULT_INDEX;
  }
  await PU.bookmarks.update(change);
  return `bookmarked: ${formatBookmarkPath([...folderPath(await loadTree(), parentGuid), title])}`;
}

/**
 * @param {string} guid
 * @param {string} title
 */
export async function renameItem(guid, title) {
  const name = title.trim();
  if (!name) return "rename: empty name";
  await places().bookmarks.update({ guid, title: name });
  return null;
}

/**
 * Moves `guid` into the folder `text` names from the Menu, made where missing; never into
 * itself or below itself.
 * @param {string} guid
 * @param {string} text
 */
export async function moveItem(guid, text) {
  const { folders, leaf } = parseBookmarkPath(text);
  const names = leaf ? [...folders, leaf] : folders;
  const tree = await loadTree();
  // The existing part of the path must not pass through the item itself.
  for (let i = 0; i <= names.length; i++) {
    const at = resolveFolders(tree, PLACES_ROOTS.menu, names.slice(0, i));
    if (at.missing.length === 0 && at.guid === guid) return "move: not into itself";
  }
  const PU = places();
  const parentGuid = await ensureFolders(tree, PLACES_ROOTS.menu, names);
  await PU.bookmarks.update({ guid, parentGuid, index: PU.bookmarks.DEFAULT_INDEX });
  return null;
}

/** @param {string} guid */
export async function removeItem(guid) {
  await places().bookmarks.remove(guid);
}

/**
 * Listens to Places' bookmark events; returns the function that stops listening.
 * @param {() => void} fn
 */
export function observeBookmarks(fn) {
  const PU = places();
  const listener = () => fn();
  PU.observers.addListener([...BOOKMARK_EVENTS], listener);
  return () => PU.observers.removeListener([...BOOKMARK_EVENTS], listener);
}
