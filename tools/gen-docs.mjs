// Regenerates packages/vimma-core/defaults.toml and docs/bindings.md from vimma-core.
import { writeFileSync } from "node:fs";
import {
  bindingTable,
  compileKeymap,
  formatDefaultsToml,
} from "../packages/vimma-core/src/index.mjs";

const root = new URL("../", import.meta.url);
writeFileSync(new URL("packages/vimma-core/defaults.toml", root), formatDefaultsToml());

const rows = bindingTable(compileKeymap());
/** @param {string} s */
const cell = (s) => s.replaceAll("|", "\\|");
const lines = [
  "# Default bindings",
  "",
  "Generated from `packages/vimma-core/src/actions.mjs` and `defaults.mjs` by `npm run gen-docs`; do not edit.",
  "",
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
console.log("wrote packages/vimma-core/defaults.toml, docs/bindings.md");
