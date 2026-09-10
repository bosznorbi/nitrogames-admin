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
          el('div', { class: 'todo-mark' }, i.kesz ? el('i', { class: 'tick' }) : ''),
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

    docsCard(t, kepek)
  );

  $('f_color').addEventListener('input', (e) => { $('f_szin').value = e.target.value; });
  $('save').addEventListener('click', save_fields);
  for (const kind of ['hatterkep', 'csempekep']) wireUpload(kind);
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
            `PNG, JPEG vagy WebP. Itt bármilyen méretű képet feltölthetsz, középre igazítva levágjuk. `
            + `Az API viszont pontos méretet vár, ha kódból töltötök fel.`)
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

/**
 * Az API pontos meretet var. Itt a bongeszoben vagjuk meretre, hogy ne a
 * csapatnak kelljen kepszerkesztovel bajlodnia: kozepre igazitva kitoltjuk
 * a celmeretet, a kilogo reszt levagjuk.
 */
async function fitToSize(file, width, height) {
  const bmp = await createImageBitmap(file);
  if (bmp.width === width && bmp.height === height) return { buffer: await file.arrayBuffer(), type: file.type, resized: false };

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  const scale = Math.max(width / bmp.width, height / bmp.height);
  const w = bmp.width * scale;
  const h = bmp.height * scale;
  ctx.drawImage(bmp, (width - w) / 2, (height - h) / 2, w, h);

  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return { buffer: await blob.arrayBuffer(), type: 'image/png', resized: true, from: `${bmp.width}×${bmp.height}` };
}

