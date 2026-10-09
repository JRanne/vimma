// Drives a running Vimma through `vimma-ctl` (spec m0-e2e-harness), so the e2e suite dogfoods
// the shipped client. Exit codes and messages are vimma-ctl's (spec
// m0-control-protocol-and-vimma-ctl). Only ready() retries, and only while the socket is not up
// yet or busy; commands and assertions run once (plan §5: no retries).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** @typedef {"server" | "usage" | "not-running" | "busy" | "auth" | "protocol" | "spawn"} CtlErrorKind */

export class CtlError extends Error {
  /**
   * @param {string} message
   * @param {{ kind: CtlErrorKind, code: string | null, exitCode: number | null, stderr: string }} details
   */
  constructor(message, { kind, code, exitCode, stderr }) {
    super(message);
    this.name = "CtlError";
    this.kind = kind;
    this.code = code;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Map a vimma-ctl exit code and stderr to an error kind and, when there is one, the protocol
 * error code.
 * @param {number | null} exitCode null: the process did not run or was killed
 * @param {string} stderr
 * @returns {{ kind: CtlErrorKind, code: string | null }}
 */
export function classify(exitCode, stderr) {
  const line =
    stderr
      .trim()
      .split("\n")[0]
      ?.replace(/^vimma-ctl: /, "") ?? "";
  switch (exitCode) {
    case 1:
      return { kind: "server", code: /^([a-z-]+): /.exec(line)?.[1] ?? null };
    case 2:
      return { kind: "usage", code: null };
    case 3:
      return /control socket is busy/.test(line)
        ? { kind: "busy", code: "busy" }
        : { kind: "not-running", code: null };
    case 4:
      return { kind: "auth", code: /^authentication failed: ([a-z-]+):/.exec(line)?.[1] ?? null };
    case 5:
      return { kind: "protocol", code: null };
    default:
      return { kind: "spawn", code: null };
  }
}

/**
 * The vimma-ctl binary: `flag` (--vimma-ctl), else VIMMA_CTL, else a cargo build in the repo.
 * @param {{ flag?: string, env?: Record<string, string | undefined>, root?: string,
 *   exists?: (path: string) => boolean }} [options]
 */
export function findVimmaCtl({ flag, env = {}, root = REPO_ROOT, exists = existsSync } = {}) {
  const explicit = flag ?? env.VIMMA_CTL;
  if (explicit) {
    if (!exists(explicit)) throw new Error(`vimma-ctl not found at ${explicit}`);
    return explicit;
  }
  const tried = ["release", "debug"].map((p) =>
    join(root, "tools/vimma-ctl/target", p, "vimma-ctl"),
  );
  const found = tried.find((p) => exists(p));
  if (found) return found;
  throw new Error(
    `vimma-ctl is not built (tried ${tried.join(", ")}). Build it: ` +
      "(cd tools/vimma-ctl && cargo build --locked), or pass --vimma-ctl / set VIMMA_CTL",
  );
}

export class Ctl {
  /**
   * @param {{ bin: string, profile: string, timeoutSecs?: number }} options
   */
  constructor({ bin, profile, timeoutSecs = 5 }) {
    this.bin = bin;
    this.profile = profile;
    this.timeoutSecs = timeoutSecs;
  }

  /**
   * Run vimma-ctl once.
   * @param {string[]} args
   * @returns {Promise<string>} stdout
   */
  run(args) {
    const argv = ["--profile", this.profile, "--timeout", String(this.timeoutSecs), ...args];
    return new Promise((resolve, reject) => {
      execFile(
        this.bin,
        argv,
        { encoding: "utf8", timeout: (this.timeoutSecs + 5) * 1000, env: { ...process.env } },
        (error, stdout, stderr) => {
          if (!error) return resolve(stdout);
          const exitCode = typeof error.code === "number" ? error.code : null;
          const { kind, code } = classify(exitCode, stderr);
          const why = stderr.trim() || error.message;
          reject(
            new CtlError(`vimma-ctl ${args[0]} failed (${kind}): ${why}`, {
              kind,
              code,
              exitCode,
              stderr,
            }),
          );
        },
      );
    });
  }

  /** @returns {Promise<Record<string, any>>} the `state` result */
  async state() {
    const out = await this.run(["state", "--json"]);
    let state;
    try {
      state = JSON.parse(out);
    } catch {
      throw new CtlError(`vimma-ctl state --json printed invalid JSON: ${out.slice(0, 200)}`, {
        kind: "protocol",
        code: null,
        exitCode: 0,
        stderr: "",
      });
    }
    return state;
  }

  /** @param {string} keys Herdr chords, space-separated */
  async sendKeys(keys) {
    await this.run(["send-keys", keys]);
  }

  /** @param {string} url @returns {Promise<string>} the new tab's id */
  async open(url) {
    return (await this.run(["open", url])).trim();
  }

  /**
   * Connection setup: call `state` until it answers, retrying only while the socket is not up
   * yet (`not-running`) or `busy`. Anything else fails at once.
   * @param {{ timeoutMs?: number, intervalMs?: number }} [options]
   */
  async ready({ timeoutMs = 10_000, intervalMs = 100 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        return await this.state();
      } catch (e) {
        const retryable = e instanceof CtlError && (e.kind === "not-running" || e.kind === "busy");
        if (!retryable || Date.now() + intervalMs >= deadline) throw e;
      }
      await sleep(intervalMs);
    }
  }
}
