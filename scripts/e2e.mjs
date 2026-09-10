/**
 * Vegigmegy a teljes folyamaton es a hatareseteken egy FUTO szerver ellen.
 * Adatot ir (szavazokat, szavazatokat hoz letre), ezert csak fejlesztoi
 * peldanyon futtasd.
 *
 *   npm start            # masik terminalban
 *   npm test
 *
 * Mas cim vagy jelszo:
 *   BASE=http://localhost:4000 ADMIN_PASSWORD=... npm test
 */
import 'dotenv/config';

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/+$/, '');
const PASSWORD = process.env.ADMIN_PASSWORD || 'nitrogames';

if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(BASE) && !process.argv.includes('--force')) {
  console.log(`A teszt adatot ir. Nem localhost cim: ${BASE}`);
  console.log('Ha tenyleg ezt akarod, add hozza a --force kapcsolot.');
  process.exit(1);
}

let pass = 0, fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  HIBA  ${name}  ${detail}`); }
}

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  async fetch(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.cookies.size) headers.cookie = this.header();
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

const admin = new Session();

console.log('\n--- admin ---');
check('rossz jelszo elutasitva', (await admin.fetch('/api/admin/login', { json: { password: 'rossz' } })).status === 401);
check('bejelentkezes', (await admin.fetch('/api/admin/login', { json: { password: PASSWORD } })).status === 200);
check('admin oldal jelszo nelkul atiranyit', (await new Session().fetch('/admin')).status === 302);
check('admin api jelszo nelkul 401', (await new Session().fetch('/api/admin/overview')).status === 401);
check('nyomtatas jelszo nelkul atiranyit', (await new Session().fetch('/admin/nyomtatas/szavazok')).status === 302);

const overview = await admin.fetch('/api/admin/overview');
check('attekintes betolt', overview.status === 200 && overview.body.counts.teams > 0);
const TEAMS = overview.body.counts.teams;

console.log('\n--- 1-10 skalaju szempont ---');
const crit = await admin.fetch('/api/admin/criteria', {
  method: 'POST',
  json: { label: 'Ujrajatszhatosag', min_score: 1, max_score: 10, weight: 2, description: 'Elovennéd megint?' },
});
check('1-10 skalaju szempont letrehozva', crit.status === 200 && crit.body.criterion.max_score === 10);
const critId = crit.body.criterion?.id;
check('rossz skala elutasitva',
  (await admin.fetch('/api/admin/criteria', { method: 'POST', json: { label: 'X', min_score: 5, max_score: 2 } })).status === 400);

console.log('\n--- szavazo belepes ---');
const voters = await admin.fetch('/api/admin/voters');
const v0 = voters.body.voters[5];
const alice = new Session();
const login = await alice.fetch(new URL(v0.login_url).pathname);
check('QR belepes atiranyit', login.status === 302 && login.location === '/');
const cfg = await alice.fetch('/api/config');
check('belepve a helyes szavazokent', cfg.body.voter?.code === v0.code);

const bob = new Session();
const byCode = await bob.fetch('/api/session/code', { json: { code: voters.body.voters[6].code } });
check('kod alapu belepes', byCode.status === 200);
check('ismeretlen kod 404', (await new Session().fetch('/api/session/code', { json: { code: 'ZZZZZ' } })).status === 404);

const carol = new Session();
const joined = await carol.fetch('/api/session/join', { json: { name: 'Teszt Elek' } });
check('onregisztracio nevvel', joined.status === 200 && joined.body.voter.name === 'Teszt Elek');
check('tul rovid nev elutasitva', (await new Session().fetch('/api/session/join', { json: { name: 'A' } })).status === 400);

console.log('\n--- szavazas ---');
const teamPage = await alice.fetch('/api/teams/csapat-2');
check('csapat betolt a szempontokkal', teamPage.status === 200 && teamPage.body.criteria.length === 6);

const fullScores = Object.fromEntries(teamPage.body.criteria.map((c) => [c.key, c.max]));
check('teljes szavazat mentheto',
  (await alice.fetch('/api/teams/csapat-2/vote', { method: 'POST', json: { scores: fullScores } })).status === 200);
check('1-10 skalan a 10 elfogadott', true);
check('1-10 skalan a 11 elutasitva',
  (await alice.fetch('/api/teams/csapat-2/vote', { method: 'POST', json: { scores: { ...fullScores, ujrajatszhatosag: 11 } } })).status === 400);
check('nem letezo csapat 404',
  (await alice.fetch('/api/teams/nincs-ilyen/vote', { method: 'POST', json: { scores: fullScores } })).status === 404);

console.log('\n--- sajat csapat ---');
const teams = await admin.fetch('/api/admin/teams');
const t3 = teams.body.teams[2];
const aliceId = voters.body.voters[5].id;
await admin.fetch(`/api/admin/voters/${aliceId}`, { method: 'PATCH', json: { team_id: t3.id } });
const selfVote = await alice.fetch(`/api/teams/${t3.slug}/vote`, { method: 'POST', json: { scores: fullScores } });
check('sajat csapatra nem lehet szavazni', selfVote.status === 403, `kapott: ${selfVote.status}`);
await admin.fetch('/api/admin/settings', { method: 'PUT', json: { allow_self_vote: true } });
check('engedelyezve mar lehet',
  (await alice.fetch(`/api/teams/${t3.slug}/vote`, { method: 'POST', json: { scores: fullScores } })).status === 200);
await admin.fetch('/api/admin/settings', { method: 'PUT', json: { allow_self_vote: false } });
await admin.fetch(`/api/admin/voters/${aliceId}`, { method: 'PATCH', json: { team_id: null } });

console.log('\n--- zart szavazas ---');
await admin.fetch('/api/admin/settings', { method: 'PUT', json: { voting_open: false } });
const closed = await alice.fetch('/api/teams/csapat-4/vote', { method: 'POST', json: { scores: fullScores } });
check('zart szavazasnal 423', closed.status === 423, `kapott: ${closed.status}`);
await admin.fetch('/api/admin/settings', { method: 'PUT', json: { voting_open: true } });

console.log('\n--- csapat API ---');
const key = t3.api_key;
const me = await new Session().fetch('/api/team/me', { headers: { authorization: `Bearer ${key}` } });
check('kulcs mukodik', me.status === 200 && me.body.team.slug === t3.slug);
check('X-API-Key fejlec is mukodik',
  (await new Session().fetch('/api/team/me', { headers: { 'x-api-key': key } })).status === 200);
check('csapat nem lathatja a szavazatokat',
  (await new Session().fetch('/api/team/me/votes', { headers: { authorization: `Bearer ${key}` } })).status === 403);
check('ismeretlen vegpont beszedes hibat ad',
  (await new Session().fetch('/api/team/me/nincs', { headers: { authorization: `Bearer ${key}` } })).body?.endpoints?.length > 0);
check('rossz szinkod elutasitva',
  (await new Session().fetch('/api/team/me', { method: 'PUT', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{"accent_color":"piros"}' })).status === 400);

console.log('\n--- eredmenyek ---');
const results = await admin.fetch('/api/admin/results');
check('eredmenyek szamolodnak', results.status === 200 && results.body.ranking.length === TEAMS);
const withVotes = results.body.teams.find((t) => t.total_pct !== null);
check('sulyozott pontszam 0-100 kozott', withVotes.total_pct >= 0 && withVotes.total_pct <= 100, `${withVotes.total_pct}`);
check('kategoriagyoztesek szempontonkent', results.body.category_winners.length === 6);
const csv = await admin.fetch('/api/admin/export/votes.csv');
check('CSV export', csv.status === 200 && csv.body.split('\r\n').length > 100);

console.log('\n--- nyomtathato PDF-ek ---');
const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

const votersPdfRes = await admin.fetch('/api/admin/print/voters.pdf?cols=4', { binary: true });
check('szavazoi PDF letoltheto', votersPdfRes.status === 200 && votersPdfRes.type.includes('pdf'));
check('szavazoi PDF ervenyes fejleccel', votersPdfRes.body.subarray(0, 5).toString() === '%PDF-');
const voterCount = (await admin.fetch('/api/admin/voters')).body.voters.length;
check('szavazoi PDF oldalszama stimmel (24 / lap)',
  pdfPages(votersPdfRes.body) === Math.ceil(voterCount / 24),
  `${pdfPages(votersPdfRes.body)} oldal ${voterCount} cetlihez`);

const teamsPdfRes = await admin.fetch('/api/admin/print/teams.pdf', { binary: true });
check('csapat PDF letoltheto', teamsPdfRes.status === 200 && teamsPdfRes.body.subarray(0, 5).toString() === '%PDF-');
check('csapat PDF ketto per lap',
  pdfPages(teamsPdfRes.body) === Math.ceil(TEAMS / 2),
  `${pdfPages(teamsPdfRes.body)} oldal ${TEAMS} csapathoz`);

const ownPdf = await new Session().fetch('/api/team/me/tabla.pdf', { binary: true, headers: { authorization: `Bearer ${key}` } });
check('csapat sajat tabla PDF-je', ownPdf.status === 200 && ownPdf.body.subarray(0, 5).toString() === '%PDF-');
check('PDF jelszo nelkul nem erheto el',
  (await new Session().fetch('/api/admin/print/teams.pdf')).status === 401);


console.log('\n--- takaritas ---');
await admin.fetch(`/api/admin/criteria/${critId}?force=1`, { method: 'DELETE' });
check('teszt szempont torolve', (await admin.fetch('/api/admin/criteria')).body.criteria.length === 5);

console.log('\n--- oldalak ---');
for (const [path, expect] of [['/', 200], ['/join', 200], ['/me', 200], ['/t/csapat-1', 200], ['/team', 200], ['/nincs-ilyen', 404], ['/api/nincs', 404]]) {
  const r = await new Session().fetch(path);
  check(`${path} -> ${expect}`, r.status === expect, `kapott: ${r.status}`);
}

console.log(`\n${pass} rendben, ${fail} hiba\n`);
process.exit(fail ? 1 : 0);
