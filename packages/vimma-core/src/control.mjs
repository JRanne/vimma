/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Control protocol, version 1: validator for every message and the discovery file
 * (docs/specs/m0-control-protocol-and-vimma-ctl.md, fixtures in tests/contract/control/v1/).
 * Pure: the browser-side server and the tests share it.
 */

import { parseKey } from "./keys.mjs";
import { MODES } from "./modes.mjs";

export const CONTROL_PROTOCOL = 1;
/** Longest accepted line in UTF-16 code units, excluding the newline. */
export const MAX_LINE_LENGTH = 1024 * 1024;
export const CONTROL_COMMANDS = Object.freeze(["send-keys", "state", "open", "reload-theme"]);
export const RESERVED_COMMANDS = Object.freeze(["list-tabs", "screenshot", "reload-config"]);
export const ERROR_CODES = Object.freeze([
  "bad-request",
  "unauthorized",
  "unsupported-protocol",
  "unknown-command",
  "invalid-args",
  "not-implemented",
  "failed",
  "internal",
  "busy",
]);

const MAX_ID = 2 ** 53 - 1;
const MAX_CHORDS = 256;
const MAX_URL = 65536;
const URL_SCHEMES = ["http", "https", "file", "about"];
const KINDS = ["hello", "challenge", "auth", "welcome", "request", "response", "discovery"];
/** Prefix of the challenge's HMAC message, so the proof is good for nothing else. */
export const CHALLENGE_CONTEXT = "vimma-server\0";

/**
 * @typedef {"hello" | "challenge" | "auth" | "welcome" | "request" | "response" | "discovery"} MessageKind
 * @typedef {{ kind?: MessageKind, command?: string }} ValidateOptions
 * @typedef {{ valid: boolean, errors: string[] }} Validation
 * @typedef {Record<string, unknown>} Obj
 */

/** @param {unknown} v @returns {v is Obj} */
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** @param {unknown} v @param {number} min @param {number} max */
const isInt = (v, min, max) =>
  Number.isInteger(v) && /** @type {number} */ (v) >= min && /** @type {number} */ (v) <= max;
/** @param {unknown} v */
const isToken = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/**
 * @param {Obj} obj
 * @param {readonly string[]} allowed
 * @param {string[]} errors
 * @param {string} [prefix]
 */
function noExtraFields(obj, allowed, errors, prefix = "") {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`unknown field "${prefix}${key}"`);
  }
}

/** @param {Obj} m @param {string[]} errors */
function checkProtocol(m, errors) {
  if (!isInt(m.protocol, 1, MAX_ID)) errors.push("protocol must be an integer >= 1");
}

/**
 * The handshake (spec m0-control-protocol-and-vimma-ctl): hello {nonce} → challenge {proof} →
 * auth {token} → welcome. The token is sent only after the server proved it knows it.
 * @param {Obj} m @param {string[]} errors
 */
function checkHello(m, errors) {
  noExtraFields(m, ["type", "protocol", "nonce"], errors);
  checkProtocol(m, errors);
  if (!isToken(m.nonce)) errors.push("nonce must be 64 lowercase hex characters");
}

/**
 * proof = HMAC-SHA256(key: the token, message: CHALLENGE_CONTEXT + the hello's nonce), ASCII.
 * @param {Obj} m @param {string[]} errors
 */
function checkChallenge(m, errors) {
  checkProtocol(m, errors);
  if (!isToken(m.proof)) errors.push("proof must be 64 lowercase hex characters");
}

/** @param {Obj} m @param {string[]} errors */
function checkAuth(m, errors) {
  noExtraFields(m, ["type", "token"], errors);
  if (!isToken(m.token)) errors.push("token must be 64 lowercase hex characters");
}

/** @param {Obj} m @param {string[]} errors */
function checkWelcome(m, errors) {
  checkProtocol(m, errors);
  if (typeof m.app !== "string") errors.push("app must be a string");
  if (typeof m.version !== "string") errors.push("version must be a string");
}

/** @param {Obj} m @param {string[]} errors */
function checkDiscovery(m, errors) {
  checkProtocol(m, errors);
  if (!isInt(m.port, 1, 65535)) errors.push("port must be an integer from 1 to 65535");
  if (!isToken(m.token)) errors.push("token must be 64 lowercase hex characters");
  if (!isInt(m.pid, 1, MAX_ID)) errors.push("pid must be an integer >= 1");
}

/** @param {Obj} args @param {string[]} errors */
function checkSendKeysArgs(args, errors) {
  noExtraFields(args, ["keys"], errors, "args.");
  if (typeof args.keys !== "string") {
    errors.push("keys must be a string");
    return;
  }
  const chords = args.keys.split(/\s+/).filter(Boolean);
  if (chords.length < 1 || chords.length > MAX_CHORDS) {
    errors.push(`keys must contain 1 to ${MAX_CHORDS} chords`);
    return;
  }
  for (const chord of chords) {
    try {
      parseKey(chord);
    } catch {
      errors.push(`keys: "${chord}" is not a chord`);
    }
  }
}

