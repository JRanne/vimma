/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Parent side of the Vimma actor (spec: docs/specs/m1-actor-insert-scroll.md): hands focus
// reports and mouse selections (m1-copy-mode) to the host for the tab's <browser>. Commands go
// out through VimmaActors.

import { parseDescriptor } from "../core/editable.mjs";
import { VimmaHost } from "../host/VimmaHost.sys.mjs";

const TRIGGERS = new Set(["focusin", "recheck"]);

export class VimmaParent extends JSWindowActorParent {
  /** @param {{ name: string, data: any }} msg */
  receiveMessage(msg) {
    if (msg.name !== "Vimma:Focus" && msg.name !== "Vimma:MouseSelection") return;
    // From a content process, which may be compromised: only the frame that has focus speaks
    // for the tab (a hidden cross-origin frame must not flip its mode), and only a well-formed
    // report is taken. The focus manager learns of a focus change before the child's report,
    // which follows it on the same IPC channel. Parent-process pages (Settings) are privileged
    // and may focus a field while their tab is still being selected, before the focus manager
    // moves: they are exempt from the focus check.
    const focused = Services.focus.focusedContentBrowsingContext;
    if (!this.manager.isInProcess && this.browsingContext !== focused) return;
    const browser = this.browsingContext.top.embedderElement;
    if (msg.name === "Vimma:MouseSelection") {
      // The user selected text with the mouse in the focused frame: copy mode takes it.
      if (browser) VimmaHost.onMouseSelection(browser);
      return;
    }
    const trigger = msg.data?.trigger;
    const descriptor = parseDescriptor(msg.data?.descriptor);
    if (!browser || !TRIGGERS.has(trigger) || !descriptor) return;
    VimmaHost.onFocusReport(browser, { descriptor, trigger, frame: this.browsingContext });
  }
}
