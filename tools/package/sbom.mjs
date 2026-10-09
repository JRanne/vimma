#!/usr/bin/env node
/**
 * CycloneDX 1.6 JSON SBOM for a Vimma release (spec m6-packaging), from the source tree: Vimma,
 * Firefox, every crates.io/git package in engine/Cargo.lock (licence from the vendored
 * Cargo.toml) and every moz.yaml `origin` (the C/C++ libraries Mozilla vendors). It lists what
 * the tree vendors, a superset of what the binary links. No dependency: scanners such as syft
 * read installed package metadata, which a Firefox build does not have.
 *
 * Usage: node tools/package/sbom.mjs [--engine engine] [--repo JRanne/vimma] --out <file>
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** @typedef {{ name: string, version: string, source?: string, checksum?: string }} CargoPackage */
/** @typedef {{ name: string, url?: string, release?: string, revision?: string, licenses: string[] }} MozYaml */
/**
 * @typedef {{ license: { id: string } } | { license: { name: string } } | { expression: string }} License
 * @typedef {{ type: string, "bom-ref": string, name: string, version?: string, purl?: string,
 *   group?: string, hashes?: { alg: string, content: string }[], licenses?: License[],
 *   externalReferences?: { type: string, url: string }[] }} Component
 */

/**
 * The `[[package]]` tables of a Cargo.lock (flat string keys only; dependencies are skipped).
 * @param {string} text
 * @returns {CargoPackage[]}
 */
export function parseCargoLock(text) {
  /** @type {CargoPackage[]} */
  const packages = [];
  for (const block of text.split(/^\[\[package\]\]$/m).slice(1)) {
    /** @type {Record<string, string>} */
    const fields = {};
    for (const match of block.matchAll(/^(name|version|source|checksum) = "([^"]*)"$/gm)) {
      fields[match[1] ?? ""] = match[2] ?? "";
    }
    if (!fields.name || !fields.version) continue;
    /** @type {CargoPackage} */
    const pkg = { name: fields.name, version: fields.version };
    if (fields.source) pkg.source = fields.source;
    if (fields.checksum) pkg.checksum = fields.checksum;
    packages.push(pkg);
  }
  return packages;
}

/** @param {string} value a YAML scalar: strips quotes and a trailing comment */
function scalar(value) {
  const v = value.replace(/\s+#.*$/, "").trim();
  const quoted = /^(["'])(.*)\1$/.exec(v);
  return quoted ? (quoted[2] ?? "") : v;
}

/**
 * The `origin:` block of a moz.yaml (two-space keys, scalar or list licence).
 * @param {string} text
 * @returns {MozYaml | null}
 */
export function parseMozYaml(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^origin:\s*$/.test(line));
  if (start < 0) return null;
  /** @type {Record<string, string>} */
  const fields = {};
  /** @type {string[]} */
  const licenses = [];
  let inLicenseList = false;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && !line.startsWith("#")) break; // next top-level key
    const key = /^ {2}([a-z-]+):\s*(.*)$/.exec(line);
    if (key) {
      inLicenseList = false;
      const [, name = "", rest = ""] = key;
      if (name === "license") {
        const value = scalar(rest);
        if (value === "") inLicenseList = true;
        else if (value.startsWith("[")) {
          licenses.push(...value.slice(1, -1).split(",").map(scalar).filter(Boolean));
        } else licenses.push(value);
      } else fields[name] = scalar(rest);
      continue;
    }
    const item = /^ {4,}- (.*)$/.exec(line);
    if (item && inLicenseList) licenses.push(scalar(item[1] ?? ""));
  }
  if (!fields.name) return null;
  /** @type {MozYaml} */
  const result = { name: fields.name, licenses };
  if (fields.url) result.url = fields.url;
  if (fields.release) result.release = fields.release;
  if (fields.revision) result.revision = fields.revision;
  return result;
}

/**
 * @param {string} license an SPDX id, an SPDX expression, the old `MIT/Apache-2.0` form or a name
 * @returns {License}
 */
function licenseEntry(license) {
  const normalized = license.replace(/\s*\/\s*/g, " OR ");
  if (/^[A-Za-z0-9.+-]+$/.test(normalized)) return { license: { id: normalized } };
  if (/^[A-Za-z0-9.+() -]+$/.test(normalized) && / (OR|AND|WITH) /.test(normalized)) {
    return { expression: normalized };
  }
  return { license: { name: license } };
}

/**
 * The licence a vendored crate's Cargo.toml declares (cargo vendor writes `license = "…"`).
 * @param {string} engineDir
 * @param {CargoPackage} pkg
 * @returns {string | undefined}
 */
