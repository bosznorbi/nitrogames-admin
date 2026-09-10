/**
 * A gep halozati IP cime, hogy helyi futtatasnal is telefonrol
 * beolvashato QR kodok keszuljenek, ne localhostra mutatok.
 */
import os from 'node:os';
import dgram from 'node:dgram';

const VIRTUAL_NIC = /vethernet|virtual|vmware|hyper-v|tailscale|zerotier|docker|wsl|loopback/i;

let cache = null;

/** Az osszes valodi (nem virtualis) IPv4 cim, elonyben a 192.168-as. */
export function localIps() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_NIC.test(name)) continue;
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) out.push({ name, ip: n.address });
    }
  }
  const score = (a) => (a.ip.startsWith('192.168.') ? 0 : a.ip.startsWith('10.') ? 1 : 2);
  return out.sort((a, b) => score(a) - score(b));
}

/**
 * Melyik interfeszen menne ki egy valodi kapcsolat? Ez megbizhatobb, mint
 * talalgatni a virtualis adapterek kozott. Csomagot nem kuldunk, csak
 * utvonalat valasztatunk az operacios rendszerrel.
 */
export async function detectLanIp() {
  const kimeno = await new Promise((resolve) => {
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
    setTimeout(() => done(null), 800);
  });

  const cimek = localIps();
  const valid = kimeno && cimek.some((a) => a.ip === kimeno);
  cache = valid ? kimeno : (cimek[0] ? cimek[0].ip : null);
  return cache;
}

/** A legutobb felismert cim. Null, ha nincs halozat, vagy meg nem futott a felismeres. */
export function lanIp() {
  return cache;
}
