// Minimal server-side intrinsic-dimension reader for the formats the submit
// route accepts (PNG, JPEG, GIF, WebP). The browser path measures aspect with
// `new Image()` (see add-to-pieces-button.tsx), but the anonymous submit route
// runs server-side with no DOM, and auto-placement needs the aspect to build a
// Piece that letterboxes correctly. Rather than pull in an image dependency for
// one call site, we parse the few header bytes each format needs.
//
// Returns null when it can't parse; callers fall back to a square aspect and
// the curator can correct it on the piece.

export type Dims = { width: number; height: number };

export function imageSize(b: Uint8Array): Dims | null {
  return png(b) ?? gif(b) ?? jpeg(b) ?? webp(b);
}

export function aspectFromBytes(b: Uint8Array): number | undefined {
  const d = imageSize(b);
  if (d && d.width > 0 && d.height > 0) {
    return Number((d.width / d.height).toFixed(4));
  }
  return undefined;
}

function view(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

function png(b: Uint8Array): Dims | null {
  // 89 50 4E 47 ... then the IHDR chunk; width@16, height@20 as big-endian u32.
  if (b.length < 24) return null;
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) {
    return null;
  }
  const dv = view(b);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

function gif(b: Uint8Array): Dims | null {
  // "GIF8" magic; logical-screen width@6, height@8 as little-endian u16.
  if (b.length < 10) return null;
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x38) {
    return null;
  }
  const dv = view(b);
  return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
}

function jpeg(b: Uint8Array): Dims | null {
  // SOI (FF D8), then walk segments to the first Start-Of-Frame marker, which
  // carries height@+5 and width@+7 (big-endian u16).
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const dv = view(b);
  let off = 2;
  while (off + 9 < b.length) {
    if (b[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = b[off + 1];
    // SOF0–SOF15 hold dimensions, except DHT(C4)/JPG(C8)/DAC(CC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return { height: dv.getUint16(off + 5), width: dv.getUint16(off + 7) };
    }
    const len = dv.getUint16(off + 2);
    if (len < 2) return null;
    off += 2 + len;
  }
  return null;
}

function webp(b: Uint8Array): Dims | null {
  // RIFF....WEBP, then one of three frame fourccs with different size encodings.
  if (b.length < 30) return null;
  const riff = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;
  const wbp =
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  if (!riff || !wbp) return null;
  const dv = view(b);
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (fourcc === "VP8 ") {
    // Lossy: 14-bit width/height at offset 26/28 (little-endian).
    return {
      width: dv.getUint16(26, true) & 0x3fff,
      height: dv.getUint16(28, true) & 0x3fff,
    };
  }
  if (fourcc === "VP8L") {
    // Lossless: after the 0x2f signature byte, 14-bit (width-1) then (height-1).
    const bits = dv.getUint32(21, true);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (fourcc === "VP8X") {
    // Extended: 24-bit (width-1)@24 and (height-1)@27, little-endian.
    return {
      width: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1,
      height: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1,
    };
  }
  return null;
}
