/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The control socket's server, protocol v1 (specs: docs/specs/m0-control-server.md,
// docs/specs/m0-control-protocol-and-vimma-ctl.md; ADR-007). One per app, not per window: the
// pref `vimma.control.enabled` starts and stops it, live. JSON lines over TCP on 127.0.0.1, a
// token from <profile>/vimma-control.json (0600) required before any command.

import {
  CONTROL_COMMANDS,
  CONTROL_PROTOCOL,
  MAX_LINE_LENGTH,
  RESERVED_COMMANDS,
  tokensEqual,
  validateMessage,
} from "../core/control.mjs";
import { parseKey } from "../core/keys.mjs";
import { VimmaHost } from "../host/VimmaHost.sys.mjs";

/** @import { Chord } from "../core/keys.mjs" */

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  AppConstants: "resource://gre/modules/AppConstants.sys.mjs",
  AsyncShutdown: "resource://gre/modules/AsyncShutdown.sys.mjs",
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

export const ENABLED_PREF = "vimma.control.enabled";
/** Test-only overrides of the spec's 5 s and 60 s. */
const HELLO_TIMEOUT_PREF = "vimma.control.helloTimeoutMs";
const IDLE_TIMEOUT_PREF = "vimma.control.idleTimeoutMs";
const HELLO_TIMEOUT_MS = 5000;
const IDLE_TIMEOUT_MS = 60000;
const MAX_CONNECTIONS = 8;
const BACKLOG = 16;
const DISCOVERY_FILE = "vimma-control.json";
const NEWLINE = 0x0a;
/** After an error that ends the connection: how long to wait for the client to close first. */
const DRAIN_MS = 1000;

/** @typedef {{ code: string, message: string }} ProtocolError */

/**
 * A failure the client caused (or `failed`): answered with `code`, not logged as a bug.
 */
class ControlError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Bytes as a hex string. @param {Uint8Array} bytes */
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** The browser window keys and state are for: the most recently focused one. */
function topWindow() {
  const win =
    lazy.BrowserWindowTracker.getTopWindow({ allowPopups: false }) ??
    Services.wm.getMostRecentWindow("navigator:browser");
  if (!win) throw new ControlError("failed", "no browser window");
  return win;
}

// ---------------------------------------------------------------------------------------------
// Key injection: chords become real key presses through a TextInputProcessor, so the host's
// keydown listener, Firefox's shortcuts and the page see what a keyboard would have produced.

/** vimma-core's named keys → DOM KeyboardEvent key and code. */
/** @type {Record<string, [string, string]>} */
const NAMED_DOM_KEYS = {
  esc: ["Escape", "Escape"],
  enter: ["Enter", "Enter"],
  tab: ["Tab", "Tab"],
  space: [" ", "Space"],
  backspace: ["Backspace", "Backspace"],
  delete: ["Delete", "Delete"],
  up: ["ArrowUp", "ArrowUp"],
  down: ["ArrowDown", "ArrowDown"],
  left: ["ArrowLeft", "ArrowLeft"],
  right: ["ArrowRight", "ArrowRight"],
  home: ["Home", "Home"],
  end: ["End", "End"],
  pageup: ["PageUp", "PageUp"],
  pagedown: ["PageDown", "PageDown"],
  insert: ["Insert", "Insert"],
};
for (let i = 1; i <= 12; i++) NAMED_DOM_KEYS[`f${i}`] = [`F${i}`, `F${i}`];

/** US-layout keyCodes for printable characters that are not letters or digits. */
/** @type {Record<string, number>} */
const PUNCTUATION_KEYCODES = {
  ";": 59,
  ":": 59,
  "=": 61,
  "+": 61,
  ",": 188,
  "<": 188,
  "-": 173,
  _: 173,
  ".": 190,
  ">": 190,
  "/": 191,
  "?": 191,
  "`": 192,
  "~": 192,
  "[": 219,
  "{": 219,
  "\\": 220,
  "|": 220,
  "]": 221,
  "}": 221,
  "'": 222,
  '"': 222,
  "!": 49,
  "@": 50,
  "#": 51,
  $: 52,
  "%": 53,
  "^": 54,
  "&": 55,
  "*": 56,
  "(": 57,
  ")": 48,
};

