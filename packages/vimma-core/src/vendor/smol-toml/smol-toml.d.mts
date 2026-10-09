/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Types for the vendored smol-toml.mjs (BSD-3-Clause, see LICENSE), written for vimma.
// tsc uses these declarations instead of type-checking the upstream JavaScript.
export interface ParseOptions {
  integersAsBigInt?: boolean | "asNeeded";
  useLegacyDate?: boolean;
  unsafeKeyBehaviour?: "keep" | "drop" | "throw";
  maxDepth?: number;
}
export declare function parse(toml: string, options?: ParseOptions): Record<string, unknown>;
export declare class TomlError extends Error {
  line: number;
  column: number;
  codeblock: string;
}
