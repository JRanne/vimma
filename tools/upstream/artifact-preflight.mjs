#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Upstream autopilot: are Mozilla's compiled binaries for the new release's revision in the
 * Taskcluster index (ADR-010)? If yes, upstream.yml runs the suites on an artifact build; if no,
 * the PR says so and names the full-build path. Same lookup as tools/artifact-build.
 *
 *   node tools/upstream/artifact-preflight.mjs patch-check.json [--github-output FILE]
 *
 * Reads `revision` from patch-check.py's report and prints `artifacts=yes|no|unknown` and a note.
 * Always exits 0 unless its arguments are wrong: the verdict is the output.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { indexNamespace, indexTask } from "../artifact-build/artifact-build.mjs";
import { githubOutputText } from "./detect.mjs";

const INDEX_URL = "https://firefox-ci-tc.services.mozilla.com/api/index/v1/task/";

/**
 * @typedef {(url: string) => Promise<{ status: number, json: () => Promise<unknown> }>} FetchJson
 */

/**
 * @param {string | null} revision
 * @param {FetchJson} fetchJson
 * @param {Date} now
 * @returns {Promise<{ artifacts: "yes" | "no" | "unknown", note: string }>}
 */
export async function preflight(revision, fetchJson, now) {
  if (!revision) return { artifacts: "unknown", note: "no revision in the source tarball" };
  let res;
  let body;
  try {
    res = await fetchJson(INDEX_URL + indexNamespace(revision));
    body = await res.json().catch(() => null);
  } catch (e) {
    return {
      artifacts: "unknown",
      note: `Taskcluster index unreachable: ${e instanceof Error ? e.message : e}`,
    };
  }
  if (res.status !== 200 && res.status !== 404) {
    return { artifacts: "unknown", note: `Taskcluster index: HTTP ${res.status}` };
  }
  try {
    const { expires } = indexTask(revision, res.status, body, now);
    return {
      artifacts: "yes",
      note: `Mozilla's linux64 build of ${revision.slice(0, 12)} is indexed until ${expires.slice(0, 10)}`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const known = res.status === 404 || /expired/.test(message);
    return { artifacts: known ? "no" : "unknown", note: message };
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { "github-output": { type: "string" } },
  });
  if (!positionals[0]) throw new Error("usage: artifact-preflight.mjs patch-check.json");
  const report = JSON.parse(readFileSync(positionals[0], "utf8"));
  const r = await preflight(
    typeof report.revision === "string" ? report.revision : null,
    (url) => fetch(url, { signal: AbortSignal.timeout(30_000) }),
    new Date(),
  );
  console.log(`artifacts=${r.artifacts}: ${r.note}`);
  if (values["github-output"]) {
    appendFileSync(
      values["github-output"],
      githubOutputText({ artifacts: r.artifacts, "artifacts-note": r.note }),
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`artifact-preflight: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  });
}