/** @type {Array<[keyof Chord, string, string]>} chord flag, DOM key, DOM code */
const MODIFIER_KEYS = [
  ["ctrl", "Control", "ControlLeft"],
  ["alt", "Alt", "AltLeft"],
  ["shift", "Shift", "ShiftLeft"],
  ["meta", "Meta", "MetaLeft"],
];

/**
 * The KeyboardEvent init for a chord's key (modifiers are pressed separately).
 * @param {Chord} chord
 */
function keyInit(chord) {
  const named = NAMED_DOM_KEYS[chord.key];
  if (named) {
    const [key, code] = named;
    return key === " " ? { key, code, keyCode: 32 } : { key, code };
  }
  const ch = chord.key;
  if (/^[a-z]$/.test(ch)) {
    return {
      key: chord.shift ? ch.toUpperCase() : ch,
      code: `Key${ch.toUpperCase()}`,
      keyCode: ch.toUpperCase().charCodeAt(0),
    };
  }
  if (/^[0-9]$/.test(ch)) return { key: ch, code: `Digit${ch}`, keyCode: ch.charCodeAt(0) };
  return { key: ch, keyCode: PUNCTUATION_KEYCODES[ch] ?? 0 };
}

/**
 * Press and release each chord in `win`, holding its modifiers like a person would.
 * @param {Window} win
 * @param {Chord[]} chords
 */
function pressChords(win, chords) {
  const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
  if (!tip.beginInputTransaction(win, () => true)) {
    throw new ControlError("failed", "another input method owns the window's keyboard input");
  }
  const KeyboardEvent = /** @type {any} */ (win).KeyboardEvent;
  for (const chord of chords) {
    const held = MODIFIER_KEYS.filter(([flag]) => chord[flag]);
    for (const [, key, code] of held) tip.keydown(new KeyboardEvent("", { key, code }));
    const event = new KeyboardEvent("", keyInit(chord));
    tip.keydown(event);
    tip.keyup(event);
    for (const [, key, code] of held.reverse()) tip.keyup(new KeyboardEvent("", { key, code }));
  }
}

// ---------------------------------------------------------------------------------------------
// Commands

/** @type {Record<string, (args: any) => object>} */
const COMMANDS = {
  "send-keys"({ keys }) {
    // The validator has already parsed every chord; parse again for the values.
    const chords = keys.split(/\s+/).filter(Boolean).map(parseKey);
    pressChords(topWindow(), chords);
    return { sent: chords.length };
  },

  state() {
    const win = /** @type {any} */ (topWindow());
    const host = VimmaHost.status(win);
    const { gBrowser } = win;
    return {
      mode: host.mode,
      pending: host.pending.length ? host.pending.join(" ") : null,
      workspace: null,
      tabs: gBrowser.visibleTabs.map((/** @type {any} */ tab, /** @type {number} */ index) => ({
        id: String(tab.linkedBrowser.browserId),
        index,
        url: tab.linkedBrowser.currentURI.spec,
        title: tab.label,
        selected: tab.selected,
        pinned: tab.pinned,
      })),
      panes: null,
    };
  },

  open({ url, where = "tab" }) {
    let uri;
    try {
      uri = Services.io.newURI(url);
    } catch {
      throw new ControlError("invalid-args", "url is not a valid URL");
    }
    // The validator checked the text; check what the URL parser made of it too.
    if (!["http", "https", "file", "about"].includes(uri.scheme)) {
      throw new ControlError("invalid-args", "url scheme must be http, https, file or about");
    }
    const win = /** @type {any} */ (topWindow());
    // The system principal, as BrowserContentHandler uses for `vimma <url>`: the token holder
    // is the user, and javascript: and data: are refused above, so no script runs in a page's
    // context. Not through browserDOMWindow.openURI(OPEN_EXTERNAL) like the command line:
    // that turns an external about:blank into the new-tab page with the URL bar focused, and
    // lets the external-link prefs pick another window; `where` is explicit here.
    const { gBrowser } = win;
    const principal = Services.scriptSecurityManager.getSystemPrincipal();
    const tab =
      where === "current"
        ? gBrowser.selectedTab
        : gBrowser.addTab(uri.spec, { triggeringPrincipal: principal, inBackground: false });
    if (where === "current") {
      tab.linkedBrowser.loadURI(uri, { triggeringPrincipal: principal });
    }
    return { tab: String(tab.linkedBrowser.browserId) };
  },
};

