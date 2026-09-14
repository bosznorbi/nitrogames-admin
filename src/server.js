import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, baseUrl } from './config.js';
import { detectLanIp, lanIp, localIps } from './lib/lan.js';
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
// A feltöltött fájlok nevében időbélyeg van, tehát frissítéskor új a név.
// Így hosszan cachelhetők: minden telefon egyszer tölti le a háttérképeket.
app.use(
  '/uploads',
  express.static(config.uploadDir, {
    maxAge: '365d',
    immutable: true,
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

/*
 * Kilepes a szavazobol. A belepes egyszeri es tartos, ezert magatol nincs
 * kijelentkezes: erre valo ez a cim. Teszteleshez kell, amikor egy telefonrol
 * tobb cetlit akarunk kiprobalni, es akkor is, ha valaki mas telefonjan
 * maradt bent. Az admin munkamenetet nem bantja.
 */
app.get('/logout', (_req, res) => {
  res.clearCookie(VOTER_COOKIE, { path: '/', sameSite: 'lax', secure: config.isProd });
  res.redirect('/belepes?kilepes=1');
});

/** Szemelyes belepteto link (a papir QR ide mutat). */
app.get('/v/:token', (req, res) => {
  const voter = db.prepare('SELECT * FROM voters WHERE token = ?').get(req.params.token);
  if (!voter) return res.redirect('/belepes?hiba=ismeretlen');
  res.cookie(VOTER_COOKIE, voter.token, voterCookieOpts());
  db.prepare("UPDATE voters SET is_activated = 1, last_seen_at = datetime('now') WHERE id = ?").run(voter.id);

  const next = String(req.query.next || '');
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  // A főoldal ebből tudja, hogy most lépett be, és mutatja a visszajelzést.
  res.redirect(safeNext === '/' ? '/?belepes=1' : safeNext);
});

app.post('/api/session/logout', (_req, res) => {
  res.clearCookie(VOTER_COOKIE, { path: '/' });
  res.json({ ok: true });
});

/* ---------- admin oldalak ---------- */

app.get('/admin/login', view('admin-login.html'));
app.get('/admin', requireAdminPage, view('admin.html'));
app.get('/admin/eredmeny', requireAdminPage, view('admin-results.html'));
app.get('/admin/qr-kodok', requireAdminPage, view('admin-qr.html'));

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

// A QR kódok ebből a címből készülnek helyi futtatásnál.
await detectLanIp();

const server = app.listen(config.port, '0.0.0.0', () => {
  const teams = db.prepare('SELECT COUNT(*) AS c FROM teams').get().c;
  const voters = db.prepare('SELECT COUNT(*) AS c FROM voters').get().c;
  const ip = lanIp();

  console.log('');
  console.log(`  ${config.eventName} szavazóapp fut`);
  console.log('');

  if (config.publicBaseUrl) {
    console.log(`  Nyilvános cím:  ${config.publicBaseUrl}`);
  } else if (ip) {
    console.log(`  TELEFONRÓL:     http://${ip}:${config.port}`);
    console.log('                  A QR kódokba is ez a cím kerül.');
  } else {
    console.log('  Nem találtam hálózati címet, a QR kódok a kérés hosztjából készülnek.');
  }

  console.log(`  Ezen a gépen:   http://localhost:${config.port}`);
  console.log(`  Admin:          http://${ip || 'localhost'}:${config.port}/admin`);

  const tobbi = localIps().filter((a) => a.ip !== ip);
  if (tobbi.length) {
    console.log('');
    console.log('  Ha nem jó a fenti cím, próbáld ezeket:');
    for (const a of tobbi) console.log(`    http://${a.ip}:${config.port}   (${a.name})`);
  }

  console.log('');
  console.log(`  Csapatok: ${teams}   szavazó cetli: ${voters}`);
  console.log(`  Adatbázis: ${config.dbFile}`);
  if (config.adminPassword === 'nitrogames') {
    console.log('  FIGYELEM: alapértelmezett admin jelszó, állítsd be az ADMIN_PASSWORD-ot.');
  }
  console.log('');
});


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
