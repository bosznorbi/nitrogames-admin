import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, baseUrl } from '../config.js';
import { allSettings, createTeam, createVoters, db, getBool, setSetting } from '../db.js';
import { ADMIN_COOKIE, adminCookieOpts, rateLimit, requireAdmin, signAdminSession } from '../middleware/auth.js';
import { apiKey, safeEqual, slugify } from '../lib/ids.js';
import { qrPngBuffer, qrSvg } from '../lib/qr.js';
import { teamsPdf, votersPdf } from '../lib/pdf.js';

export const adminRouter = express.Router();

const EDITABLE_SETTINGS = [
  'voting_open',
  'results_public',
  'allow_self_vote',
  'require_all_criteria',
  'allow_comments',
  'allow_self_register',
  'event_name',
  'intro_text',
];

/* ---------- session ---------- */

adminRouter.post(
  '/login',
  rateLimit({ windowMs: 60000, max: 10 }),
  (req, res) => {
    const password = String((req.body && req.body.password) || '');
    if (!safeEqual(password, config.adminPassword)) {
      return res.status(401).json({ error: 'bad_password', message: 'Hibás jelszó.' });
    }
    res.cookie(ADMIN_COOKIE, signAdminSession(), adminCookieOpts());
    res.json({ ok: true });
  }
);

adminRouter.post('/logout', (_req, res) => {
  res.clearCookie(ADMIN_COOKIE, { path: '/' });
  res.json({ ok: true });
});

adminRouter.use(requireAdmin);

/* ---------- attekintes es beallitasok ---------- */

adminRouter.get('/overview', (req, res) => {
  const one = (sql) => db.prepare(sql).get().c;
  res.json({
    settings: allSettings(),
    base_url: baseUrl(req),
    counts: {
      teams: one('SELECT COUNT(*) AS c FROM teams WHERE active = 1'),
      teams_total: one('SELECT COUNT(*) AS c FROM teams'),
      criteria: one('SELECT COUNT(*) AS c FROM criteria WHERE active = 1'),
      voters: one('SELECT COUNT(*) AS c FROM voters'),
      voters_activated: one('SELECT COUNT(*) AS c FROM voters WHERE is_activated = 1'),
      voters_voted: one('SELECT COUNT(DISTINCT voter_id) AS c FROM submissions'),
      submissions: one('SELECT COUNT(*) AS c FROM submissions'),
      votes: one('SELECT COUNT(*) AS c FROM votes'),
    },
    image_spec: config.image,
  });
});

adminRouter.put('/settings', (req, res) => {
  const body = req.body || {};
  const applied = {};
  for (const key of EDITABLE_SETTINGS) {
    if (!(key in body)) continue;
    let value = body[key];
    if (typeof value === 'boolean') value = value ? '1' : '0';
    value = String(value).slice(0, 500);
    setSetting(key, value);
    applied[key] = value;
  }
  res.json({ ok: true, applied, settings: allSettings() });
});

/* ---------- csapatok ---------- */

function teamRow(t, base) {
  return {
    id: t.id,
    slug: t.slug,
    number: t.number,
    name: t.name,
    game_name: t.game_name,
    tagline: t.tagline,
    description: t.description,
    accent_color: t.accent_color,
    active: Boolean(t.active),
    api_key: t.api_key,
    background_url: t.background_file ? `/uploads/${t.background_file}` : null,
    logo_url: t.logo_file ? `/uploads/${t.logo_file}` : null,
    vote_url: `${base}/t/${t.slug}`,
    qr_png: `/api/admin/qr?format=png&data=${encodeURIComponent(`${base}/t/${t.slug}`)}`,
    voters: db.prepare('SELECT COUNT(*) AS c FROM submissions WHERE team_id = ?').get(t.id).c,
    updated_at: t.updated_at,
  };
}

adminRouter.get('/teams', (req, res) => {
  const base = baseUrl(req);
  const teams = db.prepare('SELECT * FROM teams ORDER BY number').all();
  res.json({ teams: teams.map((t) => teamRow(t, base)) });
});

