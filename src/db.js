import Database from 'better-sqlite3';
import { config } from './config.js';
import { apiKey, humanCode, randomToken } from './lib/ids.js';

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
  slug            TEXT NOT NULL UNIQUE,
  number          INTEGER NOT NULL,
  name            TEXT NOT NULL,
  game_name       TEXT,
  tagline         TEXT,
  description     TEXT,
  accent_color    TEXT,
  background_file TEXT,
  logo_file       TEXT,
  api_key         TEXT NOT NULL UNIQUE,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS voters (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token        TEXT NOT NULL UNIQUE,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT,
  team_id      INTEGER REFERENCES teams(id) ON DELETE SET NULL,
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

/* ---------- settings ---------- */

const DEFAULT_SETTINGS = {
  voting_open: '0',
  results_public: '0',
  allow_self_vote: '0',
  require_all_criteria: '1',
  allow_comments: '1',
  allow_self_register: '1',
  event_name: config.eventName,
  intro_text: 'Pontozd a csapatok játékait! Olvasd be egy csapat QR-kódját, és értékeld.',
};

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

/* ---------- seed ---------- */

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
     VALUES (@key, @label, @description, 1, 5, 1, @position, 1)`
  );
  const tx = db.transaction((rows) => rows.forEach((r) => ins.run(r)));
  tx(DEFAULT_CRITERIA);
  return DEFAULT_CRITERIA.length;
}

const ACCENTS = ['#7c5cff', '#00d4ff', '#ff5c8a', '#ffb020', '#2ee6a8', '#ff7847', '#5b8cff', '#c46bff', '#00c2a8', '#ff4d6d', '#8ee34a', '#ff9ec4'];

export function createTeam({ number, name, slug }) {
  const n = number ?? (db.prepare('SELECT COALESCE(MAX(number), 0) AS m FROM teams').get().m + 1);
  return db
    .prepare(
      `INSERT INTO teams (slug, number, name, accent_color, api_key)
       VALUES (?, ?, ?, ?, ?) RETURNING *`
    )
    .get(slug || `csapat-${n}`, n, name || `${n}. csapat`, ACCENTS[(n - 1) % ACCENTS.length], apiKey());
}

export function ensureTeams(count) {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM teams').get().c;
  const created = [];
  for (let i = existing + 1; i <= count; i++) created.push(createTeam({ number: i }));
  return created;
}

export function createVoters(count) {
  const codes = new Set(db.prepare('SELECT code FROM voters').all().map((r) => r.code));
  const ins = db.prepare('INSERT INTO voters (token, code) VALUES (?, ?) RETURNING *');
  const out = [];
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      let code = humanCode(5);
      while (codes.has(code)) code = humanCode(5);
      codes.add(code);
      out.push(ins.get(randomToken(16), code));
    }
  });
  tx();
  return out;
}

seedCriteriaIfEmpty();
