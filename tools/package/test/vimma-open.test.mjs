// vimma-open (spec workspace-routing, decision 6): the desktop entry's launcher walks its parent
// processes in /proc, past openers and shells, to the app that opened the link, and runs
// `vimma -vimma-from <app> <url>`. Run here against fake /proc trees and a fake vimma.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const LAUNCHER = fileURLToPath(new URL("../vimma-open.sh", import.meta.url));

/** @type {string} */
let dir;
/** @type {string} */
let proc;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vimma-open-"));
  proc = join(dir, "proc");
  mkdirSync(proc);
  // A fake vimma: its arguments one per line, then VIMMA_FROM.
  const fake = join(dir, "vimma");
  writeFileSync(
    fake,
    `#!/bin/sh\n: > "${dir}/calls"\nfor a in "$@"; do printf '%s\\n' "$a" >> "${dir}/calls"; done\nprintf 'VIMMA_FROM=%s\\n' "\${VIMMA_FROM-unset}" >> "${dir}/calls"\n`,
  );
  chmodSync(fake, 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/**
 * A fake /proc/<pid>: `stat` (with the comm in parentheses, as the kernel writes it), `comm`
 * (truncated to 15 bytes, as the kernel does) and, when given, an `exe` link.
 * @param {number} pid
 * @param {string} comm
 * @param {number} ppid
 * @param {string} [exe]
 */
function processEntry(pid, comm, ppid, exe) {
  const d = join(proc, String(pid));
  mkdirSync(d);
  writeFileSync(join(d, "stat"), `${pid} (${comm}) S ${ppid} ${pid} ${pid} 0 -1 4194304 1 0\n`);
  writeFileSync(join(d, "comm"), `${comm.slice(0, 15)}\n`);
  if (exe) symlinkSync(exe, join(d, "exe"));
}

/**
 * Runs the launcher as if its parent were `ppid`.
 * @param {string[]} args
 * @param {{ ppid?: number, env?: Record<string, string>, launcher?: string }} [options]
 * @returns {{ args: string[], from: string, status: number | null }}
 */
function run(args, { ppid = 0, env = {}, launcher = LAUNCHER } = {}) {
  const r = spawnSync("sh", [launcher, ...args], {
    env: {
      PATH: "/usr/bin:/bin",
      VIMMA_OPEN_PROC: proc,
      VIMMA_OPEN_PPID: String(ppid),
      VIMMA_BIN: join(dir, "vimma"),
      ...env,
    },
    encoding: "utf8",
  });
  const lines = readFileSync(join(dir, "calls"), "utf8").trimEnd().split("\n");
  const from = /** @type {string} */ (lines.pop());
  return { args: lines, from, status: r.status };
}

const LINK = "https://github.com/JRanne/vimma";

describe("vimma-open", () => {
  it("names the app behind xdg-open", () => {
    processEntry(1, "systemd", 0);
    processEntry(100, "slack", 1, "/usr/lib/slack/slack");
    processEntry(200, "xdg-open", 100);
    expect(run([LINK], { ppid: 200 })).toEqual({
      args: ["-vimma-from", "slack", LINK],
      from: "VIMMA_FROM=slack",
      status: 0,
    });
  });

  it("skips shells: a link nvim opens in a terminal is nvim's", () => {
    processEntry(1, "systemd", 0);
    processEntry(300, "alacritty", 1);
    processEntry(310, "nvim", 300);
    processEntry(320, "sh", 310);
    processEntry(330, "xdg-open", 320);
    expect(run([LINK], { ppid: 330 }).args).toEqual(["-vimma-from", "nvim", LINK]);
  });

  it("a link typed into a shell is the terminal's", () => {
    processEntry(1, "systemd", 0);
    processEntry(300, "alacritty", 1);
    processEntry(310, "zsh", 300);
    processEntry(320, "xdg-open", 310);
    expect(run([LINK], { ppid: 320 }).args).toEqual(["-vimma-from", "alacritty", LINK]);
  });

  it("skips gio and its launch helper (comm truncated to 15 bytes)", () => {
    processEntry(1, "systemd", 0);
    processEntry(400, "Discord", 1);
    processEntry(410, "gio", 400);
    processEntry(420, "gio-launch-desktop", 410);
    expect(run([LINK], { ppid: 420 }).args).toEqual(["-vimma-from", "discord", LINK]);
  });

  it("knows no app behind the portal (a Flatpak app)", () => {
    processEntry(1, "systemd", 0);
    processEntry(500, "xdg-desktop-portal", 1);
    expect(run([LINK], { ppid: 500 })).toEqual({
      args: [LINK],
      from: "VIMMA_FROM=unset",
      status: 0,
    });
  });

  it("knows no app when systemd started it (uwsm app, app2unit)", () => {
    processEntry(1, "systemd", 0);
    processEntry(600, "systemd", 1);
    processEntry(610, "sh", 600);
    expect(run([LINK], { ppid: 610 }).args).toEqual([LINK]);
  });

  it("knows no app when the parent is gone (reparented to pid 1)", () => {
    processEntry(1, "systemd", 0);
    expect(run([LINK], { ppid: 1 }).args).toEqual([LINK]);
    expect(run([LINK], { ppid: 999 }).args).toEqual([LINK]);
  });

  it("skips the AppImage runtime that started it", () => {
    processEntry(1, "systemd", 0);
    processEntry(700, "slack", 1);
    processEntry(710, "xdg-open", 700);
    processEntry(720, "Vimma-1.0.0-x8", 710, "/opt/apps/Vimma-1.0.0-x86_64.AppImage");
    const r = run([LINK], {
      ppid: 720,
      env: { APPIMAGE: "/opt/apps/Vimma-1.0.0-x86_64.AppImage" },
    });
    expect(r.args).toEqual(["-vimma-from", "slack", LINK]);
  });

  it("never passes a name that is not a simple token", () => {
    processEntry(1, "systemd", 0);
    for (const [pid, comm] of /** @type {[number, string][]} */ ([
      [800, "My App"],
      [801, "../../etc"],
      [802, "-x"],
      [803, "a;rm -rf ~"],
      [804, "ä"],
    ])) {
      processEntry(pid, comm, 1);
      expect(run([LINK], { ppid: pid }).args, comm).toEqual([LINK]);
    }
  });

  it("stops on a loop in the tree and after 16 steps", () => {
    processEntry(900, "sh", 900);
    expect(run([LINK], { ppid: 900 }).args).toEqual([LINK]);
    for (let pid = 1000; pid < 1020; pid++) processEntry(pid, "sh", pid + 1);
    processEntry(1020, "slack", 1);
    expect(run([LINK], { ppid: 1000 }).args).toEqual([LINK]);
  });

  it("passes anything but one URL through unchanged", () => {
    processEntry(1, "systemd", 0);
    processEntry(100, "slack", 1);
    expect(run([], { ppid: 100 }).args).toEqual([]);
    expect(run(["--new-window", LINK], { ppid: 100 }).args).toEqual(["--new-window", LINK]);
    expect(run([LINK, LINK], { ppid: 100 }).args).toEqual([LINK, LINK]);
    expect(run(["-private-window"], { ppid: 100 }).args).toEqual(["-private-window"]);
  });

  it("runs the vimma next to it when VIMMA_BIN is not set", () => {
    processEntry(1, "systemd", 0);
    processEntry(100, "slack", 1);
    const lib = join(dir, "lib");
    mkdirSync(lib);
    const launcher = join(lib, "vimma-open");
    copyFileSync(LAUNCHER, launcher);
    copyFileSync(join(dir, "vimma"), join(lib, "vimma"));
    chmodSync(join(lib, "vimma"), 0o755);
    rmSync(join(dir, "vimma"));
    const r = spawnSync("sh", [launcher, LINK], {
      env: { PATH: "/usr/bin:/bin", VIMMA_OPEN_PROC: proc, VIMMA_OPEN_PPID: "100" },
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, "calls"), "utf8")).toBe(
      `-vimma-from\nslack\n${LINK}\nVIMMA_FROM=slack\n`,
    );
  });
});
