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
  const colW = USABLE.width / columns;
  const padX = mm(1.5);
  const fejlecH = mm(6);
  const qrSize = Math.min(colW - 2 * padX, mm(30));
  const rowH = fejlecH + qrSize + mm(9);
  const rows = Math.max(1, Math.floor(USABLE.height / rowH));
  const perPage = columns * rows;

  const doc = newDoc('Nitrogames szavazói belépők');
  const qrs = await Promise.all(voters.map((v) => qrPngBuffer(v.login_url, { size: 400 })));

  voters.forEach((voter, i) => {
    const slot = i % perPage;
    if (slot === 0) doc.addPage();

    const x = MARGIN + (slot % columns) * colW;
    const y = MARGIN + Math.floor(slot / columns) * rowH;
    cutBox(doc, x, y, colW, rowH);

    // Fejléc: a jel és a NITROGAMES felirat egy sorban, középre igazítva.
    const jelH = mm(3.6);
    const jelW = jelH * (400 / 368);
    doc.font('bold').fontSize(7.5);
    const szoW = doc.widthOfString('NITROGAMES', { characterSpacing: 0.7 });
    const egyutt = jelW + mm(1.2) + szoW;
    const fx = x + (colW - egyutt) / 2;
    const fy = y + mm(2);
    doc.image(JEL, fx, fy, { height: jelH });
    doc.fillColor(INK).text('NITROGAMES', fx + jelW + mm(1.2), fy + mm(0.4), {
      characterSpacing: 0.7,
      lineBreak: false,
    });

    doc.image(qrs[i], x + (colW - qrSize) / 2, y + fejlecH, { width: qrSize });
    doc.font('bold').fontSize(15).fillColor(INK).text(
      voter.code.split('').join(' '),
      x + padX,
      y + fejlecH + qrSize + mm(1.2),
      { width: colW - 2 * padX, align: 'center', lineBreak: false }
    );
  });

  if (!voters.length) {
    doc.addPage().font('sans').fontSize(12).fillColor(INK)
      .text('Még nincs egyetlen szavazó sem.', MARGIN, MARGIN);
  }

  return toBuffer(doc);
}

/**
 * Csapat beleptetolap: harom fer egy A4 lapra. Nem kiallitasra valo, ezzel
 * csatlakoznak a sajat csapatukhoz. Rajta a kod, a konzol cime es egy QR,
 * amit telefonrol tovabb tudnak kuldeni a munkagepre.
 *
 * @param {Array<{code:string, console_url:string}>} teams
 */
export async function teamSheetPdf(teams, { base = '' } = {}) {
  const gap = mm(3);
  const ticketH = (USABLE.height - 2 * gap) / 3;
  const doc = newDoc('Nitrogames csapat belépők');
  const qrs = await Promise.all(teams.map((t) => qrPngBuffer(t.console_url, { size: 600 })));
  const host = base.replace(/^https?:\/\//, '');

  teams.forEach((team, i) => {
    if (i % 3 === 0) doc.addPage();

    const x = MARGIN;
    const y = MARGIN + (i % 3) * (ticketH + gap);
    cutBox(doc, x, y, USABLE.width, ticketH);

    const padding = mm(8);
    const qrSize = mm(46);
    const qx = x + USABLE.width - padding - qrSize;
    const leftW = qx - x - 2 * padding;
    const lx = x + padding;
    let cy = y + padding;

    doc.image(LOGO, lx, cy, { width: mm(38) });
    cy += mm(9);

    doc.font('sans').fontSize(9).fillColor(MUTED).text('A csapatkódotok:', lx, cy, { width: leftW });
    cy += mm(5);

    doc.font('bold').fontSize(28).fillColor(INK)
      .text(team.code, lx, cy, { width: leftW, characterSpacing: 1.5 });
    cy += mm(13);

    doc.font('sans').fontSize(9).fillColor(MUTED).text('Írjátok be a böngészőbe:', lx, cy, { width: leftW });
    cy += mm(4.5);
    doc.font('bold').fontSize(12).fillColor(INK)
      .text(`${host}/csapat`, lx, cy, { width: leftW, lineBreak: false });
    cy += mm(8);

    doc.font('sans').fontSize(8.5).fillColor(MUTED).text(
      'Ezzel a kóddal éritek el a csapat konzolt és az API-t, ahányan akarjátok, '
      + 'telefonról és gépről is. Más csapatnak ne adjátok oda.',
      lx, cy, { width: leftW, lineGap: 1 }
    );

    const qy = y + (ticketH - qrSize - mm(5)) / 2;
    doc.image(qrs[i], qx, qy, { width: qrSize });
    doc.font('sans').fontSize(7.5).fillColor(MUTED)
      .text('Csapat konzol', qx, qy + qrSize + mm(1.6), { width: qrSize, align: 'center', lineBreak: false });
  });

  if (!teams.length) {
    doc.addPage().font('sans').fontSize(12).fillColor(INK)
      .text('Még nincs egyetlen aktív csapat sem.', MARGIN, MARGIN);
  }

  return toBuffer(doc);
}
