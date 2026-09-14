import { api, el, toast, since } from '/static/js/app.js';

const $ = (id) => document.getElementById(id);
const state = { settings: {}, teams: [], baseUrl: '' };
let refreshTimer = null;

/* ---------- fulek ---------- */

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('on', t === tab);
    for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== `panel-${tab.dataset.panel}`;
    location.hash = tab.dataset.panel;
    if (tab.dataset.panel === 'eredmenyek') loadResults();
    if (tab.dataset.panel === 'szavazok') loadVoters();
    if (tab.dataset.panel === 'csapatok') loadTeams();
  });
}

function openTabFromHash() {
  const name = location.hash.replace('#', '');
  const tab = [...document.querySelectorAll('.tab')].find((t) => t.dataset.panel === name);
  if (tab) tab.click();
}

/* ---------- attekintes ---------- */

const stat = (value, label) => el('div', { class: 'stat' }, el('b', {}, String(value)), el('span', {}, label));

async function loadOverview() {
  const data = await api('/api/admin/overview');
  state.settings = data.settings;
  state.baseUrl = data.base_url;

  const c = data.counts;
  $('stats').replaceChildren(
    stat(`${c.teams_ready}/${c.teams}`, 'csapat kész'),
    stat(c.criteria, 'szempont'),
    stat(c.voters, 'kinyomtatott cetli'),
    stat(c.voters_activated, 'belépett'),
    stat(`${c.voters_voted}/${c.voters_activated}`, 'szavazott'),
    stat(c.submissions, 'szavazólap'),
    stat(c.votes, 'pontszám')
  );

  const open = data.settings.voting_open === '1';
  $('votingOpen').checked = open;
  $('votingText').textContent = open ? 'Nyitva' : 'Zárva';
  $('votingLabel').textContent = open ? 'A szavazás nyitva van' : 'A szavazás zárva van';
  $('votingHint').textContent = open
    ? 'A résztvevők most tudnak pontozni. A díjkiosztás előtt zárd le.'
    : 'A főoldal látszik, de pontozni nem lehet.';
  $('votingBox').classList.toggle('live', open);

  // Csak cím változásakor töltjük újra: az 5 másodperces frissítés különben
  // minden körben letöltené ugyanazt a QR-képet.
  const qrSrc = `/api/admin/qr?format=png&size=600&data=${encodeURIComponent(state.baseUrl)}`;
  if (!$('mainQr').src.endsWith(qrSrc)) $('mainQr').src = qrSrc;
  $('mainUrl').textContent = state.baseUrl;
  $('mainUrl').href = state.baseUrl;
  // A hálózati cím frissítése csak helyi futtatásnál értelmes: élesben a
  // PUBLIC_BASE_URL rögzíti a címet.
  const helyi = !data.base_url_fixed;
  $('refreshLan').hidden = !helyi;
  $('lanHint').hidden = !helyi;
  $('baseWarn').textContent = data.base_url_fixed
    ? 'Rögzített nyilvános cím (PUBLIC_BASE_URL). Ez kerül minden QR-kódba.'
    : /localhost|127\.0\.0\.1/.test(state.baseUrl)
      ? 'Nem találtam hálózati címet, ezért localhost került ide. Telefonról ez nem érhető el.'
      : 'Ez a gép hálózati címe. Minden QR-kód erre mutat, tehát telefonról is működik.';

  // Frissítés közben ne írjuk felül azt a mezőt, amibe épp gépelnek.
  if (document.activeElement !== $('teamCount')) $('teamCount').value = c.teams_total;
  if (document.activeElement !== $('voterCount')) $('voterCount').value = c.voters - 1; // a TEST kód ezen kívül áll

  await keszultseget();
}

/**
 * Melyik csapatnak mi hiányzik még. Nyitva hagyva magától frissül, így a
 * teremben körbejárva rögtön látszik, kinél kell még noszogatni.
 */
