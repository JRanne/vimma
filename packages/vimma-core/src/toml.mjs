/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * TOML for vimma: parsing through the vendored smol-toml, and source lines for config paths.
 * See docs/specs/m5-core-config-and-theme.md § Errors with file:line.
 */
import { TomlError, parse } from "./vendor/smol-toml/smol-toml.mjs";

/** @typedef {(string | number)[]} Path  table keys and array indices, outermost first */

/**
 * @typedef {object} TomlSyntaxError
 * @property {number} line      1-based
 * @property {number} column    1-based
 * @property {string} message   one line, without smol-toml's code block
 */

/**
 * @param {string} text
 * @param {{ integersAsBigInt?: boolean }} [options]
 *   integersAsBigInt: integers become BigInt, so `1.0` (a float) can be told from `1`
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, error: TomlSyntaxError }}
 */
export function parseToml(text, { integersAsBigInt = false } = {}) {
  try {
    return { ok: true, value: parse(text, { integersAsBigInt }) };
  } catch (e) {
    /* c8 ignore next */
    if (!(e instanceof TomlError)) throw e;
    let message = e.message.replace(/^Invalid TOML document: /, "").split("\n")[0] ?? "";
    const opened = unclosedBracket(text, e.line, e.column);
    if (opened) message += ` (unclosed "${opened.char}" opened at line ${opened.line}?)`;
    return { ok: false, error: { line: e.line, column: e.column, message } };
  }
}

/**
 * The innermost `[` or `{` opened on an earlier line and still open at (line, column):
 * the parser reports an unterminated array where it notices, often at the next table header.
 * Skips strings and comments; a rough scan, only used to word a hint.
 * @param {string} text
 * @param {number} line
 * @param {number} column
 * @returns {{ char: string, line: number } | undefined}
 */
function unclosedBracket(text, line, column) {
  /** @type {{ char: string, line: number }[]} */
  const stack = [];
  let at = 1;
  let col = 1;
  for (let i = 0; i < text.length && (at < line || (at === line && col < column)); i++, col++) {
    const c = text[i];
    if (c === "\n") {
      at++;
      col = 0;
    } else if (c === "#") {
      while (i + 1 < text.length && text[i + 1] !== "\n") i++;
    } else if (c === '"' || c === "'") {
      const q = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      let j = i + q.length;
      while (j < text.length && !text.startsWith(q, j) && (q.length === 3 || text[j] !== "\n")) {
        j += c === '"' && text[j] === "\\" ? 2 : 1;
      }
      for (let k = i; k < j; k++) if (text[k] === "\n") at++;
      i = j + q.length - 1;
    } else if (c === "[" || c === "{") {
      stack.push({ char: c, line: at });
    } else if (c === "]" || c === "}") {
      stack.pop();
    }
  }
  return [...stack].reverse().find((open) => open.line < line);
}

const BARE = /^[A-Za-z0-9_-]+$/;

/**
 * `keys.new_tab[1]`, `modal.normal."<C-w>h"`: bare keys plain, others as JSON strings.
 * @param {Path} path
 */
export function formatPath(path) {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += (out ? "." : "") + (BARE.test(seg) ? seg : JSON.stringify(seg));
  }
  return out;
}

/**
 * Inverse of formatPath; also reads KeymapError paths, which quote every modal sequence.
 * @param {string} text
 * @returns {Path}
 */
export function parsePath(text) {
  /** @type {Path} */
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ".") {
      i++;
    } else if (c === "[") {
      const end = text.indexOf("]", i);
      out.push(Number(text.slice(i + 1, end)));
      i = end + 1;
    } else if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out.push(JSON.parse(text.slice(i, j + 1)));
      i = j + 1;
    } else {
      const m = /^[^.[]+/.exec(text.slice(i));
      const seg = /** @type {RegExpExecArray} */ (m)[0];
      out.push(seg);
      i += seg.length;
    }
  }
  return out;
}

/** @type {Record<string, string>} */
const ESCAPES = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", e: "\x1b", '"': '"', "\\": "\\" };

/**
 * Line of every key, table header, array element and inline-table member in `text`, which must
 * already have parsed (parseToml): the scanner trusts the syntax and only tracks positions.
 * @param {string} text
 * @returns {(path: Path) => number | undefined}  line of `path` or of its nearest located ancestor
 */
