import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, baseUrl } from '../config.js';
import { db } from '../db.js';
import { requireTeamKey, rateLimit } from '../middleware/auth.js';
import { decodeImagePayload, inspectImage } from '../lib/imageinfo.js';
import { qrPngBuffer, qrSvg } from '../lib/qr.js';

export const teamRouter = express.Router();

const HEX = /^#[0-9a-fA-F]{6}$/;

function imageSpec() {
  return {
    background: {
      width: config.image.background.width,
      height: config.image.background.height,
      formats: config.image.formats,
      max_bytes: config.image.maxBytes,
      note: 'Pontosan ekkora méretű kép kell (álló, mobil képernyőre tervezve).',
    },
    logo: {
      width: config.image.logo.width,
      height: config.image.logo.height,
      formats: config.image.formats,
      max_bytes: config.image.maxBytes,
      note: 'Négyzetes logó, átlátszó PNG ajánlott.',
    },
  };
}

function teamView(team, req) {
  const fresh = db.prepare('SELECT * FROM teams WHERE id = ?').get(team.id);
  const base = baseUrl(req);
  return {
    slug: fresh.slug,
    number: fresh.number,
    name: fresh.name,
    game_name: fresh.game_name || null,
    tagline: fresh.tagline || null,
    description: fresh.description || null,
    accent_color: fresh.accent_color || '#7c5cff',
    background_url: fresh.background_file ? `${base}/uploads/${fresh.background_file}` : null,
    logo_url: fresh.logo_file ? `${base}/uploads/${fresh.logo_file}` : null,
    vote_url: `${base}/t/${fresh.slug}`,
    qr_url: `${base}/api/team/me/qr`,
    updated_at: fresh.updated_at,
  };
}

function touch(id) {
  db.prepare("UPDATE teams SET updated_at = datetime('now') WHERE id = ?").run(id);
}

teamRouter.use(requireTeamKey);
teamRouter.use(rateLimit({ windowMs: 60000, max: 120, key: (req) => `team:${req.team.id}` }));

/** Ellenorzo hivas: mukodik-e a kulcs, es mit lat a rendszer a csapatrol. */
teamRouter.get('/me', (req, res) => {
  res.json({ ok: true, team: teamView(req.team, req), image_spec: imageSpec() });
});

teamRouter.get('/me/spec', (req, res) => {
  res.json({ image_spec: imageSpec() });
});

function updateTeam(req, res) {
  const body = req.body || {};
  const fields = {};

  if ('game_name' in body) {
    const v = String(body.game_name ?? '').trim().slice(0, 60);
    if (!v) return res.status(400).json({ error: 'invalid_game_name', message: 'A játék neve nem lehet üres.' });
    fields.game_name = v;
  }
  if ('tagline' in body) fields.tagline = String(body.tagline ?? '').trim().slice(0, 120) || null;
  if ('description' in body) fields.description = String(body.description ?? '').trim().slice(0, 600) || null;
  if ('accent_color' in body) {
    const v = String(body.accent_color ?? '').trim();
    if (v && !HEX.test(v)) {
      return res.status(400).json({ error: 'invalid_color', message: 'Az accent_color formátuma #rrggbb legyen.' });
    }
    fields.accent_color = v || null;
  }

  const keys = Object.keys(fields);
  if (!keys.length) {
    return res.status(400).json({
      error: 'nothing_to_update',
      message: 'Küldj legalább egy mezőt: game_name, tagline, description, accent_color.',
    });
  }
  const sql = `UPDATE teams SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`;
  db.prepare(sql).run({ ...fields, id: req.team.id });
  res.json({ ok: true, updated: keys, team: teamView(req.team, req) });
}

teamRouter.put('/me', updateTeam);
teamRouter.patch('/me', updateTeam);
teamRouter.post('/me', updateTeam);

/* ---------- kepfeltoltes ---------- */

