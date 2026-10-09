/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Parent side of the Vimma actor (spec: docs/specs/m1-actor-insert-scroll.md): hands focus
// reports to the host for the tab's <browser>. Commands go out through VimmaActors.

import { VimmaHost } from "../host/VimmaHost.sys.mjs";

const TRIGGERS = new Set(["focusin", "recheck"]);

export class VimmaParent extends JSWindowActorParent {
  /** @param {{ name: string, data: any }} msg */
  receiveMessage(msg) {
    if (msg.name !== "Vimma:Focus") return;
    const browser = this.browsingContext.top.embedderElement;
    const { descriptor, trigger } = msg.data ?? {};
    // From a content process: take only a well-formed report.
    if (!browser || !TRIGGERS.has(trigger) || typeof descriptor?.tagName !== "string") return;
    VimmaHost.onFocusReport(browser, { descriptor, trigger });
  }
}
