// Folio editor. Plain JS, no build step.
const app = document.getElementById('app');
const state = {
  meta: null,
  user: null,
  albums: null,
  page: null,
  draft: null,
  tab: 'content',
  device: 'desktop',
  expanded: new Set(['header']),
  saveTimer: null,
  saving: null,
  saveAgain: false,
  needsRefresh: false,
};
const refs = {};

// ---- helpers ---------------------------------------------------------------------------

const PATHS = {
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  drag: 'M9 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 16a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  chevron: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  up: 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z',
  external: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  more: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  upload: 'M5 20h14v-2H5v2zM9 16h6v-6h4l-7-7-7 7h4v6z',
  image: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z',
  lock: 'M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 0 1 6 0v2H9V6zm3 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  desktop: 'M21 2H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7v2H8v2h8v-2h-2v-2h7a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H3V4h18v12z',
  tablet: 'M18 1H6a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm-6 21a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm6-3H6V4h12v15z',
  phone: 'M16 1H8a2.5 2.5 0 0 0-2.5 2.5v17A2.5 2.5 0 0 0 8 23h8a2.5 2.5 0 0 0 2.5-2.5v-17A2.5 2.5 0 0 0 16 1zm-4 21a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4.5-4h-9V4h9v14z',
  link: 'M3.9 12A3.1 3.1 0 0 1 7 8.9h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8v2zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z',
  warning: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  text: 'M5 4v3h5.5v12h3V7H19V4H5z',
  albums: 'M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z',
  palette: 'M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.42-4.03-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  folio: 'M3 5.4 11 4v16l-8-1.4V5.4zm10-1.4 8 1.4v13.2L13 20V4zm1.4 13.4 2.6-4.2 1.5 2 .9-1.1 1.2 1.9-6.2 1.4zm4.2-9.6a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5z',
  header: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v6h16V6H4z',
  footer: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 10v4h16v-4H4z',
  quote: 'M6 17h3l2-4V7H5v6h3l-2 4zm8 0h3l2-4V7h-6v6h3l-2 4z',
  divider: 'M3 11h18v2H3zM8 6h8v2H8zm0 10h8v2H8z',
  button: 'M4 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v6h16V9H4zm3 2h10v2H7v-2z',
  info: 'M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z',
  eye: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62A7.95 7.95 0 0 1 20.36 16l2.37-.78A10.5 10.5 0 0 0 12.5 8z',
  hide: 'M12 7a5 5 0 0 1 5 5c0 .65-.13 1.26-.36 1.83l2.92 2.92A11.8 11.8 0 0 0 23 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16A4.85 4.85 0 0 1 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27z',
  play: 'M8 5v14l11-7z',
  move: 'M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z',
};

function icon(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${PATHS[name]}"/></svg>`;
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
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val);
    } else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'hidden', 'draggable'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  return el;
}

const svgEl = (markup) => {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 80 52" aria-hidden="true">${markup}</svg>`;
  return t.content.firstChild;
};

const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');

async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const res = await fetch(`/_folio/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'x-folio': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    if (res.status === 401 && path !== '/me' && path !== '/login') showLogin();
    throw err;
  }
  return data;
}

function toast(message, { error = false } = {}) {
  const el = h('div', { class: `toast${error ? ' is-error' : ''}`, role: error ? 'alert' : 'status' }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), error ? 5000 : 2600);
}

function modal({ title, body, foot, wide = false, onClose }) {
  const onKey = (e) => e.key === 'Escape' && close();
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const backdrop = h(
    'div',
    { class: 'modal-backdrop', onmousedown: (e) => e.target === backdrop && close() },
    h(
      'div',
      { class: `modal${wide ? ' is-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('div', { class: 'modal-body' }, body),
      foot ? h('div', { class: 'modal-foot' }, foot) : null,
    ),
  );
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey);
  return { close, el: backdrop };
}

function confirmDialog({ title, text, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (value) => {
      answered = true;
      m.close();
      resolve(value);
    };
    const m = modal({
      title,
      body: h('p', { class: 'muted', style: { margin: '0' } }, text),
      foot: [
        h('button', { class: 'btn btn-ghost', onclick: () => done(false) }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => done(true) }, confirm),
      ],
      onClose: () => !answered && resolve(false),
    });
  });
}

const plural = (n, word) => `${Number(n || 0).toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const fmtCount = (n) => plural(n, 'photo');
function ago(iso) {
  if (!iso) return '';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const steps = [
    [60, 'second'],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [604800, 'day', 86400],
    [2629800, 'week', 604800],
    [31557600, 'month', 2629800],
    [Infinity, 'year', 31557600],
  ];
  for (const [limit, unit, div = 1] of steps) if (Math.abs(diff) < limit) return rtf.format(Math.round(diff / div), unit);
  return '';
}
const pageUrl = (slug) => `${location.origin}/p/${slug}`;
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied');
  } catch {
    prompt('Copy this link', text);
  }
}

const FALLBACK = { serif: 'Georgia, serif', script: 'cursive', mono: 'ui-monospace, monospace' };
function fontStack(name) {
  const font = state.meta.fonts[name] || state.meta.fonts.Inter;
  if (font.system) return font.system;
  return `"${name}", ${FALLBACK[font.category] || 'system-ui, sans-serif'}`;
}
function loadFonts() {
  const families = Object.entries(state.meta.fonts)
    .filter(([, f]) => !f.system)
    .map(([name, f]) => `family=${name.replace(/ /g, '+')}:wght@${f.weights}`);
  // Google Fonts accepts many families per request, but keep URLs a sane length.
  for (let i = 0; i < families.length; i += 12) {
    document.head.append(h('link', { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?${families.slice(i, i + 12).join('&')}&display=swap` }));
  }
}

async function loadAlbums(force = false) {
  if (!state.albums || force) state.albums = (await api('/albums')).albums;
  return state.albums;
}
const albumInfo = (id) => state.albums?.find((a) => a.id === id);
const thumbUrl = (assetId, size = 'thumbnail') => (assetId ? `/_folio/api/thumb/${assetId}${size === 'preview' ? '?size=preview' : ''}` : null);

function closeMenus() {
  document.querySelectorAll('.menu, .font-list').forEach((m) => m.remove());
}
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.menu, .font-list, [data-menu-toggle]')) closeMenus();
});

const loadingScreen = () => h('div', { class: 'center-screen' }, h('div', { class: 'spinner' }));
const brandMark = (size = 32) => h('img', { class: 'brand-icon', src: '/_folio/static/icon.svg', alt: '', width: size, height: size });

function brand() {
  return h('a', { class: 'brand', href: '/folio', onclick: (e) => (e.preventDefault(), navigate('/folio')) }, brandMark(), h('span', {}, 'Folio'));
}

function menu(anchor, items) {
  if (anchor.querySelector('.menu')) return closeMenus();
  closeMenus();
  anchor.append(
    h(
      'div',
      { class: 'menu', role: 'menu' },
      items.filter(Boolean).map((item) =>
        item === '-'
          ? h('hr')
          : h(
              'button',
              {
                class: item.danger ? 'danger' : '',
                disabled: item.disabled,
                onclick: (e) => {
                  e.stopPropagation();
                  closeMenus();
                  item.run();
                },
              },
              icon(item.icon),
              item.label,
            ),
      ),
    ),
  );
}

// ---- routing -------------------------------------------------------------------------

async function navigate(path) {
  await flushSave();
  history.pushState({}, '', path);
  route();
}
window.addEventListener('popstate', () => flushSave().then(route));

async function route() {
  closeMenus();
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
  const m = location.pathname.match(/^\/folio\/([a-z0-9]+)/);
  try {
    if (m) await openEditor(m[1]);
    else await showList();
  } catch (err) {
    if (err.status === 401) return;
    if (err.status === 404 && m) {
      toast('That page no longer exists', { error: true });
      history.replaceState({}, '', '/folio');
      return showList();
    }
    app.replaceChildren(
      h(
        'div',
        { class: 'center-screen' },
        h('div', { class: 'login-card' }, h('h1', {}, 'Something went wrong'), h('p', {}, err.message), h('button', { class: 'btn btn-primary', onclick: () => route() }, 'Try again')),
      ),
    );
  }
}

// ---- login -----------------------------------------------------------------------------

function showLogin() {
  state.page = null;
  const keyInput = h('input', { class: 'input', type: 'password', placeholder: 'Immich API key', autocomplete: 'off' });
  const submit = async (e) => {
    e.preventDefault();
    try {
      state.user = (await api('/login', { method: 'POST', body: { apiKey: keyInput.value } })).user;
      route();
    } catch (err) {
      toast(err.message, { error: true });
    }
  };
  app.replaceChildren(
    h(
      'div',
      { class: 'center-screen' },
      h(
        'form',
        { class: 'login-card', onsubmit: submit },
        brandMark(48),
        h('h1', {}, 'Sign in to Folio'),
        h('p', {}, 'Folio uses your Immich account. Sign in to Immich in this browser and come back here.'),
        state.meta?.immichUrl ? h('a', { class: 'btn btn-primary', href: `/auth/login?continue=${encodeURIComponent('/folio')}` }, 'Sign in with Immich') : null,
        h('div', { class: 'divider' }, state.meta?.immichUrl ? 'or use an API key' : 'Use an Immich API key'),
        keyInput,
        h('p', { class: 'hint' }, 'Create one in Immich under Account settings → API keys.'),
        h('button', { class: 'btn btn-outline', type: 'submit' }, 'Continue'),
      ),
    ),
  );
}

// ---- pages list --------------------------------------------------------------------------

async function showList() {
  state.page = null;
  if (!app.querySelector('.list')) app.replaceChildren(loadingScreen());
  const [{ pages }] = await Promise.all([api('/pages'), loadAlbums().catch(() => [])]);
  const params = new URLSearchParams(location.search);

  const topbar = h(
    'header',
    { class: 'topbar' },
    brand(),
    h('div', { class: 'spacer' }),
    state.meta.immichUrl ? h('a', { class: 'btn btn-ghost hide-sm', href: '/photos' }, icon('back'), 'Back to Immich') : null,
    h('div', { class: 'user-chip' }, h('span', { class: 'avatar' }, (state.user.name || '?')[0].toUpperCase()), state.user.name),
  );

  const presets = state.meta.presets;
  const body = pages.length
    ? h('div', { class: 'page-grid' }, h('button', { class: 'new-card', onclick: () => newPageDialog() }, h('span', { class: 'plus' }, icon('plus')), 'New page'), pages.map(pageCard))
    : h(
        'div',
        { class: 'empty-state' },
        h(
          'div',
          { class: 'empty-art', 'aria-hidden': 'true' },
          [presets[0], presets[5], presets[3]].map((p, i) =>
            h('span', { style: { background: p.theme.bg, boxShadow: `inset 0 -18px 0 ${p.theme.accent}`, transform: `rotate(${(i - 1) * 6}deg)` } }),
          ),
        ),
        h('h2', {}, 'Make your first page'),
        h('p', {}, 'Pick a starting layout, add albums or hand-picked photos, choose a look — then share one beautiful link.'),
        h('button', { class: 'btn btn-primary', onclick: () => newPageDialog() }, icon('plus'), 'Create a page'),
      );

  app.replaceChildren(
    topbar,
    h(
      'main',
      { class: 'list' },
      h(
        'div',
        { class: 'list-head' },
        h('div', { class: 'list-title' }, brandMark(56), h('div', {}, h('h1', {}, 'Folio'), h('p', {}, 'Beautiful, shareable pages for your albums and photos.'))),
        pages.length ? h('button', { class: 'btn btn-primary', onclick: () => newPageDialog() }, icon('plus'), 'New page') : null,
      ),
      body,
    ),
  );

  // Deep link from elsewhere: /folio?new=1&album=<id>
  if (params.has('new')) {
    history.replaceState({}, '', '/folio');
    newPageDialog({ albumIds: params.getAll('album') });
  }
}

