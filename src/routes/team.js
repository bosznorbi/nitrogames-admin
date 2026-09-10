import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, baseUrl } from '../config.js';
import { db, teamLabel } from '../db.js';
import { requireTeamCode, rateLimit } from '../middleware/auth.js';
import { decodeImagePayload, inspectImage } from '../lib/imageinfo.js';
import { qrPngBuffer, qrSvg } from '../lib/qr.js';
import { formatCode } from '../lib/ids.js';

export const teamRouter = express.Router();

const HEX = /^#[0-9a-fA-F]{6}$/;

const KINDS = {
  background: {
    mezo: 'background_file',
    nev: 'háttérkép',
    leiras: 'A szavazólapotok teljes hátterét kitölti a telefonon. Álló, 9:16.',
  },
  icon: {
    mezo: 'icon_file',
    nev: 'csempekép',
    leiras: 'A főoldal 3x3-as rácsában ez a kép jelöli a játékotokat. Álló, 3:4 arányú, kitölti a csempét.',
  },
};

function imageSpec() {
  const out = {};
  for (const [kind, meta] of Object.entries(KINDS)) {
    const s = config.image[kind];
    out[kind] = {
      width: s.width,
      height: s.height,
      formats: config.image.formats,
      max_bytes: config.image.maxBytes,
      leiras: meta.leiras,
    };
  }
  return out;
}

function teamView(team, req) {
  const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(team.id);
  const base = baseUrl(req);
  return {
    szam: t.number,
    kod: formatCode(t.api_code),
    csapatnev: t.name || null,
    jatek_neve: t.game_name || null,
    mottó: t.tagline || null,
    leiras: t.description || null,
    szin: t.accent_color || '#7c5cff',
    hatterkep_url: t.background_file ? `${base}/uploads/${t.background_file}` : null,
    csempekep_url: t.icon_file ? `${base}/uploads/${t.icon_file}` : null,
    szavazolap_url: `${base}/t/${t.public_id}`,
    qr_url: `${base}/api/csapat/qr`,
    frissitve: t.updated_at,
  };
}

/* ---------- keszultseg ---------- */

/**
 * Mi hianyzik meg. Ez az egyetlen vegpont, amit eleg ismetelten meghivni:
 * megmondja, mi a kovetkezo teendo, es mikor van kesz a csapat.
 */
function checklist(team, req) {
  const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(team.id);
  const base = baseUrl(req);
  const s = imageSpec();

  const items = [
    {
      kulcs: 'csapatnev',
      kesz: Boolean(t.name),
      teendo: 'Adjatok nevet a csapatnak.',
      hogyan: `PUT ${base}/api/csapat  {"csapatnev": "A csapat neve"}`,
    },
    {
      kulcs: 'jatek_neve',
      kesz: Boolean(t.game_name),
      teendo: 'Adjátok meg a játék nevét.',
      hogyan: `PUT ${base}/api/csapat  {"jatek_neve": "A játék neve"}`,
    },
    {
      kulcs: 'leiras',
      kesz: Boolean(t.description),
      teendo: 'Írjatok rövid leírást a játékról, ez a szavazólapotokon jelenik meg.',
      hogyan: `PUT ${base}/api/csapat  {"leiras": "Miről szól, hogyan kell játszani"}`,
    },
    {
      kulcs: 'hatterkep',
      kesz: Boolean(t.background_file),
      teendo: `Töltsetek fel háttérképet, pontosan ${s.background.width}x${s.background.height} képpont.`,
      hogyan: `POST ${base}/api/csapat/hatterkep  (nyers kép body, vagy {"image_base64": "..."})`,
    },
    {
      kulcs: 'csempekep',
      kesz: Boolean(t.icon_file),
      teendo: `Töltsetek fel csempeképet, pontosan ${s.icon.width}x${s.icon.height} képpont.`,
      hogyan: `POST ${base}/api/csapat/csempekep`,
    },
    {
      kulcs: 'qr_letoltve',
      kesz: Boolean(t.qr_fetched_at),
      teendo: 'Kérjétek le a QR-kódotokat, és készítsetek belőle nyomtatható lapot az asztalotokra.',
      hogyan: `GET ${base}/api/csapat/qr?format=png&size=1000`,
    },
  ];

  const opcionalis = [
    {
      kulcs: 'mottó',
      kesz: Boolean(t.tagline),
      teendo: 'Opcionális: egysoros mottó a szavazólap tetejére.',
      hogyan: `PUT ${base}/api/csapat  {"mottó": "Két óra, egy küldetés"}`,
    },
    {
      kulcs: 'szin',
      kesz: Boolean(t.accent_color),
      teendo: 'Opcionális: kiemelő szín, #rrggbb formában.',
      hogyan: `PUT ${base}/api/csapat  {"szin": "#ff5c8a"}`,
    },
  ];

  const hianyzik = items.filter((i) => !i.kesz);
  return {
    kesz: hianyzik.length === 0,
    kesz_darab: items.length - hianyzik.length,
    osszesen: items.length,
    uzenet: hianyzik.length === 0
      ? 'Minden kötelező elem megvan. A játékotok készen áll a szavazásra.'
      : `Még ${hianyzik.length} dolog hiányzik.`,
    kovetkezo_lepes: hianyzik.length ? hianyzik[0] : null,
    hianyzik,
    kesz_elemek: items.filter((i) => i.kesz).map((i) => i.kulcs),
    opcionalis,
  };
}

