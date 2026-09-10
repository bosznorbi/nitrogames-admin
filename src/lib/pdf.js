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

/**
 * Csapat beleptetolap: harom EGYFORMA sav egy A4 lapon. A lap magassaga
 * pontosan harmadolva van, a ket vagovonal a harmadoknal fut, igy a ket
 * vagas utan mindharom lap ugyanakkora lesz.
 *
 * @param {Array<{code:string, console_url:string}>} teams
 */
export async function teamSheetPdf(teams, { base = '' } = {}) {
  const savH = PAGE.height / 3;
  const oldalPad = mm(12);
  const belsoPad = mm(11);
  const doc = newDoc('Nitrogames csapat belépők');
  const qrs = await Promise.all(teams.map((t) => qrPngBuffer(t.console_url, { size: 600 })));
  const host = base.replace(/^https?:\/\//, '');

  teams.forEach((team, i) => {
    const slot = i % 3;
    if (slot === 0) {
      doc.addPage();
      // Csak a két vágóvonal kell: két vágás, három egyforma lap.
      for (const vonal of [savH, savH * 2]) {
        doc.save().dash(4, { space: 4 }).lineWidth(0.6).strokeColor(CUT)
          .moveTo(0, vonal).lineTo(PAGE.width, vonal).stroke().undash().restore();
      }
    }

    const y = slot * savH;
    const qrSize = mm(46);
    const qx = PAGE.width - oldalPad - qrSize;
    const lx = oldalPad;
    const leftW = qx - lx - mm(10);

    // A QR teteje és a logó teteje egy vonalban.
    const teteje = y + belsoPad;
    doc.image(LOGO, lx, teteje, { width: mm(40) });
    doc.image(qrs[i], qx, teteje, { width: qrSize });

    // A szöveg a sáv aljára zárva, így a logó alatt levegő marad.
    const alja = y + savH - belsoPad;
    let cy = alja - mm(38);

    doc.font('sans').fontSize(9).fillColor(MUTED).text('A csapatkódotok:', lx, cy, { width: leftW });
    cy += mm(5);
    doc.font('bold').fontSize(28).fillColor(INK)
      .text(team.code, lx, cy, { width: leftW, characterSpacing: 1.5 });
    cy += mm(13);

    doc.font('sans').fontSize(9).fillColor(MUTED).text('Írjátok be a böngészőbe:', lx, cy, { width: leftW });
    cy += mm(4.5);
    doc.font('bold').fontSize(12).fillColor(INK)
      .text(host + '/csapat', lx, cy, { width: leftW, lineBreak: false });
    cy += mm(7.5);

    doc.font('sans').fontSize(8.5).fillColor(MUTED).text(
      'Ezzel a kóddal éritek el a csapat konzolt és az API-t, ahányan akarjátok, '
      + 'telefonról és gépről is. Más csapatnak ne adjátok oda.',
      lx, cy, { width: leftW, lineGap: 1 }
    );
  });

  if (!teams.length) {
    doc.addPage().font('sans').fontSize(12).fillColor(INK)
      .text('Még nincs egyetlen aktív csapat sem.', MARGIN, MARGIN);
  }

  return toBuffer(doc);
}
