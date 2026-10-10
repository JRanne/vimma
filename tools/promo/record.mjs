#!/usr/bin/env node
/**
 * Records the promo video's footage from a real Vimma build: each shot in tools/promo/shots.mjs
 * gets a fresh throwaway profile (the e2e harness's, plus promoPrefs), runs under its own Xvfb
 * and is driven through vimma-ctl, while ffmpeg's x11grab records the screen. The pages are the
 * fictional sites in tools/promo/fixtures, served by the harness's page server acting as an
 * HTTP proxy: no real website and no network. The video itself is composited elsewhere
 * (vimma-site: npm run video); this writes the raw clips and what happened in them.
 *
 *   node tools/promo/record.mjs --out DIR                       # every shot, 1920x1080
 *   node tools/promo/record.mjs --out DIR --geometry 1080x1920 --shots keys,panes,theme
 *   node tools/promo/record.mjs --out DIR --pace 800            # slower: ms per beat
 *
 * Options: --scale (device pixels per CSS pixel, default 1.5), --fps (default 30), --build
 * and --vimma-ctl (as npm run e2e; VIMMA_E2E_BUILD and VIMMA_CTL work too), --keep (keep the
 * profiles). Needs Xvfb and ffmpeg (with x11grab and libx264).
 *
 * Writes DIR/<shot>.mkv (lossless H.264) and DIR/manifest.json: per shot its file, duration,
 * the keys sent with their times from the clip's first frame (the key-overlay track) and named
 * marks, and screen points of interest (`points`, device pixels). Exit 0 on success, 1 on a failure, 2 on usage errors.
 */
import { spawn } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Ctl, findVimmaCtl } from "../e2e/driver.mjs";
import { findBuild, launch, quitBrowser, startXvfb } from "../e2e/launcher.mjs";
import { startPageServer } from "../e2e/pages.mjs";
import { READ_PATH_PREF, devPrefs } from "../start.mjs";
import { KeyTrack, cssWindow, parseGeometry, parseProbeTitle, promoPrefs } from "./promo.mjs";
import { SHOTS } from "./shots.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const THEMES = join(HERE, "themes");
const LIGHT_THEMES = new Set(["rose-pine"]);

const OPTIONS = /** @type {const} */ ({
  out: { type: "string" },
  geometry: { type: "string", default: "1920x1080" },
  scale: { type: "string", default: "1.5" },
  pace: { type: "string", default: "700" },
  fps: { type: "string", default: "30" },
  shots: { type: "string" },
  build: { type: "string" },
  "vimma-ctl": { type: "string" },
  keep: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
});

/** @param {string} message */
function usage(message) {
  process.stderr.write(
    `promo: ${message}\nSee the comment at the top of tools/promo/record.mjs.\n`,
  );
  process.exit(2);
}

/**
 * Write a theme into the temp theme directory the profile reads (vimma.theme.omarchyPath):
 * colors.toml, and light.mode for a light theme, as omarchy-theme-set leaves them.
 * @param {string} dir
 * @param {string} name a file in tools/promo/themes
 */
function writeTheme(dir, name) {
  copyFileSync(join(THEMES, `${name}.colors.toml`), join(dir, "colors.toml.tmp"));
  rmSync(join(dir, "colors.toml"), { force: true });
  copyFileSync(join(dir, "colors.toml.tmp"), join(dir, "colors.toml"));
  rmSync(join(dir, "colors.toml.tmp"));
  if (LIGHT_THEMES.has(name)) writeFileSync(join(dir, "light.mode"), "");
  else rmSync(join(dir, "light.mode"), { force: true });
}

/**
 * A local build's chrome files lead into its checkout's src/ (tools/start.mjs), which the
 * content sandbox must be allowed to read. The harness allows this checkout's; a build from
 * another checkout (--build ../vimma/engine/...) needs that one's too, or the content actors
 * (hints, scrolling) fail to load.
 * @param {string} binary
 * @returns {Record<string, string>}
 */
