import { el, toast } from '/static/js/app.js';

const $ = (id) => document.getElementById(id);
const STORE = 'ng_csapat_kod';
let code = '';
let state = null;

/* ---------- API ---------- */

async function call(path, { method = 'GET', body, contentType } = {}) {
  const headers = { Authorization: `Bearer ${code}` };
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
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* ---------- keszultseg ---------- */

function checklistCard(k) {
  const items = [
    ...k.hianyzik.map((i) => ({ ...i, kesz: false })),
    ...k.kesz_elemek.map((kulcs) => ({ kulcs, kesz: true, teendo: LABELS[kulcs] || kulcs })),
  ];

  return el('div', { class: 'card' },
    el('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '4px' } },
      el('h2', { style: { margin: '0' } }, k.kesz ? 'Készen álltok' : 'Mi hiányzik még'),
      el('span', { class: `pill ${k.kesz ? 'done' : 'warn'}` }, `${k.kesz_darab} / ${k.osszesen}`)
    ),
    el('p', { class: 'small muted', style: { margin: '0 0 14px' } }, k.uzenet),
    el('div', { class: 'todo' },
      ...items.map((i) =>
        el('div', { class: `todo-item ${i.kesz ? 'ok' : ''}` },
          el('div', { class: 'todo-mark' }, i.kesz ? '✓' : '·'),
          el('div', {},
            el('strong', {}, i.teendo),
            i.kesz ? null : el('code', {}, i.hogyan)
          )
        )
      )
    )
  );
}

const LABELS = {
  csapatnev: 'Csapatnév megvan.',
  jatek_neve: 'A játék neve megvan.',
  leiras: 'A leírás megvan.',
  hatterkep: 'Háttérkép feltöltve.',
  csempekep: 'Csempekép feltöltve.',
  qr_letoltve: 'QR-kód lekérve.',
};

/* ---------- megjelenites ---------- */

function render() {
  const t = state.csapat;
  const kepek = state.kepek;

  $('console').replaceChildren(
    el('h1', { style: { marginBottom: '2px' } }, t.jatek_neve || t.csapatnev || `${t.szam}. csapat`),
    el('p', { class: 'lead' }, `${t.szam}. csapat · kód: ${t.kod}`),

    checklistCard(state.keszultseg),

    el('div', { class: 'card' },
      el('h2', { style: { marginTop: '0' } }, 'A QR-kódotok'),
      el('p', { class: 'small muted', style: { marginTop: '0' } },
        'Ezt olvassák be a szavazók. Nyomtassátok ki nagyban, díszítsétek fel, és tegyétek ki az asztalotokra. A kód akkor sem változik, ha később átnevezitek a játékot.'),
      el('div', { class: 'row tight' },
        el('button', { class: 'btn', onclick: () => save('/api/csapat/qr?format=png&size=1200', `csapat-${t.szam}-qr.png`) }, 'QR letöltése (PNG)'),
        el('button', { class: 'mini', onclick: () => save('/api/csapat/qr?format=svg', `csapat-${t.szam}-qr.svg`) }, 'SVG'),
        el('a', { class: 'mini', href: t.szavazolap_url, target: '_blank', rel: 'noopener' }, 'Szavazólap megnyitása')
      )
    ),

    el('div', { class: 'card' },
      el('h2', { style: { marginTop: '0' } }, 'A játék adatai'),
      field('csapatnev', 'Csapatnév', t.csapatnev, 'Pl. Kávészünet'),
      field('jatek_neve', 'A játék neve', t.jatek_neve, 'Pl. Űrpatkányok bosszúja'),
      field('motto', 'Egysoros mottó', t['mottó'], 'Pl. Két óra, egy küldetés'),
      field('leiras', 'Leírás', t.leiras, 'Miről szól, hogyan kell játszani?', true),
      el('label', { class: 'field' },
        el('span', {}, 'Kiemelő szín'),
        el('div', { class: 'row tight' },
          el('input', { type: 'color', id: 'f_color', value: t.szin || '#7c5cff', style: { width: '52px', padding: '4px', height: '46px' } }),
          el('input', { type: 'text', id: 'f_szin', value: t.szin || '', placeholder: '#7c5cff', style: { flex: '1' } })
        )
      ),
      el('button', { class: 'btn', id: 'save' }, 'Mentés')
    ),

    uploadCard('hatterkep', 'Háttérkép', kepek.background,
      el('div', { class: 'phone', style: t.hatterkep_url ? { backgroundImage: `url("${t.hatterkep_url}")` } : {} },
        t.hatterkep_url ? '' : 'Még nincs: alap fehér design')),

    uploadCard('csempekep', 'Csempekép', kepek.icon,
      el('div', { class: 'tile-preview', style: t.csempekep_url ? { backgroundImage: `url("${t.csempekep_url}")` } : {} },
        t.csempekep_url ? '' : 'nincs')),

    uploadCard('csempekep-kesz', 'Csempekép szavazás után', kepek.icon_done,
      el('div', { class: 'tile-preview', style: t.csempekep_kesz_url ? { backgroundImage: `url("${t.csempekep_kesz_url}")` } : {} },
        t.csempekep_kesz_url ? '' : 'nincs')),

    docsCard(t, kepek)
  );

  $('f_color').addEventListener('input', (e) => { $('f_szin').value = e.target.value; });
  $('save').addEventListener('click', save_fields);
  for (const kind of ['hatterkep', 'csempekep', 'csempekep-kesz']) wireUpload(kind);
}

function field(id, label, value, placeholder, multi = false) {
  return el('label', { class: 'field' },
    el('span', {}, label),
    multi
      ? el('textarea', { id: `f_${id}`, maxlength: '600', placeholder }, value || '')
      : el('input', { type: 'text', id: `f_${id}`, value: value || '', maxlength: '120', placeholder })
  );
}

function uploadCard(kind, title, spec, preview) {
  return el('div', { class: 'card' },
    el('h2', { style: { marginTop: '0' } }, title),
    el('p', { class: 'small muted', style: { marginTop: '0' } }, spec.leiras),
    el('div', { class: 'preview' },
      preview,
      el('div', {},
        el('div', { class: 'note', style: { marginBottom: '11px' } },
          el('strong', {}, `Pontosan ${spec.width} × ${spec.height} képpont`),
          el('div', { class: 'small muted' },
            `PNG, JPEG vagy WebP · legfeljebb ${Math.round(spec.max_bytes / 1024 / 1024)} MB. Más méretet az API elutasít.`)
        ),
        el('div', { class: 'row tight' },
          el('input', { type: 'file', id: `up_${kind}`, accept: 'image/png,image/jpeg,image/webp', style: { flex: '1', minWidth: '160px' } }),
          el('button', { class: 'mini danger', id: `del_${kind}` }, 'Törlés')
        ),
        el('div', { class: 'small muted', id: `st_${kind}`, style: { marginTop: '8px' } })
      )
    )
  );
}

function wireUpload(kind) {
  $(`up_${kind}`).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = $(`st_${kind}`);
    const spec = state.kepek[{ hatterkep: 'background', csempekep: 'icon', 'csempekep-kesz': 'icon_done' }[kind]];

    try {
      const bmp = await createImageBitmap(file);
      if (bmp.width !== spec.width || bmp.height !== spec.height) {
        status.textContent = `A választott kép ${bmp.width} × ${bmp.height}, de pontosan ${spec.width} × ${spec.height} kell.`;
        status.style.color = 'var(--danger)';
        return;
      }
    } catch {
      // Ha a bongeszo nem tudja dekodolni, a szerver ugyis ellenorzi.
    }

    status.textContent = 'Feltöltés…';
    status.style.color = '';
    try {
      await call(`/api/csapat/${kind}`, { method: 'POST', body: await file.arrayBuffer(), contentType: file.type });
      toast('Feltöltve');
      load();
    } catch (err) {
      status.textContent = err.message;
      status.style.color = 'var(--danger)';
    }
  });

  $(`del_${kind}`).addEventListener('click', async () => {
    if (!confirm('Biztosan törlöd?')) return;
    await call(`/api/csapat/${kind}`, { method: 'DELETE' });
    toast('Törölve');
    load();
  });
}