function wireUpload(kind) {
  $(`up_${kind}`).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = $(`st_${kind}`);
    const spec = state.kepek[{ hatterkep: 'background', csempekep: 'icon' }[kind]];

    status.textContent = 'Feldolgozás…';
    status.style.color = '';
    let payload;
    try {
      payload = await fitToSize(file, spec.width, spec.height);
    } catch {
      status.textContent = 'Ezt a fájlt nem tudom képként megnyitni.';
      status.style.color = 'var(--danger)';
      return;
    }

    status.textContent = 'Feltöltés…';
    try {
      await call(`/api/csapat/${kind}`, { method: 'POST', body: payload.buffer, contentType: payload.type });
      toast(payload.resized ? `Méretre vágva (${payload.from}) és feltöltve` : 'Feltöltve');
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
  const NL = String.fromCharCode(10);
  const base = location.origin;
  const B = kepek.background;
  const I = kepek.icon;

  const VEGPONTOK = [
    {
      m: 'GET',
      ut: '/api/csapat/allapot',
      mit: 'Mi hiányzik még. Ezt érdemes ismételten meghívni.',
      keres: `curl -H "Authorization: Bearer ${t.kod}"\
  ${base}/api/csapat/allapot`,
      valasz: `{
  "kesz": false,
  "kesz_darab": 4,
  "osszesen": 6,
  "uzenet": "Még 2 dolog hiányzik.",
  "kovetkezo_lepes": {
    "kulcs": "csempekep",
    "teendo": "Töltsetek fel csempeképet, pontosan ${I.width}x${I.height} képpont.",
    "hogyan": "POST ${base}/api/csapat/csempekep"
  }
}`,
    },
    {
      m: 'GET',
      ut: '/api/csapat',
      mit: 'Minden adat, a készültség és a kötelező képméretek.',
      keres: `curl -H "Authorization: Bearer ${t.kod}" ${base}/api/csapat`,
      valasz: `{
  "ok": true,
  "csapat": {
    "kod": "${t.kod}",
    "csapatnev": "Kávészünet",
    "jatek_neve": "Űrpatkányok bosszúja",
    "szavazolap_url": "${base}/t/..."
  },
  "keszultseg": { "kesz": false, "hianyzik": [] },
  "kepek": { "background": { "width": ${B.width}, "height": ${B.height} } }
}`,
    },
    {
      m: 'PUT',
      ut: '/api/csapat',
      mit: 'Csapatnév, játéknév, mottó, leírás, szín. Bármelyik mező külön is küldhető.',
      keres: `curl -X PUT -H "Authorization: Bearer ${t.kod}"\
  -H "Content-Type: application/json"\
  -d '{"csapatnev":"Kávészünet","jatek_neve":"Űrpatkányok bosszúja","leiras":"Két játékos, egy perc.","szin":"#ff5c8a"}'\
  ${base}/api/csapat`,
      valasz: `{
  "ok": true,
  "mentve": ["csapatnev", "jatek_neve", "leiras", "szin"],
  "keszultseg": { "kesz": false, "hianyzik": [] }
}`,
    },
    {
      m: 'POST',
      ut: '/api/csapat/hatterkep',
      mit: `A szavazólapotok teljes háttere a telefonon. Pontosan ${B.width}x${B.height}.`,
      keres: `curl -X POST -H "Authorization: Bearer ${t.kod}"\
  -H "Content-Type: image/png"\
  --data-binary @hatter.png\
  ${base}/api/csapat/hatterkep`,
      valasz: `{
  "ok": true,
  "feltoltve": "háttérkép",
  "url": "${base}/uploads/....png",
  "meret": { "width": ${B.width}, "height": ${B.height}, "bajt": 482113, "formatum": "png" }
}`,
    },
    {
      m: 'POST',
      ut: '/api/csapat/csempekep',
      mit: `A főoldal rácsában ez jelöli a játékotokat. Pontosan ${I.width}x${I.height}.`,
      keres: `curl -X POST -H "Authorization: Bearer ${t.kod}"\
  -H "Content-Type: image/png"\
  --data-binary @csempe.png\
  ${base}/api/csapat/csempekep`,
      valasz: `{
  "ok": true,
  "feltoltve": "csempekép",
  "meret": { "width": ${I.width}, "height": ${I.height} }
}`,
    },
    {
      m: 'GET',
      ut: '/api/csapat/qr',
      mit: 'A saját QR-kódotok. format=png|svg|json, size=128..2048.',
      keres: `curl -H "Authorization: Bearer ${t.kod}"\
  "${base}/api/csapat/qr?size=1200" -o qr.png`,
      valasz: `PNG kép. A format=json ezt adja:
{
  "szavazolap_url": "${base}/t/...",
  "png": "${base}/api/csapat/qr?format=png&size=1000",
  "svg": "${base}/api/csapat/qr?format=svg"
}`,
    },
  ];

  const hiba = `Hibáknál beszédes üzenet jön, például rossz képméretnél:
{
  "error": "rossz_meret",
  "message": "A kép 800x600, de pontosan ${B.width}x${B.height} kell.",
  "kapott": { "width": 800, "height": 600, "format": "png" },
  "elvart": { "width": ${B.width}, "height": ${B.height} }
}`;

  /** Egyben bemásolható összefoglaló az AI-nak. */
  function aiSzoveg() {
    return [
      'Nitrogames nevezés: a játékunk adatait erre a szerverre kell feltölteni,',
      'különben a többiek nem tudnak rá szavazni.',
      '',
      `Szerver: ${base}`,
      `Csapatkód: ${t.kod}`,
      '',
      'A kódot minden híváshoz az Authorization: Bearer fejlécben kell küldeni.',
      'A kötőjel és a kis- vagy nagybetű nem számít.',
      '',
      'Kötelező képméretek (pontosan ekkorák, a szerver mást elutasít):',
      `  háttérkép:  ${B.width} x ${B.height}`,
      `  csempekép:  ${I.width} x ${I.height}`,
      '',
      'Fontos: hívd meg a GET /api/csapat/allapot végpontot, az megmondja,',
      'mi hiányzik még, és mi a következő lépés. A végén is ellenőrizd vele,',
      'hogy tényleg készen vagyunk.',
      '',
      'Végpontok:',
      ...VEGPONTOK.flatMap((v) => [
        '',
        `${v.m} ${v.ut}`,
        `  ${v.mit}`,
        '  Példa kérés:',
        ...v.keres.split(NL).map((sor) => '    ' + sor),
        '  Példa válasz:',
        ...v.valasz.split(NL).map((sor) => '    ' + sor),
      ]),
      '',
      hiba,
    ].join(NL);
  }

  return el('div', { class: 'card' },
    el('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' } },
      el('h2', { style: { margin: '0' } }, 'API'),
      el('button', {
        class: 'mini',
        onclick: async () => {
          const szoveg = aiSzoveg();
          try {
            await navigator.clipboard.writeText(szoveg);
            toast('Kimásolva, illeszd be az AI-nak');
          } catch {
            prompt('Másold ki kézzel:', szoveg);
          }
        },
      }, 'Másolás AI-nak')
    ),
    el('p', { class: 'small muted', style: { marginTop: '0' } },
      'A kódotokat Authorization: Bearer fejlécben küldjétek. Kötőjellel és anélkül is jó, '
      + 'a kis- és nagybetű sem számít. Nyisd le a végpontokat a példákért.'),

    ...VEGPONTOK.map((v) =>
      el('details', { class: 'vegpont' },
        el('summary', {},
          el('b', {}, v.m),
          el('code', {}, v.ut),
          el('span', {}, v.mit)
        ),
        el('div', { class: 'pelda' },
          el('small', {}, 'Példa kérés'),
          el('pre', { class: 'code' }, v.keres),
          el('small', {}, 'Példa válasz'),
          el('pre', { class: 'code' }, v.valasz)
        )
      )
    ),

    el('div', { class: 'note warn', style: { marginTop: '14px' } },
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
// Gépelés közben magától beteszi a kötőjelet: XXXX-XXXX.
$('code').addEventListener('input', (e) => {
  const tiszta = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  e.target.value = tiszta.length > 4 ? `${tiszta.slice(0, 4)}-${tiszta.slice(4)}` : tiszta;
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
