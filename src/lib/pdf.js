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

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');
const REGULAR = path.join(FONT_DIR, 'DejaVuSans.ttf');
const BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

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
  const qrSize = Math.min(colW - 2 * padX, mm(32));
  const rowH = qrSize + mm(11);
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
    doc.image(qrs[i], x + (colW - qrSize) / 2, y + mm(2.5), { width: qrSize });
    doc.font('bold').fontSize(15).fillColor(INK).text(
      voter.code.split('').join(' '),
      x + padX,
      y + mm(2.5) + qrSize + mm(1.5),
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
 * Csapat beleptetolap: A5, ketto egy A4 lapon. Nem kiallitasra valo, hanem
 * ezzel csatlakoznak a sajat csapatukhoz: rajta a kod, a szervercim, es egy
 * QR, amit telefonrol tovabb tudnak kuldeni maguknak a munkagepre.
 *
 * @param {Array<{number:number, code:string, console_url:string}>} teams
 */
export async function teamSheetPdf(teams, { base = '' } = {}) {
  const gap = mm(4);
  const ticketH = (USABLE.height - gap) / 2;
  const doc = newDoc('Nitrogames csapat belépők');
  const qrs = await Promise.all(teams.map((t) => qrPngBuffer(t.console_url, { size: 600 })));
  const host = base.replace(/^https?:\/\//, '');

  teams.forEach((team, i) => {
    if (i % 2 === 0) doc.addPage();

    const x = MARGIN;
    const y = MARGIN + (i % 2) * (ticketH + gap);
    cutBox(doc, x, y, USABLE.width, ticketH);

    const padding = mm(10);
    const qrSize = mm(52);
    const leftW = USABLE.width - qrSize - 3 * padding;
    const lx = x + padding;
    // A bal oldali blokk kozelitoleg 66 mm magas, ezt kozepre tesszuk.
    let cy = y + (ticketH - mm(66)) / 2;

    doc.font('bold').fontSize(26).fillColor(INK)
      .text(`${team.number}. csapat`, lx, cy, { width: leftW });
    cy += mm(13);

    doc.font('sans').fontSize(10).fillColor(MUTED)
      .text('A csapatkódotok, ezzel éritek el az API-t:', lx, cy, { width: leftW });
    cy += mm(6);

    doc.font('bold').fontSize(30).fillColor(INK)
      .text(team.code, lx, cy, { width: leftW, characterSpacing: 1.5 });
    cy += mm(15);

    doc.font('sans').fontSize(10).fillColor(MUTED)
      .text('A szerver címe:', lx, cy, { width: leftW });
    cy += mm(5);
    doc.font('bold').fontSize(12).fillColor(INK)
      .text(host, lx, cy, { width: leftW, lineBreak: false });
    cy += mm(10);

    doc.font('sans').fontSize(9).fillColor(MUTED).text(
      'Olvassátok be a QR-kódot telefonnal, és küldjétek át magatoknak Teamsen arra a gépre, '
      + 'amin fejlesztetek. A megnyíló oldal mindent megmutat: mit kell feltölteni, és mi hiányzik még.',
      lx, cy, { width: leftW, lineGap: 1.5 }
    );

    const qx = x + USABLE.width - padding - qrSize;
    const qy = y + (ticketH - qrSize - mm(6)) / 2;
    doc.image(qrs[i], qx, qy, { width: qrSize });
    doc.font('sans').fontSize(8).fillColor(MUTED)
      .text('Csapat konzol', qx, qy + qrSize + mm(2), { width: qrSize, align: 'center', lineBreak: false });
  });

  if (!teams.length) {
    doc.addPage().font('sans').fontSize(12).fillColor(INK)
      .text('Még nincs egyetlen aktív csapat sem.', MARGIN, MARGIN);
  }

  return toBuffer(doc);
}
