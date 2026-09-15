/**
 * Egyszer futtatando: legeneralja a 9 csapat es a 60 szavazocetli VEGLEGES
 * kodjait, es kiirja a src/kodok.js fajlba. Utana a kodok a kodbazis reszei,
 * tehat egy uj adatbazis, egy nullazas vagy egy elveszett volume sem valtoztat
 * rajtuk: a kinyomtatott papir mindig ervenyes marad.
 *
 *   node scripts/kodokat-general.mjs                 # kiirja, mit generalna
 *   node scripts/kodokat-general.mjs --ir            # tenyleg megirja a fajlt
 *   node scripts/kodokat-general.mjs --ir --ujra     # meglevo fajl felulirasa
 *   ... --csak-csapat   # a cetlik kodjai valtozatlanul maradnak
 *
 * A mar meglevo src/kodok.js-t szandekosan NEM irja felul --ujra nelkul,
 * nehogy egy veletlen futtatas ervenytelenitse a kinyomtatott lapokat.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GYOKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CEL = path.join(GYOKER, 'src', 'kodok.js');

const CSAPAT_DB = 9;
const CETLI_DB = 60;

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/*
 * Amit nem akarunk kiosztani. A kodok nagybetusek, I es O nincs bennuk, ezert
 * az olyan szavak, mint a "geci" vagy a "pina", eleve nem jonnek ki. Ami
 * kijohet, az van itt felsorolva, magyarul es angolul is. A negybetus kodnal
 * teljes egyezest nezunk, a nyolcbetusnel reszletet is, mindket feleben.
 */
const TILTOTT = [
  // magyar
  'FASZ', 'SZAR', 'SEGG', 'KURV', 'BAZD', 'BASZ', 'PUNA', 'PUCA', 'HULY',
  'BUZE', 'CULA', 'FEKA', 'NYAL', 'PELA', 'RETK', 'GENY', 'DZSU',
  // angol
  'FUCK', 'CUNT', 'TWAT', 'WANK', 'ARSE', 'SLUT', 'JERK', 'CRAP', 'DAMN',
  'TURD', 'RAPE', 'ANAL', 'ANUS', 'BUTT', 'FART', 'PORN', 'SUCK', 'DUMB',
  'KKK', 'SEX', 'ASS', 'FAG', 'JEW', 'NAZ', 'WTF', 'STD', 'PEE',
];

function tiltott(szo) {
  const s = szo.toUpperCase();
  return TILTOTT.some((t) => s.includes(t));
}

function valassz(abc, hossz) {
  const buf = crypto.randomBytes(hossz);
  let ki = '';
  for (let i = 0; i < hossz; i++) ki += abc[buf[i] % abc.length];
  return ki;
}

/**
 * Addig general, amig tiszta es meg nem foglalt kodot nem kap. Az `elotag` a
 * mar rogzitett kezdobetu: a tiltolistat a teljes kodra kell nezni, nem csak
 * a most generalt farokra.
 */
function tisztaKod(abc, hossz, foglalt, elotag = '') {
  for (let i = 0; i < 10000; i++) {
    const farok = valassz(abc, hossz);
    const k = elotag + farok;
    if (tiltott(k)) continue;
    // A nyolcjeles kod ket feleit kulon is nezzuk: NGXF-ASZ2 igy sem megy at.
    if (k.length === 8 && (tiltott(k.slice(0, 4)) || tiltott(k.slice(4)))) continue;
    if (foglalt.has(k)) continue;
    foglalt.add(k);
    return farok;
  }
  throw new Error('Nem sikerult tiszta kodot generalni.');
}

const csakCsapat = process.argv.includes('--csak-csapat');

const foglaltKod = new Set();
const foglaltAzonosito = new Set();

/*
 * A csapatkodok kezdobetuje abece sorrendben megy: az 1. csapate A, a 2.-e B,
 * es igy tovabb. Igy egy pillantasbol latszik, hogy a kezben tartott lap a
 * kinyomtatott keszlethez tartozik-e, es az is, melyik csapate.
 * Az I es az O nincs az abeceben (osszekeverhetok), ezert a 9. csapat J-t kap.
 */
const KEZDOBETUK = LETTERS.slice(0, CSAPAT_DB);

/** Szavazolap-kod: A445531, kiirva A-445-531. Kezzel is begepelheto. */
function jatekKod(betu) {
  let jegyek = '';
  const buf = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) jegyek += String(buf[i] % 10);
  return betu + jegyek;
}

const csapatok = [];
for (let n = 1; n <= CSAPAT_DB; n++) {
  const betu = KEZDOBETUK[n - 1];

  let pid = jatekKod(betu);
  while (foglaltAzonosito.has(pid)) pid = jatekKod(betu);
  foglaltAzonosito.add(pid);

  const kod = betu + tisztaKod(CODE_ALPHABET, 7, foglaltKod, betu);
  csapatok.push({ szam: n, kod, publicId: pid });
}

// A cetlik kodjai valtozatlanok maradhatnak: ha mar ki vannak nyomtatva,
// nincs ertelme ujat generalni csak azert, mert a csapatkodok cserelodnek.
let cetlik;
if (csakCsapat) {
  const meglevo = await import(`file://${CEL.replace(/\\/g, '/')}`);
  cetlik = meglevo.CETLI_KODOK.map((v) => ({ kod: v.kod, token: v.token }));
  for (const v of cetlik) foglaltKod.add(v.kod);
} else {
  cetlik = [];
  for (let i = 0; i < CETLI_DB; i++) {
    cetlik.push({
      kod: tisztaKod(LETTERS, 4, foglaltKod),
      token: crypto.randomBytes(16).toString('base64url'),
    });
  }
}

const tartalom = `/**
 * A 9 csapat es a ${CETLI_DB} szavazocetli VEGLEGES kodjai.
 *
 * Ezek kerulnek nyomtatasba, ezert a kodbazis reszei: uj adatbazis, nullazas
 * vagy elveszett volume utan is ugyanezek allnak vissza. NE ird at oket, ha
 * a lapok mar ki vannak nyomtatva.
 *
 * Generalva: ${new Date().toISOString().slice(0, 10)} a scripts/kodokat-general.mjs szkripttel.
 */

/** Csapatok: a kod a konzol es az API kulcsa, a publicId a szavazolap cimeben van (A-445-531). */
export const CSAPAT_KODOK = [
${csapatok.map((t) => `  { szam: ${t.szam}, kod: '${t.kod}', publicId: '${t.publicId}' },`).join('\n')}
];

/** Szavazocetlik: a kod kezzel beirhato, a token a QR-ben levo /v/<token> cimben. */
export const CETLI_KODOK = [
${cetlik.map((v) => `  { kod: '${v.kod}', token: '${v.token}' },`).join('\n')}
];
`;

const ir = process.argv.includes('--ir');
const ujra = process.argv.includes('--ujra');

if (ir && fs.existsSync(CEL) && !ujra) {
  console.log(`A ${path.relative(GYOKER, CEL)} mar letezik.`);
  console.log('Ha tenyleg uj kodokat akarsz (a kinyomtatott lapok ervenytelenne valnak),');
  console.log('futtasd igy:  node scripts/kodokat-general.mjs --ir --ujra');
  process.exit(1);
}

if (ir) {
  fs.writeFileSync(CEL, tartalom, 'utf8');
  console.log(`Kesz: ${path.relative(GYOKER, CEL)}`);
} else {
  console.log(tartalom);
  console.log('// Ez csak elonezet. Kiirashoz:  node scripts/kodokat-general.mjs --ir');
}
