#!/usr/bin/env node
// Stands in for Xvfb in the launcher's cancellation tests. Takes Xvfb's `-displayfd N` and
// `-fbdir DIR`, writes DIR/Xvfb_screen0 at once, then after FAKE_XVFB_DELAY_MS (default 0)
// reports display 99 on fd N and stays up. FAKE_XVFB_RECORD names a file where it writes
// { pid, fbdir } first, so a test can check both are gone afterwards.
import { createWriteStream, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const fd = Number(argv[argv.indexOf("-displayfd") + 1]);
const fbdir = argv[argv.indexOf("-fbdir") + 1] ?? "";
if (process.env.FAKE_XVFB_RECORD) {
  writeFileSync(process.env.FAKE_XVFB_RECORD, JSON.stringify({ pid: process.pid, fbdir, argv }));
}
writeFileSync(join(fbdir, "Xvfb_screen0"), "");
setInterval(() => {}, 1000);
setTimeout(
  () => createWriteStream("", { fd }).write("99\n"),
  Number(process.env.FAKE_XVFB_DELAY_MS ?? 0),
);
