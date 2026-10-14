import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appRun,
  artifactNames,
  checkDesktopEntry,
  debControl,
  debVersion,
  desktopEntry,
  ICON_SIZES,
  LAUNCHER,
  packageRelease,
  parseIni,
  pkgbuild,
  IDENTITY_REGEXP,
  RUNTIME_RELEASE,
  thirdPartyNotes,
  readAppIni,
  releaseVersion,
  sha256sums,
  srcinfo,
} from "../package.mjs";
import { tempDir } from "../../test/temp-dir.mjs";

const BRAND_DIR = fileURLToPath(new URL("../../../configs/branding/vimma/", import.meta.url));
const MAINTAINER = "Test Maintainer <test@example.invalid>";
const REPO = "JRanne/vimma";

/** @param {string} cmd */
const has = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
/** @param {string} path */
const mode = (path) => statSync(path).mode & 0o777;
/** @param {string | Buffer} data */
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
/**
 * Asserts two files are byte-identical by digest. toEqual on Buffers deep-compares byte by byte:
 * on the ~560 KB of icons below that took seconds under a loaded coverage run (#200).
 * @param {string} actual
 * @param {string} expected
 */
const expectSameBytes = (actual, expected) =>
  expect(sha256(readFileSync(actual)), `${actual} = ${expected}`).toBe(
    sha256(readFileSync(expected)),
  );

/**
 * @param {string | undefined} display
 * @param {string} [firefox]
 */
const surfer = (display, firefox = "157.0.1") => ({
  version: { product: "firefox", version: firefox },
  brands: { vimma: { release: { displayVersion: display } } },
});

const APP_INI = `#filter substitution
[App]
Vendor=Vimma
Name=Vimma
RemotingName=vimma-vimma
Version=157.0.1
BuildID=20261009000000
ID={ec8030f7-c20a-464f-9b0e-13a3a9e97384}

[Gecko]
MinVersion=157.0.1
MaxVersion=157.0.1
`;

/**
 * A fake `./mach package` tarball: one top-level vimma/ dir, as the real one.
 * @param {{ name?: string, omit?: string }} [options]
 * @param {string} [dir] where to build it (default: a temp dir removed after the test)
 * @returns {string} the tarball's path
 */
function fakeMachTarball({ name = "Vimma", omit } = {}, dir = tempDir("vimma-fake-dist-")) {
  const app = join(dir, "vimma");
  mkdirSync(join(app, "browser/chrome/icons/default"), { recursive: true });
  /** @type {Record<string, [string, number]>} */
  const files = {
    vimma: ['#!/bin/sh\necho "Vimma Vimma 0.1.0"\n', 0o755],
    "vimma-bin": ['#!/bin/sh\necho "Vimma Vimma 0.1.0"\n', 0o755],
    "application.ini": [APP_INI.replace("Name=Vimma", `Name=${name}`), 0o644],
    "libxul.so": ["not really an ELF\n", 0o755],
    "omni.ja": ["zip\n", 0o644],
  };
  for (const size of [16, 32, 48, 64, 128]) {
    files[`browser/chrome/icons/default/default${size}.png`] = [`png ${size}\n`, 0o644];
  }
  for (const [path, [content, perm]] of Object.entries(files)) {
    if (path === omit) continue;
    writeFileSync(join(app, path), content);
    chmodSync(join(app, path), perm);
  }
  const tarball = join(dir, "vimma-157.0.1.en-US.linux-x86_64.tar.xz");
  execFileSync("tar", ["-cJf", tarball, "-C", dir, "vimma"]);
  return tarball;
}

/**
 * An appimagetool stand-in: records its arguments and ARCH, writes the output file.
 * @param {string} [dir] where to put it (default: a temp dir removed after the test)
 * @returns {{ tool: string, log: string }}
 */
