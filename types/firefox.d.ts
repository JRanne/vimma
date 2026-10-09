// The slice of Firefox chrome globals our code uses. Extend as needed; the engine tree is the
// source of truth (e.g. engine/xpcom/base/nsIPrefBranch.idl).

declare const Services: {
  prefs: {
    getBoolPref(name: string, defaultValue?: boolean): boolean;
    setBoolPref(name: string, value: boolean): void;
    prefHasUserValue(name: string): boolean;
    addObserver(
      name: string,
      observer: (subject: unknown, topic: string, data: string) => void,
    ): void;
    removeObserver(
      name: string,
      observer: (subject: unknown, topic: string, data: string) => void,
    ): void;
  };
  // engine/dom/interfaces/base/nsIFocusManager.idl
  focus: {
    readonly focusedElement: Element | null;
    readonly focusedContentBrowsingContext: any;
  };
  // engine/caps/nsIScriptSecurityManager.idl
  scriptSecurityManager: {
    checkLoadURIWithPrincipal(principal: unknown, uri: unknown, flags?: number): void;
  };
  // engine/dom/events/nsIEventListenerService.idl
  els: {
    hasListenersFor(target: EventTarget, type: string): boolean;
  };
};

// XPCOM in system modules: interface constants and component constructors.
declare const Ci: any;
declare const Components: { Constructor(cid: string, iface: string, init?: string): any };

// engine/dom/chrome-webidl/BrowsingContext.webidl
declare const BrowsingContext: { get(id: number): any };

// engine/dom/webidl/URL.webidl (chrome-only)
interface URL {
  readonly URI: unknown;
}

// engine/dom/chrome-webidl/ChromeUtils.webidl
declare const ChromeUtils: {
  importESModule(url: string): any;
  registerWindowActor(name: string, options: object): void;
  now(): number;
};

// engine/dom/chrome-webidl/JSWindowActor.webidl
declare class JSWindowActorParent {
  readonly browsingContext: any;
  sendAsyncMessage(name: string, data?: unknown): void;
  sendQuery(name: string, data?: unknown): Promise<any>;
}
declare class JSWindowActorChild {
  readonly browsingContext: any;
  readonly document: Document;
  readonly contentWindow: Window | null;
  sendAsyncMessage(name: string, data?: unknown): void;
  sendQuery(name: string, data?: unknown): Promise<any>;
}

// engine/dom/interfaces/base/nsIDOMWindowUtils.idl
interface Window {
  readonly windowUtils: {
    readonly AUTHOR_SHEET: number;
    loadSheetUsingURIString(sheetURI: string, type: number): void;
  };
}

// engine/dom/webidl/Element.webidl, Node.webidl and Event.webidl (chrome-only members)
interface Element {
  readonly openOrClosedShadowRoot: ShadowRoot | null;
  readonly scrollTopMax: number;
  readonly scrollLeftMax: number;
}
interface Node {
  readonly ownerGlobal: Window;
}
interface Event {
  readonly originalTarget: EventTarget | null;
}