/** @param {Obj} args @param {string[]} errors */
function checkOpenArgs(args, errors) {
  noExtraFields(args, ["url", "where"], errors, "args.");
  const { url } = args;
  if (typeof url !== "string") errors.push("url must be a string");
  else if (url.length > MAX_URL) errors.push(`url must be at most ${MAX_URL} characters`);
  else if ([...url].some((c) => c <= " " || c === "\u007f")) {
    errors.push("url must not contain control characters or spaces");
  } else {
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url)?.[1];
    if (!scheme) errors.push("url must be an absolute URL");
    else if (!URL_SCHEMES.includes(scheme.toLowerCase())) {
      errors.push("url scheme must be http, https, file or about");
    }
  }
  if ("where" in args && args.where !== "tab" && args.where !== "current") {
    errors.push('where must be "tab" or "current"');
  }
}

/** @param {Obj} m @param {string[]} errors */
function checkRequest(m, errors) {
  noExtraFields(m, ["type", "id", "command", "args"], errors);
  if (!isInt(m.id, 1, MAX_ID)) errors.push("id must be an integer from 1 to 2^53-1");
  const { command, args } = m;
  const known =
    typeof command === "string" && [...CONTROL_COMMANDS, ...RESERVED_COMMANDS].includes(command);
  if (!known)
    errors.push(`command must be one of ${[...CONTROL_COMMANDS, ...RESERVED_COMMANDS].join(", ")}`);
  if (!isObject(args)) {
    errors.push("args must be an object");
    return;
  }
  if (command === "send-keys") checkSendKeysArgs(args, errors);
  else if (command === "open") checkOpenArgs(args, errors);
  else if (command === "state" || command === "reload-theme") {
    noExtraFields(args, [], errors, "args.");
  }
}

/** @param {Obj} result @param {string[]} errors */
function checkStateResult(result, errors) {
  if (typeof result.mode !== "string" || !MODES.includes(/** @type {any} */ (result.mode))) {
    errors.push(`result.mode must be one of ${MODES.join(", ")}`);
  }
  for (const key of ["pending", "workspace"]) {
    if (result[key] !== null && typeof result[key] !== "string") {
      errors.push(`result.${key} must be a string or null`);
    }
  }
  // A private window's state (docs/specs/private-workspace.md decision 8d): no url or title.
  if ("private" in result && typeof result.private !== "boolean") {
    errors.push("result.private must be a boolean");
  }
  const hidden = result.private === true;
  if (!Array.isArray(result.tabs)) {
    errors.push("result.tabs must be an array");
  } else {
    let selected = 0;
    result.tabs.forEach((tab, i) => {
      if (!isObject(tab)) {
        errors.push(`result.tabs[${i}] must be an object`);
        return;
      }
      if (typeof tab.id !== "string") errors.push(`result.tabs[${i}].id must be a string`);
      for (const key of ["url", "title"]) {
        if (hidden && tab[key] !== null) {
          errors.push(`result.tabs[${i}].${key} must be null in a private window`);
        } else if (!hidden && typeof tab[key] !== "string") {
          errors.push(`result.tabs[${i}].${key} must be a string`);
        }
      }
      if (typeof tab.selected !== "boolean") {
        errors.push(`result.tabs[${i}].selected must be a boolean`);
      } else if (tab.selected) selected++;
    });
    if (selected > 1) errors.push("result.tabs must have at most one selected tab");
  }
  if (!("panes" in result)) errors.push("result.panes must be present (null before split view)");
}

/** @param {unknown} result @param {string | undefined} command @param {string[]} errors */
function checkResult(result, command, errors) {
  if (!isObject(result)) {
    errors.push("result must be an object");
    return;
  }
  if (command === "send-keys" && !isInt(result.sent, 0, MAX_ID)) {
    errors.push("result.sent must be an integer >= 0");
  } else if (command === "open" && typeof result.tab !== "string") {
    errors.push("result.tab must be a string");
  } else if (command === "reload-theme" && typeof result.changed !== "boolean") {
    errors.push("result.changed must be a boolean");
  } else if (command === "state") {
    checkStateResult(result, errors);
  }
}

