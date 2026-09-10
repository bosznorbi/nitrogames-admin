/**
 * Nyomtathato ivek PDF-ben, szerveroldalon.
 *
 * Sajat betutipust agyazunk be: a PDF beepitett fontjai WinAnsi kodolasuak,
 * abbol hianyzik az o" es u" (U+0151, U+0171), tehat a magyar csapatnevek
 * elromlananak. A DejaVu Sans lefedi oket.
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
const MUTED = '#6b7280';
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
 * Szavazoi belepok: suru vagoracs, cetlinkent QR + 5 karakteres kod.
 * @param {Array<{code: string, login_url: string}>} voters
 */
export async function votersPdf(voters, { cols = 4, host = '' } = {}) {
  const columns = Math.min(Math.max(Number(cols) || 4, 2), 8);
  const colW = USABLE.width / columns;
  const padX = mm(1.5);
  const qrSize = Math.min(colW - 2 * padX, mm(32));
  const rowH = qrSize + mm(13.5);
  const rows = Math.max(1, Math.floor(USABLE.height / rowH));
  const perPage = columns * rows;

  const doc = newDoc('Nitrogames szavazói belépők');
  const qrs = await Promise.all(voters.map((v) => qrPngBuffer(v.login_url, { size: 400 })));

  voters.forEach((voter, i) => {
    const slot = i % perPage;
    if (slot === 0) doc.addPage();

    const col = slot % columns;
    const row = Math.floor(slot / columns);
    const x = MARGIN + col * colW;
    const y = MARGIN + row * rowH;

    cutBox(doc, x, y, colW, rowH);
    doc.image(qrs[i], x + (colW - qrSize) / 2, y + mm(2.5), { width: qrSize });

    doc.font('bold').fontSize(13).fillColor(INK).text(
      voter.code.split('').join(' '),
      x + padX,
      y + mm(2.5) + qrSize + mm(1.5),
      { width: colW - 2 * padX, align: 'center', lineBreak: false }
    );

    if (host) {
      doc.font('sans').fontSize(6.5).fillColor(MUTED).text(
        host,
        x + padX,
        y + mm(2.5) + qrSize + mm(7),
        { width: colW - 2 * padX, align: 'center', lineBreak: false }
      );
    }
  });

  if (!voters.length) {
    doc.addPage().font('sans').fontSize(12).fillColor(INK)
      .text('Még nincs egyetlen szavazó sem.', MARGIN, MARGIN);
  }

  return toBuffer(doc);
}

/**
 * Csapattablak: A5 meret, pontosan ketto egy A4 lapon.
 * @param {Array<{number: number, name: string, game_name: ?string, vote_url: string}>} teams
 */
export async function teamsPdf(teams) {
  const gap = mm(4);
  const ticketH = (USABLE.height - gap) / 2;
  const doc = newDoc('Nitrogames csapat QR-ív');
  const qrs = await Promise.all(teams.map((t) => qrPngBuffer(t.vote_url, { size: 700 })));

  teams.forEach((team, i) => {
    const slot = i % 2;
    if (slot === 0) doc.addPage();

    const x = MARGIN;
    const y = MARGIN + slot * (ticketH + gap);
    cutBox(doc, x, y, USABLE.width, ticketH);

    const title = `${team.number}. csapat`;
    const subtitle = team.game_name || (team.name === title ? null : team.name);
    const qrSize = mm(70);
    const innerW = USABLE.width - mm(20);
    const innerX = x + mm(10);

    // Elore kiszamoljuk a magassagot, hogy fuggolegesen kozepre kerulhessen.
    doc.font('bold').fontSize(30);
    const titleH = doc.heightOfString(title, { width: innerW });
    doc.font('bold').fontSize(16);
    const subH = subtitle ? doc.heightOfString(subtitle, { width: innerW }) + mm(1) : 0;
    const total = titleH + subH + mm(4) + qrSize + mm(4) + mm(9);

    let cursor = y + (ticketH - total) / 2;

    doc.font('bold').fontSize(30).fillColor(INK)
      .text(title, innerX, cursor, { width: innerW, align: 'center' });
    cursor += titleH;

    if (subtitle) {
      doc.font('bold').fontSize(16).fillColor(INK)
        .text(subtitle, innerX, cursor + mm(1), { width: innerW, align: 'center' });
      cursor += subH;
    }

    cursor += mm(4);
    doc.image(qrs[i], x + (USABLE.width - qrSize) / 2, cursor, { width: qrSize });
    cursor += qrSize + mm(4);

    doc.font('sans').fontSize(10).fillColor(INK)
      .text('Olvasd be, és pontozd ezt a játékot!', innerX, cursor, { width: innerW, align: 'center' });
    doc.font('sans').fontSize(7.5).fillColor(MUTED)
      .text(team.vote_url, innerX, cursor + mm(5), { width: innerW, align: 'center', lineBreak: false });
  });

  if (!teams.length) {
    doc.addPage().font('sans').fontSize(12).fillColor(INK)
      .text('Még nincs egyetlen aktív csapat sem.', MARGIN, MARGIN);
  }

  return toBuffer(doc);
}

/** Egy csapat sajat A5 tablaja, hogy ok maguk is ki tudjak nyomtatni. */
export async function singleTeamPdf(team) {
  return teamsPdf([team]);
}