export function locateKeys(text) {
  /** @type {number[]} */
  const starts = [0];
  for (let k = 0; k < text.length; k++) if (text[k] === "\n") starts.push(k + 1);
  /** @param {number} pos */
  const lineAt = (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (/** @type {number} */ (starts[mid]) <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  /** @type {Map<string, number>} */
  const lines = new Map();
  /** @param {Path} path @param {number} pos */
  const record = (path, pos) => {
    const k = JSON.stringify(path);
    if (!lines.has(k)) lines.set(k, lineAt(pos));
  };

  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; // BOM
  const ws = () => {
    while (text[i] === " " || text[i] === "\t") i++;
  };
  const wsNl = () => {
    for (;;) {
      ws();
      if (text[i] === "#") while (i < text.length && text[i] !== "\n") i++;
      if (text[i] === "\r" || text[i] === "\n") i++;
      else return;
    }
  };
  /** @param {string} q */
  const quoted = (q) => {
    let s = "";
    i++;
    while (text[i] !== q) {
      const c = /** @type {string} */ (text[i]);
      if (q === '"' && c === "\\") {
        const e = /** @type {string} */ (text[i + 1]);
        const hex = { u: 4, U: 8, x: 2 }[e];
        if (hex) {
          s += String.fromCodePoint(parseInt(text.slice(i + 2, i + 2 + hex), 16));
          i += 2 + hex;
        } else {
          s += ESCAPES[e] ?? e;
          i += 2;
        }
      } else {
        s += c;
        i++;
      }
    }
    i++;
    return s;
  };
  /** @returns {string[]} */
  const key = () => {
    /** @type {string[]} */
    const segs = [];
    for (;;) {
      ws();
      const c = text[i];
      if (c === '"' || c === "'") {
        segs.push(quoted(c));
      } else {
        const start = i;
        while (i < text.length && /[A-Za-z0-9_-]/.test(/** @type {string} */ (text[i]))) i++;
        segs.push(text.slice(start, i));
      }
      ws();
      if (text[i] !== ".") return segs;
      i++;
    }
  };
  /** @param {string} delim */
  const multiline = (delim) => {
    i += 3;
    for (;;) {
      if (delim === '"""' && text[i] === "\\") i += 2;
      else if (text.startsWith(delim, i)) break;
      else i++;
    }
    i += 3;
    while (text[i] === delim[0]) i++; // up to two quotes may end the content
  };
  /** @param {Path} path */
  const value = (path) => {
    const c = text[i];
    if (text.startsWith('"""', i) || text.startsWith("'''", i)) {
      multiline(text.slice(i, i + 3));
    } else if (c === '"' || c === "'") {
      quoted(c);
    } else if (c === "[") {
      i++;
      for (let idx = 0; ; idx++) {
        wsNl();
        if (text[i] === "]") break;
        record([...path, idx], i);
        value([...path, idx]);
        wsNl();
        if (text[i] === ",") i++;
      }
      i++;
    } else if (c === "{") {
      i++;
      for (;;) {
        wsNl();
        if (text[i] === "}") break;
        keyval(path);
        wsNl();
        if (text[i] === ",") i++;
      }
      i++;
    } else {
      while (i < text.length && !",]}\r\n#".includes(/** @type {string} */ (text[i]))) i++;
    }
  };
  /** @param {Path} base */
  const keyval = (base) => {
    ws();
    const at = i;
    const full = [...base, ...key()];
    for (let n = base.length + 1; n <= full.length; n++) record(full.slice(0, n), at);
    i++; // "="
    ws();
    value(full);
  };

  /** @type {Path} */
  let table = [];
  for (;;) {
    wsNl();
    if (i >= text.length) break;
    const before = i;
    if (text[i] === "[") {
      const at = i;
      const array = text[i + 1] === "[";
      i += array ? 2 : 1;
      table = key();
      i += array ? 2 : 1;
      record(table, at);
    } else {
      keyval(table);
    }
    /* c8 ignore next */
    if (i === before) i++; // never loop forever on input the parser would have rejected
  }

  return (path) => {
    for (let n = path.length; n > 0; n--) {
      const line = lines.get(JSON.stringify(path.slice(0, n)));
      if (line !== undefined) return line;
    }
    return undefined;
  };
}
