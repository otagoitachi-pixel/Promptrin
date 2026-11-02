// Image checks for uploads: real type from the file's bytes, pixel size, and base64 encoding.
import { sniffImage } from '../scripts/lib/shared.mjs';

/** Pixel size of a JPEG, PNG or WebP, read from the file header. Returns { width, height } or null. */
export function imageSize(b, type = sniffImage(b)) {
  try {
    if (type === 'png') {
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      return b.length >= 24 ? { width: dv.getUint32(16), height: dv.getUint32(20) } : null;
    }
    if (type === 'jpg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
        i += 2 + ((b[i + 2] << 8) | b[i + 3]);
      }
      return null;
    }
    if (type === 'webp') {
      const fourcc = String.fromCharCode(...b.slice(12, 16));
      if (fourcc === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (fourcc === 'VP8 ') return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
      if (fourcc === 'VP8L') { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    }
  } catch { /* fall through */ }
  return null;
}

const RATIOS = ['1:1', '4:5', '3:4', '2:3', '9:16', '3:2', '4:3', '16:9'];
/** The closest ratio the site supports (the same list as the admin panel). */
export function nearestRatio({ width, height }) {
  const r = width / height;
  return RATIOS.map((x) => { const [w, h] = x.split(':').map(Number); return [x, Math.abs(Math.log(r / (w / h)))]; }).sort((a, b) => a[1] - b[1])[0][0];
}

/** Base64 of raw bytes, in chunks so large images do not overflow the call stack. */
export function toBase64(bytes) {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x6000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x6000));
  return btoa(out);
}
