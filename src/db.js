import Database from 'better-sqlite3';
import fs from 'node:fs';
import { config } from './config.js';
import { publicId, teamCode, voterCode, randomToken } from './lib/ids.js';
import { CSAPAT_KODOK, CETLI_KODOK } from './kodok.js';

/**
 * A csapatok azonositasa atallt olvashato slugrol kitalalhatatlan public_id-ra,
 * a hosszu API kulcs pedig papirrol begepelheto kodra. A regi sema oszlopai
 * NOT NULL-ok voltak, azokba az uj kod nem tud beszurni. Ilyenkor a regi
 * fajlt felretesszuk (nem toroljuk), es tiszta adatbazissal indulunk.
 */
function retireLegacyDatabase(file) {
  if (!fs.existsSync(file)) return;
  let legacy = false;
  const probe = new Database(file, { readonly: true });
  try {
    const cols = probe.prepare('PRAGMA table_info(teams)').all().map((c) => c.name);
    legacy = cols.length > 0 && (cols.includes('slug') || cols.includes('api_key'));
  } catch {
    legacy = false;
  } finally {
    probe.close();
  }
  if (!legacy) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = file.replace(/\.sqlite$/, '') + `-regi-${stamp}.sqlite`;
  fs.renameSync(file, target);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(file + suffix)) fs.rmSync(file + suffix, { force: true });
  }
  console.log(`  Régi sémájú adatbázist találtam, félretettem ide: ${target}`);
  console.log('  Tiszta adatbázissal indulok. A csapatokat és szavazókat generáld újra az adminban.');
}

retireLegacyDatabase(config.dbFile);

