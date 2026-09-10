import crypto from 'node:crypto';

// Osszekeverheto karakterek nelkul (nincs 0/O, 1/I/L), hogy kezzel is le lehessen irni.
const HUMAN_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function humanCode(len = 5) {
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += HUMAN_ALPHABET[buf[i] % HUMAN_ALPHABET.length];
  return out;
}

export function apiKey() {
  return `ng_${crypto.randomBytes(24).toString('base64url')}`;
}

/** Idozites-fuggetlen string osszehasonlitas. */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function slugify(input, fallback = 'csapat') {
  const map = { á:'a', é:'e', í:'i', ó:'o', ö:'o', ő:'o', ú:'u', ü:'u', ű:'u' };
  const s = String(input ?? '')
    .toLowerCase()
    .replace(/[áéíóöőúüű]/g, (c) => map[c] || c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || fallback;
}
