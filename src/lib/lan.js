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
function kimenoCim(cel) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let kesz = false;
    const done = (value) => {
      if (kesz) return;
      kesz = true;
      try { sock.close(); } catch {}
      resolve(value);
    };
    sock.on('error', () => done(null));
    try {
      sock.connect(53, cel, () => {
        try { done(sock.address().address); } catch { done(null); }
      });
    } catch {
      done(null);
    }
    setTimeout(() => done(null), 1500);
  });
}

export async function detectLanIp() {
  // Ket celt probalunk: hotspoton vagy szurt halozaton az egyik cim elerhetetlen
  // lehet, olyankor a masik valasztja ki a helyes interfeszt.
  let kimeno = await kimenoCim('8.8.8.8');
  if (!kimeno) kimeno = await kimenoCim('1.1.1.1');

  // A friss interfesz-lista donti el, hogy a talalt cim tenyleg letezik-e most:
  // wifiváltás utan a regi cim mar nem szerepel benne.
  const cimek = localIps();
  const valid = kimeno && cimek.some((a) => a.ip === kimeno);
  cache = valid ? kimeno : (cimek[0] ? cimek[0].ip : null);
  return cache;
}

/**
 * Kezi felulbiralas: ha az automatikus valasztas melle nyul, a listabol
 * barmelyik valodi cim beallithato. Ismeretlen cimet nem fogadunk el.
 */
export function setLanIp(ip) {
  if (!localIps().some((a) => a.ip === ip)) return null;
  cache = ip;
  return cache;
}

/** A legutobb felismert cim. Null, ha nincs halozat, vagy meg nem futott a felismeres. */
export function lanIp() {
  return cache;
}
