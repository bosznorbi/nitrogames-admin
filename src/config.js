import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { lanIp } from './lib/lan.js';

const int = (v, def) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : def;
};

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// A session secret elveszese kilepteti az admint es a szavazokat.
// Ha nincs megadva, egyszer generalunk egyet es lemezre irjuk.
function resolveSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, '.session-secret');
  try {
    return fs.readFileSync(f, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(f, s, 'utf8');
    return s;
  }
}

export const config = {
  port: int(process.env.PORT, 3000),
  isProd: process.env.NODE_ENV === 'production',
  dataDir: DATA_DIR,
  uploadDir: UPLOAD_DIR,
  dbFile: path.join(DATA_DIR, 'nitrogames.sqlite'),
  adminPassword: process.env.ADMIN_PASSWORD || 'nitrogames',
  sessionSecret: resolveSecret(),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  eventName: process.env.EVENT_NAME || 'Nitrogames',
  image: {
    background: { width: int(process.env.BG_WIDTH, 1080), height: int(process.env.BG_HEIGHT, 1920) },
    icon: { width: int(process.env.ICON_WIDTH, 640), height: int(process.env.ICON_HEIGHT, 768) },
    maxBytes: int(process.env.MAX_UPLOAD_BYTES, 4 * 1024 * 1024),
    formats: ['image/png', 'image/jpeg', 'image/webp'],
  },
};

/**
 * A QR kodokba es a megosztott linkekbe kerulo abszolut alap URL.
 *
 * Helyi futtatasnal szandekosan NEM a keres hosztjat hasznaljuk: ha az admint
 * localhoston nyitod meg, a QR kodok is localhostra mutatnanak, azokat pedig
 * telefonrol nem lehet beolvasni. Ilyenkor a gep halozati cimet tesszuk beluk,
 * igy otthon is ugy tesztelheto minden, mintha a helyszinen lennenk.
 */
export function baseUrl(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;

  if (!config.isProd) {
    const ip = lanIp();
    if (ip) return `http://${ip}:${config.port}`;
  }

  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || `localhost:${config.port}`).split(',')[0].trim();
  return `${proto}://${host}`;
}