// ---------------------------------------------------------------------------------------------
// Connections

class Connection {
  /**
   * @param {Server} server
   * @param {any} transport nsISocketTransport
   */
  constructor(server, transport) {
    this.server = server;
    this.transport = transport;
    this.input = transport.openInputStream(0, 0, 0).QueryInterface(Ci.nsIAsyncInputStream);
    this.binary = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);
    this.binary.setInputStream(this.input);
    this.output = transport.openOutputStream(0, 0, 0).QueryInterface(Ci.nsIAsyncOutputStream);
    /** @type {Uint8Array[]} bytes of the line being read */
    this.chunks = [];
    this.lineLength = 0;
    this.authenticated = false;
    this.closed = false;
    /** Binary string waiting for the socket to accept it. */
    this.pendingOut = "";
    this.closeAfterWrite = false;
    /** The server is stopping: finish the command in flight, answer it, then close. */
    this.stopping = false;
    /** After an error that ends the connection: input is read and dropped until the close. */
    this.draining = false;
    this.running = false;
    /** Requests run in order: each waits for the one before. */
    this.queue = Promise.resolve();
    this.timer = null;
    this.decoder = new TextDecoder("utf-8", { fatal: true });
  }

  start() {
    this.arm(Services.prefs.getIntPref(HELLO_TIMEOUT_PREF, HELLO_TIMEOUT_MS), () =>
      this.fail(null, "bad-request", "no hello within the deadline"),
    );
    this.waitForInput();
  }

  /** @param {number} ms @param {() => void} onTimeout */
  arm(ms, onTimeout) {
    if (this.timer !== null) lazy.clearTimeout(this.timer);
    this.timer = lazy.setTimeout(() => {
      this.timer = null;
      if (!this.closed) onTimeout();
    }, ms);
  }

  waitForInput() {
    if (!this.closed) this.input.asyncWait(this, 0, 0, Services.tm.mainThread);
  }

  /** nsIInputStreamCallback */
  onInputStreamReady() {
    if (this.closed) return;
    let bytes;
    try {
      // available() is 0 both at EOF and before the transport is attached; a read tells them
      // apart: 0 bytes is EOF, "would block" means wait.
      const size = Math.min(Math.max(this.input.available(), 1), MAX_LINE_LENGTH + 2);
      const buffer = new ArrayBuffer(size);
      bytes = new Uint8Array(buffer, 0, this.binary.readArrayBuffer(size, buffer));
    } catch (e) {
      if (/** @type {any} */ (e).result === Cr.NS_BASE_STREAM_WOULD_BLOCK) this.waitForInput();
      else this.close(); // the peer closed or reset
      return;
    }
    if (bytes.length === 0) {
      this.close();
      return;
    }
    if (!this.draining) this.receive(bytes);
    this.waitForInput();
  }

  /** @param {Uint8Array} bytes */
  receive(bytes) {
    let start = 0;
    while (!this.closed && !this.draining && start < bytes.length) {
      const nl = bytes.indexOf(NEWLINE, start);
      const end = nl === -1 ? bytes.length : nl;
      this.chunks.push(bytes.subarray(start, end));
      this.lineLength += end - start;
      // A line may end in \r\n: allow one byte over the limit for the \r.
      if (this.lineLength > MAX_LINE_LENGTH + 1) {
        this.fail(null, "bad-request", `line longer than ${MAX_LINE_LENGTH} bytes`);
        return;
      }
      if (nl === -1) return;
      const line = new Uint8Array(this.lineLength);
      let at = 0;
      for (const c of this.chunks) {
        line.set(c, at);
        at += c.length;
      }
      this.chunks = [];
      this.lineLength = 0;
      start = nl + 1;
      this.onLine(line[line.length - 1] === 0x0d ? line.subarray(0, -1) : line);
    }
  }

  /** @param {Uint8Array} bytes one line without its newline */
  onLine(bytes) {
    if (bytes.length > MAX_LINE_LENGTH) {
      this.fail(null, "bad-request", `line longer than ${MAX_LINE_LENGTH} bytes`);
      return;
    }
    /** @type {unknown} */
    let message;
    try {
      message = JSON.parse(this.decoder.decode(bytes));
    } catch {
      message = undefined;
    }
    if (this.stopping) return;
    if (!this.authenticated) {
      this.handshake(message);
      return;
    }
    this.arm(Services.prefs.getIntPref(IDLE_TIMEOUT_PREF, IDLE_TIMEOUT_MS), () => this.close());
    this.queue = this.queue.then(() => this.request(message));
  }

  /** @param {unknown} m */
  handshake(m) {
    if (!isObject(m) || m.type !== "hello") {
      this.fail(null, "bad-request", "the first line must be a hello");
      return;
    }
    if (Number.isInteger(m.protocol) && m.protocol !== CONTROL_PROTOCOL) {
      this.fail(null, "unsupported-protocol", `this server speaks protocol ${CONTROL_PROTOCOL}`);
      return;
    }
    // Constant time in where the tokens differ; a malformed token simply does not match.
    if (typeof m.token !== "string" || !tokensEqual(m.token, this.server.token)) {
      this.fail(null, "unauthorized", "bad token");
      return;
    }
    const v = validateMessage(m, { kind: "hello" });
    if (!v.valid) {
      this.fail(null, "bad-request", v.errors.join("; "));
      return;
    }
    this.authenticated = true;
    this.arm(Services.prefs.getIntPref(IDLE_TIMEOUT_PREF, IDLE_TIMEOUT_MS), () => this.close());
    this.write({
      type: "welcome",
      protocol: CONTROL_PROTOCOL,
      app: "Vimma",
      version: lazy.AppConstants.MOZ_APP_VERSION_DISPLAY,
    });
  }

  /** @param {unknown} m */
  async request(m) {
    if (this.closed) return;
    if (!isObject(m)) {
      this.respond(null, { error: { code: "bad-request", message: "not a JSON object" } });
      return;
    }
    const id = Number.isInteger(m.id) && /** @type {number} */ (m.id) >= 1 ? m.id : null;
    const extra = Object.keys(m).filter((k) => !["type", "id", "command", "args"].includes(k));
    if (m.type !== "request" || id === null || extra.length || !isObject(m.args)) {
      const v = validateMessage(m, { kind: "request" });
      this.respond(id, { error: { code: "bad-request", message: v.errors.join("; ") } });
      return;
    }
    const command = /** @type {string} */ (m.command);
    if (RESERVED_COMMANDS.includes(command)) {
      this.respond(id, { error: { code: "not-implemented", message: `${command} is reserved` } });
      return;
    }
    if (!CONTROL_COMMANDS.includes(command)) {
      this.respond(id, {
        error: { code: "unknown-command", message: `unknown command ${String(command)}` },
      });
      return;
    }
    const v = validateMessage(m, { kind: "request" });
    if (!v.valid) {
      this.respond(id, { error: { code: "invalid-args", message: v.errors.join("; ") } });
      return;
    }
    this.running = true;
    try {
      const result = await COMMANDS[command]?.(m.args);
      this.respond(id, { result });
    } catch (e) {
      if (e instanceof ControlError) {
        this.respond(id, { error: { code: e.code, message: e.message } });
      } else {
        console.error("vimma control:", command, e);
        this.respond(id, { error: { code: "internal", message: String(e) } });
      }
    } finally {
      this.running = false;
    }
    // `send-keys ctrl+q` quits the app while it runs: still answer it before closing.
    if (this.stopping) this.stop();
  }

  /** Close now, or after answering the command in flight. */
  stop() {
    this.stopping = true;
    if (this.running) return;
    this.closeAfterWrite = true;
    this.flush();
  }

  /**
   * @param {unknown} id
   * @param {{ result?: object, error?: ProtocolError }} body
   */
  respond(id, body) {
    this.write({ type: "response", id, ok: !body.error, ...body });
  }

  /**
   * Answer with an error (`id`), then close: once the client has closed its end, or after
   * DRAIN_MS. Whatever the client still sends meanwhile is read and dropped. Closing at once
   * loses the answer now and then: with unread input the kernel resets the connection (RST),
   * and a client may see the close before it has read the line.
   * @param {unknown} id @param {string} code @param {string} message
   */
  fail(id, code, message) {
    this.respond(id, { error: { code, message } });
    this.draining = true;
    this.chunks = [];
    this.arm(DRAIN_MS, () => this.stop());
    this.waitForInput();
  }

  /** @param {object} message */
  write(message) {
    if (this.closed || this.closeAfterWrite) return;
    const bytes = new TextEncoder().encode(JSON.stringify(message) + "\n");
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    this.pendingOut += s;
    this.flush();
  }

  flush() {
    while (!this.closed && this.pendingOut.length) {
      let n;
      try {
        n = this.output.write(this.pendingOut, this.pendingOut.length);
      } catch (e) {
        if (/** @type {any} */ (e).result === Cr.NS_BASE_STREAM_WOULD_BLOCK) {
          this.output.asyncWait(
            { onOutputStreamReady: () => this.flush() },
            0,
            0,
            Services.tm.mainThread,
          );
          return;
        }
        this.close();
        return;
      }
      this.pendingOut = this.pendingOut.slice(n);
    }
    if (this.closeAfterWrite) this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== null) lazy.clearTimeout(this.timer);
    this.timer = null;
    this.input.close();
    this.output.close();
    this.transport.close(Cr.NS_OK);
    this.server.connections.delete(this);
    this.server.closing.delete(this);
  }
}

