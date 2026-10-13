// docs/specs/vimma-mcp.md, decision 31 (sub-PR 2c): downloads from the agent workspace, in core.
// What counts as dangerous (d): by name, by type, by the first bytes, and by the names inside a
// zip; ClamAV's answer (g); the quarantine folder (b); the question and the notices (a).
import { describe, expect, test } from "vitest";
import {
  ARCHIVE_EXTENSIONS,
  DOWNLOAD_TOOL,
  INSTALLER_EXTENSIONS,
  SCRIPT_EXTENSIONS,
  ZIP_TAIL_BYTES,
  clamVerdict,
  dangerousContent,
  dangerousName,
  dangerousType,
  displayDir,
  downloadRefusedNotice,
  downloadSavedNotice,
  formatBytes,
  resolveDownloadDir,
  zipEntryNames,
  zipLocate,
  zipVerdict,
} from "../src/agent-downloads.mjs";

const enc = new TextEncoder();

/**
 * A zip with these names (stored, empty files): local headers, the central directory and the
 * end-of-central-directory record, as `zip -0` writes them.
 * @param {string[]} names
 * @param {{ comment?: string }} [options]
 */
export function makeZip(names, { comment = "" } = {}) {
  /** @type {number[]} */
  const out = [];
  const u16 = (/** @type {number} */ n) => out.push(n & 0xff, (n >> 8) & 0xff);
  const u32 = (/** @type {number} */ n) =>
    out.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
  /** @type {number[]} */
  const offsets = [];
  for (const name of names) {
    offsets.push(out.length);
    const bytes = enc.encode(name);
    u32(0x04034b50);
    u16(10);
    u16(0);
    u16(0);
    u32(0);
    u32(0);
    u32(0);
    u32(0);
    u16(bytes.length);
    u16(0);
    out.push(...bytes);
  }
  const cdStart = out.length;
  names.forEach((name, i) => {
    const bytes = enc.encode(name);
    u32(0x02014b50);
    u16(20);
    u16(10);
    u16(0);
    u16(0);
    u32(0);
    u32(0);
    u32(0);
    u32(0);
    u16(bytes.length);
    u16(0);
    u16(0);
    u16(0);
    u16(0);
    u32(0);
    u32(/** @type {number} */ (offsets[i]));
    out.push(...bytes);
  });
  const cdSize = out.length - cdStart;
  const c = enc.encode(comment);
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(names.length);
  u16(names.length);
  u32(cdSize);
  u32(cdStart);
  u16(c.length);
  out.push(...c);
  return new Uint8Array(out);
}

/** The names in a zip, as the browser reads it: the tail, then the central directory. */
function list(/** @type {Uint8Array} */ zip) {
  const tail = zip.subarray(Math.max(0, zip.length - ZIP_TAIL_BYTES));
  const at = zipLocate(tail, zip.length);
  if (at.kind !== "zip") return at.kind;
  return zipEntryNames(zip.subarray(at.offset, at.offset + at.length), at.entries);
}

