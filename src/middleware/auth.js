import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';
import { safeEqual } from '../lib/ids.js';

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
  const token = req.cookies?.[VOTER_COOKIE];
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

/** Csapat API kulcs: `Authorization: Bearer ng_...` vagy `X-API-Key: ng_...`. */
export function requireTeamKey(req, res, next) {
  const header = req.get('authorization') || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  const key = bearer || req.get('x-api-key') || req.query.api_key;
  if (!key) {
    return res.status(401).json({
      error: 'missing_api_key',
      message: 'Add meg az API kulcsot: Authorization: Bearer ng_... vagy X-API-Key: ng_...',
    });
  }
  const team = db.prepare('SELECT * FROM teams WHERE api_key = ?').get(String(key));
  if (!team) return res.status(403).json({ error: 'invalid_api_key', message: 'Ismeretlen API kulcs.' });
  req.team = team;
  next();
}

/* ---------- egyszeru memoriabeli rate limit ---------- */

const buckets = new Map();

export function rateLimit({ windowMs = 60_000, max = 30, key = (req) => req.ip } = {}) {
  return (req, res, next) => {
    const k = `${req.baseUrl}${req.path}|${key(req)}`;
    const now = Date.now();
    const b = buckets.get(k);
    if (!b || now > b.reset) {
      buckets.set(k, { count: 1, reset: now + windowMs });
      return next();
    }
    if (b.count >= max) {
      res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({ error: 'rate_limited', message: 'Túl sok kérés, próbáld újra kicsit később.' });
    }
    b.count++;
    next();
  };
}

// Ne nojon hatartalanul a memoriaban.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 5 * 60_000).unref();
