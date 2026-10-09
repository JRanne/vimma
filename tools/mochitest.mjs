// Runs our mochitests through mach. `surfer import` symlinks tests/ under this engine path.
import { spawnSync } from "node:child_process";

const ENGINE_TESTS = "browser/base/zen-components/";
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("-"));
const paths = args.filter((a) => !a.startsWith("-"));
const mapped = (paths.length ? paths : ["tests/browser/"]).map(
  (p) => ENGINE_TESTS + p.replace(/^\.\//, ""),
);
const headless = flags.includes("--headed") ? [] : ["--headless"];
const rest = flags.filter((f) => f !== "--headed");

const engine = new URL("../engine/", import.meta.url).pathname;
const res = spawnSync("./mach", ["mochitest", ...headless, ...rest, ...mapped], {
  cwd: engine,
  stdio: "inherit",
});
process.exit(res.status ?? 1);
