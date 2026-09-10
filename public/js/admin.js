import { api, el, toast, since } from '/static/js/app.js';

const $ = (id) => document.getElementById(id);
const state = { settings: {}, teams: [], criteria: [], voters: [], baseUrl: '' };
let refreshTimer = null;

/* ---------- fulek ---------- */

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('on', t === tab);
    for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== `panel-${tab.dataset.panel}`;
    location.hash = tab.dataset.panel;
    if (tab.dataset.panel === 'eredmenyek') loadResults();
    if (tab.dataset.panel === 'szavazok') loadVoters();
  });
}

function openTabFromHash() {
  const name = location.hash.replace('#', '');
  const tab = [...document.querySelectorAll('.tab')].find((t) => t.dataset.panel === name);
  if (tab) tab.click();
}

/* ---------- attekintes ---------- */

const SWITCHES = [
  ['results_public', 'Eredmények nyilvánosak', 'Egyelőre nem használjuk a szavazói oldalon, később bekapcsolható.'],
  ['allow_self_vote', 'Saját csapatra lehet szavazni', 'Ha ki van kapcsolva, a csapathoz rendelt szavazók nem pontozhatják a saját játékukat.'],
  ['require_all_criteria', 'Minden szempont kötelező', 'A szavazat csak akkor küldhető be, ha minden szempont ki van töltve.'],
  ['allow_comments', 'Szöveges megjegyzés engedélyezve', 'A szavazók írhatnak rövid visszajelzést a csapatnak.'],
  ['allow_self_register', 'Névvel is be lehet lépni', 'Tartalék, ha valaki elveszíti a papírját. Új azonosítót kap.'],
];

async function loadOverview() {
  const data = await api('/api/admin/overview');
  state.settings = data.settings;
  state.baseUrl = data.base_url;

  const c = data.counts;
  $('stats').replaceChildren(
    stat(c.teams, 'aktív csapat'),
    stat(c.criteria, 'szempont'),
    stat(c.voters, 'generált szavazó'),
    stat(c.voters_activated, 'belépett'),
    stat(c.voters_voted, 'már szavazott'),
    stat(c.submissions, 'leadott szavazólap')
  );

  const open = data.settings.voting_open === '1';
  $('votingOpen').checked = open;
  $('votingText').textContent = open ? 'Nyitva' : 'Zárva';
  $('votingLabel').textContent = open ? 'A szavazás nyitva van' : 'A szavazás zárva van';
  $('votingHint').textContent = open
    ? 'A résztvevők most tudnak pontozni. A díjkiosztás előtt zárd le.'
    : 'A résztvevők látják a csapatokat, de nem tudnak pontozni.';
  $('votingBox').classList.toggle('live', open);

  $('switches').replaceChildren(
    ...SWITCHES.map(([key, label, hint]) =>
      el('div', { class: 'switch-row' },
        el('div', {},
          el('strong', {}, label),
          el('p', {}, hint)
        ),
        el('label', { class: 'switch' },
          el('input', {
            type: 'checkbox',
            checked: state.settings[key] === '1',
            onchange: (e) => saveSetting(key, e.target.checked),
          }),
          el('i', {})
        )
      )
    )
  );

  $('eventName').value = state.settings.event_name || '';
  $('introText').value = state.settings.intro_text || '';
  $('teamCount').value = c.teams_total;
}

const stat = (value, label) => el('div', { class: 'stat' }, el('b', {}, String(value)), el('span', {}, label));

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

$('saveTexts').addEventListener('click', async () => {
  await saveSetting('event_name', $('eventName').value);
  await saveSetting('intro_text', $('introText').value);
  loadOverview();
});

