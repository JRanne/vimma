// Runs our mochitests through mach. `surfer import` symlinks tests/ under this engine path.
// --artifact: against the artifact build (ADR-010, tools/artifact-build/artifact-build.mjs).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ENGINE_TESTS = "browser/base/zen-components/";

/**
 * @param {string[]} argv arguments after `npm run mochitest --`
 * @param {string} engine absolute path of engine/, with a trailing slash
 * @returns {{ args: string[], env: Record<string, string> }} mach arguments and extra env
 */
export function mochitestCommand(argv, engine) {
  const flags = argv.filter((a) => a.startsWith("-"));
  const paths = argv.filter((a) => !a.startsWith("-"));
  const mapped = (paths.length ? paths : ["tests/browser/"]).map(
    (p) => ENGINE_TESTS + p.replace(/^\.\//, ""),
  );
  const headless = flags.includes("--headed") ? [] : ["--headless"];
  const artifact = flags.includes("--artifact");
  const rest = flags.filter((f) => f !== "--headed" && f !== "--artifact");
  if (!artifact) return { args: ["mochitest", ...headless, ...rest, ...mapped], env: {} };
  return {
    args: [
      "mochitest",
      ...headless,
      `--setenv=XUL_APP_FILE=${engine}obj-artifact/dist/bin/browser/application.ini`,
      ...rest,
      ...mapped,
    ],
    env: { MOZCONFIG: `${engine}mozconfig.artifact` },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const engine = new URL("../engine/", import.meta.url).pathname;
  const { args, env } = mochitestCommand(process.argv.slice(2), engine);
  const res = spawnSync("./mach", args, {
    cwd: engine,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  process.exit(res.status ?? 1);
}
