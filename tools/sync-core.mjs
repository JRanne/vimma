// Copies packages/vimma-core/src/*.mjs into the chrome tree (git-ignored; see m0-key-capture spec).
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";

const root = new URL("../", import.meta.url);
const from = new URL("packages/vimma-core/src/", root);
const to = new URL("src/browser/base/content/vimma/core/", root);

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
const files = readdirSync(from).filter((f) => f.endsWith(".mjs"));
for (const f of files) copyFileSync(new URL(f, from), new URL(f, to));
console.log(`sync-core: ${files.length} modules -> ${to.pathname}`);
