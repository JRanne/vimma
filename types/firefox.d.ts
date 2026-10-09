// The slice of Firefox chrome globals our code uses. Extend as needed; the engine tree is the
// source of truth (e.g. engine/xpcom/base/nsIPrefBranch.idl).

declare const Services: {
  prefs: {
    getBoolPref(name: string, defaultValue?: boolean): boolean;
    setBoolPref(name: string, value: boolean): void;
    getIntPref(name: string, defaultValue?: number): number;
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
  };
  // engine/netwerk/base/nsIIOService.idl
  io: { newURI(spec: string): { readonly scheme: string; readonly spec: string } };
  // engine/caps/nsIScriptSecurityManager.idl
  scriptSecurityManager: { getSystemPrincipal(): unknown };
  // engine/xpcom/threads/nsIThreadManager.idl
  tm: { readonly mainThread: unknown };
  // engine/xpcom/system/nsIXULRuntime.idl
  appinfo: { readonly processID: number };
  // engine/xpcom/ds/nsIObserverService.idl
  obs: {
    addObserver(observer: (subject: unknown, topic: string) => void, topic: string): void;
    removeObserver(observer: (subject: unknown, topic: string) => void, topic: string): void;
  };
  // engine/xpcom/base/nsIWindowMediator.idl
  wm: { getMostRecentWindow(type: string): Window | null };
};

// XPCOM component classes, interfaces and results (engine/js/xpconnect). Untyped on purpose:
// each use names its interface, and the IDL in the engine tree is the reference.
declare const Cc: any;
declare const Ci: any;
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
  move(from: string, to: string): Promise<void>;
  remove(path: string, options?: { ignoreAbsent?: boolean }): Promise<void>;
};

// engine/dom/chrome-webidl/ChromeUtils.webidl
declare const ChromeUtils: {
  importESModule(url: string): any;
  defineESModuleGetters(target: object, modules: Record<string, string>): void;
};

// engine/dom/interfaces/base/nsIDOMWindowUtils.idl
interface Window {
  readonly windowUtils: {
    readonly AUTHOR_SHEET: number;
    loadSheetUsingURIString(sheetURI: string, type: number): void;
  };
}
