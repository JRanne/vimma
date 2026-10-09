#!/usr/bin/env node
/**
 * Release packages from a `./mach package` tarball (spec m6-packaging): the release tarball, the
 * AppImage, the .deb, the AUR vimma-bin PKGBUILD + .SRCINFO + vimma.desktop, and SHA256SUMS.
 *
 * Usage:
 *   node tools/package/package.mjs --tarball <vimma-*.linux-x86_64.tar.xz> --out <dir>
 *     --maintainer "Name <email>" [--tag vX.Y.Z] [--repo JRanne/vimma] [--sbom <file>]
 *     [--appimagetool <path> --runtime <path>] [--no-deb]
 * Without --appimagetool no AppImage is built (its AppDir still is, in the work dir).
 * The version is surfer.json brands.vimma.release.displayVersion; --tag must be exactly v<that>.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** SemVer with an optional pre-release, as version-files.mjs accepts (plan §7). */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const APP = "vimma";
const DESCRIPTION =
  "Keyboard-first web browser built on Firefox, with Neovim-style modes and a tmux-style prefix keymap";

/** hicolor sizes we ship, all rendered into configs/branding/vimma/ (spec m0-branding). */
export const ICON_SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512];

/**
 * Mozilla's desktop-file MIME list (python/mozbuild/mozbuild/repackaging/desktop_file.py) without
 * x-scheme-handler/chrome and x-scheme-handler/mailto: a browser grabbing mail links surprises.
 */
const MIME_TYPES = [
  "application/json",
  "application/pdf",
  "application/rdf+xml",
  "application/rss+xml",
  "application/x-xpinstall",
  "application/xhtml+xml",
  "application/xml",
  "audio/flac",
  "audio/ogg",
  "audio/webm",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "text/html",
  "text/xml",
  "video/ogg",
  "video/webm",
  "x-scheme-handler/http",
  "x-scheme-handler/https",
];

const DESKTOP_ACTIONS = [
  ["new-window", "New Window", `${APP} --new-window %u`],
  ["new-private-window", "New Private Window", `${APP} --private-window %u`],
  ["open-profile-manager", "Open the Profile Manager", `${APP} --ProfileManager`],
];

/**
 * Libraries Firefox's binaries link against (t64 names first: Ubuntu 24.04, Debian 13). The
 * package job's smoke install checks the list resolves.
 */
const DEB_DEPENDS = [
  "libc6 (>= 2.31)",
  "libasound2t64 | libasound2",
  "libatk1.0-0t64 | libatk1.0-0",
  "libcairo-gobject2",
  "libcairo2",
  "libdbus-1-3",
  "libfontconfig1",
  "libfreetype6",
  "libgdk-pixbuf-2.0-0",
  "libglib2.0-0t64 | libglib2.0-0",
  "libgtk-3-0t64 | libgtk-3-0",
  "libpango-1.0-0",
  "libpangocairo-1.0-0",
  "libx11-6",
  "libx11-xcb1",
  "libxcb-shm0",
  "libxcb1",
  "libxcomposite1",
  "libxcursor1",
  "libxdamage1",
  "libxext6",
  "libxfixes3",
  "libxi6",
  "libxrandr2",
  "libxrender1",
  "libxtst6",
];

/** @typedef {{ version?: { version?: unknown }, brands?: Record<string, { release?: { displayVersion?: unknown } }> }} SurferConfig */

/**
 * The release version: surfer.json brands.vimma.release.displayVersion (release-please bumps it).
 * @param {SurferConfig} config
 * @param {string} [tag] the release tag; must be exactly `v<version>`
 * @returns {string}
 */
export function releaseVersion(config, tag) {
  const version = config.brands?.vimma?.release?.displayVersion;
  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new Error(
      `surfer.json brands.vimma.release.displayVersion is not SemVer: ${String(version)}`,
    );
  }
  if (tag !== undefined && tag !== `v${version}`) {
    throw new Error(
      `tag ${tag} does not match surfer.json's version ${version} (want v${version})`,
    );
  }
  return version;
}

/** @param {string} version SemVer; a pre-release sorts before its release with `~` in dpkg */
export const debVersion = (version) => version.replace("-", "~");

