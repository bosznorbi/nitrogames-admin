/**
 * Nyomtathato ivek PDF-ben, szerveroldalon.
 *
 * Sajat betutipust agyazunk be: a PDF beepitett fontjai WinAnsi kodolasuak,
 * abbol hianyzik az o" es u" (U+0151, U+0171), tehat a magyar szoveg
 * elromlana. A DejaVu Sans lefedi oket.
 */
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qrPngBuffer } from './qr.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets');
const REGULAR = path.join(ASSETS, 'fonts/DejaVuSans.ttf');
const ARCADE = path.join(ASSETS, 'fonts/PixelifySans.ttf');
const BOLD = path.join(ASSETS, 'fonts/DejaVuSans-Bold.ttf');
const LOGO = path.join(ASSETS, 'logo-full-blue.png');
const JEL = path.join(ASSETS, 'logo-mark-blue.png');

/** Millimeter -> PDF pont. */
const mm = (v) => v * 2.834645669;

const MARGIN = mm(8);
const PAGE = { width: mm(210), height: mm(297) };
const USABLE = { width: PAGE.width - 2 * MARGIN, height: PAGE.height - 2 * MARGIN };

const INK = '#111111';
const MUTED = '#5b6377';
const CUT = '#b9c0cf';

function newDoc(title) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: title }, autoFirstPage: false });
  doc.registerFont('sans', REGULAR);
  doc.registerFont('bold', BOLD);
  doc.registerFont('arcade', ARCADE);
  return doc;
}

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function cutBox(doc, x, y, w, h) {
  doc.save().dash(3, { space: 3 }).lineWidth(0.5).strokeColor(CUT).rect(x, y, w, h).stroke().undash().restore();
}

/**
 * Szavazoi belepok. Egy cetlin csak a QR es a betukod van, semmi mas.
 * @param {Array<{code: string, login_url: string}>} voters
 */
export async function votersPdf(voters, { cols = 4 } = {}) {
  const columns = Math.min(Math.max(Number(cols) || 4, 2), 8);
  const rows = 4;
  const colW = USABLE.width / columns;
  const rowH = USABLE.height / rows;
  const perPage = columns * rows;

  const doc = newDoc('Nitrogames szavazói belépők');
  const qrs = await Promise.all(voters.map((v) => qrPngBuffer(v.login_url, { size: 400 })));

  voters.forEach((voter, i) => {
    const slot = i % perPage;
    if (slot === 0) doc.addPage();

    const x = MARGIN + (slot % columns) * colW;
    const y = MARGIN + Math.floor(slot / columns) * rowH;
    cutBox(doc, x, y, colW, rowH);

    // Fejléc: a jel és a NITROGAMES felirat egy sorban, középen.
    const jelH = mm(4.6);
    const jelW = jelH * (400 / 368);
    doc.font('arcade').fontSize(11);
    const szoW = doc.widthOfString('NITROGAMES', { characterSpacing: 0.8 });
    const egyutt = jelW + mm(1.6) + szoW;
    const fx = x + (colW - egyutt) / 2;
    const fy = y + mm(6);
    doc.image(JEL, fx, fy, { height: jelH });
    doc.fillColor(INK).text('NITROGAMES', fx + jelW + mm(1.6), fy + mm(0.6), {
      characterSpacing: 0.8,
      lineBreak: false,
    });

    const qrSize = Math.min(colW - mm(9), mm(34));
    const qy = y + mm(15);
    doc.image(qrs[i], x + (colW - qrSize) / 2, qy, { width: qrSize });

    doc.font('bold').fontSize(16).fillColor(INK).text(
      voter.code.split('').join(' '),
      x + mm(2),
      qy + qrSize + mm(5),
      { width: colW - mm(4), align: 'center', lineBreak: false }
    );
  });

  if (!voters.length) {
    doc.addPage().font('sans').fontSize(12).fillColor(INK)
      .text('Még nincs egyetlen szavazó sem.', MARGIN, MARGIN);
  }

  return toBuffer(doc);
}

/* ---------- csapat kezdocsomag ---------- */