// ---------------------------------------------------------------------------------------------
// Server

class Server {
  /** @param {string} token */
  constructor(token) {
    this.token = token;
    /** @type {Set<Connection>} */
    this.connections = new Set();
    /** Refused (busy) connections waiting to close. @type {Set<Connection>} */
    this.closing = new Set();
    // Loopback only: Init(…, true, …) binds 127.0.0.1 (PR_IpAddrLoopback, AF_INET;
    // netwerk/base/nsServerSocket.cpp InitSpecialConnection). Port -1: the OS picks one.
    this.socket = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
    this.socket.init(-1, true, BACKLOG);
    this.socket.asyncListen(this);
    this.port = /** @type {number} */ (this.socket.port);
  }

  /** nsIServerSocketListener @param {any} _socket @param {any} transport */
  onSocketAccepted(_socket, transport) {
    const connection = new Connection(this, transport);
    if (this.connections.size >= MAX_CONNECTIONS) {
      // Answer, so the client can tell busy from not running; never queue.
      // It lingers in `closing` (not counted) until the client closes or DRAIN_MS pass.
      this.closing.add(connection);
      connection.fail(null, "busy", `busy: ${this.connections.size} open`);
      return;
    }
    this.connections.add(connection);
    connection.start();
  }

  onStopListening() {}