function sandboxPrefs(binary) {
  const m = /^(.*)\/engine\/obj-[^/]+\/dist\/bin\/[^/]+$/.exec(binary);
  if (!m?.[1] || !existsSync(join(m[1], "src"))) return {};
  const paths = new Set([...devPrefs(REPO), ...devPrefs(m[1])].map(([, v]) => String(v)));
  return { [READ_PATH_PREF]: [...paths].join(",") };
}

/**
 * Screen recording with ffmpeg's x11grab. x11grab stamps each frame with the wall clock, and
 * -copyts keeps those stamps, so the file's start time is the first frame's epoch time: the
 * origin of the key track.
 * @param {{ display: string, width: number, height: number, fps: number, file: string }} o
 */
async function startRecording({ display, width, height, fps, file }) {
  const child = spawn(
    "ffmpeg",
    [
      ...["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1"],
      ...["-f", "x11grab", "-draw_mouse", "0", "-framerate", String(fps)],
      ...["-video_size", `${width}x${height}`, "-i", display],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-pix_fmt", "yuv444p"],
      ...["-copyts", "-y", file],
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
  const exited = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  // wait until frames are being written: progress reports frame=N
  await new Promise((resolve, reject) => {
    let buf = "";
    const onData = (/** @type {Buffer} */ d) => {
      buf += d;
      const frames = [...buf.matchAll(/^frame=(\d+)$/gm)].map((m) => Number(m[1]));
      if (frames.some((n) => n >= 2)) {
        child.stdout.off("data", onData);
        child.stdout.resume();
        resolve(undefined);
      }
    };
    child.stdout.on("data", onData);
    child.on("error", reject);
    exited.then((code) => reject(new Error(`ffmpeg exited (${code}) before recording: ${stderr}`)));
  });
  return {
    pid: child.pid,
    async stop() {
      child.stdin.end("q");
      const code = await exited;
      if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${stderr}`);
    },
  };
}

/**
 * @param {string[]} args
 * @returns {Promise<string>} stdout
 */
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} failed (${code}): ${err.trim()}`)),
    );
  });
}

/**
 * The raw capture's first-frame time (epoch ms), and a copy re-based to start at 0.
 * @param {string} raw
 * @param {string} clip
 */
async function finishClip(raw, clip) {
  const probe = JSON.parse(
    await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=start_time,duration",
      "-of",
      "json",
      raw,
    ]),
  );
  const start = Number(probe.format.start_time);
  if (!(start > 1e9))
    throw new Error(`${raw}: no wall-clock start time (${probe.format.start_time})`);
  await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-c", "copy", clip]);
  const duration = Number(
    JSON.parse(
      await run("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        clip,
      ]),
    ).format.duration,
  );
  return { origin: start * 1000, duration };
}

/**
 * What a shot can do. Every keystroke goes through vimma-ctl send-keys and onto the key track.
 */
export class Director {
  /**
   * @param {{ ctl: Ctl, pace: number, themeDir: string, track: KeyTrack }} o
   */
  constructor({ ctl, pace, themeDir, track }) {
    this.ctl = ctl;
    this.pace = pace;
    this.themeDir = themeDir;
    this.track = track;
    /** @type {Record<string, string>} hint labels worked out in setup */
    this.labels = {};
    /** @type {Record<string, { x: number, y: number }>} screen points for the video's zoom */
    this.points = {};
  }

  /** @returns {Promise<any>} */
  state() {
    return this.ctl.state();
  }

  /**
   * Wait for the state to satisfy `test`, polling every 50 ms.
   * @param {(state: any) => boolean} test
   * @param {string} what
   * @param {number} [timeoutMs]
   */
  async until(test, what, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    for (;;) {
      last = await this.ctl.state();
      if (test(last)) return last;
      if (Date.now() >= deadline) {
        throw new Error(`waited ${timeoutMs} ms for ${what}; state: ${JSON.stringify(last)}`);
      }
      await sleep(50);
    }
  }

