/**
 * Mintaadatok teszteléshez: kitölti a csapatokat, mintha készen lennének, és
 * legenerálja a szavazatokat is. Csak az admin Danger zone-jából hívható.
 *
 * A TEST kódú szavazó szándékosan kimarad a szavazatokból: az az egy belépő,
 * amivel a telefonról élesben is lehet még pontozni a feltöltött adatokon.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { config } from '../config.js';
import { db, setSetting, TEST_CODE } from '../db.js';

/* ---------- PNG-írás függőség nélkül ---------- */

const CRC_TABLA = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLA[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipus, adat) {
  const hossz = Buffer.alloc(4);
  hossz.writeUInt32BE(adat.length);
  const t = Buffer.from(tipus, 'latin1');
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([t, adat])));
  return Buffer.concat([hossz, t, adat, c]);
}

/**
 * Egyszerű, de nem sivár háttér: átlós színátmenet a csapat színéből, fölötte
 * egy ritka rács, hogy a szavazólapon látszódjon, tényleg kép van alatta.
 */
function pngKep(width, height, accent) {
  const [ar, ag, ab] = hexRgb(accent);
  const sorok = [];

  for (let y = 0; y < height; y++) {
    const sor = Buffer.alloc(1 + width * 3);
    const fy = y / height;
    for (let x = 0; x < width; x++) {
      const fx = x / width;
      const t = Math.min(1, (fx + fy) / 2);
      // Sötét alapról a csapat színe felé, de sosem teljesen kivilágosodva.
      let r = Math.round(8 + (ar - 8) * t * 0.7);
      let g = Math.round(12 + (ag - 12) * t * 0.7);
      let b = Math.round(24 + (ab - 24) * t * 0.7);
      if (x % 90 === 0 || y % 90 === 0) {
        r = Math.min(255, r + 18);
        g = Math.min(255, g + 18);
        b = Math.min(255, b + 18);
      }
      sor[1 + x * 3] = r;
      sor[2 + x * 3] = g;
      sor[3 + x * 3] = b;
    }
    sorok.push(sor);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bitmélység
  ihdr[9] = 2; // truecolor

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(sorok), { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexRgb(hex) {
  const h = String(hex || '#2ee8ff').replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

/* ---------- kitalált csapatok ---------- */

const JATEKOK = [
  { csapat: 'Kávészünet', jatek: 'Bögrefutam', motto: 'Ki issza meg az utolsó kortyot?',
    leiras: 'Végigtolod a konyhát a bögréddel, közben kerülgeted a kollégákat és a nyitva hagyott fiókokat. Aki kiönti a kávét, kezdheti elölről.' },
  { csapat: 'Nullás Hiba', jatek: 'Űrszemét', motto: 'Takaríts, mielőtt elfogy a levegő',
    leiras: 'Egy kis űrhajóval gyűjtöd be a Föld körüli törmeléket. Minél tovább bírod, annál gyorsabban jön a következő hullám.' },
  { csapat: 'Délutáni Műszak', jatek: 'Hőségriadó', motto: 'A klíma a te kezedben van',
    leiras: 'Egy irodaházat hűtesz nyáron, korlátozott árammal. Rossz sorrendben kapcsolsz, és mindenki megfő.' },
  { csapat: 'Papírrepülő', jatek: 'Emeletek',
    motto: 'Föntről minden szebb', leiras: 'Papírrepülőt hajtogatsz és eldobod a lépcsőházban. A huzat a barátod és az ellenséged is egyszerre.' },
  { csapat: 'Utolsó Commit', jatek: 'Merge Konfliktus', motto: 'Valaki mindig hozzányúlt',
    leiras: 'Két fejlesztő ugyanazt a sort írja át. Neked kell eldöntened, melyik verzió maradjon, mielőtt leáll a build.' },
  { csapat: 'Kék Bögre', jatek: 'Hangyafarm', motto: 'Kicsik, de sokan',
    leiras: 'Hangyákat irányítasz, akik morzsát cipelnek haza. Az útvonalat te rajzolod, ők makacsul ragaszkodnak hozzá.' },
  { csapat: 'Csendes Mód', jatek: 'Éjjeli Őrjárat', motto: 'Ne ébressz fel senkit',
    leiras: 'Sötét folyosókon osonsz zseblámpával. Minden hang felkelt valakit, és akkor kezdődik a hajsza.' },
  { csapat: 'Hetedik Emelet', jatek: 'Liftakna', motto: 'Mindig a rossz gomb',
    leiras: 'Liftet vezérelsz csúcsforgalomban. Nyolc emelet, huszonöt türelmetlen utas, és egy kapcsoló, ami néha beragad.' },
  { csapat: 'Reggeli Kör', jatek: 'Tízóraifutam', motto: 'Aki kapja, marja',
    leiras: 'Végigszaladsz a konyhán, és összeszeded, ami a hűtőben maradt. A kollégák ugyanezt csinálják, csak gyorsabban.' },
  { csapat: 'Néma Riasztó', jatek: 'Szerverszoba', motto: 'Valami villog',
    leiras: 'Egy adatközpontot tartasz életben. Kábelt húzol, ventilátort kapcsolsz, és próbálod kitalálni, mi zümmög.' },
  { csapat: 'Zöld Pont', jatek: 'Szelektív', motto: 'A jó kukába',
    leiras: 'Szemetet válogatsz futószalagon, egyre gyorsabban. A papír a papírhoz, az üveg az üveghez, a maradék meg a te lelkiismeretedre.' },
  { csapat: 'Első Kávé', jatek: 'Ébresztő', motto: 'Még öt perc',
    leiras: 'Egy alvó várost ébresztgetsz, ablakról ablakra. Aki felkel, dolgozni megy, aki nem, azt újra kell próbálni.' },
];

const MEGJEGYZESEK = [
  'Nagyon ötletes, jól szórakoztam vele.',
  'A grafika vitte el a show-t.',
  'Kicsit nehéz volt kiismerni, de megérte.',
  'Ehhez képest, hogy két óra volt, elképesztő.',
  'A hangulata a kedvencem az összes közül.',
  'Egyszerű, de nem tudtam letenni.',
  null, null, null, null, null,
];

/* ---------- a generálás ---------- */

export function mintaadatokat(opciok = {}) {
  const arany = Math.min(Math.max(Number(opciok.arany) || 85, 1), 100) / 100;

  const teams = db.prepare('SELECT * FROM teams WHERE active = 1 ORDER BY number').all();
  const criteria = db.prepare('SELECT * FROM criteria WHERE active = 1 ORDER BY position, id').all();
  const voters = db.prepare('SELECT * FROM voters ORDER BY id').all();

  if (!teams.length) throw new Error('Előbb hozz létre csapatokat a Csapatok fülön.');
  if (!criteria.length) throw new Error('Előbb vegyél fel szempontokat a Szempontok fülön.');
  if (!voters.length) throw new Error('Előbb generálj szavazói cetliket a Szavazók fülön.');

  fs.mkdirSync(config.uploadDir, { recursive: true });

  /* --- csapatok kitöltése --- */

  const frissit = db.prepare(`UPDATE teams SET
    name = ?, game_name = ?, tagline = ?, description = ?,
    background_file = ?, icon_file = ?, qr_fetched_at = datetime('now'),
    updated_at = datetime('now')
    WHERE id = ?`);

  const regiFajlok = [];
  const bely = Date.now();

  for (const [i, team] of teams.entries()) {
    const j = JATEKOK[i % JATEKOK.length];
    // Ha több csapat van, mint kitalált játék, a sorszám megkülönbözteti őket.
    const utotag = i >= JATEKOK.length ? ` ${Math.floor(i / JATEKOK.length) + 1}.` : '';

    const hatter = `${team.public_id}-background-${bely + i}.png`;
    const csempe = `${team.public_id}-icon-${bely + i}.png`;

    fs.writeFileSync(
      path.join(config.uploadDir, hatter),
      pngKep(config.image.background.width, config.image.background.height, team.accent_color)
    );
    fs.writeFileSync(
      path.join(config.uploadDir, csempe),
      pngKep(config.image.icon.width, config.image.icon.height, team.accent_color)
    );

    for (const f of [team.background_file, team.icon_file]) {
      if (f && f !== hatter && f !== csempe) regiFajlok.push(f);
    }

    frissit.run(
      j.csapat + utotag, j.jatek + utotag, j.motto, j.leiras,
      hatter, csempe, team.id
    );
  }

  for (const f of regiFajlok) {
    fs.rm(path.join(config.uploadDir, f), { force: true }, () => {});
  }

  /* --- szavazatok --- */

  const szavazok = voters.filter((v) => v.code !== TEST_CODE);

  // Csapatonként egy rejtett "minőség", hogy a sorrend ne legyen teljesen lapos.
  const minoseg = new Map(teams.map((t) => [t.id, 0.35 + Math.random() * 0.6]));

  const upVote = db.prepare(
    `INSERT INTO votes (voter_id, team_id, criterion_id, score) VALUES (?, ?, ?, ?)
     ON CONFLICT(voter_id, team_id, criterion_id) DO UPDATE SET score = excluded.score`
  );
  const upSub = db.prepare(
    `INSERT INTO submissions (voter_id, team_id, comment) VALUES (?, ?, ?)
     ON CONFLICT(voter_id, team_id) DO UPDATE SET comment = excluded.comment`
  );

  let pontok = 0;
  let lapok = 0;
  let resztvevok = 0;

  db.transaction(() => {
    for (const voter of szavazok) {
      if (Math.random() > arany) continue;
      resztvevok++;
      const bokezuseg = 0.75 + Math.random() * 0.5; // van, aki szigorúbb

      for (const team of teams) {
        if (Math.random() > 0.9) continue; // pár szavazat szándékosan hiányzik

        for (const c of criteria) {
          const span = c.max_score - c.min_score;
          const alap = c.min_score + span * minoseg.get(team.id) * bokezuseg;
          const pont = Math.max(
            c.min_score,
            Math.min(c.max_score, Math.round(alap + (Math.random() - 0.5) * 1.6))
          );
          upVote.run(voter.id, team.id, c.id, pont);
          pontok++;
        }
        upSub.run(voter.id, team.id, MEGJEGYZESEK[Math.floor(Math.random() * MEGJEGYZESEK.length)]);
        lapok++;
      }
    }

    db.prepare(
      `UPDATE voters SET is_activated = 1, last_seen_at = datetime('now')
       WHERE id IN (SELECT DISTINCT voter_id FROM submissions)`
    ).run();

    // Zárt szavazás mellett a szavazólap csak egy "gyere vissza később" doboz,
    // márpedig pont azt kell tudni próbálni a TEST cetlivel.
    setSetting('voting_open', '1');
  })();

  return {
    csapatok: teams.length,
    szavazok: resztvevok,
    lapok,
    pontok,
    kimaradt: voters.length - szavazok.length,
    szavazas_nyitva: true,
  };
}
