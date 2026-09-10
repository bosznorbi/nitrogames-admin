import crypto from 'node:crypto';

// Csak betuk, az osszekeverhetok nelkul (nincs I es O). Papirrol gepelik be.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

// A csapatkodban szam is lehet, de a 0/O es 1/I paros itt sincs.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function pick(alphabet, len) {
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

export function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Szavazoi kod: 4 betu, kezzel is konnyen beirhato. */
export function voterCode(len = 4) {
  return pick(LETTERS, len);
}

/** Csapatkod: papirrol begepelheto, XXXX-XXXX formaban jelenitjuk meg. */
export function teamCode() {
  return pick(CODE_ALPHABET, 8);
}

/** A csapat szavazolapjanak kitalalhatatlan azonositoja a QR-ben. */
export function publicId() {
  return crypto.randomBytes(9).toString('base64url');
}

/** Kotojel es kisbetu nelkuli alak, hogy a begepelt kod is talaljon. */
export function normalizeCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Megjelenitesi alak: NGX4-7KP2 */
export function formatCode(code) {
  const c = normalizeCode(code);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Idozites-fuggetlen string osszehasonlitas. */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function slugify(input, fallback = 'csapat') {
  const map = { á: 'a', é: 'e', í: 'i', ó: 'o', ö: 'o', ő: 'o', ú: 'u', ü: 'u', ű: 'u' };
  const s = String(input ?? '')
    .toLowerCase()
    .replace(/[áéíóöőúüű]/g, (c) => map[c] || c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || fallback;
}