adminRouter.post('/teams', (req, res) => {
  const base = baseUrl(req);
  const body = req.body || {};

  if (body.count !== undefined) {
    const target = Number(body.count);
    if (!Number.isInteger(target) || target < 0 || target > 100) {
      return res.status(400).json({ error: 'invalid_count', message: 'A csapatszám 0 és 100 között legyen.' });
    }
    const existing = db.prepare('SELECT COUNT(*) AS c FROM teams').get().c;
    const created = [];
    for (let i = existing + 1; i <= target; i++) created.push(createTeam({ number: i }));
    return res.json({
      ok: true,
      created: created.length,
      teams: db.prepare('SELECT * FROM teams ORDER BY number').all().map((t) => teamRow(t, base)),
    });
  }

  const name = String(body.name || '').trim();
  const number = db.prepare('SELECT COALESCE(MAX(number), 0) AS m FROM teams').get().m + 1;
  let slug = body.slug ? slugify(body.slug) : `csapat-${number}`;
  if (db.prepare('SELECT 1 FROM teams WHERE slug = ?').get(slug)) slug = `${slug}-${number}`;
  const team = createTeam({ number, name: name || `${number}. csapat`, slug });
  res.json({ ok: true, team: teamRow(team, base) });
});

adminRouter.patch('/teams/:id', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'not_found' });
  const body = req.body || {};
  const fields = {};
  if ('name' in body) fields.name = String(body.name || '').trim().slice(0, 60) || team.name;
  if ('game_name' in body) fields.game_name = String(body.game_name || '').trim().slice(0, 60) || null;
  if ('tagline' in body) fields.tagline = String(body.tagline || '').trim().slice(0, 120) || null;
  if ('description' in body) fields.description = String(body.description || '').trim().slice(0, 600) || null;
  if ('accent_color' in body) fields.accent_color = String(body.accent_color || '').trim() || null;
  if ('active' in body) fields.active = body.active ? 1 : 0;

  const keys = Object.keys(fields);
  if (keys.length) {
    const sql = `UPDATE teams SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`;
    db.prepare(sql).run({ ...fields, id: team.id });
  }
  const fresh = db.prepare('SELECT * FROM teams WHERE id = ?').get(team.id);
  res.json({ ok: true, team: teamRow(fresh, baseUrl(req)) });
});

adminRouter.post('/teams/:id/rotate-key', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'not_found' });
  const key = apiKey();
  db.prepare("UPDATE teams SET api_key = ?, updated_at = datetime('now') WHERE id = ?").run(key, team.id);
  res.json({ ok: true, api_key: key });
});

adminRouter.delete('/teams/:id', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'not_found' });
  for (const f of [team.background_file, team.logo_file]) {
    if (f) fs.rm(path.join(config.uploadDir, f), { force: true }, () => {});
  }
  db.prepare('DELETE FROM teams WHERE id = ?').run(team.id);
  res.json({ ok: true });
});

/* ---------- szempontok ---------- */

adminRouter.get('/criteria', (_req, res) => {
  res.json({ criteria: db.prepare('SELECT * FROM criteria ORDER BY position, id').all() });
});

adminRouter.post('/criteria', (req, res) => {
  const body = req.body || {};
  const label = String(body.label || '').trim().slice(0, 60);
  if (!label) return res.status(400).json({ error: 'missing_label', message: 'Adj nevet a szempontnak.' });
  let key = slugify(body.key || label, 'szempont');
  if (db.prepare('SELECT 1 FROM criteria WHERE key = ?').get(key)) key = `${key}-${Date.now().toString(36).slice(-4)}`;
  const min = Number.isInteger(Number(body.min_score)) ? Number(body.min_score) : 1;
  const max = Number.isInteger(Number(body.max_score)) ? Number(body.max_score) : 5;
  if (max <= min || max - min > 100) {
    return res.status(400).json({ error: 'invalid_scale', message: 'A max pontszám legyen nagyobb a minimumnál.' });
  }
  const position = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM criteria').get().m + 1;
  const row = db
    .prepare(
      `INSERT INTO criteria (key, label, description, min_score, max_score, weight, position, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1) RETURNING *`
    )
    .get(key, label, String(body.description || '').trim().slice(0, 200) || null, min, max, Number(body.weight) || 1, position);
  res.json({ ok: true, criterion: row });
});

