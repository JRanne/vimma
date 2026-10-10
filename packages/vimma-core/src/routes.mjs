/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Workspace routing rules (spec: docs/specs/workspace-routing.md): `[[routes]]` tables in
 * config.toml say which workspace a URL opens in, by domain, URL prefix or the application that
 * opened the link. The first matching rule, in file order, wins. Pure: the host passes URLs as
 * strings and the app hint as a token it has checked with isAppToken.
 */
import { closest } from "./actions.mjs";

/**
 * @typedef {object} RouteDomain
 * @property {string} host  ASCII (punycode), lower case, no trailing dot; IPv6 without brackets
 * @property {boolean} sub  `*.host`: subdomains only
 * @property {boolean} ip   an IP literal: matches only itself
 */

/**
 * @typedef {object} Route
 * @property {number} index        1-based place in the file
 * @property {string} workspace
 * @property {RouteDomain} [domain]
 * @property {string} [url]        a prefix of `URL.href`
 * @property {string} [app]        the application token
 */

/** @typedef {{ path: (string | number)[], message: string, suggestion?: string }} RouteProblem */

const KEYS = ["domain", "url", "app", "workspace"];
const LABEL = "[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?";
const DOMAIN = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*$`);
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const APP = /^[a-z0-9][a-z0-9._+-]{0,31}$/;
const MAX_NAME = 32;
const BAD_DOMAIN =
  'must be a hostname like "github.com" or "*.corp.example", without scheme, port or path';

/**
 * Whether `s` may be an application name: a lower-case token, never a path or anything a shell
 * would read. Both the launcher and the host check it.
 * @param {unknown} s
 */
export function isAppToken(s) {
  return typeof s === "string" && APP.test(s);
}

/** @param {unknown} v */
function typeName(v) {
  if (Array.isArray(v)) return "an array";
  if (typeof v === "bigint") return "an integer";
  if (typeof v === "number") return "a float";
  if (v !== null && typeof v === "object") return v instanceof Date ? "a date" : "a table";
  return typeof v === "string" ? "a string" : "a boolean";
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isTable = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

/** @param {string} s */
const hasControl = (s) =>
  [...s].some((ch) => /** @type {number} */ (ch.codePointAt(0)) < 0x20 || ch === "\x7f");

/**
 * The URL parser's ASCII hostname for `host`, or null.
 * @param {string} host
 */
function asciiHost(host) {
  try {
    return new URL(`http://${host}/`).hostname;
  } catch {
    return null;
  }
}

/**
 * A `domain` value as matching compares it, or null when it is not one.
 * @param {string} text
 * @returns {RouteDomain | null}
 */
function parseDomain(text) {
  let s = text.trim().toLowerCase().replace(/\.$/, "");
  const sub = s.startsWith("*.");
  if (sub) s = s.slice(2);
  if (!s || /[/?#@*\s\\%]/.test(s)) return null;
  if (IPV4.test(s)) return sub || asciiHost(s) !== s ? null : { host: s, sub: false, ip: true };
  const v6 = s.replace(/^\[(.*)\]$/, "$1");
  if (v6.includes(":")) {
    if (sub) return null;
    const h = asciiHost(`[${v6}]`);
    return h ? { host: h.slice(1, -1), sub: false, ip: true } : null;
  }
  const ascii = asciiHost(s);
  // The parser reads some names as IPv4 (`0x7f.1`); a domain rule must stay a name.
  if (!ascii || IPV4.test(ascii) || !DOMAIN.test(ascii)) return null;
  return { host: ascii, sub, ip: false };
}

/**
 * What the user probably meant by a `domain` that is not a hostname.
 * @param {string} text
 */
function domainSuggestion(text) {
  const host = text
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d*$/, "");
  return host !== text && parseDomain(host) ? host : undefined;
}

/**
 * A `url` value as matching compares it (`URL.href`), or null.
 * @param {string} text
 */
function parseUrlPrefix(text) {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text.trim())) return null;
  try {
    const href = new URL(text.trim()).href;
    return /^javascript:/i.test(href) ? null : href;
  } catch {
    return null;
  }
}

/**
 * Every problem of a `routes` value (the parsed `[[routes]]` array), paths relative to it.
 * @param {unknown} value
 * @returns {RouteProblem[]}
 */
