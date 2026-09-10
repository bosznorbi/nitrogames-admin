/**
 * Kiirja, milyen cimen erik el a telefonok a futo appot a helyi halozaton,
 * es rajzol egy QR kodot a terminalba, amit rogton be lehet olvasni.
 *
 *   npm run lan
 */
import os from 'node:os';
import dgram from 'node:dgram';
import QRCode from 'qrcode';
import 'dotenv/config';

const port = Number.parseInt(process.env.PORT ?? '', 10) || 3000;

const addresses = [];
for (const [name, list] of Object.entries(os.networkInterfaces())) {
  for (const n of list || []) {
    if (n.family === 'IPv4' && !n.internal) addresses.push({ name, ip: n.address });
  }
}

if (!addresses.length) {
  console.log('Nem találtam hálózati IPv4 címet. Csatlakozz wifire vagy kábelre.');
  process.exit(0);
}

/**
 * Melyik interfeszen menne ki egy valodi kapcsolat? Ez sokkal
 * megbizhatobb, mint talalgatni a virtualis adapterek kozott.
 * Csomagot nem kuldunk, csak utvonalat valasztatunk az operacios rendszerrel.
 */
async function outboundIp() {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const done = (value) => {
      try { sock.close(); } catch {}
      resolve(value);
    };
    sock.on('error', () => done(null));
    try {
      sock.connect(53, '8.8.8.8', () => done(sock.address().address));
    } catch {
      done(null);
    }
    setTimeout(() => done(null), 1000);
  });
}

const primary = await outboundIp();
const score = (a) => {
  if (a.ip === primary) return -1;
  if (/vethernet|virtual|vmware|hyper-v|loopback|tailscale|zerotier|docker|wsl/i.test(a.name)) return 5;
  if (a.ip.startsWith('192.168.')) return 0;
  if (a.ip.startsWith('10.')) return 1;
  return 2;
};
addresses.sort((a, b) => score(a) - score(b));

console.log('');
console.log('  Telefonról ezeken a címeken éred el az appot');
console.log('  (a telefon és a gép ugyanazon a wifin legyen):');
console.log('');
for (const a of addresses) {
  const mark = a.ip === primary ? '  <- ezt próbáld először' : '';
  console.log(`    http://${a.ip}:${port}      ${a.name}${mark}`);
}

const best = `http://${addresses[0].ip}:${port}`;
console.log('');
console.log(`  Olvasd be ezt a QR kódot a telefonoddal (${best}):`);
console.log('');
console.log(await QRCode.toString(best, { type: 'terminal', small: true, errorCorrectionLevel: 'L' }));
console.log('  Ha nem tölt be, a Windows tűzfalon engedélyezd a Node.js bejövő');
console.log(`  kapcsolatait a(z) ${port}-es porton (privát hálózatra).`);
console.log('');
