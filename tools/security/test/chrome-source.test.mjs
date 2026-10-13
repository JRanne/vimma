// docs/security.md: rules about what Vimma's chrome code never does, checked over its source.
// Chrome code runs with full privileges, so these hold for every file, not one feature: a
// string that reaches the DOM as HTML, code built from text, a process started or an add-on
// installed would each turn a page title, a config value or a clipboard into an attack.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const CHROME = join(ROOT, "src/browser/base/content/vimma");

/** Our chrome sources; core/ is a copy of packages/vimma-core/src (npm run sync-core). */
function sources() {
  /** @type {{ path: string, text: string }[]} */
  const out = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (relative(CHROME, p) !== "core") walk(p);
      } else if (/\.(m?js|html)$/.test(e.name)) {
        out.push({ path: relative(ROOT, p), text: readFileSync(p, "utf8") });
      }
    }
  };
  walk(CHROME);
  walk(join(ROOT, "packages/vimma-core/src"));
  return out;
}

/** "path:line: text" for every line of our sources that matches `re`. */
function hits(/** @type {RegExp} */ re) {
  return sources().flatMap(({ path, text }) =>
    text
      .split("\n")
      .flatMap((line, i) => (re.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : [])),
  );
}

describe("chrome code", () => {
  test("sanity: the scan sees our sources", () => {
    const paths = sources().map((s) => s.path);
    expect(paths).toContain("src/browser/base/content/vimma/ui/picker.mjs");
    expect(paths).toContain("src/browser/base/content/vimma/ctl/VimmaControl.sys.mjs");
  });

  test("never parses strings as HTML: page titles, add-on and bookmark names stay text", () => {
    expect(
      hits(
        /\.(innerHTML|outerHTML)\s*[+]?=|insertAdjacentHTML|createContextualFragment|parseFromString|\.setHTML(Unsafe)?\(|document\.write/,
      ),
    ).toEqual([]);
  });

  test("never builds code from text: no eval, Function or sandbox evaluation", () => {
    expect(hits(/\beval\(|new Function\b|\bFunction\(|evalInSandbox|loadSubScript/)).toEqual([]);
  });

  // C2's one exception (docs/specs/vimma-mcp.md decision 31 g, user-approved): an agent
  // download is scanned with ClamAV when `clamscan` is on PATH. One file, one program, fixed
  // arguments, no shell; nothing else in chrome starts a process.
  test("never starts a process, but clamscan on an agent download", () => {
    const CLAM = "src/browser/base/content/vimma/ctl/AgentDownloads.sys.mjs";
    const all = hits(/Subprocess|nsIProcess|@mozilla\.org\/process\/|\.launch\(\)|\.reveal\(\)/);
    expect(all.filter((h) => !h.startsWith(`${CLAM}:`))).toEqual([]);
    const text = readFileSync(join(ROOT, CLAM), "utf8");
    expect([...text.matchAll(/Subprocess\.(?!sys\b)(\w+)/g)].map((m) => m[1]).sort()).toEqual([
      "call",
      "pathSearch",
    ]);
    expect(text).toContain('Subprocess.pathSearch("clamscan")');
    expect(text).toMatch(/arguments: \["--no-summary", "--stdout", path\]/);
    expect(text).not.toMatch(/nsIProcess|\/bin\/sh|"sh"|"-c"/);
  });

  test("never installs an add-on", () => {
    expect(
      hits(
        /getInstallForURL|getInstallForFile|installAddonFromWebpage|installAddonFromAOM|installTemporaryAddon|installBuiltinAddon|\.install\(\)/,
      ),
    ).toEqual([]);
  });
});
