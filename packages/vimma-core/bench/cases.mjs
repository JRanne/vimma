/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Key-to-action in core (plan §5: < 50 µs), measured by tools/bench/bench.mjs and gated against
 * baseline.json by tools/bench/compare.mjs. Each case runs one whole key sequence from keydown to
 * the action the host would apply, so the dispatcher ends idle and every run does the same work.
 * Names key the baseline: renaming a case means re-recording it (docs/runbook.md).
 */
import { createDispatcher } from "../src/dispatcher.mjs";
import { compileKeymap } from "../src/keymap.mjs";
import { parseKey } from "../src/keys.mjs";
import { focus } from "../src/panes.mjs";
import {
  activeWorkspace,
  createWorkspaces,
  openTab,
  selectTab,
  splitPane,
  withPanes,
} from "../src/workspaces.mjs";

/** @typedef {{ name: string, run: () => unknown, expected: unknown }} BenchCase */

const d = createDispatcher(compileKeymap());
/** @param {string[]} keys */
const sequence = (keys) => {
  const chords = keys.map(parseKey);
  return () => {
    let r;
    for (const chord of chords) r = d.dispatch("normal", chord);
    return r;
  };
};
/** @param {string} id @param {number} [count] */
const action = (id, count) => ({ kind: "action", action: count ? { id, count } : { id } });

let ws = createWorkspaces([
  { name: "work", container: "c1" },
  { name: "personal", container: "c2" },
]);
for (let i = 0; i < 30; i++) ws = openTab(ws, `tab${i}`);
for (let i = 0; i < 7; i++) ws = splitPane(ws, i % 2 ? "vertical" : "horizontal", `split${i}`);
const model = ws;

/** @type {BenchCase[]} */
export const CASES = [
  { name: "single key: j → scroll.down", run: sequence(["j"]), expected: action("scroll.down") },
  {
    name: "prefix + key: ctrl+b c → tab.new",
    run: sequence(["ctrl+b", "c"]),
    expected: action("tab.new"),
  },
  {
    name: "count + motion: 5 j → scroll.down ×5",
    run: sequence(["5", "j"]),
    expected: action("scroll.down", 5),
  },
  { name: "sequence: g t → tab.next", run: sequence(["g", "t"]), expected: action("tab.next") },
  {
    name: "apply: pane focus + selectTab, 8 panes, 30 tabs",
    run: () =>
      activeWorkspace(
        selectTab(
          withPanes(model, (p) => focus(p, "left")),
          "tab3",
        ),
      ).activeTab,
    expected: "tab3",
  },
];

const KEYS = Array.from({ length: 64 }, (_, i) => `key-${i}`);
const TABLE = new Map(KEYS.map((k, i) => [k, i]));

/**
 * A fixed workload that no Vimma change can speed up or slow down: string-keyed Map lookups, as
 * the dispatcher's trie does, and integer arithmetic. No allocation, so it optimises the same way
 * in every process. Cases are gated on their ratio to it, so a faster or slower runner of the same
 * CPU model moves both and the ratio stays put.
 */
export function reference() {
  let x = 1;
  for (let i = 0; i < 64; i++) {
    x = (x * 31 + (TABLE.get(KEYS[(i * 7) & 63] ?? "") ?? 0)) | 0;
  }
  return x === 0 ? 1 : Math.abs(x);
}
