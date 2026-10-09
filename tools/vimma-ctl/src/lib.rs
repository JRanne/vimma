/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Client for Vimma's control socket, protocol version 1
//! (docs/specs/m0-control-protocol-and-vimma-ctl.md).

pub mod cli;
pub mod client;
pub mod discovery;
pub mod json;
pub mod protocol;