adminRouter.patch('/criteria/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM criteria WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  const body = req.body || {};
  const fields = {};
  if ('label' in body) fields.label = String(body.label || '').trim().slice(0, 60) || c.label;
  if ('description' in body) fields.description = String(body.description || '').trim().slice(0, 200) || null;
  if ('min_score' in body) fields.min_score = Number(body.min_score);
  if ('max_score' in body) fields.max_score = Number(body.max_score);
  if ('weight' in body) fields.weight = Number(body.weight) || 1;
  if ('position' in body) fields.position = Number(body.position) || 0;
  if ('active' in body) fields.active = body.active ? 1 : 0;

  const min = fields.min_score ?? c.min_score;
  const max = fields.max_score ?? c.max_score;
  if (!Number.isInteger(min) || !Number.isInteger(max) || max <= min || max - min > 100) {
    return res.status(400).json({ error: 'invalid_scale', message: 'Érvénytelen pontskála.' });
  }
  const keys = Object.keys(fields);
  if (keys.length) {
    db.prepare(`UPDATE criteria SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({
      ...fields,
      id: c.id,
    });
  }
  res.json({ ok: true, criterion: db.prepare('SELECT * FROM criteria WHERE id = ?').get(c.id) });
});

adminRouter.delete('/criteria/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM criteria WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  const used = db.prepare('SELECT COUNT(*) AS c FROM votes WHERE criterion_id = ?').get(c.id).c;
  if (used > 0 && !req.query.force) {
    return res.status(409).json({
      error: 'in_use',
      message: `Erre a szempontra már ${used} szavazat érkezett. Kapcsold inaktívra, vagy hívd force=1 paraméterrel.`,
    });
  }
  db.prepare('DELETE FROM criteria WHERE id = ?').run(c.id);
  res.json({ ok: true, deleted_votes: used });
});

/* ---------- szavazok ---------- */

adminRouter.get('/voters', (req, res) => {
  const base = baseUrl(req);
  const rows = db
    .prepare(
      `SELECT v.*, (SELECT COUNT(*) FROM submissions s WHERE s.voter_id = v.id) AS voted_teams
       FROM voters v ORDER BY v.id`
    )
    .all();
  res.json({
    voters: rows.map((v) => ({
      id: v.id,
      code: v.code,
      name: v.name,
      team_id: v.team_id,
      activated: Boolean(v.is_activated),
      voted_teams: v.voted_teams,
      login_url: `${base}/v/${v.token}`,
      last_seen_at: v.last_seen_at,
    })),
  });
});

adminRouter.post('/voters', (req, res) => {
  const count = Number((req.body && req.body.count) || 0);
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    return res.status(400).json({ error: 'invalid_count', message: '1 és 500 közötti darabszámot adj meg.' });
  }
  const created = createVoters(count);
  const base = baseUrl(req);
  res.json({
    ok: true,
    created: created.length,
    voters: created.map((v) => ({ id: v.id, code: v.code, login_url: `${base}/v/${v.token}` })),
  });
});

adminRouter.patch('/voters/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM voters WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'not_found' });
  const body = req.body || {};
  if ('name' in body) {
    db.prepare('UPDATE voters SET name = ? WHERE id = ?').run(String(body.name || '').trim().slice(0, 40) || null, v.id);
  }
  if ('team_id' in body) {
    const tid = body.team_id === null || body.team_id === '' ? null : Number(body.team_id);
    if (tid !== null && !db.prepare('SELECT 1 FROM teams WHERE id = ?').get(tid)) {
      return res.status(400).json({ error: 'bad_team' });
    }
    db.prepare('UPDATE voters SET team_id = ? WHERE id = ?').run(tid, v.id);
  }
  res.json({ ok: true, voter: db.prepare('SELECT * FROM voters WHERE id = ?').get(v.id) });
});

adminRouter.delete('/voters/:id', (req, res) => {
  db.prepare('DELETE FROM voters WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- eredmenyek ---------- */

function computeResults() {
  const criteria = db.prepare('SELECT * FROM criteria WHERE active = 1 ORDER BY position, id').all();
  const teams = db.prepare('SELECT * FROM teams WHERE active = 1 ORDER BY number').all();
  const weightSum = criteria.reduce((s, c) => s + (c.weight || 1), 0) || 1;

  const agg = db
    .prepare(
      `SELECT team_id, criterion_id, COUNT(*) AS n, AVG(score) AS avg, MIN(score) AS min, MAX(score) AS max
       FROM votes GROUP BY team_id, criterion_id`
    )
    .all();
  const map = new Map(agg.map((r) => [`${r.team_id}:${r.criterion_id}`, r]));

  const dist = db
    .prepare('SELECT team_id, criterion_id, score, COUNT(*) AS n FROM votes GROUP BY team_id, criterion_id, score')
    .all();
  const distMap = new Map();
  for (const d of dist) {
    const k = `${d.team_id}:${d.criterion_id}`;
    if (!distMap.has(k)) distMap.set(k, {});
    distMap.get(k)[d.score] = d.n;
  }

  const rows = teams.map((t) => {
    const perCriterion = criteria.map((c) => {
      const a = map.get(`${t.id}:${c.id}`);
      const avg = a ? a.avg : null;
      const span = c.max_score - c.min_score || 1;
      return {
        key: c.key,
        label: c.label,
        weight: c.weight,
        min: c.min_score,
        max: c.max_score,
        votes: a ? a.n : 0,
        avg: avg === null ? null : Number(avg.toFixed(3)),
        pct: avg === null ? null : Number((((avg - c.min_score) / span) * 100).toFixed(2)),
        distribution: distMap.get(`${t.id}:${c.id}`) || {},
      };
    });

    const scored = perCriterion.filter((p) => p.avg !== null);
    const weighted = scored.reduce((s, p) => s + p.pct * (p.weight || 1), 0);
    const usedWeight = scored.reduce((s, p) => s + (p.weight || 1), 0);

    return {
      team_id: t.id,
      slug: t.slug,
      number: t.number,
      name: t.name,
      game_name: t.game_name,
      accent_color: t.accent_color || '#7c5cff',
      background_url: t.background_file ? `/uploads/${t.background_file}` : null,
      voters: db.prepare('SELECT COUNT(*) AS c FROM submissions WHERE team_id = ?').get(t.id).c,
      criteria: perCriterion,
      score_sum: Number(scored.reduce((s, p) => s + p.avg, 0).toFixed(3)),
      total_pct: usedWeight ? Number((weighted / usedWeight).toFixed(2)) : null,
      coverage: Number(((usedWeight / weightSum) * 100).toFixed(0)),
    };
  });

  const ranked = [...rows].sort((a, b) => (b.total_pct ?? -1) - (a.total_pct ?? -1));
  ranked.forEach((r, i) => {
    r.rank = r.total_pct === null ? null : i + 1;
  });

  const categoryWinners = criteria.map((c) => {
    const best = [...rows]
      .filter((r) => r.criteria.find((p) => p.key === c.key)?.avg !== null)
      .sort((a, b) => {
        const av = a.criteria.find((p) => p.key === c.key).avg;
        const bv = b.criteria.find((p) => p.key === c.key).avg;
        return bv - av;
      })[0];
    return {
      key: c.key,
      label: c.label,
      winner: best
        ? {
            slug: best.slug,
            number: best.number,
            name: best.name,
            game_name: best.game_name,
            avg: best.criteria.find((p) => p.key === c.key).avg,
          }
        : null,
    };
  });

  return { criteria, teams: rows, ranking: ranked, category_winners: categoryWinners };
}

adminRouter.get('/results', (_req, res) => {
  const r = computeResults();
  res.json({
    ...r,
    stats: {
      voters_total: db.prepare('SELECT COUNT(*) AS c FROM voters').get().c,
      voters_voted: db.prepare('SELECT COUNT(DISTINCT voter_id) AS c FROM submissions').get().c,
      submissions: db.prepare('SELECT COUNT(*) AS c FROM submissions').get().c,
      votes: db.prepare('SELECT COUNT(*) AS c FROM votes').get().c,
      voting_open: getBool('voting_open'),
    },
  });
});

adminRouter.get('/results/matrix', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT v.id AS voter_id, v.code, v.name, t.slug, t.number, t.name AS team_name,
              c.key AS criterion, vo.score, vo.updated_at
       FROM votes vo
       JOIN voters v ON v.id = vo.voter_id
       JOIN teams t ON t.id = vo.team_id
       JOIN criteria c ON c.id = vo.criterion_id
       ORDER BY v.id, t.number, c.position`
    )
    .all();
  const comments = db
    .prepare(
      `SELECT v.code, v.name, t.slug, t.number, t.name AS team_name, s.comment, s.updated_at
       FROM submissions s JOIN voters v ON v.id = s.voter_id JOIN teams t ON t.id = s.team_id
       WHERE s.comment IS NOT NULL AND TRIM(s.comment) <> ''
       ORDER BY s.updated_at DESC`
    )
    .all();
  res.json({ rows, comments });
});