function fakeAppimagetool(dir = tempDir("vimma-fake-tool-")) {
  const tool = join(dir, "appimagetool");
  const log = join(dir, "args.log");
  writeFileSync(
    tool,
    `#!/bin/sh\necho "ARCH=$ARCH" > "${log}"\nfor a in "$@"; do echo "$a" >> "${log}"; done\n` +
      `for a in "$@"; do last="$a"; done\nprintf 'fake appimage' > "$last"\nchmod 755 "$last"\n`,
  );
  chmodSync(tool, 0o755);
  return { tool, log };
}

describe("version and names", () => {
  it("takes the release version from surfer.json's displayVersion", () => {
    expect(releaseVersion(surfer("0.3.1"))).toBe("0.3.1");
  });

  it("accepts the matching tag and refuses any other", () => {
    expect(releaseVersion(surfer("0.3.1"), "v0.3.1")).toBe("0.3.1");
    expect(() => releaseVersion(surfer("0.3.1"), "v0.3.2")).toThrow(/tag v0\.3\.2.*0\.3\.1/);
    expect(() => releaseVersion(surfer("0.3.1"), "0.3.1")).toThrow(/tag/);
  });

  it.each([[undefined], ["0.1"], ["v0.1.0"], ["0.1.0\n"]])("refuses version %j", (v) => {
    expect(() => releaseVersion(surfer(v))).toThrow(/displayVersion/);
  });

  it("maps a pre-release for dpkg (~ sorts first)", () => {
    expect(debVersion("0.2.0")).toBe("0.2.0");
    expect(debVersion("0.2.0-rc.1")).toBe("0.2.0~rc.1");
  });

  it("names every artifact after the Vimma version, not Firefox's", () => {
    expect(artifactNames("0.1.0")).toEqual({
      tarball: "vimma-0.1.0-linux-x86_64.tar.xz",
      appimage: "vimma-0.1.0-x86_64.AppImage",
      deb: "vimma_0.1.0_amd64.deb",
      sbom: "vimma-0.1.0.cdx.json",
      checksums: "SHA256SUMS",
    });
  });
});

describe("application.ini", () => {
  it("parses sections and keys, skipping comments and preprocessor lines", () => {
    const ini = parseIni(APP_INI);
    expect(ini.App?.RemotingName).toBe("vimma-vimma");
    expect(ini.Gecko?.MaxVersion).toBe("157.0.1");
  });

  it("reads Name and RemotingName from an app dir", () => {
    const dir = tempDir("vimma-ini-");
    writeFileSync(join(dir, "application.ini"), APP_INI);
    expect(readAppIni(dir)).toEqual({ name: "Vimma", remotingName: "vimma-vimma" });
  });
});