export const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id       TEXT NOT NULL UNIQUE,
  api_code        TEXT NOT NULL UNIQUE,
  number          INTEGER NOT NULL,
  name            TEXT,
  game_name       TEXT,
  tagline         TEXT,
  description     TEXT,
  accent_color    TEXT,
  background_file TEXT,
  icon_file       TEXT,
  qr_fetched_at   TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS voters (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token        TEXT NOT NULL UNIQUE,
  code         TEXT NOT NULL UNIQUE,
  is_activated INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS criteria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  description TEXT,
  min_score   INTEGER NOT NULL DEFAULT 1,
  max_score   INTEGER NOT NULL DEFAULT 5,
  weight      REAL NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS votes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  voter_id     INTEGER NOT NULL REFERENCES voters(id) ON DELETE CASCADE,
  team_id      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  criterion_id INTEGER NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
  score        INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (voter_id, team_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  voter_id   INTEGER NOT NULL REFERENCES voters(id) ON DELETE CASCADE,
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  comment    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (voter_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_team ON votes(team_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes(voter_id);
CREATE INDEX IF NOT EXISTS idx_submissions_team ON submissions(team_id);
`);

/* ---------- migracio ---------- */

/** Hianyzo oszlopokat pototl, hogy a korabbi adatbazis is tovabb eljen. */
function addColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

for (const [col, def] of [
  ['public_id', 'TEXT'],
  ['api_code', 'TEXT'],
  ['icon_file', 'TEXT'],
  ['qr_fetched_at', 'TEXT'],
]) {
  addColumn('teams', col, def);
}

// A regi peldanyokban meg lehet public_id vagy api_code nelkuli csapat.
for (const t of db.prepare('SELECT id, public_id, api_code FROM teams').all()) {
  if (!t.public_id) db.prepare('UPDATE teams SET public_id = ? WHERE id = ?').run(publicId(), t.id);
  if (!t.api_code) db.prepare('UPDATE teams SET api_code = ? WHERE id = ?').run(teamCode(), t.id);
}

/* ---------- settings ---------- */

/*
 * Egyetlen kapcsolo maradt az adminban: nyitva van-e a szavazas. A tobbi
 * viselkedes be van egetve, mert nem kell rajta allitani:
 *   - nem kotelezo minden szempontot kitolteni,
 *   - a szoveges megjegyzes megengedett, de nem kotelezo,
 *   - az esemeny neve a kornyezeti valtozobol jon.
 */
const DEFAULT_SETTINGS = {
  voting_open: '0',
};

export const RULES = {
  requireAllCriteria: false,
  allowComments: true,
};

// A korabbi, mar nem hasznalt beallitasok kitakaritasa.
db.prepare(`DELETE FROM settings WHERE key NOT IN ('voting_open')`).run();

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}

export function getBool(key) {
  return getSetting(key) === '1';
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

export function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

/* ---------- szempontok ---------- */

const DEFAULT_CRITERIA = [
  { key: 'jatekelmeny', label: 'Játékélmény', description: 'Mennyire szórakoztató ténylegesen játszani vele?', position: 1 },
  { key: 'feeling', label: 'Feeling', description: 'Design, hangulat, összkép: elvisz a játék világa?', position: 2 },
  { key: 'kreativitas', label: 'Kreativitás', description: 'Mennyire eredeti, meglepő az ötlet?', position: 3 },
  { key: 'megvalositas', label: 'Megvalósítás', description: 'Működik, kidolgozott, végigvihető?', position: 4 },
  { key: 'wow', label: 'Wow-faktor', description: '2 óra alatt ezt? Mennyire ejtett ámulatba?', position: 5 },
];

export function seedCriteriaIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM criteria').get().c;
  if (n > 0) return 0;
  const ins = db.prepare(
    `INSERT INTO criteria (key, label, description, min_score, max_score, weight, position, active)
     VALUES (@key, @label, @description, 1, 4, 1, @position, 1)`
  );
  db.transaction((rows) => rows.forEach((r) => ins.run(r)))(DEFAULT_CRITERIA);
  return DEFAULT_CRITERIA.length;
}

/* ---------- csapatok ---------- */

/*
 * Kilenc jol elkulonulo szin. Szandekosan tavol vannak egymastol a
 * szinkoron: nincs ket egymashoz kozeli kek vagy ket kozeli zold.
 */
const ACCENTS = [
  '#ff4d6d', // piros
  '#ffb020', // narancs
  '#ffe14d', // sárga
  '#5ce65c', // zöld
  '#00d4ff', // cián
  '#4d7cff', // kék
  '#a95cff', // lila
  '#ff5cc8', // rózsaszín
  '#00c2a8', // türkiz
  '#ff7847', // korall
  '#8ee34a', // limezöld
  '#c9a227', // arany
];

export function createTeam({ number } = {}) {
  const n = number ?? (db.prepare('SELECT COALESCE(MAX(number), 0) AS m FROM teams').get().m + 1);
  return db
    .prepare(
      `INSERT INTO teams (public_id, api_code, number, accent_color)
       VALUES (?, ?, ?, ?) RETURNING *`
    )
    .get(publicId(), teamCode(), n, ACCENTS[(n - 1) % ACCENTS.length]);
}

/** A csapat kifele hasznalt neve. A csapat sajat nevet ad magának, ez csak tartalek. */
export function teamLabel(team) {
  return team.game_name || team.name || `${team.number}. csapat`;
}

/* ---------- szavazok ---------- */

/** Tesztelesre beegetett kod, mintha ki lenne nyomtatva. Negy betu, mint a tobbi. */
export const TEST_CODE = 'TEST';

/** A korabbi otbetus kod. Regi adatbazisban meg ez all a sorban. */
const REGI_TEST_CODE = 'TESZT';

export function createVoters(count) {
  const taken = new Set(db.prepare('SELECT code FROM voters').all().map((r) => r.code));
  const ins = db.prepare('INSERT INTO voters (token, code) VALUES (?, ?) RETURNING *');
  const out = [];
  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      let code = voterCode();
      while (taken.has(code)) code = voterCode();
      taken.add(code);
      out.push(ins.get(randomToken(16), code));
    }
  })();
  return out;
}

export function ensureTestVoter() {
  const existing = db.prepare('SELECT * FROM voters WHERE code = ?').get(TEST_CODE);
  if (existing) return existing;
  return db
    .prepare('INSERT INTO voters (token, code) VALUES (?, ?) RETURNING *')
    .get(randomToken(16), TEST_CODE);
}

/**
 * A kinyomtatott kodok a kodbazisban allnak (src/kodok.js), nem az
 * adatbazisban keletkeznek. Igy egy uj adatbazis, egy nullazas vagy egy
 * elveszett volume utan is pontosan ugyanaz all vissza, es a mar kiosztott
 * papirok ervenyesek maradnak.
 *
 * Semmit nem torol: a meglevo sorokat a beegetett ertekre igazitja, a
 * hianyzokat letrehozza. A szavazatok a sorok id-jara hivatkoznak, azokat
 * nem bantjuk.
 */
function seedFixedCodes() {
  db.transaction(() => {
    for (const t of CSAPAT_KODOK) {
      const meglevo = db.prepare('SELECT * FROM teams WHERE number = ?').get(t.szam);
      const szin = ACCENTS[(t.szam - 1) % ACCENTS.length];
      if (!meglevo) {
        db.prepare(
          'INSERT INTO teams (public_id, api_code, number, accent_color) VALUES (?, ?, ?, ?)'
        ).run(t.publicId, t.kod, t.szam, szin);
      } else if (meglevo.api_code !== t.kod || meglevo.public_id !== t.publicId) {
        db.prepare("UPDATE teams SET api_code = ?, public_id = ?, updated_at = datetime('now') WHERE id = ?")
          .run(t.kod, t.publicId, meglevo.id);
      }
    }

    for (const v of CETLI_KODOK) {
      const meglevo = db.prepare('SELECT * FROM voters WHERE code = ?').get(v.kod);
      if (!meglevo) {
        db.prepare('INSERT INTO voters (token, code) VALUES (?, ?)').run(v.token, v.kod);
      } else if (meglevo.token !== v.token) {
        db.prepare('UPDATE voters SET token = ? WHERE id = ?').run(v.token, meglevo.id);
      }
    }
  })();
}

/**
 * A teszt kod otbetusrol negybetusre valtott. A regi sort atnevezzuk, nem
 * ujat keszitunk: igy a token megmarad, tehat a mar belepett telefon belepve
 * is marad. A negybetus kodot a generator is kiadhatja, ezert ha veletlenul
 * mar foglalt, a foglalo kap eloszor uj kodot.
 */
function migrateTestCode() {
  const regi = db.prepare('SELECT * FROM voters WHERE code = ?').get(REGI_TEST_CODE);
  if (!regi) return;

  db.transaction(() => {
    const utban = db.prepare('SELECT * FROM voters WHERE code = ?').get(TEST_CODE);
    if (utban) {
      const foglalt = new Set(db.prepare('SELECT code FROM voters').all().map((r) => r.code));
      let uj = voterCode();
      while (foglalt.has(uj)) uj = voterCode();
      db.prepare('UPDATE voters SET code = ? WHERE id = ?').run(uj, utban.id);
    }
    db.prepare('UPDATE voters SET code = ? WHERE id = ?').run(TEST_CODE, regi.id);
  })();
}

seedCriteriaIfEmpty();

// A skala 1-5-rol 1-4-re valtott. Az erintetlen alap szempontokat atallitjuk;
// amit kezzel modositottak, azt nem bantjuk.
db.prepare(
  `UPDATE criteria SET max_score = 4
   WHERE min_score = 1 AND max_score = 5 AND key IN (${DEFAULT_CRITERIA.map(() => '?').join(',')})`
).run(...DEFAULT_CRITERIA.map((c) => c.key));

migrateTestCode();
ensureTestVoter();
seedFixedCodes();
