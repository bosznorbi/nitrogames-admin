import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, baseUrl } from '../config.js';
import {
  allSettings, createTeam, createVoters, db, getBool, setSetting, teamLabel, TEST_CODE,
} from '../db.js';
import { ADMIN_COOKIE, adminCookieOpts, rateLimit, requireAdmin, signAdminSession } from '../middleware/auth.js';
import { formatCode, safeEqual, slugify } from '../lib/ids.js';
import { qrPngBuffer, qrSvg } from '../lib/qr.js';
import { teamSheetPdf, votersPdf } from '../lib/pdf.js';

export const adminRouter = express.Router();

const EDITABLE_SETTINGS = ['voting_open', 'require_all_criteria', 'allow_comments', 'event_name', 'ready_text'];

/* ---------- session ---------- */

adminRouter.post('/login', rateLimit({ windowMs: 60000, max: 10 }), (req, res) => {
  const password = String((req.body && req.body.password) || '');
  if (!safeEqual(password, config.adminPassword)) {
    return res.status(401).json({ error: 'bad_password', message: 'Hibás jelszó.' });
  }
  res.cookie(ADMIN_COOKIE, signAdminSession(), adminCookieOpts());
  res.json({ ok: true });
});

adminRouter.post('/logout', (_req, res) => {
  res.clearCookie(ADMIN_COOKIE, { path: '/' });
  res.json({ ok: true });
});

adminRouter.use(requireAdmin);

/* ---------- attekintes ---------- */

adminRouter.get('/overview', (req, res) => {
  const one = (sql) => db.prepare(sql).get().c;
  res.json({
    settings: allSettings(),
    base_url: baseUrl(req),
    test_code: TEST_CODE,
    counts: {
      teams: one('SELECT COUNT(*) AS c FROM teams WHERE active = 1'),
      teams_total: one('SELECT COUNT(*) AS c FROM teams'),
      teams_ready: one(`SELECT COUNT(*) AS c FROM teams WHERE active = 1
        AND name IS NOT NULL AND game_name IS NOT NULL AND description IS NOT NULL
        AND background_file IS NOT NULL AND icon_file IS NOT NULL AND qr_fetched_at IS NOT NULL`),
      criteria: one('SELECT COUNT(*) AS c FROM criteria WHERE active = 1'),
      voters: one('SELECT COUNT(*) AS c FROM voters'),
      voters_activated: one('SELECT COUNT(*) AS c FROM voters WHERE is_activated = 1'),
      voters_voted: one('SELECT COUNT(DISTINCT voter_id) AS c FROM submissions'),
      submissions: one('SELECT COUNT(*) AS c FROM submissions'),
      votes: one('SELECT COUNT(*) AS c FROM votes'),
    },
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
  const missing = [];
  if (!t.name) missing.push('csapatnév');
  if (!t.game_name) missing.push('játék neve');
  if (!t.description) missing.push('leírás');
  if (!t.background_file) missing.push('háttérkép');
  if (!t.icon_file) missing.push('csempekép');
  if (!t.qr_fetched_at) missing.push('QR lekérés');

  return {
    id: t.id,
    public_id: t.public_id,
    number: t.number,
    code: formatCode(t.api_code),
    name: t.name,
    game_name: t.game_name,
    label: teamLabel(t),
    accent_color: t.accent_color,
    active: Boolean(t.active),
    background_url: t.background_file ? `/uploads/${t.background_file}` : null,
    icon_url: t.icon_file ? `/uploads/${t.icon_file}` : null,
    vote_url: `${base}/t/${t.public_id}`,
    ready: missing.length === 0,
    missing,
    voters: db.prepare('SELECT COUNT(*) AS c FROM submissions WHERE team_id = ?').get(t.id).c,
  };
}

adminRouter.get('/teams', (req, res) => {
  const base = baseUrl(req);
  res.json({ teams: db.prepare('SELECT * FROM teams ORDER BY number').all().map((t) => teamRow(t, base)) });
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
    let created = 0;
    for (let i = existing + 1; i <= target; i++) {
      createTeam({ number: i });
      created++;
    }
    return res.json({
      ok: true,
      created,
      teams: db.prepare('SELECT * FROM teams ORDER BY number').all().map((t) => teamRow(t, base)),
    });
  }

  const team = createTeam();
  res.json({ ok: true, team: teamRow(team, base) });
});

adminRouter.patch('/teams/:id', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'not_found' });
  if ('active' in (req.body || {})) {
    db.prepare("UPDATE teams SET active = ?, updated_at = datetime('now') WHERE id = ?")
      .run(req.body.active ? 1 : 0, team.id);
  }
  const fresh = db.prepare('SELECT * FROM teams WHERE id = ?').get(team.id);
  res.json({ ok: true, team: teamRow(fresh, baseUrl(req)) });
});

