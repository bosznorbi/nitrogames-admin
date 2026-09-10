import express from 'express';
import { config, baseUrl } from '../config.js';
import { createVoters, db, getBool, getSetting } from '../db.js';
import { VOTER_COOKIE, requireVoter, rateLimit, voterCookieOpts } from '../middleware/auth.js';

export const publicRouter = express.Router();

const activeCriteria = () =>
  db.prepare('SELECT * FROM criteria WHERE active = 1 ORDER BY position, id').all();

function teamPublic(t, req) {
  return {
    slug: t.slug,
    number: t.number,
    name: t.name,
    game_name: t.game_name || null,
    tagline: t.tagline || null,
    description: t.description || null,
    accent_color: t.accent_color || '#7c5cff',
    background_url: t.background_file ? `/uploads/${t.background_file}` : null,
    logo_url: t.logo_file ? `/uploads/${t.logo_file}` : null,
    vote_url: `${baseUrl(req)}/t/${t.slug}`,
    customized: Boolean(t.background_file || t.game_name || t.logo_file),
  };
}

publicRouter.get('/config', (req, res) => {
  res.json({
    event_name: getSetting('event_name') || config.eventName,
    intro_text: getSetting('intro_text'),
    voting_open: getBool('voting_open'),
    results_public: getBool('results_public'),
    allow_comments: getBool('allow_comments'),
    allow_self_register: getBool('allow_self_register'),
    voter: req.voter
      ? { code: req.voter.code, name: req.voter.name || null, team_id: req.voter.team_id }
      : null,
    criteria: activeCriteria().map((c) => ({
      key: c.key,
      label: c.label,
      description: c.description,
      min: c.min_score,
      max: c.max_score,
      weight: c.weight,
    })),
    image_spec: {
      background: { ...config.image.background, formats: config.image.formats },
      logo: { ...config.image.logo, formats: config.image.formats },
      max_bytes: config.image.maxBytes,
    },
  });
});

/**
 * Tartalek belepes: ha valaki nem tudja beolvasni a QR-jet, beirja a papiron
 * levo 5 karakteres kodot.
 */
publicRouter.post(
  '/session/code',
  rateLimit({ windowMs: 60000, max: 20 }),
  (req, res) => {
    const code = String((req.body && req.body.code) || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!code) return res.status(400).json({ error: 'missing_code', message: 'Írd be a kódot a papírkádról.' });
    const voter = db.prepare('SELECT * FROM voters WHERE code = ?').get(code);
    if (!voter) return res.status(404).json({ error: 'unknown_code', message: 'Nincs ilyen kód. Ellenőrizd a papírkádat.' });
    res.cookie(VOTER_COOKIE, voter.token, voterCookieOpts());
    db.prepare("UPDATE voters SET is_activated = 1, last_seen_at = datetime('now') WHERE id = ?").run(voter.id);
    res.json({ ok: true, voter: { code: voter.code, name: voter.name || null } });
  }
);

/** Onregisztracio: ha be van kapcsolva, barki letrehozhat maganak azonositot nevvel. */
publicRouter.post(
  '/session/join',
  rateLimit({ windowMs: 60000, max: 10 }),
  (req, res) => {
    if (!getBool('allow_self_register')) {
      return res.status(403).json({
        error: 'self_register_disabled',
        message: 'Az önálló belépés ki van kapcsolva, olvasd be a saját QR-kódodat.',
      });
    }
    const name = String((req.body && req.body.name) || '').trim().slice(0, 40);
    if (name.length < 2) {
      return res.status(400).json({ error: 'missing_name', message: 'Adj meg egy nevet (legalább 2 karakter).' });
    }
    const voter = createVoters(1)[0];
    db.prepare("UPDATE voters SET name = ?, is_activated = 1, last_seen_at = datetime('now') WHERE id = ?")
      .run(name, voter.id);
    res.cookie(VOTER_COOKIE, voter.token, voterCookieOpts());
    res.json({ ok: true, voter: { code: voter.code, name } });
  }
);

publicRouter.post('/session/name', requireVoter, (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 40);
  db.prepare('UPDATE voters SET name = ? WHERE id = ?').run(name || null, req.voter.id);
  res.json({ ok: true, name: name || null });
});

publicRouter.get('/teams', (req, res) => {
  const teams = db.prepare('SELECT * FROM teams WHERE active = 1 ORDER BY number').all();
  let votedSlugs = new Set();
  if (req.voter) {
    const rows = db
      .prepare('SELECT t.slug FROM submissions s JOIN teams t ON t.id = s.team_id WHERE s.voter_id = ?')
      .all(req.voter.id);
    votedSlugs = new Set(rows.map((r) => r.slug));
  }
  res.json({
    voting_open: getBool('voting_open'),
    teams: teams.map((t) => ({ ...teamPublic(t, req), voted: votedSlugs.has(t.slug) })),
  });
});

publicRouter.get('/teams/:slug', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE slug = ?').get(req.params.slug);
  if (!team || !team.active) return res.status(404).json({ error: 'team_not_found' });

  const criteria = activeCriteria();
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

  const isOwnTeam = Boolean(req.voter && req.voter.team_id && req.voter.team_id === team.id);
  res.json({
    team: teamPublic(team, req),
    voting_open: getBool('voting_open'),
    allow_comments: getBool('allow_comments'),
    authenticated: Boolean(req.voter),
    voter: req.voter ? { code: req.voter.code, name: req.voter.name || null } : null,
    own_team: isOwnTeam,
    can_vote: Boolean(req.voter) && getBool('voting_open') && (!isOwnTeam || getBool('allow_self_vote')),
    criteria: criteria.map((c) => ({
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
  '/teams/:slug/vote',
  requireVoter,
  rateLimit({ windowMs: 60000, max: 60, key: (req) => (req.voter ? req.voter.id : req.ip) }),
  (req, res) => {
    if (!getBool('voting_open')) {
      return res.status(423).json({ error: 'voting_closed', message: 'A szavazás jelenleg zárva.' });
    }
    const team = db.prepare('SELECT * FROM teams WHERE slug = ?').get(req.params.slug);
    if (!team || !team.active) return res.status(404).json({ error: 'team_not_found' });

    if (req.voter.team_id === team.id && !getBool('allow_self_vote')) {
      return res.status(403).json({ error: 'self_vote', message: 'A saját csapatodra nem szavazhatsz.' });
    }

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

    res.json({ ok: true, team: team.slug, saved: rows.length });
  }
);

publicRouter.get('/me', requireVoter, (req, res) => {
  const subs = db
    .prepare(
      `SELECT t.slug, t.number, t.name, t.game_name, s.comment, s.updated_at
       FROM submissions s JOIN teams t ON t.id = s.team_id
       WHERE s.voter_id = ? ORDER BY t.number`
    )
    .all(req.voter.id);
  const scores = db
    .prepare(
      `SELECT t.slug AS slug, c.key AS key, v.score AS score FROM votes v
       JOIN teams t ON t.id = v.team_id JOIN criteria c ON c.id = v.criterion_id
       WHERE v.voter_id = ?`
    )
    .all(req.voter.id);
  const bySlug = {};
  for (const s of scores) {
    if (!bySlug[s.slug]) bySlug[s.slug] = {};
    bySlug[s.slug][s.key] = s.score;
  }
  res.json({
    voter: { code: req.voter.code, name: req.voter.name || null },
    submissions: subs.map((s) => ({ ...s, scores: bySlug[s.slug] || {} })),
    total_teams: db.prepare('SELECT COUNT(*) AS c FROM teams WHERE active = 1').get().c,
  });
});