function handleUpload(kind) {
  return (req, res) => {
    const spec = config.image[kind];
    const buf = decodeImagePayload(req);
    if (!buf || !buf.length) {
      return res.status(400).json({
        error: 'no_image',
        message: 'Küldd a képet nyers bináris body-ként (Content-Type: image/png) vagy JSON-ben image_base64 mezőben.',
        expected: imageSpec()[kind],
      });
    }
    if (buf.length > config.image.maxBytes) {
      return res.status(413).json({
        error: 'too_large',
        message: `A kép túl nagy: ${buf.length} bájt, a maximum ${config.image.maxBytes}.`,
      });
    }
    const info = inspectImage(buf);
    if (!info) {
      return res.status(415).json({
        error: 'unsupported_format',
        message: 'Nem felismerhető kép. Elfogadott formátumok: PNG, JPEG, WebP.',
        expected: imageSpec()[kind],
      });
    }
    if (!config.image.formats.includes(info.mime)) {
      return res.status(415).json({
        error: 'unsupported_format',
        message: `Ez a formátum nem engedélyezett: ${info.mime}`,
        expected: imageSpec()[kind],
      });
    }
    if (info.width !== spec.width || info.height !== spec.height) {
      return res.status(422).json({
        error: 'wrong_dimensions',
        message: `A kép mérete ${info.width}x${info.height}, de pontosan ${spec.width}x${spec.height} kell.`,
        got: { width: info.width, height: info.height, format: info.format },
        expected: imageSpec()[kind],
      });
    }

    const column = kind === 'background' ? 'background_file' : 'logo_file';
    const previous = db.prepare(`SELECT ${column} AS f FROM teams WHERE id = ?`).get(req.team.id).f;
    const filename = `${req.team.slug}-${kind}-${Date.now()}.${info.ext}`;
    fs.writeFileSync(path.join(config.uploadDir, filename), buf);
    db.prepare(`UPDATE teams SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`).run(filename, req.team.id);
    if (previous && previous !== filename) {
      fs.rm(path.join(config.uploadDir, previous), { force: true }, () => {});
    }

    res.json({
      ok: true,
      [`${kind}_url`]: `${baseUrl(req)}/uploads/${filename}`,
      bytes: buf.length,
      width: info.width,
      height: info.height,
      format: info.format,
      team: teamView(req.team, req),
    });
  };
}

function handleDelete(kind) {
  return (req, res) => {
    const column = kind === 'background' ? 'background_file' : 'logo_file';
    const previous = db.prepare(`SELECT ${column} AS f FROM teams WHERE id = ?`).get(req.team.id).f;
    db.prepare(`UPDATE teams SET ${column} = NULL, updated_at = datetime('now') WHERE id = ?`).run(req.team.id);
    if (previous) fs.rm(path.join(config.uploadDir, previous), { force: true }, () => {});
    res.json({ ok: true, removed: Boolean(previous), team: teamView(req.team, req) });
  };
}

teamRouter.post('/me/background', handleUpload('background'));
teamRouter.put('/me/background', handleUpload('background'));
teamRouter.delete('/me/background', handleDelete('background'));

teamRouter.post('/me/logo', handleUpload('logo'));
teamRouter.put('/me/logo', handleUpload('logo'));
teamRouter.delete('/me/logo', handleDelete('logo'));

/* ---------- sajat QR kod ---------- */

teamRouter.get('/me/qr', async (req, res, next) => {
  try {
    const url = `${baseUrl(req)}/t/${req.team.slug}`;
    const size = Math.min(Math.max(Number(req.query.size) || 640, 128), 2048);
    const format = String(req.query.format || 'png').toLowerCase();

    if (format === 'json') {
      return res.json({ vote_url: url, qr_svg_url: `${baseUrl(req)}/api/team/me/qr?format=svg` });
    }
    if (format === 'svg') {
      res.type('image/svg+xml');
      return res.send(await qrSvg(url, { size }));
    }
    res.type('image/png');
    res.set('Content-Disposition', `inline; filename="${req.team.slug}-qr.png"`);
    res.send(await qrPngBuffer(url, { size }));
  } catch (err) {
    next(err);
  }
});

// A csapatok szandekosan nem latjak a rajuk erkezett szavazatokat.
teamRouter.get('/me/votes', (_req, res) => {
  res.status(403).json({ error: 'forbidden', message: 'Az eredmények csak az admin felületen láthatók.' });
});

teamRouter.use((req, res) => {
  res.status(404).json({
    error: 'unknown_endpoint',
    message: `Nincs ilyen végpont: ${req.method} /api/team${req.path}`,
    endpoints: [
      'GET    /api/team/me',
      'PUT    /api/team/me           { game_name, tagline, description, accent_color }',
      'POST   /api/team/me/background  (nyers kép body vagy { image_base64 })',
      'DELETE /api/team/me/background',
      'POST   /api/team/me/logo',
      'GET    /api/team/me/qr?format=png|svg|json',
    ],
  });
});
