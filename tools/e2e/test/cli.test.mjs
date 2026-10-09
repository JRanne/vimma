// The CLI's guard: baselines change only in a reviewed commit, never from a CI run.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../e2e.mjs", import.meta.url));

describe("npm run e2e", () => {
  it("refuses --update-baselines when CI is set (exit 2, before launching anything)", () => {
    const r = spawnSync(process.execPath, [CLI, "--update-baselines", "--filter", "no-such"], {
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
      timeout: 30_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--update-baselines is refused in CI/);
  });
});
