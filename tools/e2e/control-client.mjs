// The harness's own control-protocol client (docs/specs/vimma-mcp.md, sub-PR 2b), for what
// vimma-ctl's one-shot runs cannot do: a full connection held for the rest of a scenario (opened
// while MCP is off, so keys sent through it never ask), an agent connection whose requests wait
// for the user, and vimma-ctl runs that are not awaited. The handshake is the real one: the
// server proves the token before the client sends it.
import { execFile } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { CHALLENGE_CONTEXT } from "../../packages/vimma-core/src/control.mjs";

/** How long a request may wait for the user (the longest ask_timeout plus 10 s). */
const ANSWER_MS = 310_000;

export class ControlClient {
  /** @param {import("node:net").Socket} socket */
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    /** @type {any[]} */
    this.messages = [];
    /** @type {Array<() => void>} */
    this.waiters = [];
    this.closed = false;
    this.nextId = 0;
    socket.setEncoding("utf8");
    socket.on("data", (d) => {
      this.buffer += d;
      let nl;
      while ((nl = this.buffer.indexOf("\n")) !== -1) {
        this.messages.push(JSON.parse(this.buffer.slice(0, nl)));
        this.buffer = this.buffer.slice(nl + 1);
      }
      this.wake();
    });
    socket.on("close", () => {
      this.closed = true;
      this.wake();
    });
    socket.on("error", () => {});
  }

  /**
   * Connect and authenticate as `role`.
   * @param {{ port: number, token: string, role: "full" | "agent" }} o
   */
  static async connect({ port, token, role }) {
    const socket = connect({ host: "127.0.0.1", port });
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const c = new ControlClient(socket);
    const nonce = randomBytes(32).toString("hex");
    c.send({ type: "hello", protocol: 2, role, nonce });
    const challenge = await c.take();
    const expected = createHmac("sha256", token)
      .update(CHALLENGE_CONTEXT + nonce)
      .digest("hex");
    const proof = Buffer.from(String(challenge?.proof ?? ""));
    if (
      challenge?.type !== "challenge" ||
      proof.length !== expected.length ||
      !timingSafeEqual(proof, Buffer.from(expected))
    ) {
      c.close();
      throw new Error(`the server did not prove it knows the token: ${JSON.stringify(challenge)}`);
    }
    c.send({ type: "auth", token });
    const welcome = await c.take(ANSWER_MS);
    if (welcome?.type !== "welcome") {
      c.close();
      throw new Error(`no welcome: ${JSON.stringify(welcome)}`);
    }
    return c;
  }

  wake() {
    for (const w of this.waiters.splice(0)) w();
  }

  /**
   * The next message matching `pred`, or null once closed or after `ms`.
   * @param {number} [ms] @param {(m: any) => boolean} [pred]
   */
  async take(ms = 10_000, pred = () => true) {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = this.messages.findIndex(pred);
      if (i !== -1) return this.messages.splice(i, 1)[0];
      const left = deadline - Date.now();
      if (this.closed || left <= 0) return null;
      await new Promise((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve(undefined);
        });
      });
    }
  }

  /** @param {object} message */
  send(message) {
    this.socket.write(`${JSON.stringify(message)}\n`);
  }

  /** Send a request; its id. @param {string} command @param {object} args */
  request(command, args) {
    const id = ++this.nextId;
    this.send({ type: "request", id, command, args });
    return id;
  }

  /** @param {number} id @param {number} [ms] */
  response(id, ms = ANSWER_MS) {
    return this.take(ms, (m) => m.type === "response" && m.id === id);
  }

  /** @param {string} command @param {object} args */
  call(command, args) {
    return this.response(this.request(command, args));
  }

  close() {
    this.socket.destroy();
  }
}

/** One scenario's connections and vimma-ctl runs. */
export class ControlSessions {
  /** @param {{ profile: string, bin: string, signal?: AbortSignal }} o */
  constructor({ profile, bin, signal }) {
    this.profile = profile;
    this.bin = bin;
    this.signal = signal;
    /** @type {ControlClient | null} */
    this.full = null;
    /** @type {Promise<ControlClient> | null} */
    this.agent = null;
    /** @type {Map<string, Promise<unknown>>} */
    this.pending = new Map();
    /** @type {Map<string, Promise<{ exitCode: number | null, stderr: string }>>} */
    this.runs = new Map();
    const self = this;
    this.held = {
      state: async () => self.result(await self.heldCall("state", {})),
      sendKeys: async (/** @type {string} */ keys) => {
        self.result(await self.heldCall("send-keys", { keys }));
      },
      open: async (/** @type {string} */ url) =>
        String(/** @type {any} */ (self.result(await self.heldCall("open", { url }))).tab),
    };
  }

  discovery() {
    return JSON.parse(readFileSync(join(this.profile, "vimma-control.json"), "utf8"));
  }

  /** Keep one full connection; while MCP is off, it is welcomed without a question. */
  async hold() {
    const { port, token } = this.discovery();
    this.full = await ControlClient.connect({ port, token, role: "full" });
  }

  /** @param {string} command @param {object} args */
  async heldCall(command, args) {
    if (!this.full) throw new Error("no held connection");
    return this.full.call(command, args);
  }

  /** @param {any} reply */
  result(reply) {
    if (!reply) throw new Error("the held connection closed");
    if (!reply.ok) throw new Error(`${reply.error?.code}: ${reply.error?.message}`);
    return reply.result;
  }

  /** @param {import("./scenario.mjs").AgentSend} spec */
  agentSend(spec) {
    this.agent ??= (async () => {
      const { port, token } = this.discovery();
      const c = await ControlClient.connect({ port, token, role: "agent" });
      const hi = await c.call("agent-hello", { client: { name: spec.client ?? "claude-code" } });
      if (!hi?.ok) throw new Error(`agent-hello: ${JSON.stringify(hi)}`);
      return c;
    })();
    const agent = this.agent;
    this.pending.set(
      spec.as,
      agent.then((c) => c.call(spec.send, spec.args ?? {})),
    );
  }

  /** @param {string} name */
  async agentResult(name) {
    const p = this.pending.get(name);
    if (!p) throw new Error(`no agent request named ${name}`);
    return p;
  }

  /** @param {string[]} args @param {string} as */
  ctlSpawn(args, as) {
    this.runs.set(
      as,
      new Promise((resolve) => {
        execFile(
          this.bin,
          ["--profile", this.profile, "--timeout", "5", ...args],
          { encoding: "utf8", timeout: ANSWER_MS, signal: this.signal, killSignal: "SIGKILL" },
          (error, _stdout, stderr) => {
            const code = error && typeof error.code === "number" ? error.code : error ? null : 0;
            resolve({ exitCode: code, stderr });
          },
        );
      }),
    );
  }

  /** @param {string} name */
  async ctlResult(name) {
    const p = this.runs.get(name);
    if (!p) throw new Error(`no ctl run named ${name}`);
    return p;
  }

  close() {
    this.full?.close();
    this.agent?.then((c) => c.close()).catch(() => {});
  }
}