async function save_fields() {
  const body = {
    csapatnev: $('f_csapatnev').value.trim(),
    jatek_neve: $('f_jatek_neve').value.trim(),
    motto: $('f_motto').value.trim(),
    leiras: $('f_leiras').value.trim(),
    szin: $('f_szin').value.trim(),
  };
  try {
    await call('/api/csapat', { method: 'PUT', body });
    toast('Mentve');
    load();
  } catch (err) {
    toast(err.message, true);
  }
}

/** A kodot fejlecben kuldjuk, hogy ne kerüljon a cimsorba. */
async function save(path, filename) {
  try {
    const res = await fetch(path, { headers: { Authorization: `Bearer ${code}` } });
    if (!res.ok) throw new Error('Nem sikerült letölteni.');
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

/* ---------- API leiras ---------- */

function docsCard(t, kepek) {
  const base = location.origin;
  const curl = [
    '# Mi hiányzik még? Ezt hívd meg bármikor.',
    `curl -H "Authorization: Bearer ${t.kod}" ${base}/api/csapat/allapot`,
    '',
    '# Csapatnév, játéknév, leírás',
    `curl -X PUT -H "Authorization: Bearer ${t.kod}" -H "Content-Type: application/json" \\`,
    `  -d '{"csapatnev":"Kávészünet","jatek_neve":"A játékunk","leiras":"Miről szól"}' \\`,
    `  ${base}/api/csapat`,
    '',
    `# Háttérkép (pontosan ${kepek.background.width}x${kepek.background.height})`,
    `curl -X POST -H "Authorization: Bearer ${t.kod}" -H "Content-Type: image/png" \\`,
    `  --data-binary @hatter.png ${base}/api/csapat/hatterkep`,
    '',
    `# Csempekép (pontosan ${kepek.icon.width}x${kepek.icon.height})`,
    `curl -X POST -H "Authorization: Bearer ${t.kod}" -H "Content-Type: image/png" \\`,
    `  --data-binary @csempe.png ${base}/api/csapat/csempekep`,
    '',
    '# A saját QR-kódotok, nyomtatáshoz',
    `curl -H "Authorization: Bearer ${t.kod}" "${base}/api/csapat/qr?size=1200" -o qr.png`,
  ].join('\n');

  return el('div', { class: 'card' },
    el('h2', { style: { marginTop: '0' } }, 'API'),
    el('p', { class: 'small muted', style: { marginTop: '0' } },
      'A kódotokat Authorization: Bearer fejlécben küldjétek. Kötőjellel és anélkül is jó, a kis- és nagybetű sem számít.'),
    el('div', { style: { marginBottom: '14px' } },
      ep('GET', '/api/csapat/allapot', 'Mi hiányzik még. Ezt érdemes ismételten hívni.'),
      ep('GET', '/api/csapat', 'Minden adat és a készültség.'),
      ep('PUT', '/api/csapat', 'csapatnev, jatek_neve, mottó, leiras, szin'),
      ep('POST', '/api/csapat/hatterkep', `${kepek.background.width}x${kepek.background.height}`),
      ep('POST', '/api/csapat/csempekep', `${kepek.icon.width}x${kepek.icon.height}`),
      ep('POST', '/api/csapat/csempekep-kesz', `${kepek.icon_done.width}x${kepek.icon_done.height}, opcionális`),
      ep('GET', '/api/csapat/qr', 'A saját QR-kódotok. format=png|svg|json')
    ),
    el('pre', { class: 'code' }, curl),
    el('div', { class: 'note warn' },
      el('strong', {}, 'A kód a csapaté. '),
      'Ne tegyétek ki nyilvános repóba, és ne adjátok másik csapatnak.')
  );
}

const ep = (method, path, desc) =>
  el('div', { class: 'ep' }, el('b', {}, method), el('div', {}, el('code', {}, path), el('span', {}, desc)));

/* ---------- betoltes ---------- */

async function load() {
  state = await call('/api/csapat');
  $('login').hidden = true;
  $('console').hidden = false;
  $('forget').hidden = false;
  document.title = `${state.csapat.jatek_neve || state.csapat.szam + '. csapat'} - konzol`;
  render();
}

async function connect(value) {
  code = String(value || '').trim();
  if (!code) return toast('Írd be a kódot', true);
  try {
    await load();
    localStorage.setItem(STORE, code);
    $('loginErr').hidden = true;
  } catch (err) {
    $('loginErr').hidden = false;
    $('loginErr').textContent = err.message;
  }
}

$('connect').addEventListener('click', () => connect($('code').value));
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect($('code').value); });
$('code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
});

$('forget').addEventListener('click', () => {
  localStorage.removeItem(STORE);
  location.href = '/csapat';
});

// A papiron levo QR ?kod=... alakban hozza a kodot.
const fromUrl = new URLSearchParams(location.search).get('kod');
const saved = fromUrl || localStorage.getItem(STORE);
if (saved) {
  $('code').value = saved;
  connect(saved).then(() => {
    if (fromUrl) history.replaceState(null, '', '/csapat');
  });
}