function statusChip(p) {
  if (p.expired) return h('span', { class: 'chip chip-expired' }, 'Expired');
  if (!p.live) return h('span', { class: 'chip' }, 'Draft');
  if (p.hasChanges) return h('span', { class: 'chip chip-changes' }, 'Unpublished changes');
  return h('span', { class: 'chip chip-live' }, 'Live');
}

function pageCard(p) {
  const albumThumb = p.firstAlbum && (p.firstAlbum.coverAssetId || albumInfo(p.firstAlbum.albumId)?.thumb);
  const src = p.cover ? `/_folio/img/${p.cover}` : thumbUrl(albumThumb || p.firstPhoto, 'preview');
  const meta = [`/p/${p.slug}`];
  if (p.albumCount) meta.push(plural(p.albumCount, 'album'));
  if (p.photoCount) meta.push(plural(p.photoCount, 'photo'));
  if (p.live) meta.push(plural(p.views, 'view'));
  return h(
    'a',
    { class: 'page-card', href: `/folio/${p.id}`, onclick: (e) => (e.preventDefault(), navigate(`/folio/${p.id}`)) },
    h(
      'div',
      { class: `page-thumb${src ? '' : ' no-img'}`, style: { background: p.theme.bg, color: src ? '#fff' : p.theme.text } },
      src ? h('img', { src, alt: '', loading: 'lazy' }) : null,
      h('span', { class: 'page-thumb-accent', style: { background: p.theme.accent } }),
      h('span', { class: 'page-thumb-title', style: { fontFamily: fontStack(p.theme.heading) } }, p.title),
    ),
    h(
      'div',
      { class: 'page-info' },
      h('div', { class: 'page-info-top' }, h('b', {}, p.title), statusChip(p), p.hasPassword ? h('span', { class: 'chip', title: 'Password protected' }, icon('lock')) : null),
      h('small', {}, meta.join(' · ')),
    ),
  );
}

function presetGrid(selected, onPick) {
  const grid = h('div', { class: 'presets' });
  for (const p of state.meta.presets) {
    grid.append(
      h(
        'button',
        {
          type: 'button',
          class: 'preset',
          'aria-pressed': String(p.id === selected),
          'data-preset': p.id,
          title: p.blurb,
          onclick: () => {
            grid.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === p.id)));
            onPick(p);
          },
        },
        h(
          'span',
          { class: 'preset-swatch', style: { background: p.theme.bg, color: p.theme.text } },
          h('span', { class: 'bar', style: { background: p.theme.accent } }),
          h('span', { class: 'aa', style: { fontFamily: fontStack(p.theme.heading), fontWeight: p.theme.headingWeight === 'bold' ? 700 : 400 } }, 'Aa'),
        ),
        h('span', { class: 'preset-name' }, p.name, h('small', {}, p.blurb)),
      ),
    );
  }
  return grid;
}

// Tiny schematic of a template: header shape + one bar per block.
function templateArt(t) {
  const hero = {
    cover: '<rect class="a" x="0" y="0" width="80" height="20"/><rect class="c" x="26" y="8" width="28" height="4" rx="1"/>',
    banner: '<rect class="a" x="0" y="0" width="80" height="11"/><circle class="c" cx="40" cy="12" r="3.5"/><rect class="b" x="28" y="17" width="24" height="2.5" rx="1"/>',
    split: '<rect class="c" x="6" y="7" width="22" height="4" rx="1"/><rect class="a" x="44" y="3" width="30" height="16" rx="2"/>',
    minimal: '<rect class="b" x="6" y="6" width="40" height="7" rx="1"/><rect class="c" x="6" y="16" width="8" height="1.5"/>',
  }[t.hero.style];
  const parts = { albums: [3, 'a', 7], photos: [5, 'a', 6], text: [1, 'b', 2.5], quote: [1, 'c', 3], divider: [1, 'b', 0.8], button: [1, 'c', 3.5] };
  let y = 24;
  let body = '';
  for (const type of t.blocks.slice(0, 4)) {
    const [n, cls, hgt] = parts[type];
    if (n === 1) {
      const w = type === 'button' ? 16 : type === 'divider' ? 50 : 44;
      body += `<rect class="${cls}" x="${(80 - w) / 2}" y="${y}" width="${w}" height="${hgt}" rx="1"/>`;
    } else {
      const w = (68 - (n - 1) * 2) / n;
      for (let i = 0; i < n; i++) body += `<rect class="${cls}" x="${6 + i * (w + 2)}" y="${y}" width="${w}" height="${hgt}" rx="1"/>`;
    }
    y += hgt + 3;
  }
  return svgEl(hero + body);
}

function newPageDialog({ albumIds = [] } = {}) {
  let template = state.meta.templates.find((t) => t.id === 'delivery') || state.meta.templates[0];
  let preset = template.preset;
  let presetTouched = false;
  const title = h('input', { class: 'input', id: 'new-page-title', placeholder: 'e.g. Emma & Jonas — Wedding', maxlength: 120 });
  const create = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create page');
  const presets = presetGrid(preset, (p) => {
    preset = p.id;
    presetTouched = true;
  });
  const templates = h(
    'div',
    { class: 'choices templates' },
    state.meta.templates.map((t) =>
      h(
        'button',
        {
          type: 'button',
          class: 'choice',
          'aria-pressed': String(t.id === template.id),
          'data-template': t.id,
          title: t.blurb,
          onclick: () => {
            template = t;
            templates.querySelectorAll('.choice').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.template === t.id)));
            if (!presetTouched) {
              preset = t.preset;
              presets.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === t.preset)));
            }
          },
        },
        templateArt(t),
        h('span', {}, t.name, h('small', {}, t.blurb)),
      ),
    ),
  );
  const submit = async (e) => {
    e?.preventDefault();
    create.disabled = true;
    try {
      const { page, linkErrors } = await api('/pages', { method: 'POST', body: { title: title.value, preset, template: template.id, albumIds } });
      m.close();
      reportLinkErrors(linkErrors);
      state.tab = 'content';
      state.expanded = new Set(['header']);
      navigate(`/folio/${page.id}`);
    } catch (err) {
      toast(err.message, { error: true });
      create.disabled = false;
    }
  };
  const form = h(
    'form',
    { onsubmit: submit },
    h('div', { class: 'field' }, h('label', { class: 'label', for: 'new-page-title' }, 'Page title'), title),
    h('div', { class: 'field' }, h('div', { class: 'label' }, 'Start from', h('small', {}, 'A ready-made layout you can change')), templates),
    h('div', { class: 'field' }, h('div', { class: 'label' }, 'Theme', h('small', {}, 'Colors and fonts')), presets),
    albumIds.length ? h('div', { class: 'notice', style: { marginTop: '16px' } }, icon('info'), h('p', {}, `${plural(albumIds.length, 'album')} will be added to this page.`)) : null,
  );
  const m = modal({ title: 'New page', wide: true, body: form, foot: [h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Cancel'), create] });
  create.onclick = submit;
  setTimeout(() => title.focus(), 30);
}

function reportLinkErrors(errors) {
  if (!errors?.length) return;
  const e = errors[0];
  const what = e.albumId ? `the album “${albumInfo(e.albumId)?.name || 'unknown'}”` : 'some photos';
  toast(`Couldn't share ${what}: ${e.message}`, { error: true });
}

// ---- editor ----------------------------------------------------------------------------

async function openEditor(id) {
  if (state.page?.id !== id) {
    app.replaceChildren(loadingScreen());
    const [{ page }] = await Promise.all([api(`/pages/${id}`), loadAlbums().catch(() => [])]);
    state.page = page;
    state.draft = structuredClone(page.draft);
  }
  renderEditor();
}

const TABS = [
  { id: 'content', label: 'Content', icon: 'text' },
  { id: 'design', label: 'Design', icon: 'palette' },
  { id: 'sharing', label: 'Sharing', icon: 'link' },
];
const DEVICES = {
  desktop: { width: 1280, label: 'Desktop' },
  tablet: { width: 834, height: 1112, label: 'Tablet' },
  phone: { width: 390, height: 844, label: 'Phone' },
};

function setTab(id) {
  state.tab = id;
  refs.tabs?.querySelectorAll('.tab').forEach((b, i) => b.setAttribute('aria-selected', String(TABS[i].id === id)));
}

function renderEditor() {
  refs.title = h('b', {}, state.draft.title);
  refs.status = h('span');
  refs.save = h('span', { class: 'save-state' });
  refs.publish = h('button', { class: 'btn btn-primary', onclick: publish });
  refs.copy = h('button', { class: 'btn btn-outline hide-sm', onclick: () => copy(pageUrl(state.page.slug)) }, icon('copy'), 'Copy link');
  refs.view = h('a', { class: 'btn btn-ghost btn-icon hide-sm', target: '_blank', rel: 'noopener', 'aria-label': 'Open live page', title: 'Open live page' }, icon('external'));
  const moreWrap = h('div', { class: 'menu-wrap' });
  moreWrap.append(h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'More actions', 'data-menu-toggle': '', onclick: () => openMoreMenu(moreWrap) }, icon('more')));

  const topbar = h(
    'header',
    { class: 'topbar' },
    h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'All pages', title: 'All pages', onclick: () => navigate('/folio') }, icon('back')),
    brandMark(28),
    h('div', { class: 'doc-title' }, refs.title, h('span', {}, refs.status, refs.save)),
    h('div', { class: 'spacer' }),
    refs.copy,
    refs.view,
    refs.publish,
    moreWrap,
  );

  refs.tabs = h(
    'div',
    { class: 'tabs', role: 'tablist' },
    TABS.map((t) =>
      h(
        'button',
        {
          class: 'tab',
          role: 'tab',
          'aria-selected': String(state.tab === t.id),
          onclick: () => {
            setTab(t.id);
            refs.body.scrollTop = 0;
            renderPanel();
          },
        },
        icon(t.icon),
        t.label,
      ),
    ),
  );
  refs.body = h('div', { class: 'panel-body', role: 'tabpanel' });

  refs.device = h('div', { class: 'device', 'data-device': state.device });
  refs.stage = h('div', { class: 'preview-stage' }, refs.device);
  const deviceSeg = h(
    'div',
    { class: 'seg' },
    Object.entries(DEVICES).map(([key, d]) =>
      h(
        'button',
        {
          'aria-pressed': String(state.device === key),
          'aria-label': d.label,
          title: d.label,
          onclick: (e) => {
            state.device = key;
            refs.device.dataset.device = key;
            deviceSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
            layoutDevice();
          },
        },
        icon(key),
      ),
    ),
  );

  app.replaceChildren(
    h(
      'div',
      { class: 'editor' },
      topbar,
      h('aside', { class: 'panel' }, refs.tabs, refs.body),
      h(
        'section',
        { class: 'preview', 'aria-label': 'Live preview' },
        refs.stage,
        h('div', { class: 'preview-bar' }, deviceSeg, h('span', { class: 'preview-tip hide-sm' }, icon('move'), 'Drag handles in the preview to resize')),
      ),
    ),
  );
  new ResizeObserver(layoutDevice).observe(refs.stage);
  renderPanel();
  updateChrome();
  refreshPreview();
}