/**
 * A harom kemeny feltetel. Szo szerint a kontroller-csomag README-jebol,
 * mert a csapatok ugyanezt kapjak a promptban is: ne terjen el a ketto.
 */
export const ALAPSZABALYOK = [
  'Két játékos, egy gépen. Mindkét kontroller irányítson valamit.',
  'Egy percen belül dőljön el, ki a győztes.',
  'A kör legyen újraindítható a lap újratöltése nélkül.',
];

export const MENETREND = [
  'Most: kitaláljátok a játékot, és AI-jal megépítitek.',
  'Közben: a csapat konzolon feltöltitek a nevet, a leírást, a háttér- és a csempeképet.',
  'A végén: letöltitek a saját QR-kódotokat, és kreatív designt csináltok a játék köré. '
  + 'A QR-kódot építsétek bele úgy, ahogy szeretnétek, ez kerül az asztalotokra.',
  'A bemutatón: kirakjuk a gépeket, és bárki leülhet egymás ellen játszani a játékotokkal.',
  'Pontozás: aki játszott, beolvassa a designotokba épített QR-t, és ott pontoz.',
  'Zárás: lezárjuk a szavazást, és kivetítjük az eredményhirdetést.',
];

/** Kis szakaszcim vekony alahuzassal. */
function szakaszCim(doc, cim, x, y, w) {
  doc.font('arcade').fontSize(11).fillColor(INK).text(cim.toUpperCase(), x, y, { width: w });
  const vy = y + mm(4.6);
  doc.save().lineWidth(0.7).strokeColor('#c7ccd8')
    .moveTo(x, vy).lineTo(x + w, vy).stroke().restore();
  return vy + mm(2.2);
}

/**
 * Egy felsorolaspont. A kiemelt resz ugyanabban a bekezdesben folytatodik,
 * nem kulon sorban: igy ket helyett egy sor lesz belole, es kifer az A5.
 */
function pont(doc, jel, szoveg, x, y, w, { meret = 8, kiemelt = null, vastag = false } = {}) {
  const behuzas = mm(3.6);
  doc.font('bold').fontSize(meret).fillColor('#8b93a5').text(jel, x, y, { width: behuzas });

  const tx = x + behuzas;
  const tw = w - behuzas;

  if (vastag) {
    doc.font('bold').fontSize(meret).fillColor(INK).text(szoveg, tx, y, { width: tw, lineGap: 0.5 });
  } else if (kiemelt && !szoveg) {
    doc.font('bold').fontSize(meret).fillColor(INK)
      .text(kiemelt, tx, y, { width: tw, lineGap: 0.5 });
  } else if (kiemelt) {
    doc.font('bold').fontSize(meret).fillColor(INK)
      .text(`${kiemelt}. `, tx, y, { width: tw, lineGap: 0.5, continued: true });
    doc.font('sans').fontSize(meret).fillColor(MUTED).text(szoveg, { lineGap: 0.5 });
  } else {
    doc.font('sans').fontSize(meret).fillColor(INK).text(szoveg, tx, y, { width: tw, lineGap: 0.5 });
  }
  return doc.y + mm(1.2);
}

/**
 * Csapat kezdocsomag: egy A5 oldal csapatonkent, ketto egy fektetett A4-en,
 * kozottuk egyetlen vagovonal. A ket fel pontosan egyforma, es mindenhol
 * ugyanakkora a margo, hogy vagas utan is szimmetrikus legyen.
 *
 * @param {Array<{code:string, console_url:string}>} teams
 * @param {{base?:string, repoUrl?:string, criteria?:Array<{label:string,description:string}>}} opts
 */