  /** A pacing pause, in beats of --pace, so a viewer can follow. @param {number} beats */
  hold(beats) {
    return sleep(Math.round(beats * this.pace));
  }

  /** Keys sent off camera (setup): not on the key track. @param {string} keys */
  send(keys) {
    return this.ctl.sendKeys(keys);
  }

  /**
   * One keystroke (or chord sequence) on camera, then `beats` of pause.
   * @param {string} keys
   * @param {number} [beats]
   */
  async key(keys, beats = 1) {
    this.track.key(keys, Date.now());
    await this.ctl.sendKeys(keys);
    await this.hold(beats);
  }

  /** `ctrl+b`, a short beat (the status bar shows "prefix"), then `k`. @param {string} k */
  async prefix(k) {
    await this.key("ctrl+b", 0.7);
    await this.key(k, 0);
  }

  /** Type text a character at a time. @param {string} text @param {number} beats */
  async type(text, beats) {
    for (const c of text) await this.key(c === " " ? "space" : c, beats);
  }

  /** @param {string} url */
  open(url) {
    return this.ctl.open(url);
  }

  /** @param {string} name */
  mark(name) {
    this.track.mark(name, Date.now());
  }

  /**
   * Swap the theme file, as omarchy-theme-set does, and have Vimma read it now (what
   * Omarchy's theme-set hook does). Marked on the track as `theme:<name>`.
   * @param {string} name
   */
  async theme(name) {
    writeTheme(this.themeDir, name);
    this.mark(`theme:${name}`);
    const out = await this.ctl.run(["reload-theme"]);
    if (/false/.test(out))
      throw new Error(`reload-theme did not change the theme to ${name}: ${out}`);
  }

