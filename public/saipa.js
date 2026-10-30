// SAIPA — hockey photos grouped by SaiPa game, with IPTC info and fuzzy search.
const app = document.getElementById('app');
const state = {
  user: null,
  info: null, // settings, counts, sync status
  sections: [],
  mode: 'library', // or 'search'
  query: '',
  search: null,
  filter: 'all',
  collapsed: new Set(),
  pollTimer: null,
  lastSyncState: null,
};
const refs = {};

// ---- helpers ---------------------------------------------------------------------------

const PATHS = {
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  chevron: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  prev: 'M15.41 16.59 10.83 12l4.58-4.59L14 6l-6 6 6 6z',
  next: 'M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z',
  sync: 'M12 4V1L8 5l4 4V6a6 6 0 0 1 5.65 8.03l1.46 1.46A8 8 0 0 0 12 4zm0 14a6 6 0 0 1-5.65-8.03L4.89 8.51A8 8 0 0 0 12 20v3l4-4-4-4v3z',
  settings: 'M19.14 12.94a7.14 7.14 0 0 0 0-1.88l2.03-1.58a.48.48 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54A.48.48 0 0 0 13.93 2h-3.86a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.71 8.47a.47.47 0 0 0 .12.61l2.03 1.58a7.14 7.14 0 0 0 0 1.88l-2.03 1.58a.48.48 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.86c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.03-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z',
  info: 'M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z',
  download: 'M5 20h14v-2H5v2zm14-9h-4V3H9v8H5l7 7 7-7z',
  external: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  play: 'M8 5v14l11-7z',
  unfold: 'M12 5.83 15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z',
  fold: 'M7.41 18.59 8.83 20 12 16.83 15.17 20l1.41-1.41L12 14l-4.59 4.59zm9.18-13.18L15.17 4 12 7.17 8.83 4 7.41 5.41 12 10l4.59-4.59z',
  folder: 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z',
};

function icon(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
  return t.content.firstChild;
}

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'hidden'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  return el;
}

const CLIENT_VERSION = new URL(import.meta.url).searchParams.get('v');
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/_folio/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'x-folio': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const server = res.headers.get('x-folio-version');
  if (server && CLIENT_VERSION && server !== CLIENT_VERSION) {
    try {
      if (sessionStorage.getItem('folio-reloaded-for') !== server) {
        sessionStorage.setItem('folio-reloaded-for', server);
        location.reload();
      }
    } catch {}
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

function toast(message, { error = false } = {}) {
  const el = h('div', { class: `toast${error ? ' is-error' : ''}`, role: error ? 'alert' : 'status' }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), error ? 5000 : 2600);
}

function modal({ title, body, foot }) {
  const onKey = (e) => e.key === 'Escape' && close();
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const backdrop = h(
    'div',
    { class: 'modal-backdrop', onmousedown: (e) => e.target === backdrop && close() },
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('div', { class: 'modal-body' }, body),
      foot ? h('div', { class: 'modal-foot' }, foot) : null,
    ),
  );
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey);
  return { close };
}