describe("dangerous by name (decision 31 d)", () => {
  test.each([
    ["install.sh", "script"],
    ["run.PY", "script"],
    ["tool.pl", "script"],
    ["gem.rb", "script"],
    ["payload.js", "script"],
    ["setup.ps1", "script"],
    ["go.bat", "script"],
    ["go.cmd", "script"],
    ["app.desktop", "script"],
    ["vimma.deb", "installer"],
    ["vimma.rpm", "installer"],
    ["Vimma-x86_64.AppImage", "installer"],
    ["app.flatpak", "installer"],
    ["app.snap", "installer"],
    ["setup.msi", "installer"],
    ["app.dmg", "installer"],
    ["app.pkg", "installer"],
    ["app.apk", "installer"],
    ["src.tar.gz", "archive"],
    ["src.tgz", "archive"],
    ["src.tar.xz", "archive"],
    ["src.tar.zst", "archive"],
    ["src.tar", "archive"],
    ["src.7z", "archive"],
    ["src.rar", "archive"],
    ["notes.txt.gz", "archive"],
    ["setup.exe", "executable"],
    ["lib.so", "executable"],
    ["lib.dll", "executable"],
    ["tool.jar", "executable"],
  ])("%s is %s", (name, kind) => {
    expect(dangerousName(name)?.kind).toBe(kind);
  });

  test.each(["report.pdf", "photo.jpg", "data.csv", "notes.txt", "paper.docx", "src.zip", ""])(
    "%s is not, by its name",
    (name) => {
      expect(dangerousName(name)).toBe(null);
    },
  );

  test("Firefox's own executable list (nsIApplicationReputationService.isExecutable) counts", () => {
    const isExecutable = (/** @type {string} */ n) => n.endsWith(".scr");
    expect(dangerousName("screen.scr", { isExecutable })?.kind).toBe("executable");
    expect(dangerousName("report.pdf", { isExecutable })).toBe(null);
  });

  test("a trailing dot or space does not hide the extension", () => {
    expect(dangerousName("install.sh.")?.kind).toBe("script");
    expect(dangerousName("install.sh ")?.kind).toBe("script");
  });

  test("the lists hold what decision 31 names", () => {
    expect(SCRIPT_EXTENSIONS).toEqual(
      expect.arrayContaining(["sh", "py", "pl", "rb", "js", "ps1", "bat", "cmd", "desktop"]),
    );
    expect(INSTALLER_EXTENSIONS).toEqual(
      expect.arrayContaining(["deb", "rpm", "appimage", "flatpak", "snap", "msi", "dmg", "pkg"]),
    );
    expect(ARCHIVE_EXTENSIONS).toEqual(expect.arrayContaining(["tar", "7z", "rar", "tgz"]));
  });
});

describe("dangerous by type", () => {
  test.each([
    ["application/x-executable", "executable"],
    ["application/x-sharedlib", "executable"],
    ["application/x-msdownload", "executable"],
    ["application/x-sh", "script"],
    ["text/x-shellscript", "script"],
    ["application/x-python", "script"],
    ["application/vnd.debian.binary-package", "installer"],
    ["application/x-rpm", "installer"],
    ["application/vnd.appimage", "installer"],
    ["application/x-desktop", "script"],
    ["application/x-7z-compressed", "archive"],
    ["application/x-tar", "archive"],
    ["application/gzip", "archive"],
    ["APPLICATION/X-SH; charset=utf-8", "script"],
  ])("%s is %s", (type, kind) => {
    expect(dangerousType(type)?.kind).toBe(kind);
  });

  test.each(["application/pdf", "text/plain", "image/png", "application/zip", "", undefined])(
    "%s is not, by its type",
    (type) => {
      expect(dangerousType(type)).toBe(null);
    },
  );
});

describe("dangerous by the first bytes (decision 31 d)", () => {
  const bytes = (/** @type {number[]} */ ...b) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0]);
  test.each([
    ["ELF", bytes(0x7f, 0x45, 0x4c, 0x46), "executable"],
    ["PE (MZ)", bytes(0x4d, 0x5a), "executable"],
    ["Mach-O 32", bytes(0xfe, 0xed, 0xfa, 0xce), "executable"],
    ["Mach-O 64", bytes(0xfe, 0xed, 0xfa, 0xcf), "executable"],
    ["Mach-O reversed", bytes(0xcf, 0xfa, 0xed, 0xfe), "executable"],
    ["fat binary", bytes(0xca, 0xfe, 0xba, 0xbe), "executable"],
    ["#! script", enc.encode("#!/bin/sh\necho hi\n"), "script"],
    ["gzip", bytes(0x1f, 0x8b), "archive"],
    ["xz", bytes(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00), "archive"],
    ["bzip2", enc.encode("BZh91AY&SY"), "archive"],
    ["7z", bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c), "archive"],
    ["rar", enc.encode("Rar!\u001a\u0007\u0000"), "archive"],
    ["zstd", bytes(0x28, 0xb5, 0x2f, 0xfd), "archive"],
  ])("%s", (_what, head, kind) => {
    expect(dangerousContent(head)?.kind).toBe(kind);
  });

  test("a tar has ustar at 257", () => {
    const tar = new Uint8Array(512);
    tar.set(enc.encode("ustar"), 257);
    expect(dangerousContent(tar)?.kind).toBe("archive");
  });

  test.each([
    ["a PDF", enc.encode("%PDF-1.7\n")],
    ["text", enc.encode("hello, world\n")],
    ["a PNG", bytes(0x89, 0x50, 0x4e, 0x47)],
    ["nothing", new Uint8Array(0)],
    ["one byte", new Uint8Array([0x7f])],
  ])("%s is not", (_what, head) => {
    expect(dangerousContent(head)).toBe(null);
  });
});

