/**
 * Vegigmegy a teljes folyamaton es a hatareseteken egy FUTO szerver ellen.
 * Adatot ir, ezert csak fejlesztoi peldanyon futtasd.
 *
 *   npm start            # masik terminalban
 *   npm test
 *
 * Mas cim vagy jelszo:  BASE=http://localhost:4000 ADMIN_PASSWORD=... npm test
 */
import 'dotenv/config';
import zlib from 'node:zlib';

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/+$/, '');
const PASSWORD = process.env.ADMIN_PASSWORD || 'nitrogames';

if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(BASE) && !process.argv.includes('--force')) {
  console.log(`A teszt adatot ír. Nem localhost cím: ${BASE}`);
  console.log('Ha tényleg ezt akarod, add hozzá a --force kapcsolót.');
  process.exit(1);
}

let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  HIBA  ${name}  ${detail}`); }
}

class Session {
  constructor() { this.cookies = new Map(); }
  async fetch(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
      opts.method = opts.method || 'POST';
    }
    const res = await fetch(BASE + path, { ...opts, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const type = res.headers.get('content-type') || '';
    let body;
    if (opts.binary) body = Buffer.from(await res.arrayBuffer());
    else body = type.includes('json') ? await res.json().catch(() => null) : await res.text();
    return { status: res.status, body, type, location: res.headers.get('location') };
  }
}

/** Egyszinu PNG adott meretben, hogy a feltoltest is tesztelni tudjuk. */
function makePng(w, h) {
  const crc32 = (buf) => {
    let c;
    let crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
      c = (crc ^ buf[n]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = c ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) raw[y * (1 + w * 3)] = 0;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

/* ================================================================= */

const admin = new Session();

console.log('\n--- admin ---');
check('rossz jelszó elutasítva', (await admin.fetch('/api/admin/login', { json: { password: 'rossz' } })).status === 401);
check('bejelentkezés', (await admin.fetch('/api/admin/login', { json: { password: PASSWORD } })).status === 200);
check('admin oldal jelszó nélkül átirányít', (await new Session().fetch('/admin')).status === 302);
check('admin api jelszó nélkül 401', (await new Session().fetch('/api/admin/overview')).status === 401);

console.log('\n--- alapallapot ---');
// Ismert allapotbol indulunk: minden csapatot es nem-teszt szavazot torlunk.
for (const t of (await admin.fetch('/api/admin/teams')).body.teams) {
  await admin.fetch(`/api/admin/teams/${t.id}`, { method: 'DELETE' });
}
for (const v of (await admin.fetch('/api/admin/voters')).body.voters) {
  if (!v.is_test) await admin.fetch(`/api/admin/voters/${v.id}`, { method: 'DELETE' });
}
await admin.fetch('/api/admin/teams', { json: { count: 9 } });
await admin.fetch('/api/admin/voters', { json: { count: 12 } });
// A teszt allitsa be a sajat elofeltetelet, ne fuggjon az aktualis beallitasoktol.
await admin.fetch('/api/admin/settings', {
  method: 'PUT',
  json: { voting_open: true },
});

const overview = await admin.fetch('/api/admin/overview');
check('9 csapat létrejött', overview.body.counts.teams === 9);
check('a teszt kód mindig létezik', overview.body.test_code === 'TESZT');

const teamsRes = await admin.fetch('/api/admin/teams');
const teams = teamsRes.body.teams;
check('csapat kódja XXXX-XXXX alakú', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(teams[0].code), teams[0].code);
check('szavazólap címe kitalálhatatlan', !/csapat-\d/.test(teams[0].vote_url), teams[0].vote_url);
check('a csapatnak alapból nincs neve bevésve', teams[0].name === null);
check('kezdetben egy csapat sincs kész', teams.every((t) => !t.ready));

const votersRes = await admin.fetch('/api/admin/voters');
const codes = votersRes.body.voters.map((v) => v.code);
check('TESZT kód a listában van', codes.includes('TESZT'));
check('a többi kód 4 betű', codes.filter((c) => c !== 'TESZT').every((c) => /^[A-Z]{4}$/.test(c)), codes.slice(0, 4).join(','));

console.log('\n--- szavazoi belepes ---');
const teszt = new Session();
check('TESZT kóddal be lehet lépni', (await teszt.fetch('/api/session/code', { json: { code: 'TESZT' } })).status === 200);
check('kisbetűvel is', (await new Session().fetch('/api/session/code', { json: { code: 'teszt' } })).status === 200);
check('ismeretlen kód 404', (await new Session().fetch('/api/session/code', { json: { code: 'ZZZZ' } })).status === 404);
check('névvel belépés megszűnt', (await new Session().fetch('/api/session/join', { json: { name: 'Valaki' } })).status === 404);

const qrLogin = new Session();
const loginUrl = new URL(votersRes.body.voters.find((v) => v.code !== 'TESZT').login_url).pathname;
const redir = await qrLogin.fetch(loginUrl);
check('QR belépés a főoldalra visz', redir.status === 302 && redir.location.startsWith('/?belepes='));

console.log('\n--- fooldal ---');
check('főoldal belépés nélkül 401', (await new Session().fetch('/api/home')).status === 401);
const home = await teszt.fetch('/api/home');
check('főoldal 9 csempét ad', home.body.teams.length === 9);
check('kezdetben egy csempe sincs kipipálva', home.body.done === 0);
check('a csempék nem adnak szavazó linket', !JSON.stringify(home.body.teams[0]).includes('/t/'));
check('a főoldal tudja az esemény nevét', typeof home.body.event_name === 'string' && home.body.event_name.length > 0);

console.log('\n--- csapat API ---');
const code = teams[0].code;
const headers = { authorization: `Bearer ${code}` };
const teamApi = new Session();

check('kód nélkül 401', (await teamApi.fetch('/api/csapat')).status === 401);
check('rossz kóddal 403', (await teamApi.fetch('/api/csapat', { headers: { authorization: 'Bearer ROSSZKOD' } })).status === 403);
check('kötőjel nélkül is jó', (await teamApi.fetch('/api/csapat', { headers: { authorization: `Bearer ${code.replace('-', '')}` } })).status === 200);
check('kisbetűvel is jó', (await teamApi.fetch('/api/csapat', { headers: { authorization: `Bearer ${code.toLowerCase()}` } })).status === 200);
check('?kod= paraméterrel is', (await teamApi.fetch(`/api/csapat?kod=${code}`)).status === 200);

const status0 = await teamApi.fetch('/api/csapat/allapot', { headers });
check('készültség: még nincs kész', status0.body.kesz === false);
check('készültség: 6 kötelező elem', status0.body.osszesen === 6);
check('készültség: van következő lépés', Boolean(status0.body.kovetkezo_lepes?.teendo), status0.body.kovetkezo_lepes?.teendo);

await teamApi.fetch('/api/csapat', {
  method: 'PUT', headers,
  json: { csapatnev: 'Kávészünet', jatek_neve: 'Űrpatkányok bosszúja', leiras: 'Két játékos, egy perc.', szin: '#ff5c8a' },
});
check('rossz szín elutasítva',
  (await teamApi.fetch('/api/csapat', { method: 'PUT', headers, json: { szin: 'piros' } })).status === 400);

const bg = makePng(1080, 1920);
const icon = makePng(640, 768);
check('háttérkép feltöltés',
  (await teamApi.fetch('/api/csapat/hatterkep', { method: 'POST', headers: { ...headers, 'content-type': 'image/png' }, body: bg })).status === 200);
check('rossz méret elutasítva',
  (await teamApi.fetch('/api/csapat/csempekep', { method: 'POST', headers: { ...headers, 'content-type': 'image/png' }, body: bg })).status === 422);
check('csempekép feltöltés',
  (await teamApi.fetch('/api/csapat/csempekep', { method: 'POST', headers: { ...headers, 'content-type': 'image/png' }, body: icon })).status === 200);
check('nem kép elutasítva',
  (await teamApi.fetch('/api/csapat/csempekep', { method: 'POST', headers: { ...headers, 'content-type': 'image/png' }, body: Buffer.from('ez nem kep, csak hosszabb szoveg') })).status === 415);

const qr = await teamApi.fetch('/api/csapat/qr?format=json', { headers });
check('QR lekérés', qr.status === 200 && qr.body.szavazolap_url.includes('/t/'));

const status1 = await teamApi.fetch('/api/csapat/allapot', { headers });
check('készültség: minden megvan', status1.body.kesz === true, JSON.stringify(status1.body.hianyzik));
check('nincs második csempekép végpont',
  (await teamApi.fetch('/api/csapat/csempekep-kesz', { method: 'POST', headers: { ...headers, 'content-type': 'image/png' }, body: icon })).status === 404);
check('a QR lekérés is bejelölődött', status1.body.kesz_elemek.includes('qr_letoltve'));
check('csapat nem látja a szavazatokat', (await teamApi.fetch('/api/csapat/szavazatok', { headers })).status === 403);
check('ismeretlen végpont felsorolja a jókat',
  ((await teamApi.fetch('/api/csapat/nincsilyen', { headers })).body?.vegpontok || []).length > 0);

console.log('\n--- szavazas ---');
const votePublicId = new URL(qr.body.szavazolap_url).pathname.split('/')[2];
const page = await teszt.fetch(`/api/teams/${votePublicId}`);
check('szavazólap betölt', page.status === 200 && page.body.team.label === 'Űrpatkányok bosszúja');
check('a csapat leírása megjelenik', page.body.team.description === 'Két játékos, egy perc.');
check('kitalált azonosítóra 404', (await teszt.fetch('/api/teams/kitalaltazonosito')).status === 404);

const scores = Object.fromEntries(page.body.criteria.map((c) => [c.key, c.max]));
const voted = await teszt.fetch(`/api/teams/${votePublicId}/vote`, { method: 'POST', json: { scores, comment: 'Ütős!' } });
check('szavazat mentése', voted.status === 200 && voted.body.public_id === votePublicId);
check('részleges szavazat is elmenthető',
  (await teszt.fetch(`/api/teams/${votePublicId}/vote`, { method: 'POST', json: { scores: { feeling: 3 } } })).status === 200);
check('üres szavazat elutasítva',
  (await teszt.fetch(`/api/teams/${votePublicId}/vote`, { method: 'POST', json: { scores: {} } })).status === 400);
check('belépés nélkül nem lehet szavazni',
  (await new Session().fetch(`/api/teams/${votePublicId}/vote`, { method: 'POST', json: { scores } })).status === 401);

const home2 = await teszt.fetch('/api/home');
check('a főoldalon kipipálódott', home2.body.done === 1);
check('a kipipált csempe a jó', home2.body.teams.find((t) => t.public_id === votePublicId).voted === true);
check('a csempekép megjelenik', Boolean(home2.body.teams.find((t) => t.public_id === votePublicId).icon_url));

await admin.fetch('/api/admin/settings', { method: 'PUT', json: { voting_open: false } });
check('zárt szavazásnál 423',
  (await teszt.fetch(`/api/teams/${votePublicId}/vote`, { method: 'POST', json: { scores } })).status === 423);
await admin.fetch('/api/admin/settings', { method: 'PUT', json: { voting_open: true } });

console.log('\n--- nullazas nem torli a kinyomtatott kodokat ---');
const elotte = (await admin.fetch('/api/admin/teams')).body.teams.map((t) => `${t.number}:${t.code}:${t.public_id}`);
const voterElotte = (await admin.fetch('/api/admin/voters')).body.voters.map((v) => v.code).sort();

await admin.fetch('/api/admin/reset', { json: { confirm: 'TOROL', scope: 'all' } });

const utana = (await admin.fetch('/api/admin/teams')).body.teams;
check('a csapatkódok és QR azonosítók változatlanok',
  JSON.stringify(utana.map((t) => `${t.number}:${t.code}:${t.public_id}`)) === JSON.stringify(elotte));
check('a szavazói cetlik megmaradtak',
  JSON.stringify((await admin.fetch('/api/admin/voters')).body.voters.map((v) => v.code).sort()) === JSON.stringify(voterElotte));
check('a csapatok feltöltött tartalma viszont törlődött', utana.every((t) => t.name === null && !t.icon_url));
check('a szavazatok is törlődtek', (await admin.fetch('/api/admin/results')).body.stats.votes === 0);
check('az új kód végpont megszűnt',
  (await admin.fetch(`/api/admin/teams/${utana[0].id}/new-code`, { method: 'POST' })).status === 404);

console.log('\n--- halozati cim es QR oldal ---');
const halo = await admin.fetch('/api/admin/halozat/frissites', { method: 'POST' });
check('a hálózati cím újra felismerhető', halo.status === 200 && typeof halo.body.base_url === 'string');
check('a frissítés megmondja, változott-e', typeof halo.body.valtozott === 'boolean');
check('QR oldal belépve elérhető', (await admin.fetch('/admin/qr-kodok')).status === 200);
check('QR oldal jelszó nélkül átirányít', (await new Session().fetch('/admin/qr-kodok')).status === 302);
check('a frissítés jelszó nélkül tiltott',
  (await new Session().fetch('/api/admin/halozat/frissites', { method: 'POST' })).status === 401);

console.log('\n--- PDF ---');
const vPdf = await admin.fetch('/api/admin/print/voters.pdf?cols=4', { binary: true });
check('szavazói PDF', vPdf.status === 200 && vPdf.body.subarray(0, 5).toString() === '%PDF-');
const cetliDb = (await admin.fetch('/api/admin/voters')).body.voters.length;
check('szavazói PDF oldalszáma (16 / A4)', pdfPages(vPdf.body) === Math.ceil(cetliDb / 16), `${pdfPages(vPdf.body)} oldal / ${cetliDb} cetli`);
const tPdf = await admin.fetch('/api/admin/print/teams.pdf', { binary: true });
check('csapat PDF', tPdf.status === 200 && tPdf.body.subarray(0, 5).toString() === '%PDF-');
const aktivCsapat = (await admin.fetch('/api/admin/overview')).body.counts.teams;
check('csapat PDF három per lap', pdfPages(tPdf.body) === Math.ceil(aktivCsapat / 3), `${pdfPages(tPdf.body)} oldal / ${aktivCsapat} csapat`);
check('PDF jelszó nélkül nem érhető el', (await new Session().fetch('/api/admin/print/teams.pdf')).status === 401);
check('CSV export megszűnt', (await admin.fetch('/api/admin/export/votes.csv')).status === 404);

console.log('\n--- eredmenyek ---');
const results = await admin.fetch('/api/admin/results');
check('eredmények számolódnak', results.body.ranking.length === 9);
check('nullázás után nincs pontszám', results.body.ranking.every((t) => t.total_pct === null));


console.log('\n--- beegetett szabalyok es szavazoszam ---');
const cfg = (await new Session().fetch('/api/config')).body;
check('a megjegyzés engedélyezett', cfg.allow_comments === true);
check('nincs több állítható szöveg', cfg.ready_text === undefined);

await admin.fetch('/api/admin/voters', { json: { count: 5 } });
const kevesebb = (await admin.fetch('/api/admin/voters')).body.voters;
check('a szavazószám pontosan beállítható', kevesebb.filter((v) => !v.is_test).length === 5,
  String(kevesebb.filter((v) => !v.is_test).length));
check('a TESZT kód a csökkentést is túléli', kevesebb.some((v) => v.is_test));
await admin.fetch('/api/admin/voters', { json: { count: 12 } });

console.log('\n--- holtverseny ---');
const rang = (await admin.fetch('/api/admin/results')).body.ranking.filter((t) => t.rank !== null);
const helyek = [...new Set(rang.map((t) => t.rank))].sort((a, b) => a - b);
check('a helyezések hézagmentesek', helyek.every((h, i) => h === i + 1), helyek.join(','));

console.log('\n--- oldalak ---');
for (const [path, expect] of [
  ['/', 200], ['/belepes', 200], ['/csapat', 200], [`/t/${votePublicId}`, 200],
  ['/join', 302], ['/team', 302], ['/me', 404], ['/nincsilyen', 404], ['/api/nincs', 404],
]) {
  const r = await new Session().fetch(path);
  check(`${path} -> ${expect}`, r.status === expect, `kapott: ${r.status}`);
}

console.log(`\n${pass} rendben, ${fail} hiba\n`);
process.exit(fail ? 1 : 0);