describe("desktop entry", () => {
  const text = desktopEntry({ wmClass: "vimma-vimma" });

  it("launches vimma with a URL, with our icon and the remoting name as WM class", () => {
    expect(text.startsWith("[Desktop Entry]\n")).toBe(true);
    expect(text).toMatch(/^Type=Application$/m);
    expect(text).toMatch(/^Name=Vimma$/m);
    // vimma-open names the app that opened a link (spec workspace-routing).
    expect(text).toMatch(/^Exec=vimma-open %u$/m);
    expect(text).toMatch(/^Icon=vimma$/m);
    expect(text).toMatch(/^StartupWMClass=vimma-vimma$/m);
    expect(text).toMatch(/^Categories=Network;WebBrowser;$/m);
  });

  it("handles web pages and http(s) links, but not mail links", () => {
    const mime = /^MimeType=(.*)$/m.exec(text)?.[1]?.split(";") ?? [];
    for (const type of [
      "text/html",
      "application/xhtml+xml",
      "x-scheme-handler/http",
      "x-scheme-handler/https",
    ]) {
      expect(mime).toContain(type);
    }
    expect(mime).not.toContain("x-scheme-handler/mailto");
    expect(mime).not.toContain("x-scheme-handler/chrome");
  });

  it("passes the structural checks", () => {
    expect(checkDesktopEntry(text)).toEqual([]);
  });

  it("flags a missing key, an unterminated list and an action without a group", () => {
    const broken = text
      .replace(/^Exec=vimma-open %u\n/m, "")
      .replace("Categories=Network;WebBrowser;", "Categories=Network;WebBrowser")
      .replace(/\[Desktop Action new-window\][^[]*/, "");
    const errors = checkDesktopEntry(broken).join("\n");
    expect(errors).toMatch(/Exec/);
    expect(errors).toMatch(/Categories/);
    expect(errors).toMatch(/new-window/);
  });

  it.skipIf(!has("desktop-file-validate"))("passes desktop-file-validate", () => {
    const dir = tempDir("vimma-desktop-");
    writeFileSync(join(dir, "vimma-vimma.desktop"), text);
    const result = spawnSync("desktop-file-validate", [join(dir, "vimma-vimma.desktop")], {
      encoding: "utf8",
    });
    expect(result.stdout + result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

describe("AppRun", () => {
  const script = appRun();
  it("keeps one profile across launches and records the AppImage path", () => {
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toMatch(/^export MOZ_LEGACY_PROFILES=1$/m);
    expect(script).toMatch(/MOZ_APP_LAUNCHER="\$APPIMAGE"/);
  });
  it("leaves MOZ_APP_LAUNCHER alone when not started by the AppImage runtime", () => {
    const dir = tempDir("vimma-apprun-");
    mkdirSync(join(dir, "usr/lib/vimma"), { recursive: true });
    writeFileSync(join(dir, "AppRun"), script);
    copyFileSync(LAUNCHER, join(dir, "usr/lib/vimma/vimma-open"));
    chmodSync(join(dir, "usr/lib/vimma/vimma-open"), 0o755);
    writeFileSync(
      join(dir, "usr/lib/vimma/vimma"),
      '#!/bin/sh\necho "launcher=${MOZ_APP_LAUNCHER-unset} legacy=$MOZ_LEGACY_PROFILES"\n',
    );
    chmodSync(join(dir, "AppRun"), 0o755);
    chmodSync(join(dir, "usr/lib/vimma/vimma"), 0o755);
    const env = { PATH: process.env.PATH ?? "" };
    expect(execFileSync(join(dir, "AppRun"), { env, encoding: "utf8" })).toBe(
      "launcher=unset legacy=1\n",
    );
    expect(
      execFileSync(join(dir, "AppRun"), {
        env: { ...env, APPIMAGE: "/x/v.AppImage" },
        encoding: "utf8",
      }),
    ).toBe("launcher=/x/v.AppImage legacy=1\n");
    expect(script).toMatch(/exec "\$HERE\/usr\/lib\/vimma\/vimma-open" "\$1"/);
    expect(script).toMatch(/exec "\$HERE\/usr\/lib\/vimma\/vimma" "\$@"/);
  });
  it("is valid sh", () => {
    expect(spawnSync("sh", ["-n"], { input: script }).status).toBe(0);
  });
  it("sends one link through vimma-open, and flags (desktop actions) straight to vimma", () => {
    const dir = tempDir("vimma-apprun-");
    mkdirSync(join(dir, "usr/lib/vimma"), { recursive: true });
    writeFileSync(join(dir, "AppRun"), script, { mode: 0o755 });
    copyFileSync(LAUNCHER, join(dir, "usr/lib/vimma/vimma-open"));
    chmodSync(join(dir, "usr/lib/vimma/vimma-open"), 0o755);
    writeFileSync(join(dir, "usr/lib/vimma/vimma"), '#!/bin/sh\necho "$@"\n', { mode: 0o755 });
    const env = { PATH: process.env.PATH ?? "", VIMMA_OPEN_PPID: "1" };
    const run = (/** @type {string[]} */ args) =>
      execFileSync(join(dir, "AppRun"), args, { env, encoding: "utf8" });
    expect(run(["--private-window"])).toBe("--private-window\n");
    expect(run(["--new-window"])).toBe("--new-window\n");
    expect(run(["https://example.com/"])).toBe("https://example.com/\n");
    expect(run([])).toBe("\n");
  });
});

describe("Debian control", () => {
  const control = debControl({ version: "0.2.0-rc.1", maintainer: MAINTAINER, installedKiB: 1234 });
  /** @param {string} key */
  const field = (key) => new RegExp(`^${key}: (.*)$`, "m").exec(control)?.[1];

  it("has the binary-package fields dpkg needs", () => {
    expect(field("Package")).toBe("vimma");
    expect(field("Version")).toBe("0.2.0~rc.1");
    expect(field("Architecture")).toBe("amd64");
    expect(field("Maintainer")).toBe(MAINTAINER);
    expect(field("Installed-Size")).toBe("1234");
    expect(field("Section")).toBe("web");
    expect(field("Depends")).toMatch(/libgtk-3-0t64 \| libgtk-3-0/);
    expect(field("Provides")).toBe("gnome-www-browser, www-browser");
    expect(field("Description")).toMatch(/\S/);
    expect(control.endsWith("\n")).toBe(true);
  });

  it("refuses a maintainer without an email", () => {
    expect(() => debControl({ version: "0.1.0", maintainer: "Nobody", installedKiB: 1 })).toThrow(
      /maintainer/i,
    );
  });
});

describe("PKGBUILD and .SRCINFO", () => {
  const input = {
    version: "0.1.0",
    maintainer: MAINTAINER,
    repo: REPO,
    tarballSha256: "a".repeat(64),
    desktopSha256: "b".repeat(64),
    desktopId: "vimma-vimma",
    launcherSha256: "c".repeat(64),
  };
  const build = pkgbuild(input);
  const info = srcinfo(input);

  it("points at the release tarball with its SHA-256 filled in", () => {
    expect(build).toMatch(/^# Maintainer: Test Maintainer <test@example\.invalid>$/m);
    expect(build).toMatch(/^pkgname=vimma-bin$/m);
    expect(build).toMatch(/^pkgver=0\.1\.0$/m);
    expect(build).toMatch(/^pkgrel=1$/m);
    expect(build).toMatch(/^license=\('MPL-2\.0'\)$/m);
    expect(build).toContain(
      "https://github.com/JRanne/vimma/releases/download/v${pkgver}/vimma-${pkgver}-linux-x86_64.tar.xz",
    );
    expect(build).toContain(
      `sha256sums=('${"a".repeat(64)}'\n            '${"b".repeat(64)}'\n            '${"c".repeat(64)}')`,
    );
  });

  it("is valid bash", () => {
    expect(spawnSync("bash", ["-n"], { input: build }).status).toBe(0);
  });

  it("installs the desktop file under the remoting name", () => {
    expect(build).toContain("'vimma-vimma.desktop'");
    expect(build).toContain('"$pkgdir/usr/share/applications/vimma-vimma.desktop"');
    expect(info).toContain("\tsource = vimma-vimma.desktop\n");
  });

  it("installs vimma-open next to vimma and on PATH", () => {
    expect(build).toContain('install -Dm755 "$srcdir/vimma-open" "$pkgdir/opt/vimma/vimma-open"');
    expect(build).toContain('ln -s /opt/vimma/vimma-open "$pkgdir/usr/bin/vimma-open"');
    expect(info).toContain("\tsource = vimma-open\n");
  });

  it("refuses a pre-release: the AUR gets releases only", () => {
    expect(() => pkgbuild({ ...input, version: "0.2.0-rc.1" })).toThrow(/pre-release/);
    expect(() => srcinfo({ ...input, version: "0.2.0-rc.1" })).toThrow(/pre-release/);
  });

  it("has .SRCINFO fields matching the PKGBUILD", () => {
    expect(info).toMatch(/^pkgbase = vimma-bin$/m);
    expect(info).toMatch(/^\tpkgver = 0\.1\.0$/m);
    expect(info).toMatch(/^\tpkgrel = 1$/m);
    expect(info).toMatch(/^\tlicense = MPL-2\.0$/m);
    expect(info).toContain(
      "\tsource = vimma-0.1.0-linux-x86_64.tar.xz::https://github.com/JRanne/vimma/releases/download/v0.1.0/vimma-0.1.0-linux-x86_64.tar.xz\n",
    );
    expect(info).toContain(
      `\tsha256sums = ${"a".repeat(64)}\n\tsha256sums = ${"b".repeat(64)}\n\tsha256sums = ${"c".repeat(64)}\n`,
    );
    expect(info).toMatch(/\npkgname = vimma-bin\n$/);
  });

  it.skipIf(!has("makepkg"))("equals makepkg --printsrcinfo", () => {
    const dir = tempDir("vimma-pkgbuild-");
    writeFileSync(join(dir, "PKGBUILD"), build);
    const printed = execFileSync("makepkg", ["--printsrcinfo"], { cwd: dir, encoding: "utf8" });
    expect(info).toBe(printed);
  });
});

describe("SHA256SUMS", () => {
  it("lists each file by name, sorted, in sha256sum format", () => {
    const dir = tempDir("vimma-sums-");
    writeFileSync(join(dir, "b.bin"), "bee");
    writeFileSync(join(dir, "a.bin"), "ay");
    const text = sha256sums([join(dir, "b.bin"), join(dir, "a.bin")]);
    expect(text).toBe(`${sha256("ay")}  a.bin\n${sha256("bee")}  b.bin\n`);
  });
});

describe("packageRelease on a fake ./mach package tarball", () => {
  /** @type {ReturnType<typeof packageRelease>} */
  let result;
  /** @type {string} */
  let tarball;
  /** @type {{ tool: string, log: string }} */
  let tool;
  /** @type {string} */
  let out;
  const deb = has("dpkg-deb");

  beforeAll(() => {
    // tempDir() is per test; these outlive one, so they go when the describe ends.
    const dirs = ["vimma-tarball-", "vimma-tool-", "vimma-out-", "vimma-rt-", "vimma-work-"].map(
      (prefix) => mkdtempSync(join(tmpdir(), prefix)),
    );
    const [tarDir, toolDir, outDir, rtDir, work] = /** @type {string[]} */ (dirs);
    tarball = fakeMachTarball({}, tarDir);
    tool = fakeAppimagetool(toolDir);
    out = outDir;
    const runtime = join(rtDir, "runtime-x86_64");
    writeFileSync(runtime, "runtime");
    result = packageRelease({
      workDir: work,
      tarball,
      outDir: out,
      config: surfer("0.1.0"),
      tag: "v0.1.0",
      maintainer: MAINTAINER,
      repo: REPO,
      brandDir: BRAND_DIR,
      appimagetool: tool.tool,
      runtime,
      buildDeb: deb,
    });
    return () => {
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    };
  });

  it("copies the mach tarball unchanged under the release name", () => {
    const copy = join(out, "vimma-0.1.0-linux-x86_64.tar.xz");
    expect(sha256(readFileSync(copy))).toBe(sha256(readFileSync(tarball)));
  });

  it("lays out the AppDir with AppRun, desktop file, icon and the app", () => {
    const app = result.appDir;
    expect(mode(join(app, "AppRun"))).toBe(0o755);
    expect(readFileSync(join(app, "AppRun"), "utf8")).toBe(appRun());
    expect(existsSync(join(app, "vimma.desktop"))).toBe(false);
    expect(readFileSync(join(app, "vimma-vimma.desktop"), "utf8")).toMatch(
      /^StartupWMClass=vimma-vimma$/m,
    );
    expectSameBytes(join(app, "vimma.png"), join(BRAND_DIR, "logo256.png"));
    expect(mode(join(app, "usr/lib/vimma/vimma"))).toBe(0o755);
    expect(mode(join(app, "usr/lib/vimma/vimma-open"))).toBe(0o755);
    expectSameBytes(join(app, "usr/lib/vimma/vimma-open"), LAUNCHER);
    expect(mode(join(app, "usr/lib/vimma/libxul.so"))).toBe(0o755);
    expect(mode(join(app, "usr/lib/vimma/omni.ja"))).toBe(0o644);
    expect(existsSync(join(app, "usr/share/applications/vimma-vimma.desktop"))).toBe(true);
    for (const size of ICON_SIZES) {
      const icon = join(app, `usr/share/icons/hicolor/${size}x${size}/apps/vimma.png`);
      expectSameBytes(icon, join(BRAND_DIR, `logo${size}.png`));
      expect(mode(icon)).toBe(0o644);
    }
    expect(existsSync(join(app, "usr/share/icons/hicolor/scalable/apps/vimma.svg"))).toBe(true);
  });

  it("ships the LGPL-2.1 text and a notice for the statically linked runtime", () => {
    const doc = join(result.appDir, "usr/share/doc/vimma");
    const lgpl = readFileSync(join(doc, "LGPL-2.1.txt"), "utf8");
    expect(lgpl).toMatch(/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1, February 1999/);
    expect(mode(join(doc, "LGPL-2.1.txt"))).toBe(0o644);
    const notice = readFileSync(join(doc, "APPIMAGE-RUNTIME-NOTICE.txt"), "utf8");
    expect(notice).toContain(`type2-runtime ${RUNTIME_RELEASE}`);
    expect(notice).toContain(`https://github.com/AppImage/type2-runtime/tree/${RUNTIME_RELEASE}`);
    expect(notice).toMatch(/libfuse 3\.15\.0/);
    expect(notice).toMatch(/LGPL-2\.1/);
    expect(notice).toMatch(/--appimage-extract/);
    expect(notice).toMatch(/replace/i);
  });

  it("writes third-party release notes naming the runtime and its source", () => {
    const notes = readFileSync(join(out, "notes/third-party.md"), "utf8");
    expect(notes).toBe(thirdPartyNotes());
    expect(notes).toContain(RUNTIME_RELEASE);
    expect(notes).toMatch(/LGPL-2\.1/);
  });

  it("runs appimagetool with the pinned runtime, no AppStream and ARCH=x86_64", () => {
    const args = readFileSync(tool.log, "utf8").trim().split("\n");
    expect(args[0]).toBe("ARCH=x86_64");
    expect(args).toContain("--no-appstream");
    expect(args[args.indexOf("--runtime-file") + 1]).toMatch(/runtime-x86_64$/);
    expect(args.at(-2)).toBe(result.appDir);
    expect(args.at(-1)).toBe(join(out, "vimma-0.1.0-x86_64.AppImage"));
  });

  it("stages the .deb with control, maintainer scripts, symlink, desktop file and icons", () => {
    const root = result.debRoot;
    expect(mode(join(root, "DEBIAN"))).toBe(0o755);
    expect(mode(join(root, "DEBIAN/control"))).toBe(0o644);
    expect(readFileSync(join(root, "DEBIAN/control"), "utf8")).toMatch(/^Version: 0\.1\.0$/m);
    for (const script of ["postinst", "prerm"]) {
      const path = join(root, "DEBIAN", script);
      expect(mode(path)).toBe(0o755);
      expect(spawnSync("sh", ["-n", path]).status).toBe(0);
      expect(readFileSync(path, "utf8")).toMatch(/update-alternatives/);
    }
    expect(lstatSync(join(root, "usr/bin/vimma")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(root, "usr/bin/vimma"))).toBe("../lib/vimma/vimma");
    expect(mode(join(root, "usr/lib/vimma/vimma"))).toBe(0o755);
    expect(readlinkSync(join(root, "usr/bin/vimma-open"))).toBe("../lib/vimma/vimma-open");
    expect(mode(join(root, "usr/lib/vimma/vimma-open"))).toBe(0o755);
    expect(existsSync(join(root, "usr/share/applications/vimma-vimma.desktop"))).toBe(true);
    expect(existsSync(join(root, "usr/share/icons/hicolor/512x512/apps/vimma.png"))).toBe(true);
    expect(readFileSync(join(root, "usr/share/doc/vimma/copyright"), "utf8")).toMatch(/MPL-2\.0/);
    const installed = Number(
      /^Installed-Size: (\d+)$/m.exec(readFileSync(join(root, "DEBIAN/control"), "utf8"))?.[1],
    );
    expect(installed).toBeGreaterThan(0);
  });

  it.skipIf(!deb)("builds a .deb that dpkg-deb can read", () => {
    const file = join(out, "vimma_0.1.0_amd64.deb");
    const info = execFileSync("dpkg-deb", ["--field", file, "Package", "Version"], {
      encoding: "utf8",
    });
    expect(info).toBe("Package: vimma\nVersion: 0.1.0\n");
    const contents = execFileSync("dpkg-deb", ["--contents", file], { encoding: "utf8" });
    expect(contents).toMatch(/root\/root .* \.\/usr\/lib\/vimma\/vimma\n/);
    expect(contents).toMatch(/\.\/usr\/bin\/vimma -> \.\.\/lib\/vimma\/vimma/);
  });

  it("writes the AUR files with the release tarball's SHA-256", () => {
    const aur = result.aurDir;
    const tarSum = sha256(readFileSync(join(out, "vimma-0.1.0-linux-x86_64.tar.xz")));
    const desktopSum = sha256(readFileSync(join(aur, "vimma-vimma.desktop")));
    const launcherSum = sha256(readFileSync(LAUNCHER));
    const build = readFileSync(join(aur, "PKGBUILD"), "utf8");
    expect(build).toContain(
      `sha256sums=('${tarSum}'\n            '${desktopSum}'\n            '${launcherSum}')`,
    );
    expect(mode(join(aur, "vimma-open"))).toBe(0o755);
    expect(readFileSync(join(aur, ".SRCINFO"), "utf8")).toContain(`\tsha256sums = ${tarSum}\n`);
    expect(build).toMatch(/^# Maintainer: Test Maintainer/m);
  });

  it("writes SHA256SUMS that sha256sum -c accepts, for every release file", () => {
    const sums = readFileSync(join(out, "SHA256SUMS"), "utf8");
    const names = sums
      .trim()
      .split("\n")
      .map((line) => line.split("  ")[1]);
    const expected = ["vimma-0.1.0-linux-x86_64.tar.xz", "vimma-0.1.0-x86_64.AppImage"];
    if (deb) expected.push("vimma_0.1.0_amd64.deb");
    expect(names).toEqual(expected.sort());
    expect(spawnSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: out }).status).toBe(0);
  });

  it("leaves only release files in the output dir", () => {
    const files = readdirSync(out).sort();
    expect(files).toContain("SHA256SUMS");
    expect(files.every((f) => /^(vimma|SHA256SUMS|aur$|notes$)/.test(f))).toBe(true);
  });
});

describe("packageRelease includes an SBOM given next to it", () => {
  it("adds the SBOM to SHA256SUMS", () => {
    const out = tempDir("vimma-out-");
    const sbom = join(tempDir("vimma-sbom-"), "vimma-0.1.0.cdx.json");
    writeFileSync(sbom, "{}\n");
    packageRelease({
      tarball: fakeMachTarball(),
      outDir: out,
      config: surfer("0.1.0"),
      maintainer: MAINTAINER,
      repo: REPO,
      brandDir: BRAND_DIR,
      sbom,
      buildDeb: false,
    });
    expect(readFileSync(join(out, "SHA256SUMS"), "utf8")).toContain("  vimma-0.1.0.cdx.json\n");
    expect(readFileSync(join(out, "vimma-0.1.0.cdx.json"), "utf8")).toBe("{}\n");
  });
});

describe("packageRelease cleans up after itself", () => {
  /** The tool's own scratch dirs in the temp dir. */
  const scratch = () => readdirSync(tmpdir()).filter((n) => n.startsWith("vimma-package-"));
  const opts = (/** @type {string} */ tarball) => ({
    tarball,
    outDir: tempDir("vimma-out-"),
    config: surfer("0.1.0"),
    maintainer: MAINTAINER,
    repo: REPO,
    brandDir: BRAND_DIR,
    buildDeb: false,
  });

  it("removes its scratch dir when it made one", () => {
    const before = scratch();
    packageRelease(opts(fakeMachTarball()));
    expect(scratch()).toEqual(before);
  });

  it("removes it when packaging fails too", () => {
    const before = scratch();
    expect(() => packageRelease(opts(fakeMachTarball({ name: "Firefox" })))).toThrow();
    expect(scratch()).toEqual(before);
  });

  it("keeps a workDir it was given", () => {
    const work = tempDir("vimma-work-");
    const result = packageRelease({ ...opts(fakeMachTarball()), workDir: work });
    expect(result.appDir).toBe(join(work, "AppDir"));
    expect(existsSync(join(result.appDir, "AppRun"))).toBe(true);
  });
});

describe("packageRelease refuses bad input", () => {
  /** @param {string} tarball */
  const run = (tarball) => () =>
    packageRelease({
      tarball,
      outDir: tempDir("vimma-out-"),
      config: surfer("0.1.0"),
      maintainer: MAINTAINER,
      repo: REPO,
      brandDir: BRAND_DIR,
      buildDeb: false,
    });

  it("a tarball without vimma/vimma", () => {
    expect(run(fakeMachTarball({ omit: "vimma" }))).toThrow(/vimma\/vimma/);
  });

  it("a tarball of another brand", () => {
    expect(run(fakeMachTarball({ name: "Firefox" }))).toThrow(/Name=Firefox/);
  });
});

describe("RUNTIME_RELEASE", () => {
  it("is the runtime fetch-appimagetool.sh pins", () => {
    const script = readFileSync(new URL("../fetch-appimagetool.sh", import.meta.url), "utf8");
    expect(script).toContain(`RUNTIME_RELEASE=${RUNTIME_RELEASE}\n`);
  });
});

describe("cosign identity", () => {
  const re = new RegExp(IDENTITY_REGEXP);
  const wf = "https://github.com/JRanne/vimma/.github/workflows/release.yml@";

  it.each(["refs/tags/v0.1.0", "refs/tags/v12.34.56", "refs/heads/main"])("accepts %s", (ref) => {
    expect(re.test(wf + ref)).toBe(true);
  });

  it.each([
    [`${wf}refs/heads/evil`],
    [`${wf}refs/heads/main-evil`],
    [`${wf}refs/tags/v0.1.0-rc.1`],
    [`${wf}refs/tags/v0.1.0x`],
    [`${wf}refs/pull/1/merge`],
    ["https://github.com/JRanne/vimma/.github/workflows/nightly.yml@refs/heads/main"],
    ["https://github.com/evil/vimma/.github/workflows/release.yml@refs/heads/main"],
    [`x${wf}refs/heads/main`],
  ])("refuses %s", (identity) => {
    expect(re.test(identity)).toBe(false);
  });

  it("is the regexp the runbook tells users to verify with", () => {
    const runbook = readFileSync(new URL("../../../docs/runbook.md", import.meta.url), "utf8");
    expect(runbook).toContain(`--certificate-identity-regexp '${IDENTITY_REGEXP}'`);
    expect(runbook).toContain(
      "--certificate-oidc-issuer https://token.actions.githubusercontent.com",
    );
  });
});
