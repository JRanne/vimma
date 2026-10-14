import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CFR, SB_LISTS, checkPrefs, prefLine, readPref } from "../upstream-prefs.mjs";
import { tempDir } from "../../test/temp-dir.mjs";

const script = fileURLToPath(new URL("../upstream-prefs.mjs", import.meta.url));
const ours = readFileSync(
  new URL("../../../src/browser/branding/vimma/pref/firefox-branding.js", import.meta.url),
  "utf8",
);

// Upstream's lines as in Firefox 157.0.1 (browser/app/profile/firefox.js, modules/libpref/init/all.js).
const firefoxJs =
  'pref("browser.newtabpage.activity-stream.asrouter.providers.cfr", "{\\"id\\":\\"cfr\\",' +
  '\\"enabled\\":true,\\"type\\":\\"remote-settings\\",\\"collection\\":\\"cfr\\",' +
  '\\"updateCycleInMs\\":3600000}");\n';
const allJs =
  'pref("browser.safebrowsing.provider.google4.lists", "goog-badbinurl-proto,' +
  "goog-downloadwhite-proto,goog-phish-proto,googpub-phish-proto,goog-malware-proto," +
  'goog-unwanted-proto,goog-harmful-proto");\n' +
  'pref("browser.safebrowsing.provider.google5.lists", "goog-badbinurl-proto,' +
  "goog-downloadwhite-proto,goog-phish-proto,googpub-phish-proto,goog-malware-proto," +
  'goog-unwanted-proto,goog-harmful-proto,goog-globalcache-proto");\n';

describe("upstream prefs we carry copies of", () => {
  it("reads a pref's string value, escapes and all", () => {
    expect(readPref(firefoxJs, CFR)).toBe(
      '{"id":"cfr","enabled":true,"type":"remote-settings","collection":"cfr","updateCycleInMs":3600000}',
    );
    expect(readPref(firefoxJs, "no.such.pref")).toBeNull();
  });

  it("our branding prefs match Firefox 157.0.1's", () => {
    expect(checkPrefs({ firefoxJs, allJs, ours })).toEqual([]);
  });

  it("a new upstream cfr field is reported with the line to paste", () => {
    const newer = firefoxJs.replace("3600000}", '3600000,\\"frequency\\":2}');
    const [problem, ...rest] = checkPrefs({ firefoxJs: newer, allJs, ours });
    expect(rest).toEqual([]);
    expect(problem?.pref).toBe(CFR);
    expect(problem?.want).toBe(
      '{"id":"cfr","enabled":false,"type":"remote-settings","collection":"cfr",' +
        '"updateCycleInMs":3600000,"frequency":2}',
    );
    expect(prefLine(CFR, problem?.want ?? "")).toBe(
      `pref("${CFR}", "{\\"id\\":\\"cfr\\",\\"enabled\\":false,\\"type\\":\\"remote-settings\\",` +
        '\\"collection\\":\\"cfr\\",\\"updateCycleInMs\\":3600000,\\"frequency\\":2}");',
    );
  });

  it("a new upstream Safe Browsing list is reported, minus the Mozilla-key lists", () => {
    const newer = allJs.replace('goog-harmful-proto")', 'goog-harmful-proto,goog-new-proto")');
    const problems = checkPrefs({ firefoxJs, allJs: newer, ours });
    expect(problems.map((p) => [p.pref, p.want])).toEqual([
      [
        SB_LISTS[0],
        "goog-phish-proto,googpub-phish-proto,goog-malware-proto,goog-unwanted-proto," +
          "goog-harmful-proto,goog-new-proto",
      ],
    ]);
  });

  it("a pref upstream renamed or removed is its own problem, not a silent pass", () => {
    const problems = checkPrefs({ firefoxJs: "", allJs, ours });
    expect(problems).toEqual([
      { pref: CFR, ours: expect.any(String), want: null, missing: "upstream" },
    ]);
  });

  it("the CLI exits 0 when current, 1 with the fix when stale", () => {
    const engine = tempDir("prefs-");
    mkdirSync(join(engine, "browser/app/profile"), { recursive: true });
    mkdirSync(join(engine, "modules/libpref/init"), { recursive: true });
    writeFileSync(join(engine, "browser/app/profile/firefox.js"), firefoxJs);
    writeFileSync(join(engine, "modules/libpref/init/all.js"), allJs);
    const run = () =>
      spawnSync(process.execPath, [script, "--engine", engine], { encoding: "utf8" });
    const ok = run();
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("up to date");
    writeFileSync(
      join(engine, "modules/libpref/init/all.js"),
      allJs.replace("goog-phish-proto,", ""),
    );
    const stale = run();
    expect(stale.status).toBe(1);
    expect(stale.stdout).toContain(`pref("${SB_LISTS[0]}", "googpub-phish-proto,`);
  });
});