adminRouter.get('/export/votes.csv', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT v.code AS szavazo_kod, COALESCE(v.name, '') AS szavazo_nev,
              t.number AS csapat_szam, t.name AS csapat, COALESCE(t.game_name, '') AS jatek,
              c.key AS szempont_kulcs, c.label AS szempont, vo.score AS pont, vo.updated_at AS idopont
       FROM votes vo
       JOIN voters v ON v.id = vo.voter_id
       JOIN teams t ON t.id = vo.team_id
       JOIN criteria c ON c.id = vo.criterion_id
       ORDER BY t.number, v.code, c.position`
    )
    .all();
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = Object.keys(
    rows[0] || {
      szavazo_kod: '', szavazo_nev: '', csapat_szam: '', csapat: '', jatek: '',
      szempont_kulcs: '', szempont: '', pont: '', idopont: '',
    }
  );
  const csv = [header.join(';'), ...rows.map((r) => header.map((h) => esc(r[h])).join(';'))].join('\r\n');
  res.type('text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="nitrogames-szavazatok.csv"');
  res.send('﻿' + csv);
});

adminRouter.post('/reset-votes', (req, res) => {
  if (String((req.body && req.body.confirm) || '') !== 'TOROL') {
    return res.status(400).json({
      error: 'confirm_required',
      message: 'A törléshez küldd a { "confirm": "TOROL" } mezőt.',
    });
  }
  const before = db.prepare('SELECT COUNT(*) AS c FROM votes').get().c;
  db.transaction(() => {
    db.prepare('DELETE FROM votes').run();
    db.prepare('DELETE FROM submissions').run();
  })();
  res.json({ ok: true, deleted: before });
});

/* ---------- nyomtathato PDF-ek ---------- */

adminRouter.get('/print/voters.pdf', async (req, res, next) => {
  try {
    const base = baseUrl(req);
    const onlyNew = req.query.only_new === '1';
    const rows = db
      .prepare(`SELECT token, code, is_activated FROM voters ${onlyNew ? 'WHERE is_activated = 0' : ''} ORDER BY id`)
      .all();
    const voters = rows.map((v) => ({ code: v.code, login_url: `${base}/v/${v.token}` }));
    const pdf = await votersPdf(voters, {
      cols: Number(req.query.cols) || 4,
      host: new URL(base).host,
    });
    res.type('application/pdf');
    res.set('Content-Disposition', 'attachment; filename="nitrogames-szavazoi-belepok.pdf"');
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/print/teams.pdf', async (req, res, next) => {
  try {
    const base = baseUrl(req);
    const teams = db
      .prepare('SELECT number, name, game_name, slug FROM teams WHERE active = 1 ORDER BY number')
      .all()
      .map((t) => ({ ...t, vote_url: `${base}/t/${t.slug}` }));
    const pdf = await teamsPdf(teams);
    res.type('application/pdf');
    res.set('Content-Disposition', 'attachment; filename="nitrogames-csapat-tablak.pdf"');
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

/* ---------- QR generalas (admin only) ---------- */

adminRouter.get('/qr', async (req, res, next) => {
  try {
    const data = String(req.query.data || '');
    if (!data) return res.status(400).json({ error: 'missing_data' });
    const size = Math.min(Math.max(Number(req.query.size) || 512, 128), 2048);
    if (String(req.query.format) === 'svg') {
      res.type('image/svg+xml');
      return res.send(await qrSvg(data, { size }));
    }
    res.type('image/png');
    res.set('Cache-Control', 'private, max-age=300');
    res.send(await qrPngBuffer(data, { size }));
  } catch (err) {
    next(err);
  }
});
