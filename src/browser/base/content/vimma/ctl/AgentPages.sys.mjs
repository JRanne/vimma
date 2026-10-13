/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The agent workspace's pages on a short leash (docs/specs/vimma-mcp.md decision 30, user
// 2026-10-13): what an agent opens there runs with no one watching, so its pages get no
// permission and open no pop-up. Three hooks, all Firefox's own, no upstream patch:
// - Integration.contentPermission: every nsIContentPermissionPrompt request (geolocation,
//   notifications, XR, MIDI, persistent storage, storage access, local network, and any later
//   type) from the agent container is cancelled without a prompt
//   (browser/components/permissions/ContentPermissionPrompt.sys.mjs, createPermissionPrompt).
// - Camera, microphone and screen sharing do not go through it (browser/actors/WebRTCParent's
//   prompt): every document response in an agent tab gets a DENY for its origin scoped to that
//   tab (browser), before the page has it; WebRTCParent reads it as a temporary BLOCK and
//   denies without a prompt.
// - Pop-ups: every top-level browsing context in the agent container gets
//   SANDBOXED_AUXILIARY_NAVIGATION, as Firefox's own hidden page reader does
//   (toolkit/components/pageextractor/PageExtractorParent.sys.mjs); window.open and
//   target=_blank open nothing. CanonicalBrowsingContext::ReplacedBy copies the flags.
// The agent container is WorkspaceStore.agent's, read at each check.

import { WorkspaceStore } from "../workspaces/WorkspaceStore.sys.mjs";

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  Integration: "resource://gre/modules/Integration.sys.mjs",
});

/** nsSandboxFlags.h: no new browsing contexts (window.open, target=_blank). */
export const SANDBOXED_AUXILIARY_NAVIGATION = 0x2;

/**
 * Prompts WebRTCParent shows itself, outside nsIContentPermissionPrompt (decision 30): denied
 * per agent tab. A browser-scoped DENY (Services.perms.addFromPrincipalForBrowser) is what
 * SitePermissions.getForPrincipal(principal, id, browser) reads as a temporary BLOCK, and
 * WebRTCParent then denies without a prompt. Browser-scoped, not the origin's permission:
 * permissions are shared across containers (permissions.isolateBy.userContext is false), so an
 * origin-wide DENY would reach the same site in `work`.
 */
export const AGENT_DENIED_PERMISSIONS = Object.freeze([
  "camera",
  "microphone",
  "screen",
  "speaker",
]);
/** How long each browser-scoped DENY lasts; every document load in the tab sets it again. */
const DENY_MS = 7 * 24 * 60 * 60 * 1000;

const RESPONSE_TOPICS = [
  "http-on-examine-response",
  "http-on-examine-cached-response",
  "http-on-examine-merged-response",
];

let initialised = false;

/** @param {number | null | undefined} userContextId */
function isAgentContainer(userContextId) {
  const agent = WorkspaceStore.agent?.userContextId;
  return typeof agent === "number" && agent > 0 && userContextId === agent;
}

/** @param {any} principal  nsIPrincipal, or null */
const isAgentPrincipal = (principal) =>
  !!principal && isAgentContainer(principal.originAttributes?.userContextId);

/**
 * The prompt Firefox would show, unless the request comes from the agent container: then a
 * prompt that cancels the request at once (the page is told "denied").
 * @param {any} base  ContentPermissionIntegration
 */
const permissionOverride = (base) => ({
  __proto__: base,
  /** @param {string} type @param {any} request  nsIContentPermissionRequest */
  createPermissionPrompt(type, request) {
    if (isAgentPrincipal(request.principal) || isAgentPrincipal(request.topLevelPrincipal)) {
      return { prompt: () => request.cancel() };
    }
    return base.createPermissionPrompt(type, request);
  },
});

/** @param {any} bc  a top-level content BrowsingContext in the parent */
function sandbox(bc) {
  try {
    if ((bc.sandboxFlags & SANDBOXED_AUXILIARY_NAVIGATION) === 0) {
      bc.sandboxFlags |= SANDBOXED_AUXILIARY_NAVIGATION;
    }
  } catch (e) {
    console.error("vimma agent pages: cannot sandbox", e);
  }
}

/** @param {any} subject  a BrowsingContext, just attached */
function onAttached(subject) {
  const bc = subject;
  if (!bc?.isContent || bc.parent) return;
  if (isAgentContainer(bc.originAttributes?.userContextId)) sandbox(bc);
}

/** @param {any} subject  an nsIHttpChannel with a response */
function onResponse(subject) {
  let channel;
  try {
    channel = subject.QueryInterface(Ci.nsIHttpChannel);
  } catch {
    return;
  }
  const loadInfo = channel.loadInfo;
  const type = loadInfo?.externalContentPolicyType;
  if (type !== Ci.nsIContentPolicy.TYPE_DOCUMENT && type !== Ci.nsIContentPolicy.TYPE_SUBDOCUMENT) {
    return;
  }
  if (!isAgentContainer(loadInfo.originAttributes?.userContextId)) return;
  // A frame asks with its top-level document's principal (permission delegation): deny the
  // top-level page's origin, in this tab only.
  const top = loadInfo.browsingContext?.top;
  if (!top?.browserId) return;
  const uri = type === Ci.nsIContentPolicy.TYPE_DOCUMENT ? channel.URI : top.currentURI;
  denyFor(uri, loadInfo.originAttributes, top.browserId);
}

/**
 * A browser-scoped DENY for each WebRTC prompt on `uri`'s origin, in the agent tab `browserId`.
 * @param {any} uri @param {object} originAttributes @param {number} browserId
 */
function denyFor(uri, originAttributes, browserId) {
  if (!uri?.schemeIs("https") && !uri?.schemeIs("http")) return;
  const services = /** @type {any} */ (Services);
  const principal = services.scriptSecurityManager.createContentPrincipal(uri, originAttributes);
  for (const type of AGENT_DENIED_PERMISSIONS) {
    services.perms.addFromPrincipalForBrowser(
      principal,
      type,
      services.perms.DENY_ACTION,
      browserId,
      DENY_MS,
    );
  }
}

/** Every agent tab open now: sandboxed, and its origin denied (the agent workspace changed). */
function sweep() {
  for (const win of /** @type {any} */ (Services.wm).getEnumerator("navigator:browser")) {
    for (const tab of win.gBrowser?.tabs ?? []) {
      if (!isAgentContainer(tab.userContextId)) continue;
      const bc = tab.linkedBrowser?.browsingContext;
      if (bc) sandbox(bc);
      const uri = tab.linkedBrowser?.currentURI;
      const browserId = tab.linkedBrowser?.browserId;
      if (uri && browserId) denyFor(uri, { userContextId: tab.userContextId }, browserId);
    }
  }
}

/** @param {any} subject @param {string} topic */
function observe(subject, topic) {
  if (topic === "browsing-context-attached") onAttached(subject);
  else if (topic === "vimma-mcp-changed") sweep();
  else onResponse(subject);
}

export const AgentPages = {
  /** Once per app (vimma.js): the hooks stay for the session. */
  init() {
    if (initialised) return;
    initialised = true;
    lazy.Integration.contentPermission.register(permissionOverride);
    Services.obs.addObserver(observe, "browsing-context-attached");
    for (const topic of RESPONSE_TOPICS) Services.obs.addObserver(observe, topic);
    Services.obs.addObserver(observe, "vimma-mcp-changed");
    sweep();
  },
};