$('resetVotes').addEventListener('click', async () => {
  if (!confirm('Biztosan törlöd az ÖSSZES szavazatot? Ez nem vonható vissza.')) return;
  try {
    const r = await api('/api/admin/reset-votes', { method: 'POST', body: { confirm: 'TOROL' } });
    toast(`${r.deleted} szavazat törölve`);
    loadOverview();
  } catch (err) {
    toast(err.message, true);
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  location.href = '/admin/login';
});

/* ---------- csapatok ---------- */

async function loadTeams() {
  const { teams } = await api('/api/admin/teams');
  state.teams = teams;
  const body = $('teamsTable').querySelector('tbody');
  body.replaceChildren(
    ...teams.map((t) =>
      el('tr', {},
        el('td', { class: 'num' }, String(t.number)),
        el('td', {}, el('span', {
          class: 'thumb-sm',
          style: t.background_url ? { backgroundImage: `url("${t.background_url}")` } : {},
        })),
        el('td', {},
          el('span', { class: 'swatch', style: { background: t.accent_color || '#7c5cff' } }),
          el('input', {
            type: 'text',
            value: t.name,
            style: { width: '150px', padding: '6px 9px', fontSize: '14px', display: 'inline-block' },
            onchange: (e) => patchTeam(t.id, { name: e.target.value }),
          })
        ),
        el('td', {}, t.game_name || el('span', { class: 'muted' }, '-')),
        el('td', {}, el('code', {
          class: 'key',
          title: 'Kattints a másoláshoz',
          onclick: () => copy(t.api_key),
        }, `${t.api_key.slice(0, 14)}…`)),
        el('td', { class: 'num' }, String(t.voters)),
        el('td', {}, el('a', { class: 'mini', href: t.vote_url, target: '_blank', rel: 'noopener' }, 'Szavazólap')),
        el('td', {},
          el('div', { class: 'row tight' },
            el('button', { class: 'mini', onclick: () => rotateKey(t) }, 'Új kulcs'),
            el('button', { class: 'mini danger', onclick: () => removeTeam(t) }, 'Törlés')
          )
        )
      )
    )
  );
}

async function patchTeam(id, body) {
  try {
    await api(`/api/admin/teams/${id}`, { method: 'PATCH', body });
    toast('Mentve');
    loadTeams();
  } catch (err) {
    toast(err.message, true);
  }
}

async function rotateKey(t) {
  if (!confirm(`Új API kulcs a(z) ${t.number}. csapatnak? A régi azonnal érvénytelen lesz.`)) return;
  const r = await api(`/api/admin/teams/${t.id}/rotate-key`, { method: 'POST' });
  await copy(r.api_key);
  toast('Új kulcs a vágólapon');
  loadTeams();
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

$('addTeam').addEventListener('click', async () => {
  await api('/api/admin/teams', { method: 'POST', body: {} });
  toast('Csapat hozzáadva');
  loadTeams();
  loadOverview();
});

/* ---------- szempontok ---------- */

async function loadCriteria() {
  const { criteria } = await api('/api/admin/criteria');
  state.criteria = criteria;
  const body = $('criteriaTable').querySelector('tbody');
  body.replaceChildren(
    ...criteria.map((c) =>
      el('tr', {},
        el('td', {}, el('input', {
          type: 'number', value: c.position, style: { width: '68px', padding: '6px 9px', fontSize: '14px' },
          onchange: (e) => patchCriterion(c.id, { position: Number(e.target.value) }),
        })),
        el('td', {},
          el('input', {
            type: 'text', value: c.label,
            style: { width: '170px', padding: '6px 9px', fontSize: '14px', marginBottom: '4px' },
            onchange: (e) => patchCriterion(c.id, { label: e.target.value }),
          }),
          el('input', {
            type: 'text', value: c.description || '', placeholder: 'leírás',
            style: { width: '100%', padding: '6px 9px', fontSize: '13px' },
            onchange: (e) => patchCriterion(c.id, { description: e.target.value }),
          })
        ),
        el('td', { class: 'num' },
          el('input', {
            type: 'number', value: c.min_score, style: { width: '62px', padding: '6px 9px', fontSize: '14px' },
            onchange: (e) => patchCriterion(c.id, { min_score: Number(e.target.value) }),
          }),
          ' - ',
          el('input', {
            type: 'number', value: c.max_score, style: { width: '62px', padding: '6px 9px', fontSize: '14px' },
            onchange: (e) => patchCriterion(c.id, { max_score: Number(e.target.value) }),
          })
        ),
        el('td', {}, el('input', {
          type: 'number', value: c.weight, step: '0.5',
          style: { width: '72px', padding: '6px 9px', fontSize: '14px' },
          onchange: (e) => patchCriterion(c.id, { weight: Number(e.target.value) }),
        })),
        el('td', {}, el('label', { class: 'switch' },
          el('input', {
            type: 'checkbox', checked: Boolean(c.active),
            onchange: (e) => patchCriterion(c.id, { active: e.target.checked }),
          }),
          el('i', {})
        )),
        el('td', {}, el('button', { class: 'mini danger', onclick: () => removeCriterion(c) }, 'Törlés'))
      )
    )
  );
}

async function patchCriterion(id, body) {
  try {
    await api(`/api/admin/criteria/${id}`, { method: 'PATCH', body });
    toast('Mentve');
    loadCriteria();
  } catch (err) {
    toast(err.message, true);
    loadCriteria();
  }
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
  state.voters = voters;
  const body = $('votersTable').querySelector('tbody');
  body.replaceChildren(
    ...voters.map((v) =>
      el('tr', {},
        el('td', {}, el('code', { class: 'key', onclick: () => copy(v.login_url), title: 'Belépő link másolása' }, v.code)),
        el('td', {}, el('input', {
          type: 'text', value: v.name || '', placeholder: '-',
          style: { width: '150px', padding: '6px 9px', fontSize: '14px' },
          onchange: (e) => patchVoter(v.id, { name: e.target.value }),
        })),
        el('td', {}, teamSelect(v)),
        el('td', {}, v.activated ? el('span', { class: 'pill done' }, 'Igen') : el('span', { class: 'pill' }, 'Nem')),
        el('td', { class: 'num' }, String(v.voted_teams)),
        el('td', { class: 'muted small' }, since(v.last_seen_at) || '-'),
        el('td', {}, el('button', { class: 'mini danger', onclick: () => removeVoter(v) }, 'Törlés'))
      )
    )
  );
}

function teamSelect(v) {
  const sel = el('select', {
    style: { width: '150px', padding: '6px 9px', fontSize: '14px' },
    onchange: (e) => patchVoter(v.id, { team_id: e.target.value === '' ? null : Number(e.target.value) }),
  }, el('option', { value: '' }, '-'));
  for (const t of state.teams) {
    sel.append(el('option', { value: String(t.id), selected: v.team_id === t.id }, `${t.number}. ${t.name}`));
  }
  return sel;
}

async function patchVoter(id, body) {
  try {
    await api(`/api/admin/voters/${id}`, { method: 'PATCH', body });
    toast('Mentve');
  } catch (err) {
    toast(err.message, true);
  }
}

async function removeVoter(v) {
  if (!confirm(`Törlöd a(z) ${v.code} szavazót és a szavazatait?`)) return;
  await api(`/api/admin/voters/${v.id}`, { method: 'DELETE' });
  toast('Szavazó törölve');
  loadVoters();
  loadOverview();
}

$('addVoters').addEventListener('click', async () => {
  try {
    const r = await api('/api/admin/voters', { method: 'POST', body: { count: Number($('voterCount').value) } });
    toast(`${r.created} szavazó létrehozva`);
    loadVoters();
    loadOverview();
  } catch (err) {
    toast(err.message, true);
  }
});

/* ---------- eredmenyek ---------- */

/** Ne ismetlodjon a cim, ha a csapatnak meg nincs jatekneve. */
function rankSub(t) {
  const title = t.game_name || t.name;
  return title === `${t.number}. csapat`
    ? `${t.voters} szavazó`
    : `${t.number}. csapat · ${t.voters} szavazó`;
}

async function loadResults() {
  const r = await api('/api/admin/results');
  const s = r.stats;

  $('resultStats').replaceChildren(
    stat(s.voters_voted, `szavazó a ${s.voters_total}-ból`),
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
          el('div', { class: 'rank-title' }, t.game_name || t.name),
          el('div', { class: 'rank-sub' }, rankSub(t)),
          el('div', { class: 'meter' }, el('i', {
            style: { width: `${t.total_pct === null ? 0 : Math.round((t.total_pct / (maxPct || 1)) * 100)}%` },
          }))
        ),
        el('div', { class: 'rank-score' },
          el('b', {}, t.total_pct === null ? '-' : `${t.total_pct}`),
          el('span', {}, t.total_pct === null ? 'nincs szavazat' : `pont / 100 · átlagösszeg ${t.score_sum}`)
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
              el('b', {}, w.winner.game_name || w.winner.name),
              el('span', {}, `${w.winner.number}. csapat · átlag ${w.winner.avg}`))
          : el('span', {}, 'Még nincs szavazat')
      )
    )
  );

  const head = $('breakdown').querySelector('thead');
  head.replaceChildren(
    el('tr', {},
      el('th', {}, '#'),
      el('th', {}, 'Csapat'),
      ...r.criteria.map((c) => el('th', { class: 'num' }, c.label)),
      el('th', { class: 'num' }, 'Összesített')
    )
  );

  $('breakdown').querySelector('tbody').replaceChildren(
    ...r.teams.map((t) =>
      el('tr', {},
        el('td', { class: 'num' }, String(t.number)),
        el('td', {}, t.game_name || t.name),
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

  const { comments } = await api('/api/admin/results/matrix');
  $('comments').replaceChildren(
    comments.length
      ? el('div', { class: 'stack' },
          ...comments.map((c) =>
            el('div', { class: 'card' },
              el('div', { class: 'small muted', style: { marginBottom: '5px' } },
                `${c.number}. csapat (${c.team_name}) · ${c.name || c.code} · ${since(c.updated_at)}`),
              el('div', {}, c.comment)
            )
          )
        )
      : el('div', { class: 'note' }, 'Még nincs szöveges megjegyzés.')
  );
}

$('autoRefresh').addEventListener('change', setupRefresh);

function setupRefresh() {
  clearInterval(refreshTimer);
  if ($('autoRefresh').checked) {
    refreshTimer = setInterval(() => {
      if (!$('panel-eredmenyek').hidden) loadResults().catch(() => {});
    }, 5000);
  }
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