describe("a zip's names, from its central directory (never extracted)", () => {
  test("the names, in order", () => {
    expect(list(makeZip(["README.md", "src/main.c"]))).toEqual(["README.md", "src/main.c"]);
  });

  test("with a comment after the record", () => {
    expect(list(makeZip(["a.txt"], { comment: "made by hand" }))).toEqual(["a.txt"]);
  });

  test("an empty zip lists nothing", () => {
    expect(list(makeZip([]))).toEqual([]);
  });

  test("not a zip", () => {
    expect(list(enc.encode("%PDF-1.7 not a zip at all"))).toBe("none");
  });

  test("a central directory that points outside the file cannot be listed", () => {
    const zip = makeZip(["a.txt"]);
    const eocd = zip.length - 22;
    zip[eocd + 16] = 0xff; // the offset, far past the end
    zip[eocd + 19] = 0x7f;
    expect(list(zip)).toBe("unlistable");
  });

  test("zip64 (0xffff entries) cannot be listed", () => {
    const zip = makeZip(["a.txt"]);
    const eocd = zip.length - 22;
    zip[eocd + 10] = 0xff;
    zip[eocd + 11] = 0xff;
    expect(list(zip)).toBe("unlistable");
  });

  test("a truncated central directory gives null, never a throw", () => {
    const zip = makeZip(["a.txt", "b.txt"]);
    const at = zipLocate(zip, zip.length);
    if (at.kind !== "zip") throw new Error("expected a zip");
    expect(zipEntryNames(zip.subarray(at.offset, at.offset + 10), at.entries)).toBe(null);
  });

  test("a dangerous name inside makes the zip dangerous, and says which", () => {
    expect(zipVerdict(["README.md", "bin/install.sh"])).toEqual({
      kind: "archive",
      text: "a zip holding a script (bin/install.sh)",
    });
    expect(zipVerdict(["docs/a.pdf", "img/b.png"])).toBe(null);
    expect(zipVerdict(["inner.tar.gz"])?.text).toBe(
      "a zip holding an archive Vimma cannot look inside (inner.tar.gz)",
    );
    expect(zipVerdict(["nested.zip"])?.kind).toBe("archive");
  });

  test("names inside are checked with Firefox's list too", () => {
    const isExecutable = (/** @type {string} */ n) => n.endsWith(".scr");
    expect(zipVerdict(["x.scr"], { isExecutable })?.kind).toBe("archive");
  });
});