/** @param {Obj} m @param {string | undefined} command @param {string[]} errors */
function checkResponse(m, command, errors) {
  noExtraFields(m, ["type", "id", "ok", "result", "error"], errors);
  if (m.id !== null && !isInt(m.id, 1, MAX_ID)) {
    errors.push("id must be an integer from 1 to 2^53-1 or null");
  }
  if (typeof m.ok !== "boolean") {
    errors.push("ok must be a boolean");
    return;
  }
  if (m.ok) {
    if (!("result" in m) || "error" in m) {
      errors.push("ok: true needs result and no error");
      return;
    }
    checkResult(m.result, command, errors);
    return;
  }
  if (!("error" in m) || "result" in m) {
    errors.push("ok: false needs error and no result");
    return;
  }
  const { error } = m;
  if (!isObject(error)) {
    errors.push("error must be an object");
    return;
  }
  noExtraFields(error, ["code", "message"], errors, "error.");
  if (typeof error.code !== "string" || !ERROR_CODES.includes(error.code)) {
    errors.push(`error.code must be one of ${ERROR_CODES.join(", ")}`);
  }
  if (typeof error.message !== "string") errors.push("error.message must be a string");
}

/**
 * A value for an error message, without calling anything on it: an object from JSON.parse can
 * carry a `toString` that is not a function, and String() would throw.
 * @param {unknown} v
 */
function describe(v) {
  if (typeof v === "string") return JSON.stringify(v);
  if (v === null || typeof v !== "object") return String(v);
  return Array.isArray(v) ? "(an array)" : "(an object)";
}

/**
 * Validate one decoded protocol message (or the discovery file, `kind: "discovery"`).
 * Without `kind`, it is taken from the message's `type`. For responses, `command` names the
 * request's command so the result shape can be checked; without it only the envelope is.
 * @param {unknown} message
 * @param {ValidateOptions} [options]
 * @returns {Validation}
 */
export function validateMessage(message, { kind, command } = {}) {
  /** @type {string[]} */
  const errors = [];
  if (!isObject(message)) {
    errors.push("message must be a JSON object");
    return { valid: false, errors };
  }
  if (kind !== undefined && !KINDS.includes(kind)) {
    errors.push(`unknown message kind "${kind}"`);
    return { valid: false, errors };
  }
  if (kind === "discovery") {
    checkDiscovery(message, errors);
    return { valid: errors.length === 0, errors };
  }
  const effective = kind ?? message.type;
  if (kind !== undefined && message.type !== kind) {
    errors.push(`type must be "${kind}"`);
  }
  switch (effective) {
    case "hello":
      checkHello(message, errors);
      break;
    case "challenge":
      checkChallenge(message, errors);
      break;
    case "auth":
      checkAuth(message, errors);
      break;
    case "welcome":
      checkWelcome(message, errors);
      break;
    case "request":
      checkRequest(message, errors);
      break;
    case "response":
      checkResponse(message, command, errors);
      break;
    default:
      errors.push(`unknown message type ${describe(effective)}`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * The server's framing (spec m0-control-server): bytes in, lines out. `\n` ends a line, one
 * `\r` before it is dropped, and a line over `max` bytes (`\r` not counted) is an overflow,
 * after which no more lines come out. A partial line is kept for the next push, at most
 * `max + 1` bytes of it. Pure, so the fuzzer can drive it (docs/specs/m7-fuzzing.md).
 */
export class LineFramer {
  /** @param {number} [max] */
  constructor(max = MAX_LINE_LENGTH) {
    this.max = max;
    /** @type {Uint8Array[]} the partial line, as pushed */
    this.chunks = [];
    this.length = 0;
    this.overflow = false;
  }

  /**
   * @param {Uint8Array} bytes  kept by reference until its partial line completes
   * @returns {Uint8Array[]} the lines `bytes` completed, in order, without their line ends
   */
  push(bytes) {
    /** @type {Uint8Array[]} */
    const lines = [];
    let start = 0;
    while (!this.overflow && start < bytes.length) {
      const nl = bytes.indexOf(0x0a, start);
      const end = nl === -1 ? bytes.length : nl;
      this.chunks.push(bytes.subarray(start, end));
      this.length += end - start;
      // One byte over the limit may be the \r of a \r\n.
      if (this.length > this.max + 1) {
        this.overflow = true;
        break;
      }
      if (nl === -1) break;
      let line = new Uint8Array(this.length);
      let at = 0;
      for (const c of this.chunks) {
        line.set(c, at);
        at += c.length;
      }
      this.chunks = [];
      this.length = 0;
      start = nl + 1;
      if (line[line.length - 1] === 0x0d) line = line.subarray(0, -1);
      if (line.length > this.max) {
        this.overflow = true;
        break;
      }
      lines.push(line);
    }
    if (this.overflow) {
      this.chunks = [];
      this.length = 0;
    }
    return lines;
  }
}

/**
 * Compare two tokens in time that depends only on their lengths, not on where they differ.
 * Empty or non-string tokens are never equal.
 * @param {string} a
 * @param {string} b
 */
export function tokensEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0) return false;
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  }
  return diff === 0;
}