function layoutDevice() {
  if (!refs.stage?.isConnected) return;
  const W = refs.stage.clientWidth - 48;
  const H = refs.stage.clientHeight - 20 - 80;
  const d = DEVICES[state.device];
  let width;
  let height;
  let scale;
  if (state.device === 'desktop') {
    width = Math.max(W, 1200);
    scale = W / width;
    height = H / scale;
  } else {
    width = d.width;
    height = d.height;
    scale = Math.min(1, W / width, H / height);
  }
  Object.assign(refs.device.style, { width: `${width}px`, height: `${height}px`, transform: `translateX(-50%) scale(${scale})` });
}

function refreshPreview() {
  const base = `/_folio/preview/${state.page.id}`;
  const old = refs.device.querySelector('iframe:last-of-type');
  let path = base;
  let scroll = 0;
  try {
    if (old) {
      const loc = old.contentWindow.location;
      if (loc.pathname.startsWith(base)) path = loc.pathname;
      scroll = old.contentWindow.scrollY;
    }
  } catch {}
  const frame = h('iframe', { title: 'Page preview', class: 'is-loading', src: `${path}?edit=1&t=${Date.now()}` });
  frame.addEventListener(
    'load',
    () => {
      try {
        frame.contentWindow.scrollTo({ top: scroll, behavior: 'instant' });
      } catch {}
      frame.classList.remove('is-loading');
      refs.device.querySelectorAll('iframe').forEach((f) => f !== frame && f.remove());
    },
    { once: true },
  );
  refs.device.append(frame);
}

const previewFrame = () => refs.device?.querySelector('iframe:last-of-type');
function highlightInPreview(target) {
  previewFrame()?.contentWindow?.postMessage({ source: 'folio-editor', type: 'highlight', target }, location.origin);
}

// Messages from the preview: drag handles and "Edit" chips.
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.data?.source !== 'folio-preview' || !state.page) return;
  if (e.data.type === 'set') {
    for (const [path, value] of Object.entries(e.data.changes || {})) setPath(path, value);
    changed({ refresh: false });
    if (state.tab === 'content' && state.expanded.has('header')) renderPanel();
  }
  if (e.data.type === 'select') selectCard(e.data.target);
});

function selectCard(target) {
  setTab('content');
  state.expanded.add(target);
  renderPanel();
  requestAnimationFrame(() => {
    const card = refs.body.querySelector(`[data-card="${CSS.escape(target)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.add('is-flash');
    setTimeout(() => card.classList.remove('is-flash'), 900);
  });
}

function updateChrome() {
  const p = state.page;
  refs.title.textContent = state.draft.title;
  refs.status.replaceChildren(statusChip(p));
  refs.copy.hidden = !p.live;
  refs.view.hidden = !p.live;
  refs.view.href = pageUrl(p.slug);
  const label = !p.live ? 'Publish' : p.hasChanges ? 'Update live page' : 'Published';
  refs.publish.replaceChildren(p.live && !p.hasChanges ? icon('check') : '', label);
  refs.publish.disabled = p.live && !p.hasChanges;
  refs.publish.classList.toggle('is-done', p.live && !p.hasChanges);
}

function openMoreMenu(wrap) {
  const p = state.page;
  menu(wrap, [
    p.live && { label: 'Open live page', icon: 'external', run: () => window.open(pageUrl(p.slug), '_blank', 'noopener') },
    { label: 'Open preview in new tab', icon: 'eye', run: () => window.open(`/_folio/preview/${p.id}`, '_blank', 'noopener') },
    p.live && p.hasChanges && { label: 'Discard unpublished changes', icon: 'undo', run: discardChanges },
    p.live && { label: 'Unpublish', icon: 'hide', run: unpublish },
    '-',
    { label: 'Delete page', icon: 'trash', danger: true, run: deletePageFlow },
  ]);
}

// ---- saving ----------------------------------------------------------------------------

function changed({ rerender = false, refresh = true } = {}) {
  refs.title.textContent = state.draft.title;
  refs.save.textContent = '· Editing…';
  refs.save.classList.remove('is-error');
  if (refresh) state.needsRefresh = true;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveDraft, 450);
  if (rerender) renderPanel();
}

async function saveDraft() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (state.saving) {
    state.saveAgain = true;
    return state.saving;
  }
  const pageId = state.page.id;
  const refresh = state.needsRefresh;
  state.needsRefresh = false;
  refs.save.textContent = '· Saving…';
  state.saving = (async () => {
    try {
      const before = state.page.linked.join();
      const { page, linkErrors } = await api(`/pages/${pageId}/draft`, { method: 'PUT', body: { draft: state.draft } });
      if (state.page?.id !== pageId) return;
      state.page = page;
      refs.save.textContent = '· Saved';
      updateChrome();
      reportLinkErrors(linkErrors);
      if (refresh || before !== page.linked.join()) refreshPreview();
      if (state.tab === 'content' && before !== page.linked.join()) renderPanel();
    } catch (err) {
      state.needsRefresh ||= refresh;
      if (refs.save) {
        refs.save.textContent = '· Not saved';
        refs.save.classList.add('is-error');
      }
      if (err.status !== 401) toast(err.message, { error: true });
    }
  })();
  await state.saving;
  state.saving = null;
  if (state.saveAgain) {
    state.saveAgain = false;
    await saveDraft();
  }
}

async function flushSave() {
  if (state.saveTimer) await saveDraft();
  else if (state.saving) await state.saving;
}

window.addEventListener('beforeunload', () => {
  if (!state.saveTimer || !state.page) return;
  fetch(`/_folio/api/pages/${state.page.id}/draft`, {
    method: 'PUT',
    keepalive: true,
    credentials: 'same-origin',
    headers: { 'x-folio': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ draft: state.draft }),
  });
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && state.page) {
    e.preventDefault();
    flushSave();
  }
});

async function publish() {
  refs.publish.disabled = true;
  const first = !state.page.live;
  try {
    await flushSave();
    const { page, linkErrors } = await api(`/pages/${state.page.id}/publish`, { method: 'POST' });
    state.page = page;
    updateChrome();
    reportLinkErrors(linkErrors);
    if (first) shareDialog();
    else toast('Live page updated');
    if (state.tab === 'sharing') renderPanel();
  } catch (err) {
    toast(err.message, { error: true });
    updateChrome();
  }
}

function shareDialog() {
  const url = pageUrl(state.page.slug);
  const m = modal({
    title: 'Your page is live',
    body: h(
      'div',
      {},
      h('p', { class: 'muted', style: { marginTop: '0' } }, 'Anyone with this link can see the page', state.page.hasPassword ? ' (after entering the password).' : '.'),
      h('div', { class: 'slug' }, h('input', { value: url, readonly: true, 'aria-label': 'Page link', onfocus: (e) => e.target.select() }), h('button', { class: 'btn btn-soft btn-sm', onclick: () => copy(url) }, icon('copy'), 'Copy')),
    ),
    foot: [h('a', { class: 'btn btn-ghost', href: url, target: '_blank', rel: 'noopener' }, icon('external'), 'Open page'), h('button', { class: 'btn btn-primary', onclick: () => m.close() }, 'Done')],
  });
}

async function discardChanges() {
  if (!(await confirmDialog({ title: 'Discard changes?', text: 'Your draft goes back to what is currently live.', confirm: 'Discard', danger: true }))) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  const { page } = await api(`/pages/${state.page.id}/discard`, { method: 'POST' });
  state.page = page;
  state.draft = structuredClone(page.draft);
  updateChrome();
  renderPanel();
  refreshPreview();
  toast('Changes discarded');
}

async function unpublish() {
  if (!(await confirmDialog({ title: 'Unpublish this page?', text: 'The link stops working until you publish again. Your draft is kept.', confirm: 'Unpublish', danger: true }))) return;
  const { page } = await api(`/pages/${state.page.id}/unpublish`, { method: 'POST' });
  state.page = page;
  updateChrome();
  renderPanel();
  toast('Page unpublished');
}

async function deletePageFlow() {
  const ok = await confirmDialog({
    title: `Delete “${state.draft.title}”?`,
    text: 'The page and its Immich share links are removed. Your albums and photos stay untouched in Immich.',
    confirm: 'Delete page',
    danger: true,
  });
  if (!ok) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  await api(`/pages/${state.page.id}`, { method: 'DELETE' });
  state.page = null;
  toast('Page deleted');
  navigate('/folio');
}

async function patchPage(body, message = 'Saved') {
  try {
    const { page } = await api(`/pages/${state.page.id}`, { method: 'PATCH', body });
    state.page = page;
    updateChrome();
    renderPanel();
    refreshPreview();
    toast(message);
    return true;
  } catch (err) {
    toast(err.message, { error: true });
    return false;
  }
}

// ---- controls ----------------------------------------------------------------------------

const get = (path) => path.split('.').reduce((o, k) => o?.[k], state.draft);
function setPath(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o?.[k], state.draft);
  if (target) target[last] = value;
}
function set(path, value, opts) {
  setPath(path, value);
  changed(opts);
}

function field(label, control, { hint, aside } = {}) {
  return h('div', { class: 'field' }, h('div', { class: 'label' }, label, aside ? h('small', {}, aside) : null), control, hint ? h('p', { class: 'hint' }, hint) : null);
}

function textInput(path, { placeholder, multiline = false, rows = 4, maxlength, label, onInput } = {}) {
  const el = h(multiline ? 'textarea' : 'input', { class: multiline ? 'textarea' : 'input', placeholder, rows: multiline ? rows : null, maxlength, 'aria-label': label });
  el.value = get(path) ?? '';
  el.addEventListener('input', () => {
    set(path, el.value);
    onInput?.(el.value);
  });
  return el;
}

function seg(path, options, { rerender = false } = {}) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  for (const o of options) {
    wrap.append(
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(get(path) === o.value),
          title: o.title,
          onclick: () => {
            wrap.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === o.value)));
            set(path, o.value, { rerender });
          },
        },
        o.icon ? icon(o.icon) : null,
        o.label,
      ),
    );
  }
  return wrap;
}

function choices(path, options, { rerender = false } = {}) {
  const wrap = h('div', { class: 'choices', role: 'group' });
  for (const o of options) {
    wrap.append(
      h(
        'button',
        {
          type: 'button',
          class: 'choice',
          'aria-pressed': String(get(path) === o.value),
          onclick: () => {
            wrap.querySelectorAll('.choice').forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === o.value)));
            set(path, o.value, { rerender });
          },
        },
        svgEl(o.svg),
        o.label,
      ),
    );
  }
  return wrap;
}

function toggle(path, label, hint, { onChange } = {}) {
  const value = onChange ? path : get(path);
  const input = h('input', { type: 'checkbox', class: 'switch', checked: value });
  input.addEventListener('change', () => (onChange ? onChange(input.checked) : set(path, input.checked)));
  return h('label', { class: 'switch-row' }, h('span', { class: 'text' }, label, hint ? h('small', {}, hint) : null), input);
}

function range(path, min, max, step, format) {
  const out = h('output', {}, format(get(path)));
  const input = h('input', { type: 'range', min, max, step, value: get(path) });
  input.addEventListener('input', () => {
    out.textContent = format(Number(input.value));
    set(path, Number(input.value));
  });
  return h('div', { class: 'range' }, input, out);
}

function colorField(path, label, onChange) {
  const value = get(path);
  const picker = h('input', { type: 'color', value, 'aria-label': `${label} color` });
  const text = h('input', { type: 'text', value, maxlength: 7, spellcheck: 'false', 'aria-label': `${label} hex value` });
  const apply = (v) => {
    state.draft.theme.preset = 'custom';
    document.querySelectorAll('.panel .preset').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    set(path, v);
    onChange?.();
  };
  picker.addEventListener('input', () => {
    text.value = picker.value;
    apply(picker.value);
  });
  text.addEventListener('input', () => {
    const v = text.value.trim().toLowerCase();
    const full = /^#?[0-9a-f]{6}$/.test(v) ? (v.startsWith('#') ? v : `#${v}`) : null;
    if (full) {
      picker.value = full;
      apply(full);
    }
  });
  return field(label, h('div', { class: 'color' }, picker, text));
}

const FONT_GROUPS = { sans: 'Sans serif', display: 'Display', serif: 'Serif', script: 'Handwriting', mono: 'Monospace' };
function fontPicker(path) {
  const current = get(path);
  const button = h('button', { type: 'button', class: 'font-button', 'data-menu-toggle': '', style: { fontFamily: fontStack(current) } }, current, icon('chevron'));
  const wrap = h('div', { class: 'font-picker' }, button);
  button.addEventListener('click', () => {
    if (wrap.querySelector('.font-list')) return closeMenus();
    closeMenus();
    const list = h('div', { class: 'font-list', role: 'listbox' });
    for (const [group, label] of Object.entries(FONT_GROUPS)) {
      const fonts = Object.entries(state.meta.fonts).filter(([, f]) => f.category === group);
      if (!fonts.length) continue;
      list.append(h('div', { class: 'font-group' }, label));
      for (const [name] of fonts) {
        list.append(
          h(
            'button',
            {
              type: 'button',
              role: 'option',
              'aria-selected': String(name === get(path)),
              style: { fontFamily: fontStack(name) },
              onclick: () => {
                closeMenus();
                state.draft.theme.preset = 'custom';
                set(path, name, { rerender: true });
              },
            },
            name,
          ),
        );
      }
    }
    wrap.append(list);
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  });
  return wrap;
}

function section(title, description, ...children) {
  return h(
    'section',
    { class: 'section' },
    title ? h('div', { class: 'section-head' }, h('div', {}, h('h3', {}, title), description ? h('p', {}, description) : null)) : null,
    children,
  );
}

function renderPanel() {
  if (!refs.body) return;
  const scroll = refs.body.scrollTop;
  const builders = { content: contentTab, design: designTab, sharing: sharingTab };
  refs.body.replaceChildren(...[builders[state.tab]()].flat());
  refs.body.scrollTop = scroll;
}

// Drag-to-reorder for any list rendered as sibling elements.
let dragging = null;
function sortable(el, { list, index, handle, axis = 'y', onDrop }) {
  (handle || el).addEventListener('pointerdown', () => (el.draggable = true));
  el.addEventListener('dragstart', (e) => {
    dragging = { list, from: index };
    el.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    e.stopPropagation();
  });
  el.addEventListener('dragend', () => {
    el.draggable = false;
    dragging = null;
    document.querySelectorAll('.is-dragging, .drop-before, .drop-after').forEach((n) => n.classList.remove('is-dragging', 'drop-before', 'drop-after'));
  });
  el.addEventListener('dragover', (e) => {
    if (dragging?.list !== list) return;
    e.preventDefault();
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    const after = axis === 'x' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    el.classList.toggle('drop-after', after);
    el.classList.toggle('drop-before', !after);
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
  el.addEventListener('drop', (e) => {
    if (dragging?.list !== list) return;
    e.preventDefault();
    e.stopPropagation();
    let to = el.classList.contains('drop-after') ? index + 1 : index;
    if (dragging.from < to) to--;
    const [item] = list.splice(dragging.from, 1);
    list.splice(to, 0, item);
    dragging = null;
    onDrop();
  });
}

// ---- image fields (cover, logo) -------------------------------------------------------------

function imageField(kind) {
  const value = state.draft[kind];
  const fallback = kind === 'cover' ? 'First album or photo' : 'No logo';
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,image/avif', hidden: true });
  const busy = (on) => wrap.querySelectorAll('button').forEach((b) => (b.disabled = on));
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    busy(true);
    try {
      const { image } = await api(`/pages/${state.page.id}/images`, { method: 'POST', raw: f, headers: { 'content-type': f.type || 'application/octet-stream' } });
      set(kind, image, { rerender: true });
    } catch (err) {
      toast(err.message, { error: true });
      busy(false);
    }
  });
  const fromImmich = () =>
    photoPicker({
      title: kind === 'cover' ? 'Choose a cover photo' : 'Choose a logo',
      single: true,
      onDone: async ([asset]) => {
        busy(true);
        try {
          const { image } = await api(`/pages/${state.page.id}/images/from-asset`, { method: 'POST', body: { assetId: asset.id } });
          set(kind, image, { rerender: true });
        } catch (err) {
          toast(err.message, { error: true });
          busy(false);
        }
      },
    });
  const wrap = h(
    'div',
    { class: 'image-field' },
    h('div', { class: `image-preview${kind === 'logo' ? ' is-logo' : ''}` }, value ? h('img', { src: `/_folio/img/${value}`, alt: '' }) : fallback),
    h(
      'div',
      { class: 'image-actions' },
      h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => file.click() }, icon('upload'), 'Upload'),
      h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: fromImmich }, icon('image'), 'From Immich'),
      value ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => set(kind, null, { rerender: true }) }, 'Remove') : null,
      file,
    ),
  );
  return wrap;
}

