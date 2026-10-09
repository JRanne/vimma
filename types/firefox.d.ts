// The slice of Firefox chrome globals our code uses. Extend as needed; the engine tree is the
// source of truth (e.g. engine/xpcom/base/nsIPrefBranch.idl).

declare const Services: {
  prefs: {
    getBoolPref(name: string, defaultValue?: boolean): boolean;
    setBoolPref(name: string, value: boolean): void;
    prefHasUserValue(name: string): boolean;
  };
  // engine/dom/interfaces/base/nsIFocusManager.idl
  focus: {
    readonly focusedElement: Element | null;
  };
};

// engine/dom/interfaces/base/nsIDOMWindowUtils.idl
interface Window {
  readonly windowUtils: {
    readonly AUTHOR_SHEET: number;
    loadSheetUsingURIString(sheetURI: string, type: number): void;
  };
}
