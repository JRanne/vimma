/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The public update keys this build trusts for the update manifest (docs/specs/m6a-updater.md
 * §6): the primary (Google Cloud KMS) and the offline secondary, each as base64 DER
 * SubjectPublicKeyInfo with its id, the first 8 hex digits of the SPKI's SHA-256. Empty until
 * the key ceremony in docs/runbook.md ("Update signing keys"); until then every manifest is
 * refused and nothing is shown. updates.test.mjs checks each entry (RSA-4096, the id matches,
 * one key per slot).
 * @type {readonly import("./updates.mjs").PinnedKey[]}
 */
export const UPDATE_KEYS = Object.freeze([]);