/** @param {string} version SemVer; pacman's pkgver cannot contain hyphens */
export const pkgver = (version) => version.replaceAll("-", "_");

/** @param {string} version */
export function artifactNames(version) {
  return {
    tarball: `${APP}-${version}-linux-x86_64.tar.xz`,
    appimage: `${APP}-${version}-x86_64.AppImage`,
    deb: `${APP}_${debVersion(version)}_amd64.deb`,
    sbom: `${APP}-${version}.cdx.json`,
    checksums: "SHA256SUMS",
  };
}

/**
 * INI as Firefox writes application.ini: `[Section]`, `Key=Value`, `#` and `;` comments.
 * @param {string} text
 * @returns {Record<string, Record<string, string>>}
 */
export function parseIni(text) {
  /** @type {Record<string, Record<string, string>>} */
  const ini = {};
  /** @type {Record<string, string> | undefined} */
  let section;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header?.[1]) {
      section = ini[header[1]] ??= {};
    } else if (section && line.includes("=")) {
      const at = line.indexOf("=");
      section[line.slice(0, at)] = line.slice(at + 1);
    }
  }
  return ini;
}

/**
 * @param {string} appDir the packaged app dir (the tarball's vimma/)
 * @returns {{ name: string, remotingName: string }}
 */
export function readAppIni(appDir) {
  const app = parseIni(readFileSync(join(appDir, "application.ini"), "utf8")).App ?? {};
  if (!app.Name || !app.RemotingName) {
    throw new Error(`${appDir}/application.ini has no [App] Name or RemotingName`);
  }
  return { name: app.Name, remotingName: app.RemotingName };
}

/**
 * The vimma.desktop file shared by the AppImage, the .deb and the AUR package.
 * @param {{ wmClass: string }} options wmClass: application.ini RemotingName (also Wayland app_id)
 * @returns {string}
 */