export async function teamSheetPdf(teams, { base = '', repoUrl = '', criteria = [] } = {}) {
  const LAP = { width: mm(297), height: mm(210) };
  const felW = LAP.width / 2;
  const pad = mm(10);
  const doc = newDoc('Nitrogames csapat kezdőcsomag');
  const qrs = await Promise.all(teams.map((t) => qrPngBuffer(t.console_url, { size: 600 })));
  const host = base.replace(/^https?:\/\//, '');
  const repo = repoUrl.replace(/^https?:\/\//, '');

  teams.forEach((team, i) => {
    const oldal = i % 2;
    if (oldal === 0) {
      doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
      // Egyetlen vágás középen: két egyforma A5.
      doc.save().dash(4, { space: 4 }).lineWidth(0.6).strokeColor(CUT)
        .moveTo(felW, 0).lineTo(felW, LAP.height).stroke().undash().restore();
    }

    const x0 = oldal * felW;
    const lx = x0 + pad;
    const w = felW - 2 * pad;

    /* --- fejléc: logó balra, QR jobbra, tetejük egy vonalban --- */

    const qrMeret = mm(30);
    const qx = x0 + felW - pad - qrMeret;
    const teteje = pad;

    doc.image(LOGO, lx, teteje, { width: mm(34) });
    doc.image(qrs[i], qx, teteje, { width: qrMeret });
    // A felirat a QR alatt, pontosan a QR szélességébe zárva középre. 6 ponton
    // 27 mm szeles, tehat a 30 mm-es QR ket széle marad a margója.
    doc.font('sans').fontSize(6).fillColor(MUTED).text(
      'Csapatotok adminfelülete', qx, teteje + qrMeret + mm(1.6),
      { width: qrMeret, align: 'center' }
    );

    const balW = qx - lx - mm(6);
    let cy = teteje + mm(12);

    doc.font('sans').fontSize(7.5).fillColor(MUTED).text('A CSAPATKÓDOTOK', lx, cy, { width: balW, characterSpacing: 0.8 });
    cy += mm(4);
    doc.font('bold').fontSize(21).fillColor(INK).text(team.code, lx, cy, { width: balW, characterSpacing: 1.2 });
    cy += mm(9.5);

    doc.font('sans').fontSize(7.5).fillColor(MUTED).text('A konzolotok', lx, cy, { width: balW });
    cy += mm(3.6);
    doc.font('bold').fontSize(9.5).fillColor(INK).text(`${host}/csapat`, lx, cy, { width: balW, lineBreak: false });
    cy += mm(5.4);

    if (repo) {
      doc.font('sans').fontSize(7.5).fillColor(MUTED).text('Segédanyag és kontroller-csomag', lx, cy, { width: balW });
      cy += mm(3.6);
      doc.font('bold').fontSize(9.5).fillColor(INK).text(repo, lx, cy, { width: balW, lineBreak: false });
      cy += mm(5.4);
    }

    /* --- a lap többi része a fejléc alatt, teljes szélességben --- */

    let y = Math.max(cy + mm(2), teteje + qrMeret + mm(6));

    y = szakaszCim(doc, 'A három alapszabály', lx, y, w);
    for (const szabaly of ALAPSZABALYOK) {
      y = pont(doc, '■', szabaly, lx, y, w, { meret: 8, vastag: true });
    }

    y += mm(1.5);
    y = szakaszCim(doc, 'Amire pontoznak', lx, y, w);
    if (criteria.length) {
      for (const c of criteria) {
        y = pont(doc, '▸', c.description || '', lx, y, w, { meret: 8, kiemelt: c.label });
      }
    } else {
      doc.font('sans').fontSize(8).fillColor(MUTED).text('A szempontokat a szervezők állítják be.', lx, y, { width: w });
      y = doc.y + mm(1.4);
    }

    y += mm(1.5);
    y = szakaszCim(doc, 'Menetrend', lx, y, w);
    for (const sor of MENETREND) y = pont(doc, '·', sor, lx, y, w, { meret: 8 });

    /* --- lábléc a lap aljára zárva --- */

    doc.font('sans').fontSize(6.8).fillColor(MUTED).text(
      'A kód a csapaté: a konzolt és az API-t is ezzel éritek el, ahányan akarjátok. '
      + 'Más csapatnak ne adjátok oda, és nyilvános repóba se tegyétek ki.',
      lx, LAP.height - pad - mm(6), { width: w, lineGap: 0.6 }
    );
  });

  if (!teams.length) {
    doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 })
      .font('sans').fontSize(12).fillColor(INK)
      .text('Még nincs egyetlen aktív csapat sem.', mm(12), mm(12));
  }

  return toBuffer(doc);
}