/* ---------- vedelem ---------- */

teamRouter.use(requireTeamCode);
teamRouter.use(rateLimit({ windowMs: 60000, max: 240, key: (req) => `csapat:${req.team.id}` }));

/* ---------- allapot ---------- */

teamRouter.get('/', (req, res) => {
  res.json({
    ok: true,
    csapat: teamView(req.team, req),
    keszultseg: checklist(req.team, req),
    kepek: imageSpec(),
  });
});

teamRouter.get('/allapot', (req, res) => {
  res.json(checklist(req.team, req));
});

teamRouter.get('/kepek', (_req, res) => {
  res.json({ kepek: imageSpec() });
});

/* ---------- adatok ---------- */

const TEXT_FIELDS = {
  csapatnev: { column: 'name', max: 60 },
  jatek_neve: { column: 'game_name', max: 60 },
  mottó: { column: 'tagline', max: 120 },
  motto: { column: 'tagline', max: 120 },
  leiras: { column: 'description', max: 600 },
  leírás: { column: 'description', max: 600 },
};

function updateTeam(req, res) {
  const body = req.body || {};
  const fields = {};
  const updated = [];

  for (const [key, meta] of Object.entries(TEXT_FIELDS)) {
    if (!(key in body)) continue;
    const value = String(body[key] ?? '').trim().slice(0, meta.max);
    fields[meta.column] = value || null;
    updated.push(key);
  }

  for (const key of ['szin', 'accent_color']) {
    if (!(key in body)) continue;
    const value = String(body[key] ?? '').trim();
    if (value && !HEX.test(value)) {
      return res.status(400).json({ error: 'rossz_szin', message: 'A szín formátuma #rrggbb legyen, például #ff5c8a.' });
    }
    fields.accent_color = value || null;
    updated.push(key);
  }

  const keys = Object.keys(fields);
  if (!keys.length) {
    return res.status(400).json({
      error: 'nincs_mit_menteni',
      message: 'Küldj legalább egy mezőt.',
      mezok: ['csapatnev', 'jatek_neve', 'mottó', 'leiras', 'szin'],
    });
  }

  const sql = `UPDATE teams SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`;
  db.prepare(sql).run({ ...fields, id: req.team.id });

  res.json({
    ok: true,
    mentve: updated,
    csapat: teamView(req.team, req),
    keszultseg: checklist(req.team, req),
  });
}

teamRouter.put('/', updateTeam);
teamRouter.patch('/', updateTeam);
teamRouter.post('/', updateTeam);

/* ---------- kepfeltoltes ---------- */

