// The slice of Firefox chrome globals our code uses. Extend as needed; the engine tree is the
// source of truth (e.g. engine/xpcom/base/nsIPrefBranch.idl).

declare const Services: {
  prefs: {
    getBoolPref(name: string, defaultValue?: boolean): boolean;
    getIntPref(name: string, defaultValue?: number): number;
    setBoolPref(name: string, value: boolean): void;
    getIntPref(name: string, defaultValue?: number): number;
    prefHasUserValue(name: string): boolean;
    getDefaultBranch(root: string): {
      setBoolPref(name: string, value: boolean): void;
    };
    addObserver(
      name: string,
      observer: (subject: unknown, topic: string, data: string) => void,
    ): void;
    removeObserver(
      name: string,
      observer: (subject: unknown, topic: string, data: string) => void,
    ): void;
  };
  // engine/netwerk/base/nsIIOService.idl
  io: {
    createExposableURI(uri: { spec: string }): { spec: string; displaySpec: string };
    newURI(spec: string): { readonly scheme: string; readonly spec: string };
  };
  // engine/dom/interfaces/base/nsIFocusManager.idl
  focus: {
    readonly focusedElement: Element | null;
    readonly focusedContentBrowsingContext: any;
  };
  // engine/caps/nsIScriptSecurityManager.idl
  scriptSecurityManager: {
    getSystemPrincipal(): unknown;
    checkLoadURIWithPrincipal(principal: unknown, uri: unknown, flags?: number): void;
  };
  // engine/dom/events/nsIEventListenerService.idl
  els: {
    hasListenersFor(target: EventTarget, type: string): boolean;
  };
  // engine/xpcom/threads/nsIThreadManager.idl
  tm: { readonly mainThread: unknown };
  // engine/xpcom/system/nsIXULRuntime.idl
  appinfo: { readonly processID: number };
  // engine/xpcom/ds/nsIObserverService.idl
  obs: {
    addObserver(observer: (subject: unknown, topic: string) => void, topic: string): void;
    removeObserver(observer: (subject: unknown, topic: string) => void, topic: string): void;
    notifyObservers(subject: unknown, topic: string, data?: string): void;
  };
  // engine/xpcom/base/nsIUUIDGenerator.idl
  uuid: { generateUUID(): { toString(): string } };
  // engine/xpcom/base/nsIWindowMediator.idl
  wm: { getMostRecentWindow(type: string): Window | null };
};

// XPCOM component classes and results (engine/js/xpconnect). Untyped on purpose: each use
// names its interface, and the IDL in the engine tree is the reference.
declare const Cc: any;
declare const Cr: Record<string, number>;

// engine/dom/chrome-webidl/PathUtils.webidl
declare const PathUtils: {
  readonly profileDir: string;
  join(...components: string[]): string;
};

// engine/dom/chrome-webidl/IOUtils.webidl
declare const IOUtils: {
  createUniqueFile(parent: string, prefix: string, permissions?: number): Promise<string>;
  writeUTF8(path: string, data: string): Promise<number>;
  readUTF8(path: string): Promise<string>;
  copy(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  remove(path: string, options?: { ignoreAbsent?: boolean; recursive?: boolean }): Promise<void>;
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
  defineESModuleGetters(target: object, modules: Record<string, string>): void;
  registerWindowActor(name: string, options: object): void;
  now(): number;
};

// engine/dom/chrome-webidl/JSWindowActor.webidl
declare class JSWindowActorParent {
  readonly browsingContext: any;
  /** engine/dom/chrome-webidl/WindowGlobalActors.webidl (WindowGlobalParent) */
  readonly manager: { readonly isInProcess: boolean };
  sendAsyncMessage(name: string, data?: unknown): void;
  sendQuery(name: string, data?: unknown): Promise<any>;
}
declare class JSWindowActorChild {
  readonly browsingContext: any;
  readonly document: Document;
  readonly contentWindow: Window | null;
  // WindowGlobalChild: the other actors of this frame (spec m1-find: Firefox's FinderChild)
  readonly manager: { getActor(name: string): any };
  sendAsyncMessage(name: string, data?: unknown): void;
  sendQuery(name: string, data?: unknown): Promise<any>;
}

// engine/dom/interfaces/base/nsIDOMWindowUtils.idl
interface Window {
  readonly windowUtils: {
    readonly AUTHOR_SHEET: number;
    loadSheetUsingURIString(sheetURI: string, type: number): void;
    nodesFromRect(
      x: number,
      y: number,
      top: number,
      right: number,
      bottom: number,
      left: number,
      ignoreRootScrollFrame: boolean,
      flushLayout: boolean,
      onlyVisible: boolean,
      transparencyThreshold?: number,
    ): NodeList;
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