  stop() {
    this.socket.close();
    for (const c of [...this.connections, ...this.closing]) c.stop();
  }
}

/** @type {Server | null} */
let server = null;
let initialised = false;
/** Resolves once the first browser window has finished its delayed startup. */
let windowReady = Promise.resolve();
/** start/stop run one after another, so quick pref flips settle in order. */
let chain = Promise.resolve();

const discoveryPath = () => PathUtils.join(PathUtils.profileDir, DISCOVERY_FILE);

async function startServer() {
  await windowReady;
  if (server || !Services.prefs.getBoolPref(ENABLED_PREF, false)) return;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const s = new Server(hex(bytes));
  try {
    await writeDiscovery({
      protocol: CONTROL_PROTOCOL,
      port: s.port,
      token: s.token,
      pid: Services.appinfo.processID,
    });
  } catch (e) {
    s.stop();
    throw e;
  }
  server = s;
}

/**
 * Atomically, and 0600 from the first byte: create the temporary file with mode 0600, write
 * into it (an "overwrite" write keeps the file's mode), then rename it over the real name.
 * IOUtils.writeJSON's tmpPath would create the temporary file 0644 first.
 * @param {object} discovery
 */
async function writeDiscovery(discovery) {
  const tmp = await IOUtils.createUniqueFile(PathUtils.profileDir, `${DISCOVERY_FILE}.tmp`, 0o600);
  try {
    await IOUtils.writeUTF8(tmp, JSON.stringify(discovery) + "\n");
    await IOUtils.move(tmp, discoveryPath());
  } catch (e) {
    await IOUtils.remove(tmp, { ignoreAbsent: true });
    throw e;
  }
}