// ---- content tab: header, blocks, footer -------------------------------------------------------

const BLOCKS = {
  albums: { label: 'Albums', icon: 'albums', desc: 'Album cards, tiles, or every photo inline' },
  photos: { label: 'Photos', icon: 'image', desc: 'Hand-picked photos from your library' },
  text: { label: 'Text', icon: 'text', desc: 'A heading and some paragraphs' },
  quote: { label: 'Quote', icon: 'quote', desc: 'A big quote with an author' },
  divider: { label: 'Divider', icon: 'divider', desc: 'A line, an ornament, or empty space' },
  button: { label: 'Button', icon: 'button', desc: 'A link to anywhere' },
};

function blankBlock(type) {
  const base = { id: newId(), type };
  return {
    albums: { ...base, heading: '', albums: [], albumStyle: 'cards', columns: 3, grouping: 'none', sort: 'custom', showCounts: true, showDates: true },
    photos: { ...base, heading: '', text: '', photos: [], style: 'justified', density: 'normal', rowHeight: 280, columns: 3 },
    text: { ...base, heading: '', body: '', align: 'left', size: 'normal' },
    quote: { ...base, text: '', author: '', align: 'center' },
    divider: { ...base, style: 'line', size: 'm' },
    button: { ...base, label: 'Get in touch', url: '', style: 'accent', align: 'center' },
  }[type];
}

function blockSummary(b) {
  const snip = (s) => (s.length > 42 ? `${s.slice(0, 42)}…` : s);
  switch (b.type) {
    case 'albums':
      return [b.heading, plural(b.albums.length, 'album')].filter(Boolean).join(' · ');
    case 'photos':
      return [b.heading, plural(b.photos.length, 'photo')].filter(Boolean).join(' · ');
    case 'text':
      return snip(b.heading || b.body || 'Empty');
    case 'quote':
      return snip(b.text || 'Empty');
    case 'divider':
      return { line: 'Line', ornament: 'Ornament', space: 'Empty space' }[b.style];
    case 'button':
      return b.url ? b.label : `${b.label} · no link yet`;
  }
  return '';
}

function card({ id, iconName, title, summary, body, handle, actions }) {
  const open = state.expanded.has(id);
  const toggleOpen = () => {
    if (state.expanded.has(id)) state.expanded.delete(id);
    else {
      state.expanded.add(id);
      highlightInPreview(id);
    }
    renderPanel();
  };
  return h(
    'div',
    { class: `block-card${open ? ' is-open' : ''}`, 'data-card': id },
    h(
      'div',
      { class: 'block-card-head' },
      handle || h('span', { class: 'drag drag-placeholder' }),
      h('span', { class: 'block-icon' }, icon(iconName)),
      h(
        'button',
        { class: 'block-card-title', 'aria-expanded': String(open), onclick: toggleOpen },
        h('span', {}, h('b', {}, title), summary ? h('small', {}, summary) : null),
        icon('chevron', 'chev'),
      ),
      actions || null,
    ),
    open ? h('div', { class: 'block-card-body' }, body()) : null,
  );
}

