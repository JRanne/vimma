// Regenerates packages/vimma-core/defaults.toml, docs/bindings.md and docs/bindings.json (which
// vimma.dev mirrors: docs/specs/site-keys-mirror.md) from vimma-core.
import { writeFileSync } from "node:fs";
import {
  bindingTable,
  bindingsJson,
  compileKeymap,
  formatDefaultsToml,
  keyLegend,
} from "../packages/vimma-core/src/index.mjs";

const root = new URL("../", import.meta.url);
writeFileSync(new URL("packages/vimma-core/defaults.toml", root), formatDefaultsToml());

const keymap = compileKeymap();
const rows = bindingTable(keymap);
/** @param {string} s */
const cell = (s) => s.replaceAll("|", "\\|");
const lines = [
  "# Default bindings",
  "",
  "Generated from `packages/vimma-core/src/actions.mjs` and `defaults.mjs` by `npm run gen-docs`; do not edit.",
  "",
  `Keys as you press them, with the default keys filled in (\`${keyLegend(keymap)}\`).`,
  "A `[mode]` after a key means it works only in that mode. In `config.toml` the same bindings",
  "are written in notation: `ctrl+b b` is `prefix+b`; a leader binding you add, `<leader>n`,",
  "shows as `space n` ([guide](guide.md#configtoml)).",
];
let group = "";
for (const r of rows) {
  if (r.group !== group) {
    lines.push(
      "",
      `## ${r.group}`,
      "",
      "| Action | Config name | Bindings |",
      "| --- | --- | --- |",
    );
    group = r.group;
  }
  const keys = r.bindings.length ? r.bindings.map((b) => `\`${cell(b)}\``).join(", ") : "—";
  lines.push(`| ${cell(r.description)} | \`${r.name}\` | ${keys} |`);
}
writeFileSync(new URL("docs/bindings.md", root), lines.join("\n") + "\n");
writeFileSync(
  new URL("docs/bindings.json", root),
  JSON.stringify(bindingsJson(keymap), null, 2) + "\n",
);
console.log("wrote packages/vimma-core/defaults.toml, docs/bindings.md, docs/bindings.json");
