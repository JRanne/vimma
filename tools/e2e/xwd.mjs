// Decode an XWD (X Window Dump) image: the format Xvfb keeps its framebuffer in when started
// with `-fbdir DIR` (DIR/Xvfb_screen0), and what `xwd` writes. Spec m0-e2e-harness: this is how
// the harness captures the screen until the control protocol's `screenshot` command exists.
// Only TrueColor/DirectColor ZPixmaps (Xvfb at depth 16/24/32) are supported.

/** @typedef {import("./png.mjs").Image} Image */

const XWD_FILE_VERSION = 7;
const HEADER_FIELDS = 25;
const Z_PIXMAP = 2;
const COLOR_ENTRY_SIZE = 12;

/** Shift and width of a colour mask, to scale its channel to 8 bits. @param {number} mask */
function maskInfo(mask) {
  if (mask === 0) throw new Error("XWD: zero colour mask (not a TrueColor visual)");
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  let bits = 0;
  while (((mask >>> (shift + bits)) & 1) === 1) bits++;
  return { shift, max: 2 ** bits - 1 };
}

/**
 * @param {Uint8Array} file
 * @returns {Image}
 */
export function decodeXwd(file) {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (buf.length < HEADER_FIELDS * 4) throw new Error("not an XWD file (too short)");
  // The header is written MSB-first by xwd and Xvfb; accept either order, decided by the version.
  const big = buf.readUInt32BE(4) === XWD_FILE_VERSION;
  if (!big && buf.readUInt32LE(4) !== XWD_FILE_VERSION) {
    throw new Error("not an XWD file (file_version is not 7)");
  }
  /** @param {number} i */
  const field = (i) => (big ? buf.readUInt32BE(i * 4) : buf.readUInt32LE(i * 4));
  const [headerSize, , format, , width, height, , byteOrder, , , , bpp, bytesPerLine] = Array.from(
    { length: 13 },
    (_, i) => field(i),
  );
  const masks = [field(14), field(15), field(16)];
  const ncolors = field(19);
  if (format !== Z_PIXMAP) throw new Error(`XWD: pixmap format ${format} is not ZPixmap`);
  if (bpp !== 16 && bpp !== 24 && bpp !== 32) throw new Error(`XWD: ${bpp} bits per pixel`);
  const w = /** @type {number} */ (width);
  const h = /** @type {number} */ (height);
  const bpl = /** @type {number} */ (bytesPerLine);
  const bytes = /** @type {number} */ (bpp) / 8;
  const offset = /** @type {number} */ (headerSize) + ncolors * COLOR_ENTRY_SIZE;
  if (offset + bpl * h > buf.length) {
    throw new Error(`XWD truncated: ${buf.length} bytes, need ${offset + bpl * h}`);
  }
  const [r, g, b] = masks.map(maskInfo);
  const out = new Uint8Array(w * h * 4);
  if (bytes === 4 && byteOrder === 0 && masks.join() === "16711680,65280,255") {
    // Xvfb at depth 24 on a little-endian host: bytes are B, G, R, X. A fast path for 1 Mpx.
    for (let y = 0; y < h; y++) {
      for (let x = 0, p = offset + y * bpl, o = y * w * 4; x < w; x++, p += 4, o += 4) {
        out[o] = /** @type {number} */ (buf[p + 2]);
        out[o + 1] = /** @type {number} */ (buf[p + 1]);
        out[o + 2] = /** @type {number} */ (buf[p]);
        out[o + 3] = 255;
      }
    }
    return { width: w, height: h, data: out };
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = offset + y * bpl + x * bytes;
      let v = 0;
      for (let k = 0; k < bytes; k++) {
        // byte_order 0 = LSBFirst, 1 = MSBFirst
        const byte = /** @type {number} */ (buf[byteOrder === 0 ? p + bytes - 1 - k : p + k]);
        v = v * 256 + byte;
      }
      const o = (y * w + x) * 4;
      for (const [c, info] of [r, g, b].entries()) {
        const { shift, max } = /** @type {{ shift: number, max: number }} */ (info);
        out[o + c] = Math.round(((Math.floor(v / 2 ** shift) & max) * 255) / max);
      }
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}
