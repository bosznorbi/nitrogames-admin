/**
 * Kepformatum es meret felismerese a fajl fejlecebol, kulso fuggoseg nelkul.
 * A formatumot MINDIG a magic byte-okbol allapitjuk meg, sosem a kuldott
 * Content-Type fejlecbol - azt a hivo hazudhatja.
 */

function png(buf) {
  if (buf.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { format: 'png', mime: 'image/png', ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) { off++; continue; }
    const marker = buf[off + 1];
    if (marker === 0xff) { off++; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { off += 2; continue; }
    const len = buf.readUInt16BE(off + 2);
    if (len < 2) return null;
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      return { format: 'jpeg', mime: 'image/jpeg', ext: 'jpg', height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    }
    off += 2 + len;
  }
  return null;
}

function webp(buf) {
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buf.toString('ascii', 12, 16);
  const base = { format: 'webp', mime: 'image/webp', ext: 'webp' };

  if (chunk === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { ...base, width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const b = buf.readUInt32LE(21);
    return { ...base, width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    const w = buf[24] | (buf[25] << 8) | (buf[26] << 16);
    const h = buf[27] | (buf[28] << 8) | (buf[29] << 16);
    return { ...base, width: w + 1, height: h + 1 };
  }
  return null;
}

/** @returns {{format,mime,ext,width,height}|null} */
export function inspectImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  try {
    const info = png(buf) || jpeg(buf) || webp(buf);
    if (!info || !info.width || !info.height) return null;
    return info;
  } catch {
    return null;
  }
}

/** Elfogadjuk a nyers binaris body-t, a data URL-t es a sima base64-et is. */
export function decodeImagePayload(req) {
  if (Buffer.isBuffer(req.body) && req.body.length) return req.body;
  const b = req.body;
  if (b && typeof b === 'object') {
    const raw = b.image_base64 ?? b.image ?? b.data;
    if (typeof raw === 'string' && raw.length) {
      const cleaned = raw.includes(',') && raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
      try {
        return Buffer.from(cleaned.replace(/\s+/g, ''), 'base64');
      } catch {
        return null;
      }
    }
  }
  return null;
}