async function keszultseget() {
  const { teams } = await api('/api/admin/teams');
  state.teams = teams;

  const keszek = teams.filter((t) => t.ready).length;
  const mind = keszek === teams.length && teams.length > 0;

  $('keszBox').classList.toggle('kesz', mind);
  $('keszOsszegzo').textContent = teams.length
    ? (mind ? `mind a ${teams.length} kész` : `${keszek}/${teams.length} kész`)
    : 'nincs csapat';

  $('keszLista').replaceChildren(
    ...(teams.length
      ? teams.map((t) =>
          el('div', {
            class: `kesz-sor ${t.ready ? 'ok' : ''}`,
            style: { '--team': t.accent_color || '#7c5cff' },
          },
            el('span', { class: 'nev' }, el('i', {}), `${t.number}.`),
            el('span', { class: 'hiany' },
              t.ready
                ? `Kész: ${t.label}`
                : el('span', {}, `${t.label} - hiányzik: `, el('b', {}, t.missing.join(', '))))
          )
        )
      : [el('div', { class: 'kesz-sor' }, el('span', { class: 'hiany' }, 'Még nincs csapat.'))])
  );
}

async function saveSetting(key, value) {
  try {
    const r = await api('/api/admin/settings', { method: 'PUT', body: { [key]: value } });
    state.settings = r.settings;
    toast('Mentve');
  } catch (err) {
    toast(err.message, true);
  }
}

$('votingOpen').addEventListener('change', async (e) => {
  await saveSetting('voting_open', e.target.checked);
  loadOverview();
});

$('seedDemo').addEventListener('click', async () => {
  const ok = confirm([
    'Feltölti a csapatokat kitalált nevekkel, leírásokkal és képekkel, szavazatokat is generál,',
    'és megnyitja a szavazást.',
    '',
    'A meglévő csapattartalom felülíródik. A TEST cetli szavazatai üresek maradnak,',
    'azzal telefonról még tudsz szavazni.',
  ].join('\n'));
  if (!ok) return;

  const btn = $('seedDemo');
  const eredeti = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generálás…';
  try {
    const r = await api('/api/admin/mintaadatok', { method: 'POST', body: { confirm: 'MINTA' } });
    toast(r.message);
    loadOverview();
    loadTeams();
    loadVoters();
  } catch (err) {
    toast(err.message, true);
  }
  btn.disabled = false;
  btn.textContent = eredeti;
});

$('resetVotes').addEventListener('click', () => reset('votes', [
  'Törlöd az összes szavazatot?',
  '',
  'A szavazók kilépnek a telefonjukról, de a cetlijükkel újra beléphetnek.',
].join('\n')));
$('resetAll').addEventListener('click', () =>
  reset('all', [
    'Nullázod a szavazatokat ÉS a csapatok által feltöltött tartalmat (nevek, leírások, képek)?',
    '',
    'A csapatkódok, a QR-kódok és a szavazói cetlik érvényesek maradnak, tehát a kinyomtatott lapok jók lesznek.',
    'A szavazók kilépnek a telefonjukról, de a cetlijükkel újra beléphetnek.',
  ].join('\n')));

async function reset(scope, question) {
  if (!confirm(question)) return;
  try {
    const r = await api('/api/admin/reset', { method: 'POST', body: { confirm: 'TOROL', scope } });
    toast(r.message);
    loadOverview();
    loadTeams();
    loadVoters();
  } catch (err) {
    toast(err.message, true);
  }
}

/**
 * A címválasztó csak akkor jelenik meg, ha több valódi hálózati cím is van.
 * Az automatikus felismerés ilyenkor tévedhet (régi wifi, hotspot, VPN),
 * és kézzel is ki lehet jelölni a jót.
 */
function lanCimekKirajzol(lista, aktiv) {
  const tobb = (lista || []).length > 1;
  $('lanValaszto').hidden = !tobb;
  if (!tobb) return;

  $('lanCimek').replaceChildren(
    ...lista.map((a) =>
      el('button', {
        class: `mini ${a.ip === aktiv ? 'ok' : ''}`,
        title: a.nev,
        onclick: () => halozatFrissit(a.ip),
      }, a.ip)
    )
  );
}

async function halozatFrissit(ip = null) {
  const btn = $('refreshLan');
  const eredeti = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Keresés…';
  try {
    const r = await api('/api/admin/halozat/frissites', {
      method: 'POST',
      body: ip ? { ip } : {},
    });
    if (r.rogzitett) toast('A PUBLIC_BASE_URL van beállítva, azt nem írjuk felül');
    else if (!r.ip) toast('Nem találtam hálózati címet', true);
    else if (r.kezi) toast(`Beállítva: ${r.ip}`);
    else if (r.valtozott) toast(`Új cím: ${r.ip}`);
    else toast(`A cím nem változott: ${r.ip}`);

    lanCimekKirajzol(r.tobbi, r.ip);
    // A QR-kódok és a csapatlinkek a friss címből épülnek újra.
    await loadOverview();
    await loadTeams();
  } catch (err) {
    toast(err.message, true);
  }
  btn.disabled = false;
  btn.textContent = eredeti;
}