describe("ClamAV's answer (decision 31 g)", () => {
  test("exit 0 is clean, 1 infected with the signature, anything else an error", () => {
    expect(clamVerdict({ exitCode: 0, stdout: "/q/a.part: OK\n" })).toEqual({ kind: "clean" });
    expect(clamVerdict({ exitCode: 1, stdout: "/q/a.part: Eicar-Test-Signature FOUND\n" })).toEqual(
      { kind: "infected", signature: "Eicar-Test-Signature" },
    );
    expect(clamVerdict({ exitCode: 1, stdout: "" })).toEqual({
      kind: "infected",
      signature: "a virus",
    });
    expect(clamVerdict({ exitCode: 2, stdout: "" })).toEqual({ kind: "error" });
    expect(clamVerdict({ exitCode: -1, stdout: "" })).toEqual({ kind: "error" });
  });

  test("a hostile signature name is one plain line, cut", () => {
    const v = clamVerdict({ exitCode: 1, stdout: `/q/a: ${"\u202eX".repeat(100)}\n FOUND\n` });
    expect(v.kind).toBe("infected");
    if (v.kind === "infected") {
      // eslint-disable-next-line no-control-regex -- control characters are what it checks for
      expect(v.signature).not.toMatch(/[\u0000-\u001f\u202e]/);
      expect(v.signature.length).toBeLessThanOrEqual(60);
    }
  });
});

describe("the quarantine folder (decision 31 b)", () => {
  const home = "/home/u";
  test("~ expands; an absolute path stays; trailing slashes go", () => {
    expect(resolveDownloadDir("~/Downloads/vimma-agent/", home)).toBe(
      "/home/u/Downloads/vimma-agent",
    );
    expect(resolveDownloadDir("/srv/q", home)).toBe("/srv/q");
    expect(resolveDownloadDir("/srv/a/../q/./", home)).toBe("/srv/q");
  });

  test("shown with ~ for the home folder", () => {
    expect(displayDir("/home/u/Downloads/vimma-agent", home)).toBe("~/Downloads/vimma-agent");
    expect(displayDir("/srv/q", home)).toBe("/srv/q");
  });
});

describe("the question and the notices (decision 31 a, g)", () => {
  test("the tool is vimma_download", () => {
    expect(DOWNLOAD_TOOL).toBe("vimma_download");
  });

  test.each([
    [-1, "unknown size"],
    [0, "0 B"],
    [999, "999 B"],
    [1500, "1.5 kB"],
    [2_100_000, "2.1 MB"],
    [200_000_000, "200 MB"],
    [3_200_000_000, "3.2 GB"],
  ])("%d bytes: %s", (n, text) => {
    expect(formatBytes(n)).toBe(text);
  });

  test("saved: where, and whether ClamAV scanned it", () => {
    const at = "~/Downloads/vimma-agent";
    expect(downloadSavedNotice({ name: "report.pdf", dir: at, scan: "clean" })).toBe(
      'saved "report.pdf" to ~/Downloads/vimma-agent, scanned (ClamAV)',
    );
    expect(downloadSavedNotice({ name: "report.pdf", dir: at, scan: "none" })).toBe(
      'saved "report.pdf" to ~/Downloads/vimma-agent, not scanned',
    );
    expect(downloadSavedNotice({ name: "report.pdf", dir: at, scan: "error" })).toBe(
      'saved "report.pdf" to ~/Downloads/vimma-agent, not scanned (ClamAV failed)',
    );
  });

  test("refused and deleted: why", () => {
    expect(downloadRefusedNotice("a.bin", { kind: "http" })).toBe(
      'refused download "a.bin": not https',
    );
    expect(downloadRefusedNotice("a.bin", { kind: "cap", mb: 200 })).toBe(
      'refused download "a.bin": over [mcp] download_max_mb (200 MB)',
    );
    expect(downloadRefusedNotice("a.bin", { kind: "infected", signature: "Eicar" })).toBe(
      'deleted download "a.bin": ClamAV found Eicar',
    );
    expect(downloadRefusedNotice("a.bin", { kind: "danger", text: "an executable (ELF)" })).toBe(
      'deleted download "a.bin": an executable (ELF), not allowed',
    );
    expect(downloadRefusedNotice("a.bin", { kind: "place" })).toBe(
      'refused download "a.bin": not in the quarantine folder',
    );
  });

  test("a file name in a notice is one line, cut", () => {
    const n = downloadSavedNotice({ name: `a\nb${"x".repeat(200)}`, dir: "/q", scan: "none" });
    expect(n).not.toMatch(/\n/);
    expect(n.length).toBeLessThan(140);
  });
});