export function desktopEntry({ wmClass }) {
  const lines = [
    "[Desktop Entry]",
    "Version=1.5",
    "Type=Application",
    "Name=Vimma",
    "GenericName=Web Browser",
    "Comment=Browse the web from the keyboard",
    `Exec=${APP} %u`,
    `Icon=${APP}`,
    "Terminal=false",
    "StartupNotify=true",
    `StartupWMClass=${wmClass}`,
    "Categories=Network;WebBrowser;",
    `MimeType=${MIME_TYPES.join(";")};`,
    "Keywords=Internet;WWW;Browser;Web;Explorer;vim;",
    `Actions=${DESKTOP_ACTIONS.map(([id]) => id).join(";")};`,
  ];
  for (const [id, name, exec] of DESKTOP_ACTIONS) {
    lines.push("", `[Desktop Action ${id}]`, `Name=${name}`, `Exec=${exec}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Structural checks for when desktop-file-validate is not installed.
 * @param {string} text
 * @returns {string[]} problems, empty when fine
 */
export function checkDesktopEntry(text) {
  const errors = [];
  /** @type {Map<string, Map<string, string>>} */
  const groups = new Map();
  /** @type {Map<string, string> | undefined} */
  let group;
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header?.[1]) {
      if (groups.has(header[1])) errors.push(`duplicate group [${header[1]}]`);
      group = new Map();
      groups.set(header[1], group);
    } else if (!group) {
      errors.push(`line before the first group: ${line}`);
    } else if (!/^[A-Za-z0-9-]+(\[[^\]]+\])?=/.test(line)) {
      errors.push(`not a key=value line: ${line}`);
    } else {
      const at = line.indexOf("=");
      group.set(line.slice(0, at), line.slice(at + 1));
    }
  }
  if ([...groups.keys()][0] !== "Desktop Entry") errors.push("first group is not [Desktop Entry]");
  const entry = groups.get("Desktop Entry") ?? new Map();
  for (const key of ["Type", "Name", "Exec", "Icon"]) {
    if (!entry.get(key)) errors.push(`[Desktop Entry] has no ${key}`);
  }
  for (const key of ["Categories", "MimeType", "Keywords", "Actions"]) {
    const value = entry.get(key);
    if (value !== undefined && !value.endsWith(";")) errors.push(`${key} does not end with ;`);
  }
  for (const action of (entry.get("Actions") ?? "").split(";").filter(Boolean)) {
    const actionGroup = groups.get(`Desktop Action ${action}`);
    if (!actionGroup) errors.push(`action ${action} has no [Desktop Action ${action}] group`);
    else if (!actionGroup.get("Name")) errors.push(`action ${action} has no Name`);
  }
  return errors;
}

/** The AppImage entry point. */
export function appRun() {
  return [
    "#!/bin/sh",
    "# Vimma AppImage entry point (spec m6-packaging).",
    'HERE="$(dirname "$(readlink -f "$0")")"',
    "# The image is mounted at a new path on every start; Firefox keys dedicated profiles by",
    "# install path, so without this every launch would open a fresh profile.",
    "export MOZ_LEGACY_PROFILES=1",
    '# "Make default browser" and remoting record the .AppImage, not the temporary mount.',
    'export MOZ_APP_LAUNCHER="$APPIMAGE"',
    `exec "$HERE/usr/lib/${APP}/${APP}" "$@"`,
    "",
  ].join("\n");
}

/** @param {string} maintainer */
function checkMaintainer(maintainer) {
  if (!/^[^<>\n]+ <[^<>\s]+@[^<>\s]+>$/.test(maintainer)) {
    throw new Error(`maintainer must be "Name <email>", got: ${JSON.stringify(maintainer)}`);
  }
}

/**
 * @param {{ version: string, maintainer: string, installedKiB: number }} options
 * @returns {string} DEBIAN/control
 */
export function debControl({ version, maintainer, installedKiB }) {
  checkMaintainer(maintainer);
  return [
    `Package: ${APP}`,
    `Version: ${debVersion(version)}`,
    "Architecture: amd64",
    `Maintainer: ${maintainer}`,
    `Installed-Size: ${installedKiB}`,
    `Depends: ${DEB_DEPENDS.join(", ")}`,
    "Recommends: libpulse0",
    "Provides: gnome-www-browser, www-browser",
    "Section: web",
    "Priority: optional",
    "Homepage: https://github.com/JRanne/vimma",
    `Description: ${DESCRIPTION}`,
    " Vimma is a Firefox fork driven from the keyboard: a modal page layer, a",
    " prefix keymap, workspaces as containers and an always-visible status bar.",
    "",
  ].join("\n");
}

const POSTINST = `#!/bin/sh
set -e
# Priority 40, below Firefox's 100: Vimma never becomes the default browser by itself.
if [ "$1" = "configure" ] || [ "$1" = "abort-upgrade" ] || [ "$1" = "abort-remove" ]; then
  update-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/bin/${APP} 40
  update-alternatives --install /usr/bin/gnome-www-browser gnome-www-browser /usr/bin/${APP} 40
fi
`;

const PRERM = `#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "deconfigure" ]; then
  update-alternatives --remove x-www-browser /usr/bin/${APP}
  update-alternatives --remove gnome-www-browser /usr/bin/${APP}
fi
`;

const COPYRIGHT = `Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: Vimma
Source: https://github.com/JRanne/vimma

Files: *
Copyright: Vimma contributors; Mozilla Foundation and contributors (Firefox)
License: MPL-2.0
 Third-party components and their licences are listed in about:license and in
 the release's CycloneDX SBOM (vimma-<version>.cdx.json).

License: MPL-2.0
 This Source Code Form is subject to the terms of the Mozilla Public License,
 v. 2.0. If a copy of the MPL was not distributed with this file, You can
 obtain one at https://mozilla.org/MPL/2.0/.
`;

/**
 * @typedef {{ version: string, maintainer: string, repo: string, tarballSha256: string,
 *   desktopSha256: string }} AurInput
 */

const AUR_DEPENDS = [
  "alsa-lib",
  "dbus",
  "gtk3",
  "hicolor-icon-theme",
  "libxt",
  "mime-types",
  "ttf-font",
];
const AUR_OPTDEPENDS = [
  "ffmpeg: H.264, AAC and MP3 playback",
  "libpulse: PulseAudio audio (also via pipewire-pulse)",
  "networkmanager: location detection via available Wi-Fi networks",
];

/** @param {AurInput} input */
function aurSource(input) {
  const v = pkgver(input.version);
  const url = `https://github.com/${input.repo}/releases/download/v${v}/${APP}-${v}-linux-x86_64.tar.xz`;
  return { file: `${APP}-${v}-linux-x86_64.tar.xz`, url };
}

/**
 * The AUR vimma-bin PKGBUILD, installing the release tarball to /opt/vimma.
 * @param {AurInput} input
 * @returns {string}
 */
export function pkgbuild(input) {
  checkMaintainer(input.maintainer);
  /** @param {string[]} items */
  const list = (items) => items.map((s) => `'${s}'`).join(" ");
  return `# Maintainer: ${input.maintainer}
# Generated by tools/package/package.mjs in ${input.repo} (spec m6-packaging); edit it there.
pkgname=${APP}-bin
pkgver=${pkgver(input.version)}
pkgrel=1
pkgdesc="${DESCRIPTION}"
arch=('x86_64')
url="https://github.com/${input.repo}"
license=('MPL-2.0')
depends=(${list(AUR_DEPENDS)})
optdepends=(${AUR_OPTDEPENDS.map((s) => `'${s}'`).join("\n            ")})
provides=('${APP}')
conflicts=('${APP}')
options=('!strip' '!debug')
source=("${APP}-\${pkgver}-linux-x86_64.tar.xz::https://github.com/${input.repo}/releases/download/v\${pkgver}/${APP}-\${pkgver}-linux-x86_64.tar.xz"
        '${APP}.desktop')
sha256sums=('${input.tarballSha256}'
            '${input.desktopSha256}')

package() {
  install -d "$pkgdir/opt" "$pkgdir/usr/bin"
  cp -a "$srcdir/${APP}" "$pkgdir/opt/${APP}"
  ln -s /opt/${APP}/${APP} "$pkgdir/usr/bin/${APP}"
  install -Dm644 "$srcdir/${APP}.desktop" "$pkgdir/usr/share/applications/${APP}.desktop"
  local size
  for size in 16 32 48 64 128; do
    install -Dm644 "$srcdir/${APP}/browser/chrome/icons/default/default\${size}.png" \\
      "$pkgdir/usr/share/icons/hicolor/\${size}x\${size}/apps/${APP}.png"
  done
}
`;
}

/**
 * .SRCINFO for the PKGBUILD above, in makepkg --printsrcinfo's order and format.
 * @param {AurInput} input
 * @returns {string}
 */
export function srcinfo(input) {
  const { file, url } = aurSource(input);
  const fields = [
    ["pkgdesc", DESCRIPTION],
    ["pkgver", pkgver(input.version)],
    ["pkgrel", "1"],
    ["url", `https://github.com/${input.repo}`],
    ["arch", "x86_64"],
    ["license", "MPL-2.0"],
    ...AUR_DEPENDS.map((d) => ["depends", d]),
    ...AUR_OPTDEPENDS.map((d) => ["optdepends", d]),
    ["provides", APP],
    ["conflicts", APP],
    ["options", "!strip"],
    ["options", "!debug"],
    ["source", `${file}::${url}`],
    ["source", `${APP}.desktop`],
    ["sha256sums", input.tarballSha256],
    ["sha256sums", input.desktopSha256],
  ];
  const body = fields.map(([key, value]) => `\t${key} = ${value}`).join("\n");
  return `pkgbase = ${APP}-bin\n${body}\n\npkgname = ${APP}-bin\n`;
}

/** @param {string} path */
export const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * @param {string[]} files
 * @returns {string} `sha256sum` output for the files, by base name, sorted
 */
export function sha256sums(files) {
  return files
    .map((file) => `${sha256File(file)}  ${basename(file)}\n`)
    .sort((a, b) => (a.slice(66) < b.slice(66) ? -1 : 1))
    .join("");
}

/**
 * @param {string} path
 * @param {string} content
 * @param {number} mode
 */
function writeFile(path, content, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  writeFileSync(path, content);
  chmodSync(path, mode);
}

/**
 * @param {string} from
 * @param {string} to
 */
function installFile(from, to) {
  mkdirSync(dirname(to), { recursive: true, mode: 0o755 });
  copyFileSync(from, to);
  chmodSync(to, 0o644);
}

/**
 * `cp -a` keeps modes and symlinks of the packaged app exactly as mach made them.
 * @param {string} appDir
 * @param {string} to
 */
function copyApp(appDir, to) {
  mkdirSync(dirname(to), { recursive: true, mode: 0o755 });
  execFileSync("cp", ["-a", appDir, to]);
}

/**
 * hicolor icons and the desktop file under <root>/usr/share.
 * @param {string} root
 * @param {string} brandDir
 * @param {string} desktop
 */
function installShare(root, brandDir, desktop) {
  writeFile(join(root, `usr/share/applications/${APP}.desktop`), desktop);
  for (const size of ICON_SIZES) {
    installFile(
      join(brandDir, `logo${size}.png`),
      join(root, `usr/share/icons/hicolor/${size}x${size}/apps/${APP}.png`),
    );
  }
  installFile(
    join(brandDir, "logo.svg"),
    join(root, `usr/share/icons/hicolor/scalable/apps/${APP}.svg`),
  );
}

/**
 * Installed-Size in KiB, as dpkg-gencontrol counts it: each file rounded up, symlinks as 1.
 * @param {string} dir
 * @returns {number}
 */
function installedKiB(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += installedKiB(path);
    else if (entry.isSymbolicLink()) total += 1;
    else total += Math.ceil(lstatSync(path).size / 1024);
  }
  return total;
}

/**
 * @typedef {{
 *   tarball: string, outDir: string, config: SurferConfig, maintainer: string, repo: string,
 *   brandDir: string, tag?: string, sbom?: string, appimagetool?: string, runtime?: string,
 *   buildDeb?: boolean, workDir?: string,
 * }} PackageOptions
 */

/**
 * Every release file from one `./mach package` tarball; see the file comment.
 * @param {PackageOptions} options
 * @returns {{ version: string, files: string[], appDir: string, debRoot: string, aurDir: string }}
 */
export function packageRelease(options) {
  const version = releaseVersion(options.config, options.tag);
  checkMaintainer(options.maintainer);
  const names = artifactNames(version);
  const work = options.workDir ?? mkdtempSync(join(tmpdir(), "vimma-package-"));
  const out = options.outDir;
  mkdirSync(out, { recursive: true });

  const extract = join(work, "extract");
  rmSync(extract, { recursive: true, force: true });
  mkdirSync(extract, { recursive: true });
  execFileSync("tar", ["-xJf", options.tarball, "-C", extract]);
  const app = join(extract, APP);
  if (!existsSync(join(app, APP))) {
    throw new Error(`${options.tarball} has no ${APP}/${APP}: not a ./mach package tarball?`);
  }
  const ini = readAppIni(app);
  if (ini.name !== "Vimma") {
    throw new Error(`${options.tarball}: application.ini has Name=${ini.name}, want Vimma`);
  }
  const desktop = desktopEntry({ wmClass: ini.remotingName });
  const problems = checkDesktopEntry(desktop);
  if (problems.length) throw new Error(`desktop file: ${problems.join("; ")}`);

  /** @type {string[]} */
  const files = [];
  const tarball = join(out, names.tarball);
  copyFileSync(options.tarball, tarball);
  chmodSync(tarball, 0o644);
  files.push(tarball);

  // AppImage
  const appDir = join(work, "AppDir");
  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(appDir, { recursive: true, mode: 0o755 });
  copyApp(app, join(appDir, `usr/lib/${APP}`));
  installShare(appDir, options.brandDir, desktop);
  writeFile(join(appDir, "AppRun"), appRun(), 0o755);
  writeFile(join(appDir, `${APP}.desktop`), desktop);
  installFile(join(options.brandDir, "logo256.png"), join(appDir, `${APP}.png`));
  if (options.appimagetool) {
    if (!options.runtime) throw new Error("--appimagetool needs --runtime (the pinned runtime)");
    const appimage = join(out, names.appimage);
    execFileSync(
      options.appimagetool,
      ["--no-appstream", "--runtime-file", options.runtime, appDir, appimage],
      { env: { ...process.env, ARCH: "x86_64", APPIMAGE_EXTRACT_AND_RUN: "1" }, stdio: "inherit" },
    );
    chmodSync(appimage, 0o755);
    files.push(appimage);
  }

  // .deb
  const debRoot = join(work, "deb");
  rmSync(debRoot, { recursive: true, force: true });
  mkdirSync(debRoot, { recursive: true, mode: 0o755 });
  copyApp(app, join(debRoot, `usr/lib/${APP}`));
  installShare(debRoot, options.brandDir, desktop);
  mkdirSync(join(debRoot, "usr/bin"), { recursive: true, mode: 0o755 });
  symlinkSync(`../lib/${APP}/${APP}`, join(debRoot, `usr/bin/${APP}`));
  writeFile(join(debRoot, `usr/share/doc/${APP}/copyright`), COPYRIGHT);
  const size = installedKiB(debRoot);
  mkdirSync(join(debRoot, "DEBIAN"), { mode: 0o755 });
  chmodSync(join(debRoot, "DEBIAN"), 0o755);
  writeFile(
    join(debRoot, "DEBIAN/control"),
    debControl({ version, maintainer: options.maintainer, installedKiB: size }),
  );
  writeFile(join(debRoot, "DEBIAN/postinst"), POSTINST, 0o755);
  writeFile(join(debRoot, "DEBIAN/prerm"), PRERM, 0o755);
  if (options.buildDeb !== false) {
    const deb = join(out, names.deb);
    execFileSync("dpkg-deb", ["--root-owner-group", "-Zxz", "--build", debRoot, deb], {
      stdio: "inherit",
    });
    files.push(deb);
  }

  if (options.sbom) {
    const sbom = join(out, names.sbom);
    if (options.sbom !== sbom) copyFileSync(options.sbom, sbom);
    files.push(sbom);
  }

  // AUR: not a release asset; release.yml pushes it to aur.archlinux.org/vimma-bin.git.
  const aurDir = join(out, "aur");
  rmSync(aurDir, { recursive: true, force: true });
  writeFile(join(aurDir, `${APP}.desktop`), desktop);
  const aur = {
    version,
    maintainer: options.maintainer,
    repo: options.repo,
    tarballSha256: sha256File(tarball),
    desktopSha256: sha256File(join(aurDir, `${APP}.desktop`)),
  };
  writeFile(join(aurDir, "PKGBUILD"), pkgbuild(aur));
  writeFile(join(aurDir, ".SRCINFO"), srcinfo(aur));

  writeFile(join(out, names.checksums), sha256sums(files));
  return { version, files: [...files, join(out, names.checksums)], appDir, debRoot, aurDir };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      tarball: { type: "string" },
      out: { type: "string" },
      maintainer: { type: "string" },
      tag: { type: "string" },
      repo: { type: "string", default: "JRanne/vimma" },
      sbom: { type: "string" },
      appimagetool: { type: "string" },
      runtime: { type: "string" },
      "no-deb": { type: "boolean", default: false },
    },
  });
  if (!values.tarball || !values.out || !values.maintainer) {
    console.error("usage: package.mjs --tarball <file> --out <dir> --maintainer 'Name <email>' …");
    process.exit(2);
  }
  const root = new URL("../../", import.meta.url);
  const result = packageRelease({
    tarball: values.tarball,
    outDir: values.out,
    maintainer: values.maintainer,
    tag: values.tag,
    repo: values.repo ?? "JRanne/vimma",
    sbom: values.sbom,
    appimagetool: values.appimagetool,
    runtime: values.runtime,
    buildDeb: !values["no-deb"],
    config: JSON.parse(readFileSync(new URL("surfer.json", root), "utf8")),
    brandDir: fileURLToPath(new URL("configs/branding/vimma/", root)),
  });
  console.log(`package: Vimma ${result.version}`);
  for (const file of result.files) console.log(`  ${file}`);
  console.log(`  ${result.aurDir}/ (PKGBUILD, .SRCINFO, ${APP}.desktop)`);
}