const nf = new Intl.NumberFormat('fi-FI');
const plural = (n, one, many) => `${nf.format(n)} ${n === 1 ? one : many}`;
const WEEKDAY = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
// "ti 20.10.2026" from a wall-clock "2026-10-20T18:30" (no time zone games).
function fiDate(local) {
  const [y, m, d] = local.slice(0, 10).split('-').map(Number);
  const wd = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${d}.${m}.${y}`;
}
const fiTime = (local) => (local.length >= 16 ? local.slice(11, 16).replace(':', '.') : '');
const thumb = (id, size = 'thumbnail') => `/_folio/api/thumb/${id}${size === 'preview' ? '?size=preview' : ''}`;

// Same matching rules as the server, so the viewer can highlight matched words.
const fold = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
function wordMatches(q, t) {
  if (q === t || (t.startsWith(q) && q.length >= 2)) return true;
  let p = 0;
  while (p < q.length && p < t.length && q[p] === t[p]) p++;
  return p >= 4 && p >= Math.min(q.length, t.length) * 0.6;
}
function highlight(text, words) {
  const span = h('span');
  if (!words?.length) {
    span.textContent = text;
    return span;
  }
  for (const part of String(text).split(/([\p{L}\p{N}]+)/u)) {
    const f = fold(part);
    if (f && words.some((w) => wordMatches(w, f))) span.append(h('mark', {}, part));
    else span.append(part);
  }
  return span;
}

try {
  state.collapsed = new Set(JSON.parse(localStorage.getItem('saipa-collapsed') || '[]'));
} catch {}
const saveCollapsed = () => {
  try {
    localStorage.setItem('saipa-collapsed', JSON.stringify([...state.collapsed].slice(-2000)));
  } catch {}
};

// ---- shell -----------------------------------------------------------------------------

function renderShell() {
  refs.search = h('input', { type: 'search', placeholder: 'Search players, captions, opponents… e.g. “Kari torjunta”', 'aria-label': 'Search photos', autocomplete: 'off', spellcheck: 'false' });
  refs.clear = h('button', { class: 'btn btn-ghost btn-icon btn-sm clear', 'aria-label': 'Clear search', hidden: true, onclick: () => setQuery('') }, icon('close'));
  let timer;
  refs.search.addEventListener('input', () => {
    refs.clear.hidden = !refs.search.value;
    clearTimeout(timer);
    timer = setTimeout(() => setQuery(refs.search.value), 250);
  });
  refs.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setQuery('');
  });
  refs.syncBtn = h('button', { class: 'btn btn-outline sp-sync', onclick: startSync, title: 'Look for new photos and read their IPTC' }, icon('sync'), h('span', { class: 'hide-sm' }, 'Sync'));
  refs.progress = h('div', { class: 'sp-progress', hidden: true });
  refs.main = h('main', { class: 'sp-main' });

  app.replaceChildren(
    h(
      'header',
      { class: 'topbar sp-top' },
      h('a', { class: 'btn btn-ghost btn-icon sp-back', href: '/photos', title: 'Back to Immich', 'aria-label': 'Back to Immich' }, icon('back')),
      h('a', { class: 'sp-brand', href: '/saipa' }, h('img', { src: '/_folio/static/saipa-icon.svg', width: 32, height: 32, alt: '', class: 'brand-icon' }), h('span', {}, 'SAIPA')),
      h('div', { class: 'sp-search' }, icon('search'), refs.search, refs.clear),
      refs.syncBtn,
      h('button', { class: 'btn btn-ghost btn-icon', title: 'Settings', 'aria-label': 'Settings', onclick: () => settingsDialog() }, icon('settings')),
    ),
    refs.progress,
    refs.main,
  );
}

// ---- sync status -----------------------------------------------------------------------------

function showStatus(status) {
  const running = ['listing', 'reading'].includes(status?.state);
  document.body.classList.toggle('syncing', running);
  refs.progress.hidden = !running;
  refs.syncBtn.disabled = running;
  refs.syncBtn.querySelector('.icon').classList.toggle('spin', running);
  if (running) {
    const pct = status.total ? Math.round((status.done / status.total) * 100) : 0;
    refs.progress.replaceChildren(
      h('span', {}, status.state === 'listing' ? 'Looking through your hockey folder…' : `Reading IPTC info · ${nf.format(status.done)} / ${nf.format(status.total)}`),
      h('div', { class: 'bar' }, h('span', { style: { width: `${status.state === 'listing' ? 5 : pct}%` } })),
    );
  }
  if (state.lastSyncState && ['listing', 'reading'].includes(state.lastSyncState) && status.state === 'done') {
    toast('Sync finished');
    loadLibrary();
  }
  if (status?.state === 'error' && state.lastSyncState !== 'error') toast(`Sync failed: ${status.message}`, { error: true });
  state.lastSyncState = status?.state;
  clearTimeout(state.pollTimer);
  if (running) {
    // Show photos as they arrive during the first sync.
    if (status.state === 'reading' && !state.sections.length) loadLibrary();
    state.pollTimer = setTimeout(async () => showStatus(await api('/saipa/status').catch(() => status)), 1500);
  }
}

async function startSync() {
  try {
    showStatus(await api('/saipa/sync', { method: 'POST' }));
  } catch (err) {
    toast(err.message, { error: true });
  }
}

// ---- library & search ----------------------------------------------------------------------------

async function loadLibrary() {
  const data = await api('/saipa/library');
  state.sections = data.sections;
  state.info = { ...state.info, ...data };
  if (state.mode === 'library') renderSections();
}

async function setQuery(q) {
  q = q.trim();
  if (refs.search.value.trim() !== q) refs.search.value = q;
  refs.clear.hidden = !q;
  state.query = q;
  if (!q) {
    state.mode = 'library';
    state.search = null;
    renderSections();
    return;
  }
  const result = await api(`/saipa/search?q=${encodeURIComponent(q)}`);
  if (result.q !== state.query) return; // a newer search is on its way
  state.mode = 'search';
  state.search = result;
  renderSections();
}

function currentSections() {
  const list = state.mode === 'search' ? state.search.sections : state.sections;
  if (state.filter === 'games') return list.filter((s) => s.kind === 'game');
  if (state.filter === 'days') return list.filter((s) => s.kind === 'day');
  return list;
}

let io;
function renderSections() {
  io?.disconnect();
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        fillBody(e.target);
      }
    },
    { rootMargin: '1200px 0px' },
  );

  const sections = currentSections();
  const photos = sections.reduce((n, s) => n + s.items.length, 0);
  const games = sections.filter((s) => s.kind === 'game').length;
  const searching = state.mode === 'search';

  const summary = searching
    ? h('div', { class: 'sp-summary' }, h('b', {}, plural(state.search.total, 'photo', 'photos')), ` for “${state.query}”`, games ? ` · ${plural(games, 'game', 'games')}` : '')
    : h('div', { class: 'sp-summary' }, h('b', {}, plural(games, 'game', 'games')), ` · ${plural(photos, 'photo', 'photos')}`, state.info?.withMetadata != null ? ` · ${nf.format(state.info.withMetadata)} with IPTC` : '');

  const filterSeg = h(
    'div',
    { class: 'seg' },
    [
      ['all', 'All'],
      ['games', 'Games'],
      ['days', 'Other days'],
    ].map(([value, label]) =>
      h(
        'button',
        {
          'aria-pressed': String(state.filter === value),
          onclick: () => {
            state.filter = value;
            renderSections();
          },
        },
        label,
      ),
    ),
  );
  const tools = h(
    'div',
    { class: 'sp-tools' },
    filterSeg,
    !searching
      ? [
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => setAll(true) }, icon('fold'), 'Collapse all'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => setAll(false) }, icon('unfold'), 'Expand all'),
        ]
      : null,
  );

  const list = h('div', { class: 'sp-sections' });
  if (!sections.length) {
    list.append(
      searching
        ? h('div', { class: 'sp-empty' }, h('h2', {}, 'Nothing found'), h('p', {}, 'Try fewer or shorter words — “kari torj” works too.'))
        : h(
            'div',
            { class: 'sp-empty' },
            h('h2', {}, 'No photos yet'),
            h('p', {}, state.info?.status?.state === 'reading' || state.info?.status?.state === 'listing' ? 'Your folder is being read — photos appear here as soon as they’re found.' : 'Add photos to your hockey folder in Immich, then press Sync.'),
          ),
    );
  }
  for (const section of sections) list.append(sectionEl(section));

  refs.main.replaceChildren(
    h('div', { class: 'sp-toolbar' }, summary, tools),
    ...(searching && state.search.partial ? [h('div', { class: 'notice sp-partial' }, icon('info'), h('p', {}, 'No photo matched every word, so these match some of them.'))] : []),
    list,
  );
}

function setAll(collapse) {
  for (const s of currentSections()) collapse ? state.collapsed.add(s.key) : state.collapsed.delete(s.key);
  saveCollapsed();
  renderSections();
}

function score(game) {
  if (game.home.goals == null || !game.ended) return h('span', { class: 'sp-score is-upcoming' }, game.ended ? '–' : fiTime(game.local));
  const us = game.home.id === 'saipa' ? 'home' : 'away';
  const them = us === 'home' ? 'away' : 'home';
  const won = game[us].goals > game[them].goals;
  const suffix = game.finishedType === 'ENDED_DURING_WINNING_SHOT_COMPETITION' ? 'VL' : game.finishedType === 'ENDED_DURING_EXTENDED_GAME_TIME' ? 'JA' : '';
  return h('span', { class: `sp-score${won ? '' : ' is-loss'}`, title: won ? 'SaiPa won' : 'SaiPa lost' }, `${game.home.goals}–${game.away.goals}`, suffix ? h('small', {}, suffix) : null);
}

function teamName(team) {
  return h('span', { class: team.id === 'saipa' ? 'us' : '' }, team.name);
}

function sectionEl(section) {
  const searching = state.mode === 'search';
  const collapsed = !searching && state.collapsed.has(section.key);
  const g = section.game;
  const head = h(
    'div',
    {
      class: 'sp-head',
      role: 'button',
      tabindex: '0',
      'aria-expanded': String(!collapsed),
      onclick: () => toggle(section, el),
      onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle(section, el)),
    },
    h('span', { class: 'btn btn-ghost btn-icon btn-sm chev-btn' }, icon('chevron', 'chev')),
    h(
      'div',
      { class: 'sp-head-text' },
      g
        ? [
            h('div', { class: 'sp-title' }, teamName(g.home), h('span', { class: 'vs' }, '–'), teamName(g.away), score(g)),
            h('div', { class: 'sp-meta' }, [fiDate(g.local), `klo ${fiTime(g.local)}`, g.serie, g.arena].filter(Boolean).join(' · ')),
          ]
        : [h('div', { class: 'sp-title' }, fiDate(section.date)), h('div', { class: 'sp-meta' }, 'Not during a SaiPa game')],
    ),
    h('span', { class: 'sp-count' }, plural(section.items.length, 'photo', 'photos')),
  );
  const body = h('div', { class: 'sp-body' });
  const el = h('section', { class: `sp-section ${g ? 'sp-game' : 'sp-day'}${collapsed ? ' is-collapsed' : ''}`, 'data-key': section.key }, head, collapsed ? null : body);
  el._section = section;
  if (!collapsed) placeholder(body, section);
  return el;
}

function toggle(section, el) {
  if (state.mode === 'search') return;
  const collapsed = !state.collapsed.has(section.key);
  collapsed ? state.collapsed.add(section.key) : state.collapsed.delete(section.key);
  saveCollapsed();
  const fresh = sectionEl(section);
  el.replaceWith(fresh);
  if (collapsed && fresh.getBoundingClientRect().top < 64) fresh.scrollIntoView({ block: 'start' });
}

// Reserve roughly the right height so scrolling stays smooth, then lay out
// the photos once the section comes near the screen.
function placeholder(body, section) {
  const width = Math.max(320, (refs.main.clientWidth || window.innerWidth) - 48);
  const row = rowHeight(width);
  const totalWidth = section.items.reduce((w, it) => w + Math.min(3, Math.max(0.4, it[1] || 1.5)) * row, 0);
  const rows = Math.max(1, Math.ceil(totalWidth / width));
  body.replaceChildren(h('div', { class: 'sp-placeholder', style: { height: `${rows * (row + 4)}px` } }));
  body._section = section;
  io.observe(body);
}

const rowHeight = (width) => (width < 600 ? 130 : width < 1000 ? 170 : 210);

function fillBody(body) {
  const section = body._section;
  const width = body.clientWidth;
  if (!width) return;
  const target = rowHeight(width);
  const gap = 4;
  const frag = document.createDocumentFragment();
  let row = [];
  let sum = 0;
  const flush = (full) => {
    const hgt = full ? (width - gap * (row.length - 1)) / sum : Math.min(target, (width - gap * (row.length - 1)) / sum);
    const el = h('div', { class: 'sp-row' });
    let used = 0;
    row.forEach((it, n) => {
      const r = Math.min(3, Math.max(0.4, it[1] || 1.5));
      let w = Math.floor(r * hgt);
      if (full && n === row.length - 1) w = Math.max(1, Math.floor(width - used - gap * (row.length - 1)));
      used += w;
      el.append(thumbEl(it, w, Math.round(hgt), section));
    });
    frag.append(el);
    row = [];
    sum = 0;
  };
  for (const it of section.items) {
    row.push(it);
    sum += Math.min(3, Math.max(0.4, it[1] || 1.5));
    if (sum * target + gap * (row.length - 1) >= width) flush(true);
  }
  if (row.length) flush(false);
  body.replaceChildren(frag);
}

function thumbEl(item, w, hgt, section) {
  const [id, , video] = item;
  const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', src: thumb(id) });
  img.onload = img.onerror = () => img.classList.add('is-loaded');
  return h(
    'button',
    { class: 'sp-thumb', style: { width: `${w}px`, height: `${hgt}px` }, 'aria-label': 'Open photo', onclick: () => openViewer(section, id) },
    img,
    video ? h('span', { class: 'photo-badge' }, icon('play')) : null,
  );
}

// ---- viewer -------------------------------------------------------------------------------------

const FIELDS = [
  ['headline', 'Headline'],
  ['title', 'Title'],
  ['byline', 'Photographer'],
  ['bylineTitle', 'Position'],
  ['credit', 'Credit'],
  ['source', 'Source'],
  ['copyright', 'Copyright'],
  ['city', 'City'],
  ['sublocation', 'Location'],
  ['state', 'Region'],
  ['country', 'Country'],
  ['dateCreated', 'Date created'],
  ['category', 'Category'],
  ['supplementalCategories', 'More categories'],
  ['jobId', 'Job ID'],
  ['instructions', 'Instructions'],
  ['captionWriter', 'Caption by'],
  ['contact', 'Contact'],
];

function openViewer(section, id) {
  // Browse through every photo currently listed (all sections, in order).
  const list = currentSections().flatMap((s) => (state.mode === 'library' && state.collapsed.has(s.key) && s !== section ? [] : s.items.map((it) => it[0])));
  let index = Math.max(0, list.indexOf(id));
  const stageImg = h('div', { class: 'sp-stage-media' });
  const counter = h('span');
  const panel = h('aside', { class: 'sp-panel' });
  const stage = h(
    'div',
    { class: 'sp-stage' },
    h('div', { class: 'sp-stage-top' }, counter, h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    stageImg,
    h('button', { class: 'sp-nav prev', 'aria-label': 'Previous photo', onclick: () => go(-1) }, icon('prev')),
    h('button', { class: 'sp-nav next', 'aria-label': 'Next photo', onclick: () => go(1) }, icon('next')),
  );
  const root = h('div', { class: 'sp-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo' }, stage, panel);
  const onKey = (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  };
  let startX = null;
  stage.addEventListener('pointerdown', (e) => e.pointerType !== 'mouse' && (startX = e.clientX));
  stage.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });
  function close() {
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    root.remove();
  }
  function go(d) {
    index = (index + d + list.length) % list.length;
    show();
  }
  let token = 0;
  async function show() {
    const assetId = list[index];
    const mine = ++token;
    counter.textContent = `${nf.format(index + 1)} / ${nf.format(list.length)}`;
    const spinner = h('div', { class: 'lb-spinner' });
    const img = h('img', { alt: '', src: thumb(assetId, 'preview') });
    img.onload = img.onerror = () => spinner.remove();
    stageImg.replaceChildren(img, spinner);
    panel.replaceChildren(h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
    for (const d of [1, -1]) new Image().src = thumb(list[(index + d + list.length) % list.length], 'preview');
    try {
      const info = await api(`/saipa/asset/${assetId}`);
      if (mine === token) renderPanel(panel, info, close);
    } catch (err) {
      if (mine === token) panel.replaceChildren(h('p', { class: 'muted' }, err.message));
    }
  }
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.body.append(root);
  show();
}

function renderPanel(panel, info, closeViewer) {
  const m = info.meta;
  const words = state.mode === 'search' ? state.search.words : [];
  const parts = [];

  if (m) {
    const heading = m.headline || m.title;
    if (heading) parts.push(h('h2', {}, highlight(heading, words)));
    if (m.caption) parts.push(h('p', { class: 'caption' }, highlight(m.caption, words)));
    const kw = [].concat(m.keywords || []);
    if (kw.length) {
      parts.push(h('h3', {}, 'Keywords'));
      parts.push(
        h(
          'div',
          { class: 'sp-chips' },
          kw.map((k) =>
            h(
              'button',
              {
                title: `Search for “${k}”`,
                onclick: () => {
                  closeViewer();
                  setQuery(k);
                },
              },
              highlight(k, words),
            ),
          ),
        ),
      );
    }
    const rows = FIELDS.filter(([key]) => m[key] && (!['headline', 'title'].includes(key) || m[key] !== heading)).map(([key, label]) => [label, [].concat(m[key]).join(', ')]);
    if (rows.length) {
      parts.push(h('h3', {}, 'IPTC'));
      parts.push(h('dl', { class: 'sp-dl' }, rows.map(([label, value]) => [h('dt', {}, label), h('dd', {}, highlight(value, words))])));
    }
  } else {
    parts.push(
      h(
        'div',
        { class: 'sp-noiptc' },
        icon('info'),
        h('span', {}, info.checked ? 'This photo has no IPTC info (no caption, keywords or photographer). You can still find it by game, opponent or date.' : 'IPTC info for this photo hasn’t been read yet — it will be after the next sync.'),
      ),
    );
  }

  const g = info.game;
  parts.push(h('h3', {}, 'Game'));
  if (g) {
    const scorers = g.scorers?.length
      ? h(
          'ul',
          { class: 'sp-scorers' },
          g.scorers.map((s) => h('li', {}, h('span', {}, `${Math.floor(s.time / 60)}:${String(s.time % 60).padStart(2, '0')}`), `${s.score} ${s.name}`, s.tags?.length ? h('em', { class: 'sp-tag' }, s.tags.join(' ')) : null)),
        )
      : null;
    parts.push(
      h(
        'div',
        { class: 'sp-game-card' },
        h('b', {}, `${g.home.name} – ${g.away.name}${g.ended && g.home.goals != null ? `  ${g.home.goals}–${g.away.goals}` : ''}`),
        h('small', {}, [fiDate(g.local), `klo ${fiTime(g.local)}`, g.serie, g.arena, g.spectators ? `${nf.format(g.spectators)} spectators` : null].filter(Boolean).join(' · ')),
        scorers,
      ),
    );
  } else parts.push(h('p', { class: 'muted' }, 'Not taken during a SaiPa game.'));

  const e = info.exif;
  const camera = e
    ? [
        ['Camera', [e.make, e.model].filter(Boolean).join(' ')],
        ['Lens', e.lens],
        ['Exposure', [e.exposureTime ? `${e.exposureTime} s` : null, e.fNumber ? `f/${e.fNumber}` : null, e.iso ? `ISO ${e.iso}` : null, e.focalLength ? `${Math.round(e.focalLength)} mm` : null].filter(Boolean).join(' · ')],
        ['Size', e.width && e.height ? `${e.width} × ${e.height}${e.fileSize ? ` · ${(e.fileSize / 1e6).toFixed(1)} MB` : ''}` : null],
      ].filter(([, v]) => v)
    : [];
  parts.push(h('h3', {}, 'Photo'));
  parts.push(
    h(
      'dl',
      { class: 'sp-dl' },
      [['Taken', `${fiDate(info.time)} klo ${info.time.slice(11, 19).replace(/:/g, '.')}`], ['File', info.file], ...camera, ['Folder', info.path.replace(/\/[^/]*$/, '')]].map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]),
    ),
  );
  parts.push(
    h(
      'div',
      { class: 'sp-panel-actions' },
      h('a', { class: 'btn btn-outline btn-sm', href: `/photos/${info.id}`, target: '_blank', rel: 'noopener' }, icon('external'), 'Open in Immich'),
      h('a', { class: 'btn btn-outline btn-sm', href: `/_folio/api/saipa/original/${info.id}`, download: info.file || '' }, icon('download'), 'Download'),
    ),
  );
  panel.replaceChildren(...parts);
}

// ---- settings & setup -------------------------------------------------------------------------------

function folderPicker(current, onPick) {
  const filter = h('input', { class: 'input', placeholder: 'Filter folders, e.g. saipa or hockey', 'aria-label': 'Filter folders' });
  const list = h('div', { class: 'folder-list', role: 'radiogroup' }, h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
  let folders = [];
  const draw = () => {
    const q = fold(filter.value);
    const shown = folders.filter((f) => fold(f).includes(q)).slice(0, 400);
    list.replaceChildren(
      ...(shown.length
        ? shown.map((f) =>
            h(
              'label',
              {},
              h('input', { type: 'radio', name: 'folder', value: f, checked: f === current, onchange: () => onPick(f) }),
              f,
            ),
          )
        : [h('div', { class: 'none' }, folders.length ? 'No folder matches.' : 'Immich has no folders yet. Folders appear once photos are uploaded or imported from a library.')]),
    );
  };
  filter.addEventListener('input', draw);
  api('/saipa/folders')
    .then((d) => {
      folders = d.folders;
      draw();
    })
    .catch((err) => list.replaceChildren(h('div', { class: 'none' }, err.message)));
  return h('div', {}, filter, list);
}

function settingsFields(s) {
  const values = { ...s };
  const subfolders = h('input', { type: 'checkbox', class: 'switch', checked: s.subfolders, onchange: (e) => (values.subfolders = e.target.checked) });
  const num = (key, label, hint) =>
    h('div', { class: 'field' }, h('div', { class: 'label' }, label), h('input', { class: 'input', type: 'number', value: s[key], oninput: (e) => (values[key] = Number(e.target.value)) }), hint ? h('p', { class: 'hint' }, hint) : null);
  const el = h(
    'div',
    {},
    h('div', { class: 'field' }, h('div', { class: 'label' }, 'Hockey folder', h('small', {}, 'All photos in it are sorted into games')), folderPicker(s.folder, (f) => (values.folder = f))),
    h('label', { class: 'switch-row', style: { marginTop: '8px' } }, h('span', { class: 'text' }, 'Include subfolders', h('small', {}, 'e.g. one folder per game or per season')), subfolders),
    h(
      'div',
      { class: 'num-row', style: { marginTop: '12px' } },
      num('before', 'Minutes before', 'Warm-ups'),
      num('after', 'Minutes after', 'Game + celebrations'),
      num('clockOffset', 'Camera clock fix', 'Minutes to add'),
    ),
    h('p', { class: 'hint', style: { marginTop: '10px' } }, 'Photos are matched by the time on your camera. If its clock was wrong (say 1 hour behind), set the fix to 60.'),
  );
  return { el, values };
}

function settingsDialog() {
  const { el, values } = settingsFields(state.info.settings);
  const save = h('button', { class: 'btn btn-primary' }, 'Save');
  const m = modal({ title: 'SAIPA settings', body: el, foot: [h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Cancel'), save] });
  save.addEventListener('click', async () => {
    try {
      const info = await api('/saipa/settings', { method: 'PUT', body: values });
      state.info = { ...state.info, ...info };
      m.close();
      toast('Settings saved');
      showStatus(info.status);
      loadLibrary();
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
}

function renderSetup() {
  const { el, values } = settingsFields(state.info.settings);
  const go = h('button', { class: 'btn btn-primary', style: { marginTop: '18px' } }, 'Start');
  go.addEventListener('click', async () => {
    if (!values.folder) return toast('Pick a folder first', { error: true });
    go.disabled = true;
    try {
      state.info = await api('/saipa/settings', { method: 'PUT', body: values });
      start();
    } catch (err) {
      toast(err.message, { error: true });
      go.disabled = false;
    }
  });
  app.replaceChildren(
    h(
      'div',
      { class: 'sp-setup' },
      h('img', { src: '/_folio/static/saipa-icon.svg', width: 64, height: 64, alt: '', class: 'brand-icon' }),
      h('h1', {}, 'Your SaiPa photo archive'),
      h('p', {}, 'Pick the Immich folder where you keep your hockey photos. SAIPA sorts them into SaiPa games using Liiga’s schedule, reads their IPTC captions, and makes everything searchable.'),
      el,
      go,
    ),
  );
}

// ---- boot ----------------------------------------------------------------------------------------

async function start() {
  state.info = await api('/saipa/state');
  if (!state.info.settings.folder) return renderSetup();
  renderShell();
  showStatus(state.info.status);
  refs.main.replaceChildren(h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
  await loadLibrary();
  const q = new URLSearchParams(location.search).get('q');
  if (q) setQuery(q);
}

(async () => {
  app.replaceChildren(h('div', { class: 'center-screen' }, h('div', { class: 'spinner' })));
  try {
    await api('/me');
    await start();
  } catch (err) {
    app.replaceChildren(
      h(
        'div',
        { class: 'center-screen' },
        h(
          'div',
          { class: 'login-card' },
          h('img', { src: '/_folio/static/saipa-icon.svg', width: 48, height: 48, alt: '', class: 'brand-icon' }),
          h('h1', {}, err.status === 401 ? 'Sign in to Immich first' : 'SAIPA can’t start'),
          h('p', {}, err.status === 401 ? 'SAIPA uses your Immich account. Sign in to Immich in this browser, then come back.' : err.message),
          err.status === 401 ? h('a', { class: 'btn btn-primary', href: `/auth/login?continue=${encodeURIComponent('/saipa')}` }, 'Sign in with Immich') : null,
        ),
      ),
    );
  }
})();
