/**
 * Kiirja, milyen cimen erik el a telefonok a futo appot, es rajzol egy QR
 * kodot a terminalba, amit rogton be lehet olvasni.
 *
 *   npm run lan
 */
import 'dotenv/config';
import QRCode from 'qrcode';
import { detectLanIp, localIps } from '../src/lib/lan.js';

const port = Number.parseInt(process.env.PORT ?? '', 10) || 3000;
const ip = await detectLanIp();

if (!ip) {
  console.log('\n  Nem találtam hálózati IPv4 címet. Csatlakozz wifire, vagy kapcsolj hotspotot.\n');
  process.exit(0);
}

const cim = `http://${ip}:${port}`;

console.log('');
console.log('  Telefonról ezen a címen éred el az appot:');
console.log('');
console.log(`    ${cim}`);
console.log('');
console.log('  A szerver a QR kódokba is ezt a címet írja, tehát a kinyomtatott');
console.log('  és a képernyőn megjelenő kódok is működnek telefonról.');

const tobbi = localIps().filter((a) => a.ip !== ip);
if (tobbi.length) {
  console.log('');
  console.log('  Ha ez nem jó, próbáld ezeket:');
  for (const a of tobbi) console.log(`    http://${a.ip}:${port}   (${a.name})`);
}

console.log('');
console.log('  Olvasd be ezt a QR kódot a telefonoddal:');
console.log('');
console.log(await QRCode.toString(cim, { type: 'terminal', small: true, errorCorrectionLevel: 'L' }));
console.log('  Ha nem tölt be, a Windows tűzfalon engedélyezd a Node.js bejövő');
console.log(`  kapcsolatait a(z) ${port}-es porton.`);
console.log('');