$('refreshLan').addEventListener('click', () => halozatFrissit());

$('logout').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  location.href = '/admin/login';
});

/* ---------- csapatok ---------- */

async function loadTeams() {
  const { teams } = await api('/api/admin/teams');
  state.teams = teams;
  $('teamsTable').querySelector('tbody').replaceChildren(
    ...teams.map((t) =>
      el('tr', {},
        el('td', { class: 'num', 'data-label': 'Sorszám' }, String(t.number)),
        el('td', { 'data-label': 'Csempe' }, el('span', {
          class: 'thumb-sm tile-cell',
          title: t.icon_url ? 'Feltöltött csempekép' : 'Még nincs csempekép',
          style: t.icon_url
            ? { backgroundImage: `url("${t.icon_url}")` }
            : { background: t.accent_color || '#7c5cff', color: '#fff' },
        }, t.icon_url ? '' : String(t.number))),
        el('td', { 'data-label': 'Csapat / játék' },
          el('span', { class: 'swatch', style: { background: t.accent_color || '#7c5cff' } }),
          el('strong', {}, t.label),
          t.name && t.game_name ? el('div', { class: 'small muted' }, t.name) : null
        ),
        el('td', { 'data-label': 'Kód' },
          el('code', { class: 'key', title: 'Másolás', onclick: () => copy(t.code) }, t.code)),
        el('td', { 'data-label': 'Készültség' },
          t.ready
            ? el('span', { class: 'pill done' }, 'Kész')
            : el('span', { class: 'small muted' }, `hiányzik: ${t.missing.join(', ')}`)
        ),
        el('td', { class: 'num', 'data-label': 'Szavazat' }, String(t.voters)),
        el('td', { 'data-label': 'Műveletek' },
          el('div', { class: 'row tight' },
            el('a', { class: 'mini', href: t.vote_url, target: '_blank', rel: 'noopener' }, 'Szavazólap'),
            // A csapat saját konzolja a kódjukkal, új lapon: innen látjuk,
            // hol tartanak, és szükség esetén helyettük is fel tudunk tölteni.
            el('a', {
              class: 'mini ikon',
              href: `/csapat?kod=${encodeURIComponent(t.code)}`,
              target: '_blank',
              rel: 'noopener',
              title: `${t.label}: csapat konzol megnyitása`,
              'aria-label': `${t.label}: csapat konzol megnyitása`,
              html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                       <path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/>
                       <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>
                     </svg>`,
            }),
            el('button', { class: 'mini danger', onclick: () => removeTeam(t) }, 'Törlés')
          )
        )
      )
    )
  );
}

async function removeTeam(t) {
  if (!confirm(`Törlöd a(z) ${t.number}. csapatot és a rá adott összes szavazatot?`)) return;
  await api(`/api/admin/teams/${t.id}`, { method: 'DELETE' });
  toast('Csapat törölve');
  loadTeams();
  loadOverview();
}

$('setTeamCount').addEventListener('click', async () => {
  try {
    const r = await api('/api/admin/teams', { method: 'POST', body: { count: Number($('teamCount').value) } });
    toast(r.created ? `${r.created} új csapat` : 'Nincs új csapat (csak felfelé bővít)');
    loadTeams();
    loadOverview();
  } catch (err) {
    toast(err.message, true);
  }
});

/* ---------- szempontok ---------- */

const smallInput = (props) =>
  el('input', { ...props, style: { padding: '6px 9px', fontSize: '14px', ...(props.style || {}) } });

async function loadCriteria() {
  const { criteria } = await api('/api/admin/criteria');
  $('criteriaTable').querySelector('tbody').replaceChildren(
    ...criteria.map((c) =>
      el('tr', {},
        el('td', { 'data-label': 'Sorrend' }, smallInput({
          type: 'number', value: c.position, style: { width: '70px' },
          onchange: (e) => patchCriterion(c.id, { position: Number(e.target.value) }),
        })),
        el('td', { 'data-label': 'Név és leírás' },
          smallInput({
            type: 'text', value: c.label, style: { width: '170px', marginBottom: '5px' },
            onchange: (e) => patchCriterion(c.id, { label: e.target.value }),
          }),
          smallInput({
            type: 'text', value: c.description || '', placeholder: 'leírás',
            style: { width: '100%', fontSize: '13px' },
            onchange: (e) => patchCriterion(c.id, { description: e.target.value }),
          })
        ),
        el('td', { 'data-label': 'Skála' },
          smallInput({
            type: 'number', value: c.min_score, style: { width: '64px' },
            onchange: (e) => patchCriterion(c.id, { min_score: Number(e.target.value) }),
          }),
          ' - ',
          smallInput({
            type: 'number', value: c.max_score, style: { width: '64px' },
            onchange: (e) => patchCriterion(c.id, { max_score: Number(e.target.value) }),
          })
        ),
        el('td', { 'data-label': 'Súly' }, smallInput({
          type: 'number', value: c.weight, step: '0.5', style: { width: '74px' },
          onchange: (e) => patchCriterion(c.id, { weight: Number(e.target.value) }),
        })),
        el('td', { 'data-label': 'Aktív' }, el('label', { class: 'switch' },
          el('input', {
            type: 'checkbox', checked: Boolean(c.active),
            onchange: (e) => patchCriterion(c.id, { active: e.target.checked }),
          }),
          el('i', {})
        )),
        el('td', { 'data-label': '' }, el('button', { class: 'mini danger', onclick: () => removeCriterion(c) }, 'Törlés'))
      )
    )
  );
}

async function patchCriterion(id, body) {
  try {
    await api(`/api/admin/criteria/${id}`, { method: 'PATCH', body });
    toast('Mentve');
  } catch (err) {
    toast(err.message, true);
  }
  loadCriteria();
}

async function removeCriterion(c) {
  try {
    await api(`/api/admin/criteria/${c.id}`, { method: 'DELETE' });
    toast('Szempont törölve');
  } catch (err) {
    if (err.data && err.data.error === 'in_use') {
      if (!confirm(`${err.message}\n\nMégis törlöd a hozzá tartozó szavazatokkal együtt?`)) return;
      await api(`/api/admin/criteria/${c.id}?force=1`, { method: 'DELETE' });
      toast('Szempont és szavazatai törölve');
    } else {
      toast(err.message, true);
      return;
    }
  }
  loadCriteria();
  loadOverview();
}

$('addCriterion').addEventListener('click', async () => {
  try {
    await api('/api/admin/criteria', {
      method: 'POST',
      body: {
        label: $('cLabel').value,
        description: $('cDesc').value,
        min_score: Number($('cMin').value),
        max_score: Number($('cMax').value),
        weight: Number($('cWeight').value),
      },
    });
    $('cLabel').value = '';
    $('cDesc').value = '';
    toast('Szempont hozzáadva');
    loadCriteria();
    loadOverview();
  } catch (err) {
    toast(err.message, true);
  }
});

/* ---------- szavazok ---------- */

async function loadVoters() {
  const { voters } = await api('/api/admin/voters');
  state.voterCount = voters.filter((v) => !v.is_test).length;
  $('votersTable').querySelector('tbody').replaceChildren(
    ...voters.map((v) =>
      el('tr', {},
        el('td', { 'data-label': 'Kód' },
          el('span', { class: 'voter-code', onclick: () => copy(v.login_url), title: 'Belépő link másolása' }, v.code),
          v.is_test ? el('span', { class: 'pill', style: { marginLeft: '10px' } }, 'teszt') : null
        ),
        el('td', { 'data-label': 'Belépett' },
          v.activated ? el('span', { class: 'pill done' }, 'Igen') : el('span', { class: 'pill' }, 'Nem')),
        el('td', { class: 'num', 'data-label': 'Szavazott' }, String(v.voted_teams)),
        el('td', { class: 'muted small', 'data-label': 'Utoljára' }, since(v.last_seen_at) || '-'),
        el('td', { class: 'jobbra', 'data-label': '' },
          v.is_test ? null : el('button', { class: 'mini danger', onclick: () => removeVoter(v) }, 'Törlés'))
      )
    )
  );
}

async function removeVoter(v) {
  if (!confirm(`Törlöd a(z) ${v.code} szavazót és a szavazatait?`)) return;
  await api(`/api/admin/voters/${v.id}`, { method: 'DELETE' });
  toast('Szavazó törölve');
  loadVoters();
  loadOverview();
}

$('addVoters').addEventListener('click', async () => {
  const cel = Number($('voterCount').value);
  const most = state.voterCount ?? 0;
  if (cel < most && !confirm(`${most - cel} szavazó cetli eldobása a szavazataikkal együtt. Biztos?`)) return;
  try {
    const r = await api('/api/admin/voters', { method: 'POST', body: { count: cel } });
    toast(r.message);
    loadVoters();
    loadOverview();
  } catch (err) {
    toast(err.message, true);
  }
});

/* ---------- eredmenyek ---------- */

function rankSub(t) {
  return `${t.number}. csapat · ${t.voters} szavazó`;
}

async function loadResults() {
  const r = await api('/api/admin/results');
  const s = r.stats;

  $('resultStats').replaceChildren(
    stat(`${s.voters_voted}/${s.voters_activated}`, 'szavazott / belépett'),
    stat(s.voters_total, 'kinyomtatott cetli'),
    stat(s.submissions, 'szavazólap'),
    stat(s.votes, 'pontszám'),
    stat(s.voting_open ? 'Nyitva' : 'Zárva', 'szavazás')
  );

  const best = r.ranking.find((x) => x.total_pct !== null);
  const maxPct = best ? best.total_pct : 100;

  $('ranking').replaceChildren(
    ...r.ranking.map((t) =>
      el('div', { class: 'rank', style: { '--team': t.accent_color } },
        el('div', { class: 'rank-pos' }, t.rank ? String(t.rank) : '-'),
        el('div', {},
          el('div', { class: 'rank-title' }, t.label),
          el('div', { class: 'rank-sub' }, rankSub(t)),
          el('div', { class: 'meter' }, el('i', {
            style: { width: `${t.total_pct === null ? 0 : Math.round((t.total_pct / (maxPct || 1)) * 100)}%` },
          }))
        ),
        el('div', { class: 'rank-score' },
          el('b', {}, t.total_pct === null ? '-' : String(t.total_pct)),
          el('span', {}, t.total_pct === null ? 'nincs szavazat' : 'pont / 100')
        )
      )
    )
  );

  $('winners').replaceChildren(
    ...r.category_winners.map((w) =>
      el('div', { class: 'winner' },
        el('small', {}, w.label),
        w.winner
          ? el('div', {},
              el('b', {}, w.winner.label),
              el('span', {}, `${w.winner.number}. csapat · átlag ${w.winner.avg}`))
          : el('span', {}, 'Még nincs szavazat')
      )
    )
  );

  $('breakdown').querySelector('thead').replaceChildren(
    el('tr', {},
      el('th', {}, '#'),
      el('th', {}, 'Csapat'),
      ...r.criteria.map((c) => el('th', { class: 'num' }, c.label)),
      el('th', { class: 'num' }, 'Össz.')
    )
  );

  $('breakdown').querySelector('tbody').replaceChildren(
    ...r.teams.map((t) =>
      el('tr', {},
        el('td', { class: 'num' }, String(t.number)),
        el('td', {}, t.label),
        ...t.criteria.map((p) =>
          el('td', { class: 'num' },
            p.avg === null ? el('span', { class: 'muted' }, '-') : el('strong', {}, p.avg.toFixed(2)),
            el('div', { class: 'small muted' }, p.votes ? `${p.votes} db` : '')
          )
        ),
        el('td', { class: 'num' }, t.total_pct === null ? '-' : el('strong', {}, String(t.total_pct)))
      )
    )
  );

  const { comments } = await api('/api/admin/results/comments');
  $('comments').replaceChildren(
    comments.length
      ? el('div', { class: 'stack' },
          ...comments.map((c) =>
            el('div', { class: 'card' },
              el('div', { class: 'small muted', style: { marginBottom: '5px' } },
                `${c.number}. csapat · ${c.label} · ${since(c.updated_at)}`),
              el('div', {}, c.comment)
            )
          )
        )
      : el('div', { class: 'note' }, 'Még nincs szöveges megjegyzés.')
  );
}

function setupRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!$('panel-eredmenyek').hidden) loadResults().catch(() => {});
    // Az áttekintés készültségi listája is éljen: e szerint járunk körbe.
    if (!$('panel-attekintes').hidden) loadOverview().catch(() => {});
  }, 5000);
}

/* ---------- segedek ---------- */

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Vágólapra másolva');
  } catch {
    prompt('Másold ki kézzel:', text);
  }
}

/* ---------- indulas ---------- */

(async () => {
  try {
    await loadOverview();
    await loadTeams();
    await loadCriteria();
    setupRefresh();
    openTabFromHash();
  } catch (err) {
    if (err.status === 401) location.href = '/admin/login';
    else toast(err.message, true);
  }
})();
