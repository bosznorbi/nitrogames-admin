/**
 * Demo szavazatok generalasa probahoz (pl. a dijkioszto kivetitő nezet
 * kiprobalasahoz). Eles adatra soha ne futtasd.
 *
 *   node scripts/demo-votes.mjs --igen            # kitolti a hianyzo szavazatokat
 *   node scripts/demo-votes.mjs --igen --arany 70 # a szavazok 70%-a szavaz
 */
import { db } from '../src/db.js';

if (!process.argv.includes('--igen')) {
  console.log('Ez a script véletlenszerű DEMO szavazatokat ír az adatbázisba.');
  console.log('Ha tényleg ezt akarod, futtasd így:  node scripts/demo-votes.mjs --igen');
  process.exit(1);
}

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : def;
};

const ratio = Math.min(Math.max(arg('arany', 85), 1), 100) / 100;

const teams = db.prepare('SELECT * FROM teams WHERE active = 1 ORDER BY number').all();
const criteria = db.prepare('SELECT * FROM criteria WHERE active = 1 ORDER BY position, id').all();
const voters = db.prepare('SELECT * FROM voters ORDER BY id').all();

if (!teams.length || !criteria.length || !voters.length) {
  console.log('Előbb hozz létre csapatokat, szempontokat és szavazókat az admin felületen.');
  process.exit(1);
}

// Csapatonkent egy rejtett "minoseg", hogy a sorrend ne legyen teljesen lapos.
const quality = new Map(teams.map((t) => [t.id, 0.35 + Math.random() * 0.6]));

const upVote = db.prepare(
  `INSERT INTO votes (voter_id, team_id, criterion_id, score) VALUES (?, ?, ?, ?)
   ON CONFLICT(voter_id, team_id, criterion_id) DO UPDATE SET score = excluded.score`
);
const upSub = db.prepare(
  `INSERT INTO submissions (voter_id, team_id, comment) VALUES (?, ?, ?)
   ON CONFLICT(voter_id, team_id) DO UPDATE SET comment = excluded.comment`
);

const COMMENTS = [
  'Nagyon ötletes, jól szórakoztam vele.',
  'A grafika vitte el a show-t.',
  'Kicsit nehéz volt kiismerni, de megérte.',
  'Ehhez képest, hogy két óra volt, elképesztő.',
  'A hangulata a kedvencem az összes közül.',
  null, null, null, null,
];

let votes = 0;
let subs = 0;

db.transaction(() => {
  for (const voter of voters) {
    if (Math.random() > ratio) continue;
    const generosity = 0.75 + Math.random() * 0.5; // van, aki szigorubb

    for (const team of teams) {
      if (Math.random() > 0.9) continue; // par szavazat hianyzik

      for (const c of criteria) {
        const span = c.max_score - c.min_score;
        const base = c.min_score + span * quality.get(team.id) * generosity;
        const score = Math.max(c.min_score, Math.min(c.max_score, Math.round(base + (Math.random() - 0.5) * 1.6)));
        upVote.run(voter.id, team.id, c.id, score);
        votes++;
      }
      upSub.run(voter.id, team.id, COMMENTS[Math.floor(Math.random() * COMMENTS.length)]);
      subs++;
    }
  }
})();

console.log(`Kész: ${votes} pontszám, ${subs} szavazólap, ${teams.length} csapatra.`);