  /**
   * The hint label Vimma will give the page's target link: load `url#probe` (fixtures/probe.js
   * titles it with the label, worked out with vimma-core's hints.mjs), then close that tab.
   * @param {string} url
   */
  async probeHintLabel(url) {
    await this.open(`${url}#probe`);
    const s = await this.until(
      (st) =>
        st.tabs.some((/** @type {any} */ t) => t.selected && /^probe(-error)?:/.test(t.title)),
      "the probe page's report",
    );
    const tab = s.tabs.find((/** @type {any} */ t) => t.selected);
    const report = parseProbeTitle(tab.title);
    if (!report) throw new Error("no probe report");
    const count = s.tabs.length;
    await this.send("ctrl+b shift+x");
    await this.until((st) => st.tabs.length === count - 1, "the probe tab closed");
    return report;
  }
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({ options: OPTIONS, allowPositionals: false }));
  } catch (e) {
    return usage(/** @type {Error} */ (e).message);
  }
  if (values.help) {
    process.stdout.write("See the comment at the top of tools/promo/record.mjs.\n");
    return 0;
  }
  if (!values.out) return usage("--out DIR is required");
  const screen = parseGeometry(values.geometry);
  const scale = Number(values.scale);
  const pace = Number(values.pace);
  const fps = Number(values.fps);
  if (!(pace >= 100 && pace <= 5000)) return usage("--pace is ms per beat, 100 to 5000");
  if (![24, 25, 30, 50, 60].includes(fps)) return usage("--fps is 24, 25, 30, 50 or 60");
  const names = values.shots ? values.shots.split(",") : SHOTS.map((s) => s.name);
  const shots = names.map((n) => {
    const shot = SHOTS.find((s) => s.name === n);
    if (!shot) return usage(`no shot "${n}"; there are ${SHOTS.map((s) => s.name).join(", ")}`);
    return shot;
  });
  const window = cssWindow(screen, scale);

  const build = findBuild({ build: values.build, env: process.env });
  const ctlBin = findVimmaCtl({ flag: values["vimma-ctl"], env: process.env });
  const out = values.out;
  mkdirSync(out, { recursive: true });
  console.log(
    `promo: build ${build.binary}\npromo: ${values.geometry} at ${scale}x, pace ${pace} ms`,
  );

  /** @type {Array<() => Promise<void>>} */
  const cleanups = [];
  const cleanupAll = async () => {
    for (const c of cleanups.splice(0).reverse()) await c().catch(() => {});
  };
  for (const [sig, code] of /** @type {const} */ ([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ])) {
    process.once(sig, () => cleanupAll().finally(() => process.exit(code)));
  }

  try {
    // the fixtures, plus vimma-core's hints.mjs for probe.js (as .js: the server's types)
    const served = mkdtempSync(join(tmpdir(), "vimma-promo-pages-"));
    cleanups.push(async () => rmSync(served, { recursive: true, force: true }));
    cpSync(FIXTURES, served, { recursive: true });
    copyFileSync(join(REPO, "packages/vimma-core/src/hints.mjs"), join(served, "hints.js"));
    const pages = await startPageServer(served);
    cleanups.push(() => pages.close());
    const port = Number(new URL(pages.base).port);
    const display = await startXvfb({ ...screen });
    cleanups.push(() => display.stop());
    const themeDir = mkdtempSync(join(tmpdir(), "vimma-promo-theme-"));
    cleanups.push(async () => rmSync(themeDir, { recursive: true, force: true }));
    // our own Xvfb at the full screen size, with the window in CSS pixels: launch()'s own
    // Xvfb would be the window's size, which is smaller once devPixelsPerPx is over 1
    const baseEnv = { ...process.env, DISPLAY: display.display };
    delete baseEnv.WAYLAND_DISPLAY;
    const env = { ...build.env, GDK_BACKEND: "x11", MOZ_ENABLE_WAYLAND: "0" };

    const manifest = {
      geometry: screen,
      scale,
      fps,
      pace,
      /** @type {any[]} */
      shots: [],
    };
    for (const shot of shots) {
      console.log(`promo: ${shot.name}`);
      writeTheme(themeDir, "tokyo-night");
      /** @type {() => Promise<void>} */
      let teardown = async () => {};
      const session = await launch({
        build: { binary: build.binary, env },
        xvfb: false,
        baseEnv,
        window,
        keep: values.keep,
        prefs: { ...promoPrefs({ port, themeDir, scale }), ...sandboxPrefs(build.binary) },
        onTeardown: (t) => {
          teardown = t;
          cleanups.push(t);
        },
        log: (line) => console.log(`  ${line}`),
      });
      const ctl = new Ctl({ bin: ctlBin, profile: session.profile });
      await ctl.ready();
      const track = new KeyTrack();
      const director = new Director({ ctl, pace, themeDir, track });
      await director.until((s) => s.workspace === "main", "the first window", 20_000);
      await shot.setup(director);
      const raw = join(out, `${shot.name}.raw.mkv`);
      const recording = await startRecording({
        display: display.display,
        ...screen,
        fps,
        file: raw,
      });
      try {
        await shot.run(director);
      } finally {
        await recording.stop();
      }
      if (!(await quitBrowser({ ctl, child: session.child }))) {
        console.log("  ctrl+q did not quit the browser; signalling it");
      }
      const failed = session.loadFailure();
      await teardown();
      if (failed) throw new Error(`the browser logged "${failed}"`);
      const file = `${shot.name}.mkv`;
      const { origin, duration } = await finishClip(raw, join(out, file));
      rmSync(raw);
      const { keys, marks } = track.resolve(origin);
      manifest.shots.push({
        name: shot.name,
        file,
        duration,
        keys,
        marks,
        points: director.points,
      });
      console.log(`  ${file}: ${duration.toFixed(2)} s, ${keys.length} keys`);
    }
    writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`promo: wrote ${join(out, "manifest.json")}`);
    return 0;
  } finally {
    await cleanupAll();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`promo: ${e instanceof Error ? e.stack : String(e)}\n`);
      process.exit(1);
    },
  );
}
