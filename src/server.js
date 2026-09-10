import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { config, baseUrl } from './config.js';
import { db } from './db.js';
import { publicRouter } from './routes/public.js';
import { teamRouter } from './routes/team.js';
import { adminRouter } from './routes/admin.js';
import {
  VOTER_COOKIE,
  loadVoter,
  requireAdminPage,
  voterCookieOpts,
} from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VIEWS = path.join(ROOT, 'views');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ---------- body parserek ---------- */

// Nyers kepfeltoltes (Content-Type: image/png | image/jpeg | image/webp)
app.use(
  express.raw({
    type: (req) => /^image\//i.test(req.headers['content-type'] || ''),
    limit: config.image.maxBytes + 64 * 1024,
  })
);
app.use(express.json({ limit: '16mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

/* ---------- statikus fajlok ---------- */

app.use(
  '/static',
  express.static(path.join(ROOT, 'public'), { maxAge: config.isProd ? '1h' : 0, index: false })
);
app.use(
  '/uploads',
  express.static(config.uploadDir, {
    maxAge: '5m',
    index: false,
    setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
  })
);

// A statikus fajlok utan, hogy minden CSS/kep keresre ne fusson DB iras.
app.use(loadVoter);

const view = (name) => (_req, res) => res.sendFile(path.join(VIEWS, name));

/* ---------- szavazoi oldalak ---------- */

app.get('/', view('index.html'));
app.get('/belepes', view('belepes.html'));
app.get('/join', (_req, res) => res.redirect('/belepes'));
app.get('/t/:publicId', view('vote.html'));
app.get('/csapat', view('csapat.html'));
app.get('/team', (req, res) => res.redirect('/csapat' + (req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '')));

/** Szemelyes belepteto link (a papir QR ide mutat). */
app.get('/v/:token', (req, res) => {
  const voter = db.prepare('SELECT * FROM voters WHERE token = ?').get(req.params.token);
  if (!voter) return res.redirect('/belepes?hiba=ismeretlen');
  res.cookie(VOTER_COOKIE, voter.token, voterCookieOpts());
  db.prepare("UPDATE voters SET is_activated = 1, last_seen_at = datetime('now') WHERE id = ?").run(voter.id);

  const next = String(req.query.next || '');
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  res.redirect(safeNext);
});

app.post('/api/session/logout', (_req, res) => {
  res.clearCookie(VOTER_COOKIE, { path: '/' });
  res.json({ ok: true });
});

/* ---------- admin oldalak ---------- */

app.get('/admin/login', view('admin-login.html'));
app.get('/admin', requireAdminPage, view('admin.html'));
app.get('/admin/eredmeny', requireAdminPage, view('admin-results.html'));

/* ---------- API ---------- */

app.use('/api/admin', adminRouter);
app.use('/api/csapat', teamRouter);
app.use('/api/team', teamRouter); // regi nev, hogy a mar kiadott peldak is menjenek
app.use('/api', publicRouter);

app.get('/healthz', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

/* ---------- hibakezeles ---------- */

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not_found', message: `Nincs ilyen végpont: ${req.method} ${req.path}` });
  }
  res.status(404).sendFile(path.join(VIEWS, '404.html'));
});

app.use((err, req, res, _next) => {
  const tooLarge = err && (err.type === 'entity.too.large' || err.status === 413);
  const status = tooLarge ? 413 : err.status || err.statusCode || 500;
  if (status >= 500) console.error('[hiba]', err);
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({
      error: tooLarge ? 'too_large' : 'server_error',
      message: tooLarge ? 'A küldött adat túl nagy.' : 'Váratlan szerverhiba.',
    });
  }
  res.status(status).type('text/plain; charset=utf-8').send('Hiba történt.');
});

/* ---------- indulas ---------- */

const server = app.listen(config.port, '0.0.0.0', () => {
  const teams = db.prepare('SELECT COUNT(*) AS c FROM teams').get().c;
  const voters = db.prepare('SELECT COUNT(*) AS c FROM voters').get().c;
  console.log('');
  console.log(`  ${config.eventName} szavazóapp fut`);
  console.log(`  helyi cím:   http://localhost:${config.port}`);
  for (const ip of localIps()) console.log(`  hálózaton:   http://${ip}:${config.port}   <- erről érhető el telefonról`);
  console.log(`  admin:       http://localhost:${config.port}/admin`);
  console.log(`  adatbázis:   ${config.dbFile}`);
  console.log(`  csapatok: ${teams}   szavazók: ${voters}`);
  if (config.adminPassword === 'nitrogames') {
    console.log('  FIGYELEM: alapértelmezett admin jelszó van érvényben, állítsd be az ADMIN_PASSWORD-ot.');
  }
  console.log('');
});

const VIRTUAL_NIC = /vethernet|virtual|vmware|hyper-v|tailscale|zerotier|docker|wsl/i;

function localIps() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_NIC.test(name)) continue;
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
  }
  return out;
}

function shutdown() {
  server.close(() => {
    try {
      db.close();
    } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, baseUrl };