export function validateRoutes(value) {
  /** @type {RouteProblem[]} */
  const problems = [];
  if (!Array.isArray(value)) {
    return [{ path: [], message: `expected [[routes]] tables, got ${typeName(value)}` }];
  }
  value.forEach((rule, i) => {
    if (!isTable(rule)) {
      problems.push({ path: [i], message: `expected a table, got ${typeName(rule)}` });
      return;
    }
    const before = problems.length;
    for (const [key, v] of Object.entries(rule)) {
      const path = [i, key];
      if (!KEYS.includes(key)) {
        const suggestion = closest(key, KEYS);
        problems.push({
          path,
          message: `unknown key "${key}"`,
          ...(suggestion ? { suggestion } : {}),
        });
      } else if (typeof v !== "string") {
        problems.push({ path, message: `expected a string, got ${typeName(v)}` });
      } else if (key === "domain" && !parseDomain(v)) {
        const suggestion = domainSuggestion(v);
        problems.push({ path, message: BAD_DOMAIN, ...(suggestion ? { suggestion } : {}) });
      } else if (key === "url" && !parseUrlPrefix(v)) {
        problems.push({
          path,
          message: 'must be a URL like "file:///home/me/work/" or "about:preferences"',
        });
      } else if (key === "app" && !isAppToken(v.toLowerCase())) {
        problems.push({
          path,
          message:
            "must be an application name: letters, digits and . _ + - (as `vimma-open` reports it)",
        });
      } else if (key === "workspace") {
        const length = [...v].length;
        if (length < 1 || length > MAX_NAME) {
          problems.push({ path, message: `workspace name must be 1 to ${MAX_NAME} characters` });
        } else if (hasControl(v)) {
          problems.push({ path, message: "workspace name must not contain control characters" });
        }
      }
    }
    if (problems.length > before) return;
    if (!("domain" in rule || "url" in rule || "app" in rule)) {
      problems.push({ path: [i], message: 'a rule needs domain, url or app (and "workspace")' });
    } else if ("domain" in rule && "url" in rule) {
      problems.push({ path: [i, "url"], message: "use domain or url, not both" });
    } else if (!("workspace" in rule)) {
      problems.push({ path: [i], message: 'missing "workspace"' });
    }
  });
  return problems;
}

/**
 * The rules of a valid `routes` value, as matching uses them.
 * @param {readonly Record<string, string>[]} value  validated by validateRoutes
 * @returns {Route[]}
 */
export function resolveRoutes(value) {
  return value.map((rule, i) => {
    /** @type {Route} */
    const route = { index: i + 1, workspace: rule.workspace ?? "" };
    if (rule.domain !== undefined)
      route.domain = /** @type {RouteDomain} */ (parseDomain(rule.domain));
    if (rule.url !== undefined) route.url = /** @type {string} */ (parseUrlPrefix(rule.url));
    if (rule.app !== undefined) route.app = rule.app.toLowerCase();
    return route;
  });
}

/**
 * @param {URL} u
 * @param {RouteDomain} d
 */
function domainHit(u, d) {
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.replace(/\.$/, "").replace(/^\[(.*)\]$/, "$1");
  if (d.ip) return host === d.host;
  if (IPV4.test(host) || host.includes(":")) return false;
  return d.sub ? host.endsWith(`.${d.host}`) : host === d.host || host.endsWith(`.${d.host}`);
}

/**
 * The first rule, in file order, that matches `url` opened by `app` (null: not known). With
 * `workspaces`, a rule naming a workspace not in it is skipped. Every key of a rule must match.
 * @param {readonly Route[]} routes
 * @param {{ url: string, app?: string | null }} what
 * @param {{ workspaces?: readonly string[] }} [options]
 * @returns {Route | null}
 */
export function matchRoute(routes, { url, app = null }, { workspaces } = {}) {
  if (!routes.length) return null;
  /** @type {URL | null} */
  let u;
  try {
    u = new URL(url);
  } catch {
    u = null;
  }
  const token = isAppToken(app) ? app : null;
  for (const r of routes) {
    if (workspaces && !workspaces.includes(r.workspace)) continue;
    if (r.app !== undefined && r.app !== token) continue;
    if (r.domain && !(u && domainHit(u, r.domain))) continue;
    if (r.url !== undefined && !(u && u.href.startsWith(r.url))) continue;
    return r;
  }
  return null;
}

/**
 * What a rule matches, for `:route` and about:vimma: `app discord, domain youtube.com`.
 * @param {Route} route
 */
export function describeRoute(route) {
  const parts = [];
  if (route.app !== undefined) parts.push(`app ${route.app}`);
  if (route.domain) {
    const d = route.domain;
    const host = d.ip && d.host.includes(":") ? `[${d.host}]` : d.host;
    parts.push(`domain ${d.sub ? "*." : ""}${host}`);
  }
  if (route.url !== undefined) parts.push(`url ${route.url}`);
  return parts.join(", ");
}

/**
 * The `domain` `:route add` writes for a page: its host without a leading `www.`; null for a
 * page that is not http(s).
 * @param {string} url
 * @returns {string | null}
 */
export function routeDomainFor(url) {
  /** @type {URL} */
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.replace(/\.$/, "").replace(/^\[(.*)\]$/, "$1");
  return host.startsWith("www.") ? host.slice(4) : host;
}
