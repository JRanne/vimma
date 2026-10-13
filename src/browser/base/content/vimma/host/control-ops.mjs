/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// `:control on <minutes>` and `:control off` (docs/specs/vimma-mcp.md decision 29 D): full
// control (the control socket's `full` role, `vimma.control.enabled`) for a while. The end time
// is a pref, so a restart inside the window keeps it and one after it turns control off at
// startup. Turning control on in about:config sets no end time and is left alone.

import { controlOnQuestion, controlStatus, parseControlCommand } from "../core/agent-prompt.mjs";

const lazy = /** @type {any} */ ({});
ChromeUtils.defineESModuleGetters(lazy, {
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

export const CONTROL_ENABLED_PREF = "vimma.control.enabled";
/** When `:control on <minutes>` ends, in seconds since the epoch; absent: no end. */
export const CONTROL_UNTIL_PREF = "vimma.control.enabledUntil";

let timer = /** @type {any} */ (null);
let watching = false;

/** The end time in ms, or null. */
function untilMs() {
  const s = Services.prefs.getIntPref(CONTROL_UNTIL_PREF, 0);
  return s > 0 ? s * 1000 : null;
}

/** Off now, and the end time gone. */
function turnOff() {
  if (timer) lazy.clearTimeout(timer);
  timer = null;
  Services.prefs.clearUserPref(CONTROL_UNTIL_PREF);
  Services.prefs.setBoolPref(CONTROL_ENABLED_PREF, false);
}

/** Arm the timer for the end time, or end it now when it has passed. */
function arm() {
  if (timer) lazy.clearTimeout(timer);
  timer = null;
  const until = untilMs();
  if (until === null) return;
  if (!Services.prefs.getBoolPref(CONTROL_ENABLED_PREF, false)) {
    Services.prefs.clearUserPref(CONTROL_UNTIL_PREF);
    return;
  }
  const left = until - Date.now();
  if (left <= 0) {
    turnOff();
    return;
  }
  // Timers past 2^31 ms overflow; 1440 minutes is far below that.
  timer = lazy.setTimeout(arm, Math.min(left, 60 * 60 * 1000));
}

export const ControlHost = {
  /** At startup (vimma.js) and in tests: an end time in the past turns control off. */
  init() {
    if (!watching) {
      watching = true;
      Services.prefs.addObserver(CONTROL_UNTIL_PREF, arm);
      Services.prefs.addObserver(CONTROL_ENABLED_PREF, arm);
    }
    arm();
  },

  /** Full control's state, for `:control`, `:mcp` and about:vimma. */
  status() {
    return controlStatus({
      enabled: Services.prefs.getBoolPref(CONTROL_ENABLED_PREF, false),
      until: untilMs(),
      now: Date.now(),
    });
  },

  /**
   * `:control [on <minutes> | off]`: the notice's text, or null while its y/N is open.
   * @param {string | undefined} text
   * @param {(question: string, yes: () => void) => void} ask
   * @param {(text: string) => void} say  after the answer
   * @returns {string | null}
   */
  run(text, ask, say) {
    const command = parseControlCommand(text);
    switch (command.kind) {
      case "refuse":
        return command.text;
      case "status":
        return this.status();
      case "off":
        turnOff();
        return "full control off";
      case "on": {
        const { minutes } = command;
        ask(controlOnQuestion(minutes), () => {
          // On first: the end time's observer clears an end time while control is off.
          Services.prefs.setBoolPref(CONTROL_ENABLED_PREF, true);
          Services.prefs.setIntPref(
            CONTROL_UNTIL_PREF,
            Math.floor((Date.now() + minutes * 60_000) / 1000),
          );
          arm();
          say(this.status());
        });
        return null;
      }
    }
    return null;
  },
};
