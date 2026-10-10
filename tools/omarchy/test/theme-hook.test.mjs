// The Omarchy theme-set hook (spec m5-omarchy-theme, "Instant reload"). omarchy-hook runs every
// file in ~/.config/omarchy/hooks/theme-set.d/ as `bash <file> <theme-name>`; this runs ours the
// same way with a fake vimma-ctl, in a temporary directory, never the user's ~/.config.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("../vimma-theme-reload.sh", import.meta.url));

/** @type {string} */
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vimma-theme-hook-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/**
 * A fake vimma-ctl that records its arguments and exits with `code`.
 * @param {number} code
 */
function fakeCtl(code) {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const ctl = join(bin, "vimma-ctl");
  writeFileSync(
    ctl,
    `#!/bin/sh\necho "$*" >> "${dir}/calls"\necho noise; echo err >&2\nexit ${code}\n`,
  );
  chmodSync(ctl, 0o755);
  return bin;
}

/** @param {Record<string, string>} env */
function runHook(env) {
  return spawnSync("bash", [HOOK, "tokyo-night"], {
    env: { HOME: dir, ...env },
    encoding: "utf8",
    timeout: 10000,
  });
}

const calls = () => readFileSync(join(dir, "calls"), "utf8");

describe("vimma-theme-reload.sh", () => {
  it("asks the running Vimma to reload its theme, with a short timeout", () => {
    const r = runHook({ PATH: `${fakeCtl(0)}:/usr/bin:/bin` });
    expect(r.status).toBe(0);
    expect(calls()).toBe("--timeout 2 reload-theme\n");
    expect(r.stdout + r.stderr).toBe("");
  });

  it("stays quiet and succeeds when Vimma is not running or the socket is off", () => {
    const r = runHook({ PATH: `${fakeCtl(3)}:/usr/bin:/bin` });
    expect(r.status).toBe(0);
    expect(calls()).toBe("--timeout 2 reload-theme\n");
    expect(r.stdout + r.stderr).toBe("");
  });

  it("does nothing without vimma-ctl", () => {
    const r = runHook({ PATH: "/usr/bin:/bin" });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toBe("");
  });

  it("uses VIMMA_CTL when set", () => {
    const ctl = join(fakeCtl(0), "vimma-ctl");
    const r = runHook({ PATH: "/usr/bin:/bin", VIMMA_CTL: ctl });
    expect(r.status).toBe(0);
    expect(calls()).toBe("--timeout 2 reload-theme\n");
  });
});
