import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, getSetting } from '../db.js';
import { normalizeCode, safeEqual } from '../lib/ids.js';

export const VOTER_COOKIE = 'ng_voter';
export const ADMIN_COOKIE = 'ng_admin';

const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;
const VOTER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hmac(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

export function signAdminSession() {
  const exp = String(Date.now() + ADMIN_TTL_MS);
  return `${exp}.${hmac(exp)}`;
}

export function verifyAdminSession(value) {
  if (typeof value !== 'string' || !value.includes('.')) return false;
  const idx = value.lastIndexOf('.');
  const exp = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  if (!safeEqual(sig, hmac(exp))) return false;
  return Number(exp) > Date.now();
}

/*
 * A szavazoi suti alairva es idobelyeggel utazik. A tokent nem cserelhetjuk,
 * mert az a kinyomtatott QR-ben all (/v/<token>), ezert a kileptetes ugy
 * mukodik, hogy az admin elore allitja a "voter_epoch" beallitast: az annal
 * regebben kiadott sutik ervenyuket vesztik. A papir ettol ervenyes marad,
 * ujra beolvasva mindenki visszalep.
 */
export function signVoterSession(token) {
  const kiadva = String(Date.now());
  return `${token}.${kiadva}.${hmac(`${token}.${kiadva}`)}`;
}

function readVoterSession(value) {
  if (typeof value !== 'string') return null;
  const reszek = value.split('.');
  if (reszek.length !== 3) return null;
  const [token, kiadva, sig] = reszek;
  if (!safeEqual(sig, hmac(`${token}.${kiadva}`))) return null;

  const epoch = Number(getSetting('voter_epoch') || 0);
  if (Number(kiadva) < epoch) return null;
  return token;
}

export function cookieOpts(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge,
    path: '/',
  };
}

export const adminCookieOpts = () => cookieOpts(ADMIN_TTL_MS);
export const voterCookieOpts = () => cookieOpts(VOTER_TTL_MS);

/* ---------- middleware ---------- */

export function loadVoter(req, _res, next) {
  const token = readVoterSession(req.cookies?.[VOTER_COOKIE]);
  req.voter = null;
  if (token) {
    const v = db.prepare('SELECT * FROM voters WHERE token = ?').get(token);
    if (v) {
      req.voter = v;
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      db.prepare('UPDATE voters SET last_seen_at = ?, is_activated = 1 WHERE id = ?').run(now, v.id);
    }
  }
  next();
}

export function requireVoter(req, res, next) {
  if (!req.voter) return res.status(401).json({ error: 'not_authenticated', message: 'Előbb olvasd be a saját QR-kódodat.' });
  next();
}

export function isAdmin(req) {
  return verifyAdminSession(req.cookies?.[ADMIN_COOKIE]);
}

/** API vedelem: mindig JSON valasz. */
export function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  return res.status(401).json({ error: 'admin_required', message: 'Jelentkezz be az admin felületen.' });
}

/** HTML oldal vedelem: atiranyitas a bejelentkezesre. */
export function requireAdminPage(req, res, next) {
  if (isAdmin(req)) return next();
  return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
}

/**
 * Csapatkod. A papiron kapott 8 karakteres kod, barmelyik helyen:
 *   Authorization: Bearer XXXX-XXXX
 *   X-Csapat-Kod: XXXX-XXXX
 *   ?kod=XXXX-XXXX
 * A kotojel es a kisbetu nem szamit.
 */
export function requireTeamCode(req, res, next) {
  const header = req.get('authorization') || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  const raw = bearer || req.get('x-csapat-kod') || req.get('x-api-key') || req.query.kod || req.query.code;
  if (!raw) {
    return res.status(401).json({
      error: 'hianyzo_kod',
      message: 'Add meg a csapatkódot: Authorization: Bearer XXXX-XXXX fejlécben, vagy ?kod=XXXX-XXXX paraméterben.',
    });
  }
  const code = normalizeCode(raw);
  const team = code ? db.prepare('SELECT * FROM teams WHERE api_code = ?').get(code) : null;
  if (!team) {
    return res.status(403).json({
      error: 'ismeretlen_kod',
      message: 'Ismeretlen csapatkód. A papírotokon szereplő 8 karakteres kódot add meg.',
    });
  }
  req.team = team;
  next();
}

/* ---------- egyszeru memoriabeli rate limit ---------- */

const buckets = new Map();

/**
 * @param {boolean} csakHiba Csak a hibas valasz szamit bele a keretbe.
 *   A csapatepiton mind az 50 telefon ugyanarrol a wifi-rol, tehat ugyanarrol
 *   a publikus IP-rol jon. Ha a sikeres belepes is fogyasztana a keretet,
 *   egy kozos kodbeirasnal a sokadik ember mar 429-et kapna. Igy viszont
 *   csak a talalgatas fogy, a jo kodot beiro emberek nem zarjak ki egymast.
 */
export function rateLimit({ windowMs = 60_000, max = 30, key = (req) => req.ip, csakHiba = false } = {}) {
  return (req, res, next) => {
    const k = `${req.baseUrl}${req.path}|${key(req)}`;
    const now = Date.now();
    const b = buckets.get(k);

    if (b && now <= b.reset && b.count >= max) {
      res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({ error: 'rate_limited', message: 'Túl sok kérés, próbáld újra kicsit később.' });
    }

    const szamol = () => {
      const most = Date.now();
      const akt = buckets.get(k);
      if (!akt || most > akt.reset) buckets.set(k, { count: 1, reset: most + windowMs });
      else akt.count++;
    };

    if (csakHiba) res.on('finish', () => { if (res.statusCode >= 400) szamol(); });
    else szamol();

    next();
  };
}

// Ne nojon hatartalanul a memoriaban.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 5 * 60_000).unref();