async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  s.stop();
  await IOUtils.remove(discoveryPath(), { ignoreAbsent: true });
}

/** @param {() => Promise<void>} step */
function enqueue(step) {
  chain = chain.then(step).catch((e) => console.error("vimma control:", e));
  return chain;
}

function apply() {
  return enqueue(() =>
    Services.prefs.getBoolPref(ENABLED_PREF, false) ? startServer() : stopServer(),
  );
}

export const VimmaControl = {
  /** Called by every browser window; starts watching the pref once per app. */
  /**
   * Called by every browser window. The first call starts watching the pref, but the server
   * starts only once that window has finished its delayed startup: a client that sees the
   * discovery file must find a window to send keys to and report on (e2e harness, issue: state
   * answered "no browser window" while the first window was still loading).
   * @param {Window} win
   */
  init(win) {
    if (initialised) return;
    initialised = true;
    const w = /** @type {any} */ (win);
    if (!w.gBrowserInit?.delayedStartupFinished) {
      windowReady = new Promise((resolve) => {
        /** @param {unknown} subject */
        const observer = (subject) => {
          if (subject !== win) return;
          Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
          resolve(undefined);
        };
        Services.obs.addObserver(observer, "browser-delayed-startup-finished");
      });
    }
    Services.prefs.addObserver(ENABLED_PREF, apply);
    Services.obs.addObserver(() => this.shutdown(), "quit-application-granted");
    // In case quit-application-granted was skipped (e.g. a forced quit): the file must go.
    lazy.AsyncShutdown.profileBeforeChange.addBlocker(
      "VimmaControl: remove the discovery file",
      () => this.shutdown(),
    );
    apply();
  },

  /** Stop the server and remove the discovery file. */
  shutdown() {
    Services.prefs.removeObserver(ENABLED_PREF, apply);
    return enqueue(stopServer);
  },

  /** Resolves once pending starts and stops are done (tests). */
  settled() {
    return chain;
  },

  /** The listening port, or null while stopped. */
  get port() {
    return server?.port ?? null;
  },

  /** Open connections, handshaking or authenticated (tests). */
  get connections() {
    return server?.connections.size ?? 0;
  },
};
