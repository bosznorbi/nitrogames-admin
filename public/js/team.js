import { el, toast } from '/static/js/app.js';

const $ = (id) => document.getElementById(id);
const STORE = 'ng_team_key';
let key = '';
let spec = null;

/* ---------- API a csapat kulcsaval ---------- */

async function call(path, { method = 'GET', body, contentType } = {}) {
  const headers = { Authorization: `Bearer ${key}` };
  let payload;
  if (body instanceof ArrayBuffer || body instanceof Uint8Array) {
    headers['Content-Type'] = contentType;
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Hiba (${res.status})`);
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------- megjelenites ---------- */

function render(team) {
  const bg = spec.background;
  const logo = spec.logo;

  $('console').replaceChildren(
    el('h1', {}, team.game_name || team.name),
    el('p', { class: 'lead' }, `${team.number}. csapat · a szavazók ezt a nevet és ezt a hátteret látják`),

    el('div', { class: 'card' },
      el('h2', { style: { marginTop: '0' } }, 'Előnézet és QR-kód'),
      el('div', { class: 'preview' },
        el('div', {
          class: 'phone',
          style: team.background_url ? { backgroundImage: `url("${team.background_url}")` } : {},
        }, team.background_url ? '' : 'Még nincs háttérkép: alap fehér design'),
        el('div', {},
          el('p', { class: 'small muted', style: { marginTop: '0' } }, 'A szavazólapotok címe:'),
          el('p', { style: { margin: '0 0 12px' } },
            el('a', { href: team.vote_url, target: '_blank', rel: 'noopener' }, team.vote_url)),
          el('div', { class: 'row tight' },
            el('button', { class: 'mini', onclick: () => downloadQr('png', `${team.slug}-qr.png`) }, 'QR letöltése (PNG)'),
            el('button', { class: 'mini', onclick: () => downloadQr('svg', `${team.slug}-qr.svg`) }, 'QR (SVG)')
          ),
          el('p', { class: 'small muted' }, 'Ezt kinyomtathatjátok a saját táblátokra is.')
        )
      )
    ),

    el('div', { class: 'card' },
      el('h2', { style: { marginTop: '0' } }, 'Játék adatai'),
      field('game_name', 'A játék neve', team.game_name, 'Pl. Űrpatkányok bosszúja'),
      field('tagline', 'Egysoros mottó', team.tagline, 'Pl. Két óra, egy küldetés'),
      field('description', 'Rövid leírás', team.description, 'Mi ez a játék? Hogyan kell játszani?', true),
      el('label', { class: 'field' },
        el('span', {}, 'Kiemelő szín (#rrggbb)'),
        el('div', { class: 'row tight' },
          el('input', { type: 'color', id: 'f_color_picker', value: team.accent_color || '#7c5cff', style: { width: '52px', padding: '4px', height: '46px' } }),
          el('input', { type: 'text', id: 'f_accent_color', value: team.accent_color || '', placeholder: '#7c5cff', class: 'grow', style: { flex: '1' } })
        )
      ),
      el('button', { class: 'btn', id: 'save' }, 'Mentés')
    ),

    uploadCard('background', 'Háttérkép', bg,
      'Ez tölti ki a szavazólapotok teljes hátterét a telefonon. Álló, 9:16 arányú kép.'),
    uploadCard('logo', 'Logó (nem kötelező)', logo, 'Négyzetes kép, átlátszó PNG ajánlott.'),

    docsCard(team)
  );

  $('f_color_picker').addEventListener('input', (e) => { $('f_accent_color').value = e.target.value; });
  $('save').addEventListener('click', save);
  wireUpload('background');
  wireUpload('logo');
}

/** A QR-t a kulccsal a fejlecben kerjuk le, hogy ne kerüljon a cimsorba. */
async function downloadQr(format, filename) {
  try {
    const res = await fetch(`/api/team/me/qr?format=${format}&size=1000`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error('Nem sikerült lekérni a QR-kódot.');
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    toast(err.message, true);
  }
}

function field(name, label, value, placeholder, multi = false) {
  return el('label', { class: 'field' },
    el('span', {}, label),
    multi
      ? el('textarea', { id: `f_${name}`, maxlength: '600', placeholder }, value || '')
      : el('input', { type: 'text', id: `f_${name}`, value: value || '', maxlength: '120', placeholder })
  );
}

function uploadCard(kind, title, s, hint) {
  return el('div', { class: 'card' },
    el('h2', { style: { marginTop: '0' } }, title),
    el('p', { class: 'small muted', style: { marginTop: '0' } }, hint),
    el('div', { class: 'note', style: { marginBottom: '12px' } },
      el('strong', {}, `Pontosan ${s.width} × ${s.height} képpont`),
      el('div', { class: 'small muted' },
        `Formátum: PNG, JPEG vagy WebP · legfeljebb ${Math.round(spec.max_bytes / 1024 / 1024)} MB. Más méretet az API elutasít.`)
    ),
    el('div', { class: 'row tight' },
      el('input', { type: 'file', id: `up_${kind}`, accept: 'image/png,image/jpeg,image/webp', style: { flex: '1', minWidth: '180px' } }),
      el('button', { class: 'mini danger', id: `del_${kind}` }, 'Törlés')
    ),
    el('div', { class: 'small muted', id: `st_${kind}`, style: { marginTop: '8px' } })
  );
}

function wireUpload(kind) {
  $(`up_${kind}`).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = $(`st_${kind}`);
    const s = spec[kind];

    try {
      const bmp = await createImageBitmap(file);
      if (bmp.width !== s.width || bmp.height !== s.height) {
        status.textContent = `A választott kép ${bmp.width} × ${bmp.height}, de pontosan ${s.width} × ${s.height} kell.`;
        status.style.color = 'var(--danger)';
        return;
      }
    } catch {
      // Ha a bongeszo nem tudja dekodolni, a szerver ugyis ellenorzi.
    }

    status.textContent = 'Feltöltés…';
    status.style.color = '';
    try {
      const buf = await file.arrayBuffer();
      await call(`/api/team/me/${kind}`, { method: 'POST', body: buf, contentType: file.type });
      toast('Feltöltve');
      load();
    } catch (err) {
      status.textContent = err.message;
      status.style.color = 'var(--danger)';
    }
  });

  $(`del_${kind}`).addEventListener('click', async () => {
    if (!confirm('Biztosan törlöd?')) return;
    await call(`/api/team/me/${kind}`, { method: 'DELETE' });
    toast('Törölve');
    load();
  });
}

async function save() {
  const body = {
    game_name: $('f_game_name').value.trim(),
    tagline: $('f_tagline').value.trim(),
    description: $('f_description').value.trim(),
    accent_color: $('f_accent_color').value.trim(),
  };
  if (!body.game_name) delete body.game_name;
  try {
    await call('/api/team/me', { method: 'PUT', body });
    toast('Mentve');
    load();
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------- API leiras ---------- */

function docsCard(team) {
  const base = location.origin;
  const bg = spec.background;

  const curl = [
    '# 1) Ellenőrzés: működik a kulcs?',
    `curl -H "Authorization: Bearer ${key}" \\`,
    `  ${base}/api/team/me`,
    '',
    '# 2) Játék adatainak beállítása',
    `curl -X PUT -H "Authorization: Bearer ${key}" \\`,
    '  -H "Content-Type: application/json" \\',
    `  -d '{"game_name":"A játékunk","tagline":"Egy mondat róla","accent_color":"#ff5c8a"}' \\`,
    `  ${base}/api/team/me`,
    '',
    `# 3) Háttérkép feltöltése (pontosan ${bg.width}x${bg.height})`,
    `curl -X POST -H "Authorization: Bearer ${key}" \\`,
    '  -H "Content-Type: image/png" \\',
    '  --data-binary @hatter.png \\',
    `  ${base}/api/team/me/background`,
    '',
    '# 4) Saját QR kód letöltése',
    `curl -H "Authorization: Bearer ${key}" \\`,
    `  ${base}/api/team/me/qr?size=800 -o csapat-qr.png`,
  ].join('\n');

  const js = [
    'const KEY = "' + key + '";',
    'const BASE = "' + base + '";',
    '',
    'async function setGame(data) {',
    '  const r = await fetch(`${BASE}/api/team/me`, {',
    '    method: "PUT",',
    '    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },',
    '    body: JSON.stringify(data),',
    '  });',
    '  return r.json();',
    '}',
    '',
    '// Kép base64-ként is küldhető, ha úgy egyszerűbb:',
    'async function setBackground(base64Png) {',
    '  const r = await fetch(`${BASE}/api/team/me/background`, {',
    '    method: "POST",',
    '    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },',
    '    body: JSON.stringify({ image_base64: base64Png }),',
    '  });',
    '  return r.json();',
    '}',
  ].join('\n');

  return el('div', { class: 'card' },
    el('h2', { style: { marginTop: '0' } }, 'API leírás'),
    el('p', { class: 'small muted', style: { marginTop: '0' } },
      'Minden hívás a kulcsotokkal megy, Authorization: Bearer fejlécben (vagy X-API-Key fejlécben). ' +
      'A válaszok JSON-ban jönnek, hiba esetén beszédes üzenettel.'),

    el('div', { style: { marginBottom: '16px' } },
      ep('GET', '/api/team/me', 'Állapot lekérdezése és kulcs ellenőrzése.'),
      ep('PUT', '/api/team/me', 'game_name, tagline, description, accent_color beállítása.'),
      ep('POST', '/api/team/me/background', `Háttérkép, pontosan ${bg.width}x${bg.height}.`),
      ep('DELETE', '/api/team/me/background', 'Háttérkép törlése.'),
      ep('POST', '/api/team/me/logo', `Logó, pontosan ${spec.logo.width}x${spec.logo.height}.`),
      ep('GET', '/api/team/me/qr', 'Saját QR kód. format=png|svg|json, size=128..2048.')
    ),

    el('h3', { style: { fontSize: '15px', margin: '18px 0 8px' } }, 'curl példák'),
    el('pre', { class: 'code' }, curl),
    el('h3', { style: { fontSize: '15px', margin: '18px 0 8px' } }, 'JavaScript példa'),
    el('pre', { class: 'code' }, js),

    el('div', { class: 'note warn' },
      el('strong', {}, 'A kulcs a csapaté. '),
      'Ne tegyétek ki nyilvános repóba, és ne osszátok meg másik csapattal.')
  );
}

const ep = (method, path, desc) =>
  el('div', { class: 'ep' },
    el('b', {}, method),
    el('div', {}, el('code', {}, path), el('span', {}, desc))
  );

/* ---------- betoltes ---------- */

async function load() {
  const data = await call('/api/team/me');
  spec = data.image_spec;
  spec.max_bytes = data.image_spec.background.max_bytes;
  $('login').hidden = true;
  $('console').hidden = false;
  $('forget').hidden = false;
  document.title = `${data.team.game_name || data.team.name} - csapat konzol`;
  render(data.team);
}

$('connect').addEventListener('click', async () => {
  key = $('key').value.trim();
  if (!key) return toast('Írd be a kulcsot', true);
  try {
    await load();
    localStorage.setItem(STORE, key);
  } catch (err) {
    toast(err.message, true);
  }
});

$('key').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('connect').click();
});

$('forget').addEventListener('click', () => {
  localStorage.removeItem(STORE);
  location.reload();
});

const saved = localStorage.getItem(STORE);
if (saved) {
  key = saved;
  $('key').value = saved;
  load().catch(() => {
    localStorage.removeItem(STORE);
    toast('A mentett kulcs már nem érvényes.', true);
  });
}