adminRouter.delete('/teams/:id', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'not_found' });
  for (const f of [team.background_file, team.icon_file]) {
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
    db.prepare(`UPDATE criteria SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...fields, id: c.id });
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
      message: `Erre a szempontra már ${used} szavazat érkezett.`,
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
       FROM voters v ORDER BY (v.code = ?) DESC, v.id`
    )
    .all(TEST_CODE);
  res.json({
    test_code: TEST_CODE,
    voters: rows.map((v) => ({
      id: v.id,
      code: v.code,
      is_test: v.code === TEST_CODE,
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
  res.json({ ok: true, created: created.length });
});

adminRouter.delete('/voters/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM voters WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'not_found' });
  if (v.code === TEST_CODE) {
    return res.status(400).json({ error: 'test_voter', message: 'A teszt szavazót nem lehet törölni.' });
  }
  db.prepare('DELETE FROM voters WHERE id = ?').run(v.id);
  res.json({ ok: true });
});

/* ---------- eredmenyek ---------- */

function computeResults() {
  const criteria = db.prepare('SELECT * FROM criteria WHERE active = 1 ORDER BY position, id').all();
  const teams = db.prepare('SELECT * FROM teams WHERE active = 1 ORDER BY number').all();
  const weightSum = criteria.reduce((s, c) => s + (c.weight || 1), 0) || 1;

  const agg = db
    .prepare('SELECT team_id, criterion_id, COUNT(*) AS n, AVG(score) AS avg FROM votes GROUP BY team_id, criterion_id')
    .all();
  const map = new Map(agg.map((r) => [`${r.team_id}:${r.criterion_id}`, r]));

  const rows = teams.map((t) => {
    const perCriterion = criteria.map((c) => {
      const a = map.get(`${t.id}:${c.id}`);
      const avg = a ? a.avg : null;
      const span = c.max_score - c.min_score || 1;
      return {
        key: c.key,
        label: c.label,
        weight: c.weight,
        votes: a ? a.n : 0,
        avg: avg === null ? null : Number(avg.toFixed(3)),
        pct: avg === null ? null : Number((((avg - c.min_score) / span) * 100).toFixed(2)),
      };
    });

    const scored = perCriterion.filter((p) => p.avg !== null);
    const weighted = scored.reduce((s, p) => s + p.pct * (p.weight || 1), 0);
    const usedWeight = scored.reduce((s, p) => s + (p.weight || 1), 0);

    return {
      team_id: t.id,
      number: t.number,
      label: teamLabel(t),
      accent_color: t.accent_color || '#7c5cff',
      voters: db.prepare('SELECT COUNT(*) AS c FROM submissions WHERE team_id = ?').get(t.id).c,
      criteria: perCriterion,
      score_sum: Number(scored.reduce((s, p) => s + p.avg, 0).toFixed(3)),
      total_pct: usedWeight ? Number((weighted / usedWeight).toFixed(2)) : null,
      coverage: Number(((usedWeight / weightSum) * 100).toFixed(0)),
    };
  });

  const ranked = [...rows].sort((a, b) => (b.total_pct ?? -1) - (a.total_pct ?? -1));
  ranked.forEach((r, i) => { r.rank = r.total_pct === null ? null : i + 1; });

  const categoryWinners = criteria.map((c) => {
    const best = [...rows]
      .filter((r) => r.criteria.find((p) => p.key === c.key)?.avg !== null)
      .sort((a, b) => b.criteria.find((p) => p.key === c.key).avg - a.criteria.find((p) => p.key === c.key).avg)[0];
    return {
      key: c.key,
      label: c.label,
      winner: best ? { number: best.number, label: best.label, avg: best.criteria.find((p) => p.key === c.key).avg } : null,
    };
  });

  return { criteria, teams: rows, ranking: ranked, category_winners: categoryWinners };
}

adminRouter.get('/results', (_req, res) => {
  res.json({
    ...computeResults(),
    stats: {
      voters_total: db.prepare('SELECT COUNT(*) AS c FROM voters').get().c,
      voters_voted: db.prepare('SELECT COUNT(DISTINCT voter_id) AS c FROM submissions').get().c,
      submissions: db.prepare('SELECT COUNT(*) AS c FROM submissions').get().c,
      votes: db.prepare('SELECT COUNT(*) AS c FROM votes').get().c,
      voting_open: getBool('voting_open'),
    },
  });
});

adminRouter.get('/results/comments', (_req, res) => {
  const comments = db
    .prepare(
      `SELECT t.number, t.name, t.game_name, s.comment, s.updated_at
       FROM submissions s JOIN teams t ON t.id = s.team_id
       WHERE s.comment IS NOT NULL AND TRIM(s.comment) <> ''
       ORDER BY s.updated_at DESC LIMIT 300`
    )
    .all()
    .map((c) => ({ number: c.number, label: teamLabel(c), comment: c.comment, updated_at: c.updated_at }));
  res.json({ comments });
});

/* ---------- nullazas ---------- */

adminRouter.post('/reset', (req, res) => {
  const body = req.body || {};
  if (String(body.confirm || '') !== 'TOROL') {
    return res.status(400).json({ error: 'confirm_required', message: 'A törléshez küldd a { "confirm": "TOROL" } mezőt.' });
  }
  const scope = body.scope === 'all' ? 'all' : 'votes';
  const votes = db.prepare('SELECT COUNT(*) AS c FROM votes').get().c;

  db.transaction(() => {
    db.prepare('DELETE FROM votes').run();
    db.prepare('DELETE FROM submissions').run();

    if (scope === 'all') {
      // A csapatok es a szavazok azonositoja megmarad: a kodjaik es a
      // QR-jeik elore ki vannak nyomtatva, azokat nem szabad eldobni.
      // Csak a csapatok altal feltoltott tartalom nullazodik.
      for (const t of db.prepare('SELECT background_file, icon_file FROM teams').all()) {
        for (const f of [t.background_file, t.icon_file]) {
          if (f) fs.rm(path.join(config.uploadDir, f), { force: true }, () => {});
        }
      }
      db.prepare(`UPDATE teams SET
        name = NULL, game_name = NULL, tagline = NULL, description = NULL,
        background_file = NULL, icon_file = NULL,
        qr_fetched_at = NULL, updated_at = datetime('now')`).run();
      db.prepare('UPDATE voters SET is_activated = 0, last_seen_at = NULL').run();
    }
  })();

  res.json({
    ok: true,
    scope,
    message: scope === 'all'
      ? `Nullázva: ${votes} szavazat és a csapatok által feltöltött tartalom. `
        + 'A csapatkódok, a QR-kódok és a szavazói cetlik érvényesek maradtak.'
      : `${votes} szavazat törölve.`,
  });
});

/* ---------- nyomtathato PDF-ek ---------- */

function sendPdf(res, req, buffer, filename) {
  const inline = req.query.nezet === 'inline';
  res.type('application/pdf');
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`);
  res.send(buffer);
}

adminRouter.get('/print/voters.pdf', async (req, res, next) => {
  try {
    const base = baseUrl(req);
    const rows = db
      .prepare(`SELECT token, code FROM voters ${req.query.only_new === '1' ? 'WHERE is_activated = 0' : ''} ORDER BY id`)
      .all();
    const pdf = await votersPdf(
      rows.map((v) => ({ code: v.code, login_url: `${base}/v/${v.token}` })),
      { cols: Number(req.query.cols) || 4, host: new URL(base).host }
    );
    sendPdf(res, req, pdf, 'nitrogames-szavazoi-belepok.pdf');
  } catch (err) {
    next(err);
  }
});

/** A csapatok beleptetolapja: kod, szervercim es egy tovabbkuldheto QR. */
adminRouter.get('/print/teams.pdf', async (req, res, next) => {
  try {
    const base = baseUrl(req);
    const teams = db.prepare('SELECT * FROM teams WHERE active = 1 ORDER BY number').all().map((t) => ({
      number: t.number,
      code: formatCode(t.api_code),
      console_url: `${base}/csapat?kod=${formatCode(t.api_code)}`,
    }));
    const pdf = await teamSheetPdf(teams, { base });
    sendPdf(res, req, pdf, 'nitrogames-csapat-belepok.pdf');
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