function crateLicense(engineDir, pkg) {
  for (const dir of [`${pkg.name}-${pkg.version}`, pkg.name]) {
    const toml = join(engineDir, "third_party/rust", dir, "Cargo.toml");
    if (!existsSync(toml)) continue;
    const text = readFileSync(toml, "utf8");
    const version = /^version = "([^"]*)"$/m.exec(text)?.[1];
    if (version && version !== pkg.version) continue;
    return /^license = "([^"]*)"$/m.exec(text)?.[1];
  }
  return undefined;
}

/**
 * Every moz.yaml under the engine, skipping objdirs and VCS dirs.
 * @param {string} dir
 * @returns {string[]}
 */
function findMozYaml(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (/^(obj-.*|\.git|\.hg|node_modules)$/.test(entry.name)) continue;
      found.push(...findMozYaml(join(dir, entry.name)));
    } else if (entry.name === "moz.yaml") found.push(join(dir, entry.name));
  }
  return found.sort();
}

/**
 * @param {{ engineDir: string,
 *   config: { version?: { version?: unknown }, brands?: Record<string, { release?: { displayVersion?: unknown } }> },
 *   repo: string, serialNumber?: string, timestamp?: string }} options
 */
export function buildSbom({ engineDir, config, repo, serialNumber, timestamp }) {
  const version = String(config.brands?.vimma?.release?.displayVersion ?? "");
  const firefox = String(config.version?.version ?? "");
  const mpl = [licenseEntry("MPL-2.0")];
  /** @type {Component[]} */
  const components = [
    {
      type: "application",
      "bom-ref": `pkg:generic/mozilla/firefox@${firefox}`,
      group: "mozilla",
      name: "firefox",
      version: firefox,
      purl: `pkg:generic/mozilla/firefox@${firefox}`,
      licenses: mpl,
      externalReferences: [{ type: "website", url: "https://www.mozilla.org/firefox/" }],
    },
  ];
  const lock = join(engineDir, "Cargo.lock");
  for (const pkg of existsSync(lock) ? parseCargoLock(readFileSync(lock, "utf8")) : []) {
    if (!pkg.source) continue; // in-tree crate: part of Firefox
    const purl = `pkg:cargo/${pkg.name}@${pkg.version}`;
    /** @type {Component} */
    const component = {
      type: "library",
      "bom-ref": `${purl}#${pkg.source}`,
      name: pkg.name,
      version: pkg.version,
      purl,
    };
    if (pkg.checksum) component.hashes = [{ alg: "SHA-256", content: pkg.checksum }];
    const license = crateLicense(engineDir, pkg);
    if (license) component.licenses = [licenseEntry(license)];
    if (pkg.source.startsWith("git+")) {
      component.externalReferences = [{ type: "vcs", url: pkg.source.slice(4) }];
    }
    components.push(component);
  }
  for (const file of findMozYaml(engineDir)) {
    const origin = parseMozYaml(readFileSync(file, "utf8"));
    if (!origin) continue;
    const ver = origin.release ?? origin.revision ?? "";
    const purlVersion = origin.revision ?? ver.split(/\s/)[0] ?? "";
    const purl = `pkg:generic/${encodeURIComponent(origin.name)}${purlVersion ? `@${encodeURIComponent(purlVersion)}` : ""}`;
    /** @type {Component} */
    const component = {
      type: "library",
      "bom-ref": `${purl}#${file.slice(engineDir.length + 1)}`,
      name: origin.name,
      purl,
    };
    if (ver) component.version = ver;
    if (origin.licenses.length) component.licenses = origin.licenses.map(licenseEntry);
    if (origin.url) component.externalReferences = [{ type: "website", url: origin.url }];
    components.push(component);
  }
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: serialNumber ?? `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: timestamp ?? new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      tools: { components: [{ type: "application", name: "tools/package/sbom.mjs" }] },
      component: {
        type: "application",
        "bom-ref": `pkg:github/${repo}@v${version}`,
        name: "vimma",
        version,
        purl: `pkg:github/${repo}@v${version}`,
        licenses: mpl,
        externalReferences: [{ type: "vcs", url: `https://github.com/${repo}` }],
      },
      properties: [
        {
          name: "vimma:sbom:scope",
          value:
            "Components vendored in the Firefox source tree (Cargo.lock, moz.yaml): a superset of what the binary links, test-only crates included.",
        },
      ],
    },
    components,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      engine: { type: "string", default: "engine" },
      repo: { type: "string", default: "JRanne/vimma" },
      out: { type: "string" },
    },
  });
  if (!values.out) {
    console.error("usage: sbom.mjs [--engine engine] [--repo owner/name] --out <file>");
    process.exit(2);
  }
  const root = new URL("../../", import.meta.url);
  const bom = buildSbom({
    engineDir: values.engine ?? "engine",
    repo: values.repo ?? "JRanne/vimma",
    config: JSON.parse(readFileSync(new URL("surfer.json", root), "utf8")),
  });
  writeFileSync(values.out, `${JSON.stringify(bom, null, 2)}\n`);
  console.log(`sbom: ${bom.components.length} components -> ${values.out}`);
}
