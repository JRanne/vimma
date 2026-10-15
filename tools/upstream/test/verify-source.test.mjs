import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "../../test/temp-dir.mjs";
import { fakeSign, withFakeGpgv } from "./fake-gpgv.mjs";

// tools/upstream/verify-source.sh (`npm run verify-source`): checks the tarball a local
// `npx surfer download` left in .surfer/engine/ against Mozilla's signed SHA512SUMS (spec
// build-supply-chain, B1), since Surfer checks nothing. The archive is a file:// directory; gpgv
// is a stub (fake-gpgv.mjs). No network.
const SCRIPT = fileURLToPath(new URL("../verify-source.sh", import.meta.url));
const VERSION = "158.0";
const NAME = `source/firefox-${VERSION}.source.tar.xz`;

/** @param {{ tarball?: string | null, signature?: "good" | "bad" }} [opts] */
function setup(opts = {}) {
  const root = tempDir("verify-source-");
  const dir = join(root, "releases", VERSION);
  mkdirSync(dir, { recursive: true });
  const genuine = "genuine tarball bytes\n";
  const hash = createHash("sha512").update(genuine).digest("hex");
  writeFileSync(join(dir, "SHA512SUMS"), `${"0".repeat(128)}  other\n${hash}  ${NAME}\n`);
  if ((opts.signature ?? "good") === "good") fakeSign(join(dir, "SHA512SUMS"));
  else writeFileSync(join(dir, "SHA512SUMS.asc"), "not mozilla's\n");
  const work = join(root, "checkout");
  mkdirSync(join(work, ".surfer", "engine"), { recursive: true });
  writeFileSync(
    join(work, "surfer.json"),
    JSON.stringify({ version: { product: "firefox", version: VERSION } }),
  );
  const tarball = opts.tarball === undefined ? genuine : opts.tarball;
  if (tarball !== null) {
    writeFileSync(join(work, ".surfer", "engine", `firefox-${VERSION}.source.tar.xz`), tarball);
  }
  const env = withFakeGpgv({
    ...process.env,
    MOZILLA_RELEASES: `file://${join(root, "releases")}`,
  });
  return spawnSync("bash", [SCRIPT], { cwd: work, env, encoding: "utf8" });
}

describe("verify-source.sh", () => {
  it("passes the tarball surfer download left when Mozilla's signed SHA512SUMS lists it", () => {
    const r = setup();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`${NAME} matches`);
  });

  it("fails a tampered tarball", () => {
    const r = setup({ tarball: "evil bytes\n" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/SHA-512 mismatch/);
  });

  it("fails when SHA512SUMS is not signed by Mozilla's release key", () => {
    const r = setup({ signature: "bad" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not signed by Mozilla's release key/);
  });

  it("fails when there is no tarball to check", () => {
    const r = setup({ tarball: null });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/npx surfer download/);
  });
});