function handleUpload(kind) {
  return (req, res) => {
    const spec = config.image[kind];
    const meta = KINDS[kind];
    const buf = decodeImagePayload(req);

    if (!buf || !buf.length) {
      return res.status(400).json({
        error: 'nincs_kep',
        message: 'Küldd a képet nyers bináris body-ként (Content-Type: image/png), vagy JSON-ben az image_base64 mezőben.',
        elvart: imageSpec()[kind],
      });
    }
    if (buf.length > config.image.maxBytes) {
      return res.status(413).json({
        error: 'tul_nagy',
        message: `A kép ${buf.length} bájt, a maximum ${config.image.maxBytes}.`,
      });
    }
    const info = inspectImage(buf);
    if (!info || !config.image.formats.includes(info.mime)) {
      return res.status(415).json({
        error: 'rossz_formatum',
        message: 'Nem felismerhető kép. Elfogadott formátumok: PNG, JPEG, WebP.',
        elvart: imageSpec()[kind],
      });
    }
    if (info.width !== spec.width || info.height !== spec.height) {
      return res.status(422).json({
        error: 'rossz_meret',
        message: `A kép ${info.width}x${info.height}, de pontosan ${spec.width}x${spec.height} kell.`,
        kapott: { width: info.width, height: info.height, format: info.format },
        elvart: imageSpec()[kind],
      });
    }

    const previous = db.prepare(`SELECT ${meta.mezo} AS f FROM teams WHERE id = ?`).get(req.team.id).f;
    const filename = `${req.team.public_id}-${kind}-${Date.now()}.${info.ext}`;
    fs.writeFileSync(path.join(config.uploadDir, filename), buf);
    db.prepare(`UPDATE teams SET ${meta.mezo} = ?, updated_at = datetime('now') WHERE id = ?`).run(filename, req.team.id);
    if (previous && previous !== filename) {
      fs.rm(path.join(config.uploadDir, previous), { force: true }, () => {});
    }

    res.json({
      ok: true,
      feltoltve: meta.nev,
      url: `${baseUrl(req)}/uploads/${filename}`,
      meret: { width: info.width, height: info.height, bajt: buf.length, formatum: info.format },
      keszultseg: checklist(req.team, req),
    });
  };
}

function handleDelete(kind) {
  return (req, res) => {
    const meta = KINDS[kind];
    const previous = db.prepare(`SELECT ${meta.mezo} AS f FROM teams WHERE id = ?`).get(req.team.id).f;
    db.prepare(`UPDATE teams SET ${meta.mezo} = NULL, updated_at = datetime('now') WHERE id = ?`).run(req.team.id);
    if (previous) fs.rm(path.join(config.uploadDir, previous), { force: true }, () => {});
    res.json({ ok: true, torolve: Boolean(previous), keszultseg: checklist(req.team, req) });
  };
}

for (const [utvonal, kind] of [
  ['hatterkep', 'background'],
  ['csempekep', 'icon'],
]) {
  teamRouter.post(`/${utvonal}`, handleUpload(kind));
  teamRouter.put(`/${utvonal}`, handleUpload(kind));
  teamRouter.delete(`/${utvonal}`, handleDelete(kind));
}

/* ---------- sajat QR kod ---------- */

teamRouter.get('/qr', async (req, res, next) => {
  try {
    const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.team.id);
    const url = `${baseUrl(req)}/t/${t.public_id}`;
    const size = Math.min(Math.max(Number(req.query.size) || 800, 128), 2048);
    const format = String(req.query.format || 'png').toLowerCase();

    db.prepare("UPDATE teams SET qr_fetched_at = datetime('now') WHERE id = ?").run(t.id);

    if (format === 'json') {
      return res.json({
        szavazolap_url: url,
        png: `${baseUrl(req)}/api/csapat/qr?format=png&size=1000`,
        svg: `${baseUrl(req)}/api/csapat/qr?format=svg`,
        tipp: 'Nyomtassátok ki nagyban, és díszítsétek fel. Ezt fogják beolvasni a szavazók.',
      });
    }
    if (format === 'svg') {
      res.type('image/svg+xml');
      return res.send(await qrSvg(url, { size }));
    }
    res.type('image/png');
    res.set('Content-Disposition', `inline; filename="csapat-${t.number}-qr.png"`);
    res.send(await qrPngBuffer(url, { size }));
  } catch (err) {
    next(err);
  }
});

// A csapatok szandekosan nem latjak a rajuk erkezett szavazatokat.
teamRouter.get('/szavazatok', (_req, res) => {
  res.status(403).json({ error: 'tiltott', message: 'Az eredmények csak az admin felületen láthatók.' });
});

teamRouter.use((req, res) => {
  res.status(404).json({
    error: 'ismeretlen_vegpont',
    message: `Nincs ilyen végpont: ${req.method} /api/csapat${req.path}`,
    vegpontok: [
      'GET    /api/csapat              minden adat és a készültség',
      'GET    /api/csapat/allapot      csak a készültség: mi hiányzik még',
      'PUT    /api/csapat              { csapatnev, jatek_neve, mottó, leiras, szin }',
      'POST   /api/csapat/hatterkep    kép, pontosan 1080x1920',
      'POST   /api/csapat/csempekep    kép, pontosan 640x768 (álló)',
      'GET    /api/csapat/qr           saját QR kód, format=png|svg|json',
    ],
  });
});
