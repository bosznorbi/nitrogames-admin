import express from 'express';
import { config, baseUrl } from '../config.js';
import { db, getBool, getSetting, teamLabel } from '../db.js';
import { VOTER_COOKIE, requireVoter, rateLimit, voterCookieOpts } from '../middleware/auth.js';
import { normalizeCode } from '../lib/ids.js';

export const publicRouter = express.Router();

const activeCriteria = () =>
  db.prepare('SELECT * FROM criteria WHERE active = 1 ORDER BY position, id').all();

/**
 * A csempe adatai. Szandekosan NEM adjuk vissza a szavazolap cimet: a
 * fooldalrol nem lehet atmenni szavazni, csak a csapat QR kodjaval.
 */
function tile(t, voted) {
  return {
    public_id: t.public_id,
    number: t.number,
    label: teamLabel(t),
    accent_color: t.accent_color || '#7c5cff',
    icon_url: t.icon_file ? `/uploads/${t.icon_file}` : null,
    voted,
  };
}

publicRouter.get('/config', (req, res) => {
  res.json({
    event_name: getSetting('event_name') || config.eventName,
    ready_text: getSetting('ready_text'),
    voting_open: getBool('voting_open'),
    allow_comments: getBool('allow_comments'),
    authenticated: Boolean(req.voter),
    criteria: activeCriteria().map((c) => ({
      key: c.key,
      label: c.label,
      description: c.description,
      min: c.min_score,
      max: c.max_score,
    })),
  });
});

/** Belepes a papirra nyomtatott kóddal, ha a QR nem olvasodik be. */
publicRouter.post(
  '/session/code',
  rateLimit({ windowMs: 60000, max: 20 }),
  (req, res) => {
    const code = normalizeCode(req.body && req.body.code);
    if (!code) return res.status(400).json({ error: 'missing_code', message: 'Írd be a kódot a papírkádról.' });
    const voter = db.prepare('SELECT * FROM voters WHERE code = ?').get(code);
    if (!voter) return res.status(404).json({ error: 'unknown_code', message: 'Nincs ilyen kód. Ellenőrizd a papírkádat.' });
    res.cookie(VOTER_COOKIE, voter.token, voterCookieOpts());
    db.prepare("UPDATE voters SET is_activated = 1, last_seen_at = datetime('now') WHERE id = ?").run(voter.id);
    res.json({ ok: true });
  }
);

/** A fooldal: a csempek es a haladas. */
publicRouter.get('/home', requireVoter, (req, res) => {
  const teams = db.prepare('SELECT * FROM teams WHERE active = 1 ORDER BY number').all();
  const voted = new Set(
    db.prepare('SELECT team_id FROM submissions WHERE voter_id = ?').all(req.voter.id).map((r) => r.team_id)
  );
  const tiles = teams.map((t) => tile(t, voted.has(t.id)));
  res.json({
    event_name: getSetting('event_name') || config.eventName,
    ready_text: getSetting('ready_text'),
    voting_open: getBool('voting_open'),
    done: tiles.filter((t) => t.voted).length,
    total: tiles.length,
    teams: tiles,
  });
});

/** Egy csapat szavazolapja. Csak a QR-bol szarmazo public_id-vel erheto el. */
publicRouter.get('/teams/:publicId', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE public_id = ?').get(req.params.publicId);
  if (!team || !team.active) return res.status(404).json({ error: 'team_not_found' });

  const myScores = {};
  let myComment = null;
  if (req.voter) {
    const rows = db
      .prepare(
        'SELECT c.key AS key, v.score AS score FROM votes v JOIN criteria c ON c.id = v.criterion_id WHERE v.voter_id = ? AND v.team_id = ?'
      )
      .all(req.voter.id, team.id);
    for (const r of rows) myScores[r.key] = r.score;
    const sub = db
      .prepare('SELECT comment FROM submissions WHERE voter_id = ? AND team_id = ?')
      .get(req.voter.id, team.id);
    myComment = sub ? sub.comment : null;
  }

  res.json({
    team: {
      public_id: team.public_id,
      number: team.number,
      name: team.name || null,
      game_name: team.game_name || null,
      label: teamLabel(team),
      tagline: team.tagline || null,
      description: team.description || null,
      accent_color: team.accent_color || '#7c5cff',
      background_url: team.background_file ? `/uploads/${team.background_file}` : null,
    },
    voting_open: getBool('voting_open'),
    allow_comments: getBool('allow_comments'),
    authenticated: Boolean(req.voter),
    criteria: activeCriteria().map((c) => ({
      key: c.key,
      label: c.label,
      description: c.description,
      min: c.min_score,
      max: c.max_score,
    })),
    my_scores: myScores,
    my_comment: myComment,
    already_voted: Object.keys(myScores).length > 0,
  });
});

publicRouter.post(
  '/teams/:publicId/vote',
  requireVoter,
  rateLimit({ windowMs: 60000, max: 60, key: (req) => (req.voter ? req.voter.id : req.ip) }),
  (req, res) => {
    if (!getBool('voting_open')) {
      return res.status(423).json({ error: 'voting_closed', message: 'A szavazás jelenleg zárva.' });
    }
    const team = db.prepare('SELECT * FROM teams WHERE public_id = ?').get(req.params.publicId);
    if (!team || !team.active) return res.status(404).json({ error: 'team_not_found' });

    const criteria = activeCriteria();
    const scores = req.body && req.body.scores;
    if (!scores || typeof scores !== 'object') {
      return res.status(400).json({ error: 'missing_scores', message: 'Hiányoznak a pontszámok.' });
    }

    const rows = [];
    for (const c of criteria) {
      const raw = scores[c.key];
      if (raw === undefined || raw === null || raw === '') {
        if (getBool('require_all_criteria')) {
          return res.status(400).json({
            error: 'incomplete',
            message: `Minden szempontot pontozz, hiányzik: ${c.label}`,
            criterion: c.key,
          });
        }
        continue;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < c.min_score || n > c.max_score) {
        return res.status(400).json({
          error: 'invalid_score',
          message: `Érvénytelen pontszám ennél: ${c.label} (${c.min_score}-${c.max_score})`,
          criterion: c.key,
        });
      }
      rows.push({ criterion_id: c.id, score: n });
    }
    if (!rows.length) {
      return res.status(400).json({ error: 'missing_scores', message: 'Nincs egyetlen pontszám sem.' });
    }

    const comment = getBool('allow_comments')
      ? String((req.body && req.body.comment) || '').trim().slice(0, 500) || null
      : null;

    const upVote = db.prepare(
      `INSERT INTO votes (voter_id, team_id, criterion_id, score) VALUES (?, ?, ?, ?)
       ON CONFLICT(voter_id, team_id, criterion_id)
       DO UPDATE SET score = excluded.score, updated_at = datetime('now')`
    );
    const upSub = db.prepare(
      `INSERT INTO submissions (voter_id, team_id, comment) VALUES (?, ?, ?)
       ON CONFLICT(voter_id, team_id)
       DO UPDATE SET comment = excluded.comment, updated_at = datetime('now')`
    );
    db.transaction(() => {
      for (const r of rows) upVote.run(req.voter.id, team.id, r.criterion_id, r.score);
      upSub.run(req.voter.id, team.id, comment);
    })();

    res.json({ ok: true, public_id: team.public_id });
  }
);