function contentTab() {
  const blocks = state.draft.blocks;
  const blockCards = blocks.map((b, i) => {
    const handle = h('span', { class: 'drag', title: 'Drag to reorder' }, icon('drag'));
    const moreWrap = h('div', { class: 'menu-wrap' });
    const move = (to) => {
      const [item] = blocks.splice(i, 1);
      blocks.splice(to, 0, item);
      changed({ rerender: true });
    };
    moreWrap.append(
      h(
        'button',
        {
          class: 'btn btn-ghost btn-icon btn-sm',
          'aria-label': 'Block actions',
          'data-menu-toggle': '',
          onclick: () =>
            menu(moreWrap, [
              { label: 'Move up', icon: 'up', disabled: i === 0, run: () => move(i - 1) },
              { label: 'Move down', icon: 'chevron', disabled: i === blocks.length - 1, run: () => move(i + 1) },
              {
                label: 'Duplicate',
                icon: 'copy',
                run: () => {
                  const copyBlock = { ...structuredClone(b), id: newId() };
                  blocks.splice(i + 1, 0, copyBlock);
                  state.expanded.add(copyBlock.id);
                  changed({ rerender: true });
                },
              },
              '-',
              {
                label: 'Delete block',
                icon: 'trash',
                danger: true,
                run: () => {
                  blocks.splice(i, 1);
                  changed({ rerender: true });
                },
              },
            ]),
        },
        icon('more'),
      ),
    );
    const el = card({
      id: b.id,
      iconName: BLOCKS[b.type].icon,
      title: BLOCKS[b.type].label,
      summary: blockSummary(b),
      handle,
      actions: moreWrap,
      body: () => BLOCK_EDITORS[b.type](b, i),
    });
    sortable(el, { list: blocks, index: i, handle, onDrop: () => changed({ rerender: true }) });
    return el;
  });

  const addWrap = h('div', { class: 'menu-wrap add-block' });
  addWrap.append(
    h(
      'button',
      {
        class: 'btn btn-soft add-block-btn',
        'data-menu-toggle': '',
        onclick: () => {
          if (addWrap.querySelector('.menu')) return closeMenus();
          closeMenus();
          addWrap.append(
            h(
              'div',
              { class: 'menu menu-blocks', role: 'menu' },
              Object.entries(BLOCKS).map(([type, info]) =>
                h(
                  'button',
                  {
                    onclick: () => {
                      closeMenus();
                      const block = blankBlock(type);
                      blocks.push(block);
                      state.expanded.add(block.id);
                      changed({ rerender: true });
                      requestAnimationFrame(() => refs.body.querySelector(`[data-card="${block.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                      if (type === 'albums') albumPicker(block);
                      if (type === 'photos') addPhotos(block);
                    },
                  },
                  h('span', { class: 'block-icon' }, icon(info.icon)),
                  h('span', { class: 'menu-text' }, h('b', {}, info.label), h('small', {}, info.desc)),
                ),
              ),
            ),
          );
        },
      },
      icon('plus'),
      'Add block',
    ),
  );

  return [
    h(
      'div',
      { class: 'cards' },
      card({ id: 'header', iconName: 'header', title: 'Header', summary: state.draft.title, body: headerEditor }),
      h('div', { class: 'cards-label' }, 'Blocks', h('small', {}, blocks.length ? 'Drag to reorder' : '')),
      blockCards.length ? blockCards : h('div', { class: 'notice' }, icon('info'), h('p', {}, h('b', {}, 'No blocks yet. '), 'Add albums, hand-picked photos, text and more.')),
      addWrap,
      card({ id: 'footer', iconName: 'footer', title: 'Footer', summary: state.draft.footer.text || state.draft.footer.contactLabel || '', body: footerEditor }),
    ),
  ];
}

const HERO_STYLES = [
  { value: 'cover', label: 'Cover', svg: '<rect class="a" width="80" height="52"/><rect class="c" x="20" y="21" width="40" height="5" rx="1"/><rect class="b" x="28" y="30" width="24" height="3" rx="1"/>' },
  { value: 'banner', label: 'Banner', svg: '<rect class="a" width="80" height="20"/><circle class="c" cx="40" cy="22" r="6"/><rect class="b" x="24" y="32" width="32" height="4" rx="1"/><rect class="a" x="30" y="39" width="20" height="2.5" rx="1"/>' },
  { value: 'split', label: 'Split', svg: '<rect class="c" x="8" y="19" width="26" height="5" rx="1"/><rect class="b" x="8" y="27" width="18" height="3" rx="1"/><rect class="a" x="42" y="8" width="30" height="36" rx="3"/>' },
  { value: 'minimal', label: 'Minimal', svg: '<rect class="b" x="10" y="15" width="46" height="8" rx="1"/><rect class="a" x="10" y="27" width="28" height="3" rx="1"/><rect class="c" x="10" y="36" width="10" height="2" rx="1"/>' },
];

function headerEditor() {
  const hero = state.draft.hero;
  const framed = hero.focusX !== 50 || hero.focusY !== 50;
  return [
    field('Title', textInput('title', { maxlength: 120, label: 'Title' })),
    field('Subtitle', textInput('subtitle', { placeholder: 'e.g. 14 June 2026 · Villa Aurora', maxlength: 240, label: 'Subtitle' })),
    field('Style', choices('hero.style', HERO_STYLES, { rerender: true })),
    field('Height', range('hero.size', 20, 100, 1, (v) => `${v}%`), { hint: 'Percent of the screen height. You can also drag the “Height” bar in the preview.' }),
    h(
      'div',
      { class: 'row2' },
      field('Alignment', seg('hero.align', [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }])),
      field('Title size', range('hero.titleScale', 50, 180, 5, (v) => `${v}%`)),
    ),
    hero.style === 'cover' ? field('Photo darkening', range('hero.overlay', 0, 90, 5, (v) => `${v}%`)) : null,
    hero.style !== 'minimal'
      ? field('Cover photo', imageField('cover'), {
          hint: 'Drag the photo in the preview to choose which part shows.',
        })
      : null,
    hero.style !== 'minimal' && framed
      ? h(
          'button',
          {
            class: 'linklike',
            style: { marginTop: '6px' },
            onclick: () => {
              Object.assign(state.draft.hero, { focusX: 50, focusY: 50 });
              changed({ rerender: true });
            },
          },
          'Reset photo framing',
        )
      : null,
    field('Logo', imageField('logo')),
    state.draft.logo
      ? h(
          'div',
          { class: 'row2' },
          field('Logo shape', seg('hero.logoShape', [{ value: 'round', label: 'Circle' }, { value: 'square', label: 'Rounded' }, { value: 'plain', label: 'Original' }])),
          field('Logo size', range('hero.logoSize', 32, 260, 2, (v) => `${v}px`)),
        )
      : null,
  ];
}

function footerEditor() {
  return [
    field('Footer text', textInput('footer.text', { multiline: true, rows: 3, placeholder: 'e.g. Photos by Sampo Studio · Thank you!', maxlength: 600, label: 'Footer text' })),
    h(
      'div',
      { class: 'row2' },
      field('Button label', textInput('footer.contactLabel', { placeholder: 'Book a session', maxlength: 60, label: 'Button label' })),
      field('Button link', textInput('footer.contactUrl', { placeholder: 'you@example.com or https://…', maxlength: 500, label: 'Button link' })),
    ),
    h('div', { style: { marginTop: '12px' } }, toggle('footer.poweredBy', 'Show “Shared with Immich” credit')),
  ];
}

// ---- block editors -------------------------------------------------------------------------------

const ALBUM_STYLES = [
  { value: 'cards', label: 'Cards', svg: '<rect class="a" x="6" y="6" width="20" height="14" rx="2"/><rect class="a" x="30" y="6" width="20" height="14" rx="2"/><rect class="a" x="54" y="6" width="20" height="14" rx="2"/><rect class="b" x="6" y="22" width="13" height="2.5" rx="1"/><rect class="b" x="30" y="22" width="13" height="2.5" rx="1"/><rect class="b" x="54" y="22" width="13" height="2.5" rx="1"/><rect class="a" x="6" y="29" width="20" height="14" rx="2"/><rect class="a" x="30" y="29" width="20" height="14" rx="2"/><rect class="a" x="54" y="29" width="20" height="14" rx="2"/><rect class="b" x="6" y="45" width="13" height="2.5" rx="1"/><rect class="b" x="30" y="45" width="13" height="2.5" rx="1"/><rect class="b" x="54" y="45" width="13" height="2.5" rx="1"/>' },
  { value: 'tiles', label: 'Tiles', svg: '<rect class="a" x="6" y="6" width="20" height="40" rx="3"/><rect class="a" x="30" y="6" width="20" height="40" rx="3"/><rect class="a" x="54" y="6" width="20" height="40" rx="3"/><rect class="c" x="9" y="38" width="12" height="3" rx="1"/><rect class="c" x="33" y="38" width="12" height="3" rx="1"/><rect class="c" x="57" y="38" width="12" height="3" rx="1"/>' },
  { value: 'editorial', label: 'Editorial', svg: '<rect class="a" x="6" y="6" width="38" height="18" rx="2"/><rect class="c" x="48" y="10" width="24" height="3.5" rx="1"/><rect class="b" x="48" y="17" width="18" height="2.5" rx="1"/><rect class="a" x="36" y="28" width="38" height="18" rx="2"/><rect class="c" x="6" y="32" width="24" height="3.5" rx="1"/><rect class="b" x="6" y="39" width="18" height="2.5" rx="1"/>' },
  { value: 'feature', label: 'Feature', svg: '<rect class="a" x="6" y="6" width="68" height="22" rx="3"/><rect class="c" x="10" y="20" width="22" height="4" rx="1"/><rect class="a" x="6" y="32" width="20" height="14" rx="2"/><rect class="a" x="30" y="32" width="20" height="14" rx="2"/><rect class="a" x="54" y="32" width="20" height="14" rx="2"/>' },
  { value: 'inline', label: 'All photos', svg: '<rect class="c" x="6" y="6" width="24" height="3.5" rx="1"/><rect class="a" x="6" y="13" width="22" height="12" rx="1"/><rect class="a" x="30" y="13" width="14" height="12" rx="1"/><rect class="a" x="46" y="13" width="28" height="12" rx="1"/><rect class="a" x="6" y="27" width="30" height="10" rx="1"/><rect class="a" x="38" y="27" width="16" height="10" rx="1"/><rect class="a" x="56" y="27" width="18" height="10" rx="1"/><rect class="a" x="6" y="39" width="16" height="9" rx="1"/><rect class="a" x="24" y="39" width="26" height="9" rx="1"/><rect class="a" x="52" y="39" width="22" height="9" rx="1"/>' },
];
const GRID_STYLES = [
  { value: 'justified', label: 'Justified', svg: '<rect class="a" x="6" y="6" width="22" height="12" rx="1"/><rect class="a" x="30" y="6" width="14" height="12" rx="1"/><rect class="a" x="46" y="6" width="28" height="12" rx="1"/><rect class="a" x="6" y="20" width="30" height="13" rx="1"/><rect class="a" x="38" y="20" width="16" height="13" rx="1"/><rect class="a" x="56" y="20" width="18" height="13" rx="1"/><rect class="a" x="6" y="35" width="16" height="11" rx="1"/><rect class="a" x="24" y="35" width="26" height="11" rx="1"/><rect class="a" x="52" y="35" width="22" height="11" rx="1"/>' },
  { value: 'masonry', label: 'Masonry', svg: '<rect class="a" x="6" y="6" width="21" height="16" rx="1"/><rect class="a" x="6" y="24" width="21" height="22" rx="1"/><rect class="a" x="29.5" y="6" width="21" height="24" rx="1"/><rect class="a" x="29.5" y="32" width="21" height="14" rx="1"/><rect class="a" x="53" y="6" width="21" height="12" rx="1"/><rect class="a" x="53" y="20" width="21" height="26" rx="1"/>' },
  { value: 'grid', label: 'Square', svg: '<rect class="a" x="6" y="6" width="15.5" height="12.5" rx="1"/><rect class="a" x="23.5" y="6" width="15.5" height="12.5" rx="1"/><rect class="a" x="41" y="6" width="15.5" height="12.5" rx="1"/><rect class="a" x="58.5" y="6" width="15.5" height="12.5" rx="1"/><rect class="a" x="6" y="20.5" width="15.5" height="12.5" rx="1"/><rect class="a" x="23.5" y="20.5" width="15.5" height="12.5" rx="1"/><rect class="a" x="41" y="20.5" width="15.5" height="12.5" rx="1"/><rect class="a" x="58.5" y="20.5" width="15.5" height="12.5" rx="1"/><rect class="a" x="6" y="35" width="15.5" height="12.5" rx="1"/><rect class="a" x="23.5" y="35" width="15.5" height="12.5" rx="1"/><rect class="a" x="41" y="35" width="15.5" height="12.5" rx="1"/><rect class="a" x="58.5" y="35" width="15.5" height="12.5" rx="1"/>' },
];
const PHOTO_STYLES = [
  ...GRID_STYLES,
  { value: 'stack', label: 'Large', svg: '<rect class="a" x="14" y="5" width="52" height="26" rx="2"/><rect class="b" x="30" y="33" width="20" height="2" rx="1"/><rect class="a" x="14" y="39" width="52" height="13" rx="2"/>' },
  { value: 'carousel', label: 'Carousel', svg: '<rect class="a" x="-6" y="10" width="26" height="26" rx="2"/><rect class="a" x="23" y="10" width="34" height="26" rx="2"/><rect class="a" x="60" y="10" width="26" height="26" rx="2"/><circle class="c" cx="62" cy="44" r="2"/><circle class="b" cx="70" cy="44" r="2"/>' },
];

const BLOCK_EDITORS = { albums: albumsEditor, photos: photosEditor, text: textEditor, quote: quoteEditor, divider: dividerEditor, button: buttonEditor };

function albumsEditor(block, bi) {
  const p = `blocks.${bi}`;
  const sections = [...new Set(state.draft.blocks.filter((b) => b.type === 'albums').flatMap((b) => b.albums.map((a) => a.section)).filter(Boolean))];
  const listId = `sections-${block.id}`;
  return [
    field('Heading', textInput(`${p}.heading`, { placeholder: 'Optional, e.g. Galleries', maxlength: 160, label: 'Heading' })),
    h(
      'div',
      { class: 'field' },
      h('div', { class: 'label' }, `Albums (${block.albums.length})`, h('button', { class: 'btn btn-soft btn-sm', onclick: () => albumPicker(block) }, icon('plus'), 'Add albums')),
      block.albums.length
        ? h('div', { class: 'album-list' }, block.albums.map((entry, i) => albumRow(block, bi, entry, i, listId)))
        : h('p', { class: 'hint' }, 'No albums in this block yet.'),
      h('datalist', { id: listId }, sections.map((s) => h('option', { value: s }))),
    ),
    field('Style', choices(`${p}.albumStyle`, ALBUM_STYLES, { rerender: true })),
    ['cards', 'tiles', 'feature'].includes(block.albumStyle) ? field('Columns', seg(`${p}.columns`, [2, 3, 4].map((n) => ({ value: n, label: String(n) })))) : null,
    h(
      'div',
      { class: 'row2' },
      field('Group', seg(`${p}.grouping`, [{ value: 'none', label: 'None' }, { value: 'year', label: 'Year' }, { value: 'sections', label: 'Sections' }], { rerender: true })),
      field(
        'Order',
        (() => {
          const select = h('select', { class: 'select', 'aria-label': 'Album order' }, [['custom', 'As arranged'], ['newest', 'Newest first'], ['oldest', 'Oldest first'], ['name', 'A → Z']].map(([v, l]) => h('option', { value: v }, l)));
          select.value = block.sort;
          select.addEventListener('change', () => set(`${p}.sort`, select.value));
          return select;
        })(),
      ),
    ),
    block.grouping === 'sections' ? h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Give albums a section name (open an album above) to group them, e.g. “Ceremony” and “Party”.') : null,
    h('div', { style: { marginTop: '12px' } }, toggle(`${p}.showDates`, 'Show dates'), toggle(`${p}.showCounts`, 'Show photo counts')),
  ];
}

function albumRow(block, bi, entry, index, listId) {
  const info = albumInfo(entry.albumId);
  const linked = state.page.linked.includes(entry.albumId);
  const key = `${block.id}:${entry.albumId}`;
  const open = state.expanded.has(key);
  const list = block.albums;
  const thumbId = entry.coverAssetId || info?.thumb;
  const p = `blocks.${bi}.albums.${index}`;

  let status;
  if (!info) status = h('small', { class: 'warn' }, 'Not found in your Immich library');
  else if (!linked) status = h('small', { class: 'warn' }, 'Share link missing');
  else status = h('small', {}, [fmtCount(info.count), info.dateText, entry.section].filter(Boolean).join(' · '));

  const handle = h('span', { class: 'drag', title: 'Drag to reorder' }, icon('drag'));
  const row = h(
    'div',
    { class: 'album-item' },
    h(
      'div',
      { class: 'album-main' },
      handle,
      thumbId ? h('img', { class: 'thumb', src: thumbUrl(thumbId), alt: '', loading: 'lazy' }) : h('span', { class: 'thumb' }),
      h('div', { class: 'album-text' }, h('b', {}, entry.title || info?.name || 'Unknown album'), status),
      h(
        'button',
        {
          class: 'btn btn-ghost btn-icon btn-sm',
          'aria-expanded': String(open),
          'aria-label': open ? 'Collapse album options' : 'Edit album options',
          onclick: () => {
            open ? state.expanded.delete(key) : state.expanded.add(key);
            renderPanel();
          },
        },
        icon('chevron', 'chev'),
      ),
    ),
    open
      ? h(
          'div',
          { class: 'album-more' },
          !linked
            ? h(
                'div',
                { class: 'notice notice-warn', style: { marginTop: '12px' } },
                icon('warning'),
                h(
                  'div',
                  {},
                  h('p', {}, h('b', {}, 'This album can’t be shown yet. '), 'Folio needs to create an Immich share link for it. Only the album owner can do that.'),
                  h('button', { class: 'linklike', style: { marginTop: '6px' }, onclick: () => repairRef(entry.albumId) }, 'Try again'),
                ),
              )
            : null,
          field('Title on page', textInput(`${p}.title`, { placeholder: info?.name || 'Album title', maxlength: 160, label: 'Title on page', onInput: (v) => (row.querySelector('.album-text b').textContent = v || info?.name || 'Unknown album') })),
          field('Description', textInput(`${p}.description`, { multiline: true, rows: 3, placeholder: 'Optional — shown with the album', maxlength: 2000, label: 'Description' })),
          field(
            'Section',
            (() => {
              const el = textInput(`${p}.section`, { placeholder: 'e.g. Ceremony', maxlength: 80, label: 'Section' });
              el.setAttribute('list', listId);
              return el;
            })(),
          ),
          h(
            'div',
            { class: 'inline-actions' },
            h(
              'button',
              {
                class: 'btn btn-outline btn-sm',
                disabled: !info,
                onclick: () =>
                  photoPicker({
                    title: 'Choose album cover',
                    single: true,
                    albumId: entry.albumId,
                    onDone: ([asset]) => {
                      entry.coverAssetId = asset.id;
                      changed({ rerender: true });
                    },
                  }),
              },
              icon('image'),
              'Cover photo',
            ),
            entry.coverAssetId ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => ((entry.coverAssetId = null), changed({ rerender: true })) }, 'Reset cover') : null,
            h(
              'button',
              {
                class: 'btn btn-danger btn-sm',
                onclick: () => {
                  list.splice(index, 1);
                  state.expanded.delete(key);
                  changed({ rerender: true });
                },
              },
              icon('trash'),
              'Remove',
            ),
          ),
        )
      : null,
  );
  sortable(row, { list, index, handle, onDrop: () => changed({ rerender: true }) });
  return row;
}

async function repairRef(ref) {
  try {
    const { page, linkErrors } = await api(`/pages/${state.page.id}/repair/${ref}`, { method: 'POST' });
    state.page = page;
    if (linkErrors?.length) reportLinkErrors(linkErrors);
    else toast('Link restored');
    renderPanel();
    refreshPreview();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

function photosEditor(block, bi) {
  const p = `blocks.${bi}`;
  const linked = state.page.linked.includes(block.id);
  const thumbs = h(
    'div',
    { class: 'photo-thumbs' },
    block.photos.map((photo, i) => {
      const el = h(
        'button',
        { type: 'button', class: 'photo-thumb', title: photo.caption || 'Click to add a caption · drag to reorder', onclick: () => photoDialog(block, i) },
        h('img', { src: thumbUrl(photo.id), alt: '', loading: 'lazy', draggable: 'false' }),
        photo.video ? h('span', { class: 'photo-badge' }, icon('play')) : null,
        photo.caption ? h('span', { class: 'photo-caption-dot', title: photo.caption }) : null,
      );
      sortable(el, { list: block.photos, index: i, axis: 'x', onDrop: () => changed({ rerender: true }) });
      return el;
    }),
    h('button', { type: 'button', class: 'photo-thumb photo-add', onclick: () => addPhotos(block), 'aria-label': 'Add photos' }, icon('plus')),
  );
  const showRow = ['justified', 'carousel'].includes(block.style);
  const showCols = ['masonry', 'grid'].includes(block.style);
  return [
    field('Heading', textInput(`${p}.heading`, { placeholder: 'Optional, e.g. Highlights', maxlength: 160, label: 'Heading' })),
    field('Text', textInput(`${p}.text`, { multiline: true, rows: 2, placeholder: 'Optional', maxlength: 2000, label: 'Text' })),
    h(
      'div',
      { class: 'field' },
      h(
        'div',
        { class: 'label' },
        `Photos (${block.photos.length})`,
        block.photos.length
          ? h(
              'button',
              {
                class: 'linklike',
                onclick: async () => {
                  if (!(await confirmDialog({ title: 'Remove all photos?', text: 'They stay in Immich — they’re only removed from this block.', confirm: 'Remove all', danger: true }))) return;
                  block.photos = [];
                  changed({ rerender: true });
                },
              },
              'Remove all',
            )
          : null,
      ),
      thumbs,
      h('p', { class: 'hint' }, 'Click a photo to add a caption. Drag to reorder.'),
      block.photos.length && !linked
        ? h('div', { class: 'notice notice-warn', style: { marginTop: '8px' } }, icon('warning'), h('div', {}, h('p', {}, 'These photos couldn’t be shared yet.'), h('button', { class: 'linklike', onclick: () => repairRef(block.id) }, 'Try again')))
        : null,
    ),
    field('Layout', choices(`${p}.style`, PHOTO_STYLES, { rerender: true })),
    showRow ? field('Photo height', range(`${p}.rowHeight`, 140, 560, 10, (v) => `${v}px`)) : null,
    showCols ? field('Columns', seg(`${p}.columns`, [2, 3, 4, 5].map((n) => ({ value: n, label: String(n) })))) : null,
    block.style !== 'stack' ? field('Spacing', seg(`${p}.density`, [{ value: 'tight', label: 'Tight' }, { value: 'normal', label: 'Normal' }, { value: 'airy', label: 'Airy' }])) : null,
  ];
}

function addPhotos(block) {
  photoPicker({
    title: 'Add photos',
    exclude: new Set(block.photos.map((p) => p.id)),
    onDone: (assets) => {
      for (const a of assets) block.photos.push({ id: a.id, ratio: a.ratio, video: a.video, duration: a.duration, date: a.date, caption: '' });
      changed({ rerender: true });
    },
  });
}

function photoDialog(block, index) {
  const photo = block.photos[index];
  const caption = h('input', { class: 'input', value: photo.caption || '', maxlength: 300, placeholder: 'Optional caption', 'aria-label': 'Caption' });
  const save = () => {
    photo.caption = caption.value;
    m.close();
    changed({ rerender: true });
  };
  caption.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  const m = modal({
    title: 'Photo',
    body: h(
      'div',
      {},
      h('img', { class: 'photo-large', src: thumbUrl(photo.id, 'preview'), alt: '' }),
      field('Caption', caption, { hint: 'Shown in the photo viewer, and under the photo in the Large and Carousel layouts.' }),
    ),
    foot: [
      h(
        'button',
        {
          class: 'btn btn-danger',
          onclick: () => {
            block.photos.splice(index, 1);
            m.close();
            changed({ rerender: true });
          },
        },
        icon('trash'),
        'Remove',
      ),
      h(
        'button',
        {
          class: 'btn btn-ghost',
          onclick: async () => {
            try {
              const { image } = await api(`/pages/${state.page.id}/images/from-asset`, { method: 'POST', body: { assetId: photo.id } });
              state.draft.cover = image;
              m.close();
              changed({ rerender: true });
              toast('Set as page cover');
            } catch (err) {
              toast(err.message, { error: true });
            }
          },
        },
        'Use as page cover',
      ),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn btn-primary', onclick: save }, 'Save'),
    ],
  });
  setTimeout(() => caption.focus(), 30);
}

function textEditor(block, bi) {
  const p = `blocks.${bi}`;
  return [
    field('Heading', textInput(`${p}.heading`, { placeholder: 'Optional', maxlength: 200, label: 'Heading' })),
    field('Text', textInput(`${p}.body`, { multiline: true, rows: 6, placeholder: 'Write something…', maxlength: 6000, label: 'Text' }), { hint: 'Leave a blank line to start a new paragraph. Links work.' }),
    h(
      'div',
      { class: 'row2' },
      field('Alignment', seg(`${p}.align`, [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }])),
      field('Size', seg(`${p}.size`, [{ value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large' }])),
    ),
  ];
}

function quoteEditor(block, bi) {
  const p = `blocks.${bi}`;
  return [
    field('Quote', textInput(`${p}.text`, { multiline: true, rows: 3, placeholder: 'Something worth remembering', maxlength: 1000, label: 'Quote' })),
    field('Author', textInput(`${p}.author`, { placeholder: 'Optional', maxlength: 160, label: 'Author' })),
    field('Alignment', seg(`${p}.align`, [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }])),
  ];
}

function dividerEditor(block, bi) {
  const p = `blocks.${bi}`;
  return [
    field('Style', seg(`${p}.style`, [{ value: 'line', label: 'Line' }, { value: 'ornament', label: '✦ Ornament' }, { value: 'space', label: 'Space' }], { rerender: true })),
    field('Size', seg(`${p}.size`, [{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }, { value: 'l', label: 'Large' }])),
  ];
}

function buttonEditor(block, bi) {
  const p = `blocks.${bi}`;
  return [
    h(
      'div',
      { class: 'row2' },
      field('Label', textInput(`${p}.label`, { placeholder: 'Get in touch', maxlength: 80, label: 'Label' })),
      field('Link', textInput(`${p}.url`, { placeholder: 'https://… or email', maxlength: 500, label: 'Link' })),
    ),
    h(
      'div',
      { class: 'row2' },
      field('Style', seg(`${p}.style`, [{ value: 'accent', label: 'Filled' }, { value: 'outline', label: 'Outline' }])),
      field('Alignment', seg(`${p}.align`, [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }])),
    ),
  ];
}

// ---- pickers ---------------------------------------------------------------------------------

function albumPicker(block) {
  const selected = new Set();
  const existing = new Set(block.albums.map((a) => a.albumId));
  const grid = h('div', { class: 'album-grid' });
  const search = h('input', { class: 'input', placeholder: 'Search albums', 'aria-label': 'Search albums' });
  const counter = h('span', { class: 'grow' });
  const add = h('button', { class: 'btn btn-primary', disabled: true }, 'Add albums');

  const update = () => {
    counter.textContent = selected.size ? `${selected.size} selected` : '';
    add.disabled = !selected.size;
    add.textContent = selected.size > 1 ? `Add ${selected.size} albums` : 'Add album';
  };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const items = state.albums.filter((a) => !q || (a.name || '').toLowerCase().includes(q));
    grid.replaceChildren(
      ...(items.length
        ? items.map((a) => {
            const added = existing.has(a.id);
            const btn = h(
              'button',
              {
                type: 'button',
                class: 'album-pick',
                disabled: added,
                'aria-pressed': String(selected.has(a.id)),
                onclick: () => {
                  selected.has(a.id) ? selected.delete(a.id) : selected.add(a.id);
                  btn.setAttribute('aria-pressed', String(selected.has(a.id)));
                  update();
                },
              },
              h('span', { class: 'cover' }, a.thumb ? h('img', { src: thumbUrl(a.thumb), alt: '', loading: 'lazy' }) : null, h('span', { class: 'check' }, icon('check'))),
              h('b', {}, a.name || 'Untitled'),
              h('small', {}, added ? 'Already in this block' : [fmtCount(a.count), a.dateText, a.owned ? '' : `shared by ${a.ownerName || 'someone'}`].filter(Boolean).join(' · ')),
            );
            return btn;
          })
        : [h('p', { class: 'muted' }, q ? 'No albums match your search.' : 'You have no albums in Immich yet.')]),
    );
  };
  search.addEventListener('input', draw);
  add.addEventListener('click', () => {
    for (const id of selected) block.albums.push({ albumId: id, title: '', description: '', section: '', coverAssetId: null });
    m.close();
    changed({ rerender: true });
  });

  const body = h('div', {}, h('div', { class: 'search' }, icon('search'), search), h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
  const m = modal({ title: 'Add albums', wide: true, body, foot: [counter, h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Cancel'), add] });
  loadAlbums(true)
    .then(() => {
      body.lastChild.replaceWith(grid);
      draw();
      search.focus();
    })
    .catch((err) => toast(err.message, { error: true }));
}

const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

// Pick photos from the whole library, one album, or a smart search.
function photoPicker({ title, single = false, albumId = null, exclude = new Set(), onDone }) {
  const selected = new Map();
  const counter = h('span', { class: 'grow' });
  const done = h('button', { class: 'btn btn-primary', disabled: true, hidden: single }, 'Add photos');
  const holder = h('div', { class: 'picker-results' });
  let source = albumId ? 'album' : 'library';

  const update = () => {
    counter.textContent = selected.size ? `${selected.size} selected` : single ? 'Click a photo to choose it' : '';
    done.disabled = !selected.size;
    done.textContent = selected.size > 1 ? `Add ${selected.size} photos` : 'Add photo';
  };
  update();

  const tile = (asset) => {
    const already = exclude.has(asset.id);
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'asset-tile',
        disabled: already,
        title: already ? 'Already in this block' : '',
        'aria-pressed': String(selected.has(asset.id) || already),
        onclick: () => {
          if (single) {
            m.close();
            onDone([asset]);
            return;
          }
          selected.has(asset.id) ? selected.delete(asset.id) : selected.set(asset.id, asset);
          btn.setAttribute('aria-pressed', String(selected.has(asset.id)));
          update();
        },
      },
      h('img', { src: thumbUrl(asset.id), alt: '', loading: 'lazy' }),
      asset.video ? h('span', { class: 'photo-badge' }, icon('play')) : null,
      single ? null : h('span', { class: 'check' }, icon('check')),
    );
    return btn;
  };
  const gridOf = (assets) => h('div', { class: 'asset-grid' }, assets.map(tile));
  const spinner = () => h('div', { class: 'loading' }, h('div', { class: 'spinner' }));
  const errorBox = (err) => h('p', { class: 'muted' }, err.message);

  async function showLibrary() {
    holder.replaceChildren(spinner());
    try {
      const { buckets } = await api('/library/buckets');
      if (!buckets.length) return holder.replaceChildren(h('p', { class: 'muted' }, 'Your library is empty.'));
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            io.unobserve(entry.target);
            const sectionEl = entry.target;
            api(`/library/bucket?timeBucket=${encodeURIComponent(sectionEl.dataset.bucket)}`)
              .then(({ assets }) => sectionEl.querySelector('.month-grid').replaceWith(gridOf(assets)))
              .catch((err) => sectionEl.querySelector('.month-grid').replaceWith(errorBox(err)));
          }
        },
        { root: holder.closest('.modal-body'), rootMargin: '600px 0px' },
      );
      holder.replaceChildren(
        ...buckets.map((b) => {
          const el = h(
            'section',
            { class: 'month', 'data-bucket': b.timeBucket },
            h('h4', {}, MONTH_FMT.format(new Date(b.timeBucket)), h('small', {}, fmtCount(b.count))),
            h('div', { class: 'month-grid', style: { height: `${Math.ceil(b.count / 6) * 112}px` } }),
          );
          io.observe(el);
          return el;
        }),
      );
    } catch (err) {
      holder.replaceChildren(errorBox(err));
    }
  }

  async function showAlbum(id) {
    holder.replaceChildren(spinner());
    try {
      const { assets } = await api(`/albums/${id}/assets`);
      holder.replaceChildren(assets.length ? gridOf(assets) : h('p', { class: 'muted' }, 'This album is empty.'));
    } catch (err) {
      holder.replaceChildren(errorBox(err));
    }
  }

  const albumSelect = h('select', { class: 'select', 'aria-label': 'Album' });
  albumSelect.addEventListener('change', () => showAlbum(albumSelect.value));
  const searchInput = h('input', { class: 'input', placeholder: 'Try “beach at sunset” or “dog”', 'aria-label': 'Search photos' });
  const runSearch = async () => {
    if (!searchInput.value.trim()) return;
    holder.replaceChildren(spinner());
    try {
      const { assets } = await api('/search', { method: 'POST', body: { query: searchInput.value } });
      holder.replaceChildren(assets.length ? gridOf(assets) : h('p', { class: 'muted' }, 'Nothing found.'));
    } catch (err) {
      holder.replaceChildren(errorBox(err));
    }
  };
  searchInput.addEventListener('keydown', (e) => e.key === 'Enter' && runSearch());

  const controls = h('div', { class: 'picker-bar' });
  const sourceSeg = h('div', { class: 'seg' });
  const showSource = (name) => {
    source = name;
    sourceSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.source === name)));
    if (name === 'library') {
      controls.replaceChildren();
      showLibrary();
    } else if (name === 'album') {
      controls.replaceChildren(albumSelect);
      loadAlbums().then((albums) => {
        albumSelect.replaceChildren(...albums.map((a) => h('option', { value: a.id }, a.name || 'Untitled')));
        const pageAlbum = state.draft.blocks.flatMap((b) => (b.type === 'albums' ? b.albums : []))[0]?.albumId;
        albumSelect.value = albumId || pageAlbum || albums[0]?.id || '';
        if (albumSelect.value) showAlbum(albumSelect.value);
        else holder.replaceChildren(h('p', { class: 'muted' }, 'You have no albums yet.'));
      });
    } else {
      controls.replaceChildren(h('div', { class: 'search grow' }, icon('search'), searchInput), h('button', { class: 'btn btn-outline', onclick: runSearch }, 'Search'));
      holder.replaceChildren(h('p', { class: 'muted' }, 'Search uses Immich’s smart search — describe what’s in the photo.'));
      setTimeout(() => searchInput.focus(), 30);
    }
  };
  if (!albumId) {
    for (const [name, label] of [['library', 'Library'], ['album', 'Albums'], ['search', 'Search']]) {
      sourceSeg.append(h('button', { type: 'button', 'data-source': name, onclick: () => showSource(name) }, label));
    }
  }

  done.addEventListener('click', () => {
    m.close();
    onDone([...selected.values()]);
  });
  const m = modal({
    title,
    wide: true,
    body: h('div', {}, albumId ? null : h('div', { class: 'picker-top' }, sourceSeg, controls), holder),
    foot: [counter, h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Cancel'), done],
  });
  showSource(source);
}

// ---- design tab ------------------------------------------------------------------------------

function contrastRatio(a, b) {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function designTab() {
  const t = state.draft.theme;
  const contrastNote = h('p', { class: 'hint', style: { marginTop: '10px', color: 'var(--warn)' } });
  const checkContrast = () => {
    const ratio = contrastRatio(state.draft.theme.text, state.draft.theme.bg);
    contrastNote.textContent = ratio < 4.5 ? `Text contrast is low (${ratio.toFixed(1)}:1) — some visitors may struggle to read it.` : '';
  };
  checkContrast();

  return [
    section(
      'Theme',
      `${state.meta.presets.length} looks to start from — tweak anything below.`,
      presetGrid(t.preset, (p) => {
        Object.assign(state.draft.theme, { preset: p.id, ...p.theme });
        changed({ rerender: true });
      }),
    ),
    section(
      'Colors',
      null,
      h('div', { class: 'colors' }, colorField('theme.bg', 'Background', checkContrast), colorField('theme.text', 'Text', checkContrast), colorField('theme.accent', 'Accent')),
      contrastNote,
    ),
    section(
      'Typography',
      `${Object.keys(state.meta.fonts).length} fonts`,
      field('Headings', fontPicker('theme.heading')),
      field('Body text', fontPicker('theme.body')),
      h(
        'div',
        { class: 'row2' },
        field('Heading weight', seg('theme.headingWeight', [{ value: 'regular', label: 'Light' }, { value: 'bold', label: 'Bold' }])),
        field('Heading case', seg('theme.headingCase', [{ value: 'normal', label: 'Aa' }, { value: 'upper', label: 'AA' }])),
      ),
    ),
    section(
      'Layout',
      null,
      field('Corner radius', range('theme.radius', 0, 32, 1, (v) => `${v}px`)),
      field('Page width', seg('layout.width', [{ value: 'narrow', label: 'Narrow' }, { value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Wide' }])),
    ),
    section(
      'Album pages',
      'The photo grid visitors see after opening an album.',
      field('Arrangement', choices('gallery.style', GRID_STYLES)),
      field('Spacing', seg('gallery.density', [{ value: 'tight', label: 'Tight' }, { value: 'normal', label: 'Normal' }, { value: 'airy', label: 'Airy' }])),
    ),
  ];
}

// ---- sharing tab ------------------------------------------------------------------------------

function sharingTab() {
  const p = state.page;
  const slugInput = h('input', { value: p.slug, 'aria-label': 'Page address', spellcheck: 'false', maxlength: 60 });
  const saveSlug = h('button', { class: 'btn btn-soft btn-sm', hidden: true }, 'Save');
  slugInput.addEventListener('input', () => {
    const clean = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (clean !== slugInput.value) slugInput.value = clean;
    saveSlug.hidden = clean === p.slug || !clean;
  });
  const commitSlug = async () => {
    if (saveSlug.hidden) return;
    if (p.live && !(await confirmDialog({ title: 'Change the link?', text: 'The old link will stop working for anyone you already sent it to.', confirm: 'Change link' }))) return;
    patchPage({ slug: slugInput.value.replace(/^-+|-+$/g, '') }, 'Link updated');
  };
  saveSlug.addEventListener('click', commitSlug);
  slugInput.addEventListener('keydown', (e) => e.key === 'Enter' && commitSlug());

  const pwBox = h('div');
  const drawPassword = (editing = false) => {
    if (editing) {
      const input = h('input', { class: 'input', type: 'text', placeholder: 'New password', autocomplete: 'off', 'aria-label': 'New password' });
      const save = async () => {
        try {
          const { page } = await api(`/pages/${p.id}/password`, { method: 'POST', body: { password: input.value } });
          state.page = page;
          renderPanel();
          updateChrome();
          toast('Password saved');
        } catch (err) {
          toast(err.message, { error: true });
        }
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
      pwBox.replaceChildren(
        h('div', { class: 'field' }, input, h('p', { class: 'hint' }, 'Share it with your guests separately. Changing it signs everyone out.')),
        h('div', { class: 'inline-actions' }, h('button', { class: 'btn btn-primary btn-sm', onclick: save }, 'Save password'), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => drawPassword(false) }, 'Cancel')),
      );
      setTimeout(() => input.focus());
      return;
    }
    pwBox.replaceChildren(
      h(
        'div',
        { class: 'switch-row', style: { cursor: 'default' } },
        h('span', { class: 'text' }, 'Password', h('small', {}, p.hasPassword ? 'On — visitors must enter it first' : 'Off — anyone with the link can view')),
        h(
          'div',
          { class: 'image-actions' },
          h('button', { class: 'btn btn-outline btn-sm', onclick: () => drawPassword(true) }, p.hasPassword ? 'Change' : 'Set password'),
          p.hasPassword
            ? h(
                'button',
                {
                  class: 'btn btn-ghost btn-sm',
                  onclick: async () => {
                    const { page } = await api(`/pages/${p.id}/password`, { method: 'POST', body: { password: null } });
                    state.page = page;
                    renderPanel();
                    toast('Password removed');
                  },
                },
                'Remove',
              )
            : null,
        ),
      ),
    );
  };
  drawPassword();

  const expires = p.sharing.expiresAt ? new Date(p.sharing.expiresAt) : null;
  const toLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dateInput = h('input', { class: 'input', type: 'date', value: expires ? toLocalDate(expires) : '', min: toLocalDate(new Date()), 'aria-label': 'Expiry date' });
  dateInput.addEventListener('change', () => {
    const v = dateInput.value;
    patchPage({ sharing: { expiresAt: v ? new Date(`${v}T23:59:59`).toISOString() : null } }, v ? 'Expiry date set' : 'Expiry removed');
  });

  return [
    section(
      'Page link',
      null,
      h('div', { class: 'slug' }, h('span', {}, `${location.host}/p/`), slugInput, saveSlug),
      h('div', { class: 'status-line' }, statusChip(p), p.live ? `Published ${ago(p.publishedAt)}${p.views ? ` · ${plural(p.views, 'view')}` : ''}` : 'Publish to make this link work.'),
      p.live
        ? h(
            'div',
            { class: 'inline-actions' },
            h('button', { class: 'btn btn-outline btn-sm', onclick: () => copy(pageUrl(p.slug)) }, icon('copy'), 'Copy link'),
            h('a', { class: 'btn btn-ghost btn-sm', href: pageUrl(p.slug), target: '_blank', rel: 'noopener' }, icon('external'), 'Open'),
          )
        : null,
    ),
    section(
      'Access',
      'These apply right away, even to the live page.',
      pwBox,
      field('Expires', h('div', { style: { display: 'flex', gap: '8px' } }, dateInput, expires ? h('button', { class: 'btn btn-ghost', onclick: () => patchPage({ sharing: { expiresAt: null } }, 'Expiry removed') }, 'Clear') : null), {
        hint: p.expired ? 'This page has expired. Pick a later date to bring it back.' : 'After this date the page shows an “expired” note and its share links stop working.',
      }),
      h(
        'div',
        { style: { marginTop: '12px' } },
        toggle(p.sharing.allowDownload, 'Allow downloads', 'Original files and ZIPs of albums and photo blocks', { onChange: (v) => patchPage({ sharing: { allowDownload: v } }) }),
        toggle(p.sharing.noindex, 'Hide from search engines', 'Asks Google & co. not to list this page', { onChange: (v) => patchPage({ sharing: { noindex: v } }) }),
      ),
    ),
    section(
      'How sharing works',
      null,
      h(
        'div',
        { class: 'notice' },
        icon('info'),
        h(
          'p',
          {},
          'Each album and Photos block gets a private Immich share link (you’ll see them in Immich under ',
          h('b', {}, 'Shared links'),
          ', named “Folio · ',
          state.draft.title,
          '”). Visitors never see those links — photos are streamed through this page, so the password, expiry and download settings above always apply.',
        ),
      ),
    ),
    section(
      null,
      null,
      h(
        'div',
        { class: 'inline-actions', style: { marginTop: '0' } },
        p.live ? h('button', { class: 'btn btn-outline btn-sm', onclick: unpublish }, icon('hide'), 'Unpublish') : null,
        h('button', { class: 'btn btn-danger btn-sm', onclick: deletePageFlow }, icon('trash'), 'Delete page'),
      ),
    ),
  ];
}

// ---- boot ----------------------------------------------------------------------------------

(async () => {
  app.replaceChildren(loadingScreen());
  try {
    state.meta = await api('/meta');
    loadFonts();
    state.user = (await api('/me')).user;
  } catch (err) {
    if (err.status === 401) return showLogin();
    app.replaceChildren(h('div', { class: 'center-screen' }, h('div', { class: 'login-card' }, h('h1', {}, 'Folio can’t start'), h('p', {}, err.message))));
    return;
  }
  route();
})();
