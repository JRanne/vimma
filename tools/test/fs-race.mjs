/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A node:fs that lets a test change a file inside a tool's check-then-use window (CodeQL
// js/file-system-race). The change lands right before the first use of the path (a read, write
// or open), so code that checked the path first (exists, stat) acts on a file it never checked,
// and code that opens once and asks the descriptor sees one file throughout. In a test file:
//
//   vi.mock("node:fs", async (original) =>
//     (await import("../../test/fs-race.mjs")).racyFs(await original()));
//   import { beforeUse } from "../../test/fs-race.mjs";
//   beforeUse(path, () => renameSync(other, path));

import { resolve } from "node:path";

/** @type {{ path: string, change: () => void } | null} */
let pending = null;

/**
 * Run `change` once, right before the next read, write or open of `path`.
 * @param {string} path
 * @param {() => void} change
 */
export function beforeUse(path, change) {
  pending = { path: resolve(path), change };
}

/** Whether the change has run; `beforeUse` arms it again. */
export const fired = () => pending === null;

const USES = ["readFileSync", "writeFileSync", "openSync", "appendFileSync"];

/**
 * @template {Record<string, any>} T
 * @param {T} fs  the real node:fs
 * @returns {T}
 */
export function racyFs(fs) {
  /** @type {Record<string, any>} */
  const out = { ...fs };
  for (const name of USES) {
    out[name] = (/** @type {any[]} */ ...args) => {
      const p = args[0];
      if (pending && typeof p === "string" && resolve(p) === pending.path) {
        const { change } = pending;
        pending = null;
        change();
      }
      return fs[name](...args);
    };
  }
  out.default = { ...fs.default, ...Object.fromEntries(USES.map((n) => [n, out[n]])) };
  return /** @type {T} */ (out);
}
