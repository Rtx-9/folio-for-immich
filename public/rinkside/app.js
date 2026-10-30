// RinkSide inside Folio: cull, caption, look, crop, export and sync hockey photos.
// Photos are read from the card by this browser; picks and edits are saved by
// Folio for your Immich account; Immich is reached with your Immich login.
import { albumAssets, api, framesFromAssets, immich, immichUrl, runSync, suggestPeople } from './backend.js';
import { captionFor, DEFAULT_TEMPLATE, fileName, gameTitle, parsePlayers, parseRoster, rosterText, slug, TOKENS } from './caption.js';
import { Card, freeName, hasFolderAccess, loadHandle, pickCard, pickExportFolder, saveHandle, writable, writeFile, Zip } from './card.js';
import { decode, iceColor, isNeutral, LOOK_DEFAULTS, neutralize, Renderer, sampleAt } from './look.js';
import { cameraLabel, exifFromDetails, frameMeta, fullBlob, scanFiles, sourceExif, tagJpeg, thumbBlob, xmpPacket } from './media.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

let toastTimer;
function toast(msg, { error = false, ms = 3200 } = {}) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast${error ? ' err' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}
const fail = (err) => toast(err.message || String(err), { error: true, ms: 6000 });

const pad = (n, k = 2) => String(n).padStart(k, '0');
function fmtTime(t, withCs = true) {
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${withCs ? `.${pad(Math.floor(d.getUTCMilliseconds() / 10))}` : ''}`;
}
const fmtDate = (t) => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const S = {
  sess: null,
  rosters: {},
  frames: [],
  byId: new Map(),
  order: [],
  idx: 0,
  mode: 'loupe',
  filter: 'all',
  autoAdvance: true,
  selection: new Set(),
  anchor: null,
  zoom: null,
  before: false,
  picking: false,
  cropEdit: null,
  tab: 'caption',
  clipboard: null,
  undo: [],
  cards: new Map(), // source id → Card (this browser's access to that card)
};

const cur = () => S.order[S.idx];
const adjusted = (f) => f.t + (S.sess.cameras?.[f.cam]?.offset || 0) * 1000;
const effectiveLook = (f) => (f?.look ? f.look : S.sess?.look) || LOOK_DEFAULTS;
const camLabel = (f) => S.sess.cameras?.[f.cam]?.label || '';
const isImmich = () => S.sess?.mode === 'immich';

// ---------------------------------------------------------------------------
// Images: from the card (local games) or from Immich (album games)
// ---------------------------------------------------------------------------
async function fileFor(f, kind) {
  const card = S.cards.get(f.src);
  if (!card) throw new Error('The card for this photo is not connected');
  return card.file(f[kind].rel);
}

async function fullOf(f) {
  if (isImmich()) {
    const want = f.asset.mime === 'image/jpeg' ? `/assets/${f.asset.id}/original` : `/assets/${f.asset.id}/thumbnail?size=fullsize`;
    const r = await fetch(immichUrl(want));
    if (!r.ok) throw new Error(`Immich: ${r.status}`);
    return r.blob();
  }
  return fullBlob(f, (kind) => fileFor(f, kind));
}

// Thumbnails: object URLs kept in a small cache.
const thumbs = new Map(); // id → Promise<url>
function thumbSrc(f) {
  if (isImmich()) return Promise.resolve(immichUrl(`/assets/${f.asset.id}/thumbnail?size=preview`));
  if (!thumbs.has(f.id)) {
    const p = thumbBlob(f, (kind) => fileFor(f, kind)).then((b) => URL.createObjectURL(b));
    p.catch(() => thumbs.delete(f.id));
    thumbs.set(f.id, p);
    if (thumbs.size > 1500) {
      const [k, old] = thumbs.entries().next().value;
      thumbs.delete(k);
      old.then((u) => URL.revokeObjectURL(u)).catch(() => {});
    }
  }
  return thumbs.get(f.id);
}
function thumbImg(f) {
  const img = h('img', { alt: '', decoding: 'async' });
  thumbSrc(f).then((u) => (img.src = u)).catch(() => img.classList.add('missing'));
  return img;
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
const chosen = [];
async function showHome() {
  closeGame();
  $('#game').hidden = true;
  $('#home').hidden = false;
  history.replaceState(null, '', '/rinkside');
  document.title = 'RinkSide';
  $('#no-folder-access').hidden = hasFolderAccess;
  renderChosen();
  let state;
  try {
    state = await api('GET', '/state');
  } catch (err) {
    if (err.status === 401) {
      $('#signed-out').hidden = false;
      $('.new-game').hidden = true;
      return;
    }
    return fail(err);
  }
  S.state = state;
  const games = $('#games');
  games.replaceChildren();
  if (!state.sessions.length) games.append(h('p', { class: 'muted', text: 'No games yet.' }));
  for (const g of state.sessions) {
    const teams = [g.game.home, g.game.away].filter(Boolean).join(' – ');
    games.append(
      h(
        'div',
        { class: 'game-row', onclick: () => openGame(g.id) },
        h('div', {}, h('div', { class: 't', text: g.name || teams || 'Untitled game' }), h('div', { class: 'meta', text: [fmtDate(g.first), g.game.league, g.mode === 'immich' ? 'Immich album' : g.sources.map((s) => s.label).join(' + ')].filter(Boolean).join(' · ') })),
        h('div', { class: 'meta' }, `${g.count} photos · ${g.picks} picks`, g.synced ? h('span', { class: 'badge', text: ' synced' }) : ''),
        h('button', {
          class: 'ghost',
          title: 'Remove this game from RinkSide (photos on the card and in Immich are not touched)',
          onclick: async (e) => {
            e.stopPropagation();
            if (!confirm(`Remove “${g.name || teams || 'Untitled game'}” from RinkSide?\nPicks, captions and edits for it are forgotten. Photos on the card and in Immich are not touched.`)) return;
            await api('DELETE', `/s/${g.id}`).catch(fail);
            showHome();
          },
          text: '✕',
        }),
      ),
    );
  }
}

function renderChosen() {
  $('#chosen-cards').replaceChildren(...chosen.map((c, i) => h('span', { class: 'chip' }, `💾 ${c.label}`, ' ', h('button', { type: 'button', class: 'ghost', onclick: () => (chosen.splice(i, 1), renderChosen()), text: '✕' }))));
  $('#open-card').hidden = chosen.length > 0;
  $('#add-card').hidden = !chosen.length;
  $('#start-game').hidden = !chosen.length;
}

$('#open-card').onclick = $('#add-card').onclick = async () => {
  try {
    const card = await pickCard();
    if (card) chosen.push(card);
    renderChosen();
  } catch (err) {
    fail(err);
  }
};

// Read the cards, then create the game.
async function scanCards(cards, firstId = 'a') {
  const box = $('#home').hidden ? $('#scan') : $('#home-scan');
  const bar = box.id === 'scan' ? $('#scan-bar') : $('i', box);
  const msg = box.id === 'scan' ? $('#scan-text') : $('.msg', box);
  box.hidden = false;
  const sources = [];
  const frames = [];
  const errors = [];
  let id = firstId;
  for (const card of cards) {
    msg.textContent = `Looking for photos on ${card.label}…`;
    bar.style.width = '3%';
    const entries = await card.list();
    const r = await scanFiles(id, entries, (done, total) => {
      msg.textContent = `Reading ${card.label}… ${done} / ${total}`;
      bar.style.width = `${(done / total) * 100}%`;
    });
    sources.push({ id, label: card.label, card });
    frames.push(...r.frames);
    errors.push(...r.errors);
    id = String.fromCharCode(id.charCodeAt(0) + 1);
  }
  box.hidden = true;
  if (errors.length) toast(`${errors.length} file(s) could not be read: ${errors[0].file} – ${errors[0].error}`, { error: true, ms: 8000 });
  return { sources, frames };
}

function camerasFor(frames, existing = {}) {
  const cams = { ...existing };
  const added = {};
  for (const f of frames) {
    if (cams[f.cam]) continue;
    const labels = new Set(Object.values(cams).map((c) => c.label));
    let label = cameraLabel(f.ex?.model);
    for (let i = 2; labels.has(label); i++) label = `${cameraLabel(f.ex?.model)} ${i}`;
    cams[f.cam] = added[f.cam] = { label, model: f.ex?.model || '', offset: 0 };
  }
  return added;
}

$('#start-game').onclick = async () => {
  if (!chosen.length) return;
  $('#start-game').disabled = true;
  try {
    const { sources, frames } = await scanCards(chosen);
    if (!frames.length) throw new Error('No photos found on that card (looked for JPG and NEF files).');
    const { id } = await api('POST', '/sessions', { sources: sources.map(({ id: sid, label }) => ({ id: sid, label })), frames, cameras: camerasFor(frames) });
    for (const s of sources) {
      if (s.card.handle) await saveHandle(`${id}:${s.id}`, s.card.handle);
      S.cards.set(s.id, s.card);
    }
    chosen.length = 0;
    await openGame(id, { setup: true, keepCards: true });
  } catch (err) {
    fail(err);
  } finally {
    $('#start-game').disabled = false;
    $('#home-scan').hidden = true;
  }
};

// ---------------------------------------------------------------------------
// Opening a game
// ---------------------------------------------------------------------------
async function openGame(id, { setup = false, keepCards = false } = {}) {
  $('#home').hidden = true;
  $('#game').hidden = false;
  history.replaceState(null, '', `/rinkside?game=${id}`);
  const cards = keepCards ? new Map(S.cards) : new Map();
  closeGame();
  S.cards = cards;
  S.sess = { id, frames: [], cameras: {}, game: {}, look: { ...LOOK_DEFAULTS }, sources: [] };
  await loadSession(id);
  if (!isImmich()) await connectCards(false);
  if (setup || (!S.sess.game.home && S.frames.length)) openSetup();
}

// Find this browser's access to each card of the game; ask if needed.
async function connectCards(ask) {
  const missing = [];
  for (const src of S.sess.sources) {
    let card = S.cards.get(src.id);
    if (!card) {
      const handle = await loadHandle(`${S.sess.id}:${src.id}`);
      if (handle) S.cards.set(src.id, (card = new Card({ handle, label: src.label })));
    }
    let state = card ? await card.permission(ask).catch(() => 'denied') : 'missing';
    if (state === 'granted') {
      // Is the card actually there? (It may have been taken out.)
      const probe = S.frames.find((f) => f.src === src.id);
      if (probe) {
        try {
          await card.file((probe.jpg || probe.nef).rel);
        } catch {
          state = 'gone';
        }
      }
    }
    if (state !== 'granted') missing.push({ src, state });
  }
  S.missing = missing;
  const box = $('#reconnect');
  if (!missing.length) {
    box.hidden = true;
    show();
    return true;
  }
  const names = missing.map((m) => m.src.label).join(' and ');
  const needsPick = missing.some((m) => m.state !== 'prompt');
  $('#reconnect-text').textContent = needsPick ? `Insert the card ${names} and choose it to see the photos.` : `Allow access to ${names} to see the photos.`;
  $('#reconnect-btn').textContent = needsPick ? `Choose ${missing[0].src.label}…` : 'Allow access';
  box.hidden = false;
  return false;
}

$('#reconnect-btn').onclick = async () => {
  const first = S.missing?.[0];
  if (!first) return;
  try {
    if (first.state === 'prompt') return void (await connectCards(true));
    const card = await pickCard();
    if (!card) return;
    // Make sure it's the right card: one of its photos must be there.
    const probe = S.frames.find((f) => f.src === first.src.id);
    try {
      await card.file((probe.jpg || probe.nef).rel);
    } catch {
      return toast(`That isn't ${first.src.label}: ${(probe.jpg || probe.nef).rel} is not on it.`, { error: true, ms: 6000 });
    }
    S.cards.set(first.src.id, card);
    if (card.handle) await saveHandle(`${S.sess.id}:${first.src.id}`, card.handle);
    for (const t of thumbs.values()) t.then((u) => URL.revokeObjectURL(u)).catch(() => {});
    thumbs.clear();
    await connectCards(false);
    renderStrip();
    if (S.mode === 'grid') renderGrid();
  } catch (err) {
    fail(err);
  }
};

async function loadSession(id, { keep = false } = {}) {
  const prevId = keep ? cur()?.id : null;
  const sess = await api('GET', `/s/${id}`);
  S.sess = sess;
  S.rosters = sess.rosters || {};
  resort();
  rebuildOrder(prevId);
  $('#game-title').textContent = gameName();
  document.title = `${gameName()} · RinkSide`;
  renderFilters();
  setMode(S.mode);
}

function gameName() {
  const g = S.sess.game || {};
  const teams = [g.home, g.away].filter(Boolean).join(' – ');
  return teams ? `${teams} · ${fmtDate(S.frames[0]?.t)}` : S.sess.name || 'Untitled game';
}

function resort() {
  S.frames = [...S.sess.frames].sort((a, b) => adjusted(a) - adjusted(b) || a.cam.localeCompare(b.cam) || a.name.localeCompare(b.name));
  S.byId = new Map(S.frames.map((f) => [f.id, f]));
}

function closeGame() {
  for (const e of cache.values()) e.then((d) => d?.bitmap.close()).catch(() => {});
  cache.clear();
  for (const t of thumbs.values()) t.then((u) => u.startsWith('blob:') && URL.revokeObjectURL(u)).catch(() => {});
  thumbs.clear();
  zoomImage?.bitmap.close();
  zoomImage = null;
  disp = null;
  S.zoom = null;
  S.cropEdit = null;
  S.selection.clear();
  S.undo = [];
  S.cards = new Map();
  S.missing = [];
  $('#reconnect').hidden = true;
}

// ---------------------------------------------------------------------------
// Filters and navigation
// ---------------------------------------------------------------------------
const FILTERS = [
  ['all', 'All', () => true],
  ['picks', 'Picks', (f) => f.flag === 1],
  ['unflagged', 'Unflagged', (f) => !f.flag],
  ['norejects', 'Hide rejects', (f) => f.flag !== -1],
  ['rated', 'Rated', (f) => f.stars > 0],
];

function rebuildOrder(keepId = cur()?.id) {
  const test = FILTERS.find((x) => x[0] === S.filter)[2];
  // The photo you're on stays visible until you move away, even if it no longer matches.
  S.order = S.frames.filter((f) => test(f) || f.id === keepId);
  const i = S.order.findIndex((f) => f.id === keepId);
  if (i >= 0) S.idx = i;
  else {
    const t = keepId && S.byId.get(keepId) ? adjusted(S.byId.get(keepId)) : -Infinity;
    const next = S.order.findIndex((f) => adjusted(f) >= t);
    S.idx = Math.max(0, next === -1 ? S.order.length - 1 : next);
  }
}

function renderFilters() {
  $('#filters').replaceChildren(...FILTERS.map(([key, label, test]) => h('button', { class: S.filter === key ? 'on' : '', onclick: () => setFilter(key) }, label, h('b', { text: String(S.frames.filter(test).length) }))));
}

function setFilter(key) {
  S.filter = key;
  rebuildOrder(cur()?.id);
  const test = FILTERS.find((x) => x[0] === key)[2];
  if (cur() && !test(cur())) {
    S.order = S.order.filter(test);
    S.idx = Math.min(S.idx, Math.max(0, S.order.length - 1));
  }
  renderFilters();
  show();
}

function go(i, { skim = false } = {}) {
  if (!S.order.length) return;
  const n = Math.max(0, Math.min(S.order.length - 1, i));
  const leaving = cur();
  const test = FILTERS.find((x) => x[0] === S.filter)[2];
  const target = S.order[n];
  if (leaving && !test(leaving) && leaving !== target) {
    S.order = S.order.filter((f) => f === target || test(f));
    S.idx = S.order.indexOf(target);
  } else S.idx = n;
  if (S.cropEdit) cancelCrop();
  show({ skim });
}
const step = (d, opts) => go(S.idx + d, opts);

// ---------------------------------------------------------------------------
// Loupe: decoding, caching, drawing
// ---------------------------------------------------------------------------
const canvas = $('#gl');
let renderer;
try {
  renderer = new Renderer(canvas);
} catch (err) {
  console.error(err);
}
const cache = new Map();
let disp = null;
let zoomImage = null;
let lastDst = null;
let lastSrc = null;
let sampler = null;

const stageSize = () => {
  const r = $('#stage').getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return { w: Math.max(1, Math.round(r.width * dpr)), h: Math.max(1, Math.round(r.height * dpr)), dpr };
};
const maxEdge = () => {
  const { w, h: hh } = stageSize();
  return Math.min(4096, Math.max(1600, Math.ceil(Math.max(w, hh) / 256) * 256));
};
const cropKey = (crop) => (crop ? `${crop.x.toFixed(4)},${crop.y.toFixed(4)},${crop.w.toFixed(4)},${crop.h.toFixed(4)}` : 'full');

function load(f, { crop = f.crop } = {}) {
  const key = `${f.id}|${cropKey(crop)}|${maxEdge()}`;
  if (!cache.has(key)) {
    const p = fullOf(f)
      .then((blob) => decode(blob, { crop, maxEdge: maxEdge(), quality: 'medium' }))
      .then((d) => ({ ...d, id: f.id, key }));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    trimCache();
  }
  return cache.get(key);
}

function trimCache() {
  const near = new Set();
  for (let d = -2; d <= 4; d++) {
    const f = S.order[S.idx + d];
    if (f) near.add(f.id);
  }
  for (const [key, p] of cache) {
    if (near.has(key.split('|')[0]) || key === disp?.key) continue;
    cache.delete(key);
    p.then((d) => d.bitmap.close()).catch(() => {});
  }
}

let preloadTimer;
function preload() {
  clearTimeout(preloadTimer);
  preloadTimer = setTimeout(async () => {
    for (const d of [1, 2, 3, -1]) {
      const f = S.order[S.idx + d];
      if (f && !S.skimming) await load(f).catch(() => {});
    }
  }, 60);
}

let showToken = 0;
async function show({ skim = false } = {}) {
  const f = cur();
  updateChrome();
  if (S.mode === 'grid') return renderGrid(true);
  renderStrip(true);
  if (!f) {
    disp = null;
    draw();
    $('#skim').hidden = true;
    $('#empty').hidden = false;
    $('#empty').textContent = S.frames.length ? 'No photos match this filter.' : 'No photos in this game yet.';
    return;
  }
  $('#empty').hidden = true;
  if (S.missing?.some((m) => m.src.id === f.src)) {
    disp = null;
    draw();
    $('#skim').hidden = true;
    return;
  }
  const token = ++showToken;
  const editing = Boolean(S.cropEdit);
  const key = `${f.id}|${cropKey(editing ? null : f.crop)}|${maxEdge()}`;
  if (disp?.key === key) {
    $('#skim').hidden = true;
    draw();
    if (S.zoom) loadZoom(f);
    return preload();
  }
  // Show the small preview at once; the full photo replaces it when decoded.
  const skimImg = $('#skim');
  skimImg.hidden = false;
  skimImg.removeAttribute('src');
  thumbSrc(f).then((u) => token === showToken && (skimImg.src = u)).catch(() => {});
  if (skim) return;
  try {
    const d = await load(f, { crop: editing ? null : f.crop });
    if (token !== showToken) return;
    disp = d;
    sampler = null;
    skimImg.hidden = true;
    draw();
    if (S.zoom) loadZoom(f);
    if (editing) placeCropBox();
  } catch (err) {
    if (token === showToken) toast(`${f.name}: ${err.message}`, { error: true });
  }
  preload();
}

function draw() {
  const { w: cw, h: ch } = stageSize();
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  if (!renderer) return;
  const f = cur();
  const look = S.before ? LOOK_DEFAULTS : effectiveLook(f);
  if (!disp || disp.id !== f?.id) {
    renderer.image = null;
    renderer.draw(look, { x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 0, h: 0 });
    return;
  }
  if (S.zoom && !S.cropEdit) {
    // 100%: one image pixel per screen pixel.
    const img = zoomImage?.id === f.id ? zoomImage : disp;
    const k = img.bitmap.width / disp.full.w;
    const vw = Math.min(cw, disp.full.w);
    const vh = Math.min(ch, disp.full.h);
    let x = S.zoom.u * disp.full.w - vw / 2;
    let y = S.zoom.v * disp.full.h - vh / 2;
    x = Math.max(0, Math.min(disp.full.w - vw, x));
    y = Math.max(0, Math.min(disp.full.h - vh, y));
    S.zoom.u = (x + vw / 2) / disp.full.w;
    S.zoom.v = (y + vh / 2) / disp.full.h;
    lastSrc = { x: x * k, y: y * k, w: vw * k, h: vh * k };
    lastDst = { x: (cw - vw) / 2, y: (ch - vh) / 2, w: vw, h: vh };
    renderer.setImage(img.bitmap);
    renderer.draw(look, lastSrc, lastDst);
    $('#zoom-label').hidden = false;
    return;
  }
  $('#zoom-label').hidden = true;
  const src = disp.src;
  const margin = S.cropEdit ? 40 * stageSize().dpr : 0;
  const scale = Math.min((cw - margin * 2) / src.w, (ch - margin * 2) / src.h);
  lastSrc = src;
  lastDst = { x: (cw - src.w * scale) / 2, y: (ch - src.h * scale) / 2, w: src.w * scale, h: src.h * scale };
  renderer.setImage(disp.bitmap);
  renderer.draw(look, lastSrc, lastDst);
}

async function loadZoom(f) {
  if (zoomImage?.id === f.id) return draw();
  zoomImage?.bitmap.close();
  zoomImage = null;
  try {
    const d = await decode(await fullOf(f), {});
    if (cur()?.id !== f.id || !S.zoom) return d.bitmap.close();
    zoomImage = { id: f.id, bitmap: d.bitmap };
    draw();
  } catch (err) {
    fail(err);
  }
}

function toImage(clientX, clientY) {
  if (!lastDst || !disp) return null;
  const r = canvas.getBoundingClientRect();
  const dpr = stageSize().dpr;
  const px = (clientX - r.left) * dpr;
  const py = (clientY - r.top) * dpr;
  if (px < lastDst.x || py < lastDst.y || px > lastDst.x + lastDst.w || py > lastDst.y + lastDst.h) return null;
  const bx = lastSrc.x + ((px - lastDst.x) / lastDst.w) * lastSrc.w;
  const by = lastSrc.y + ((py - lastDst.y) / lastDst.h) * lastSrc.h;
  const img = S.zoom && zoomImage?.id === disp.id ? zoomImage.bitmap : disp.bitmap;
  return { u: bx / img.width, v: by / img.height, bx, by, img };
}

function toggleZoom(at) {
  const f = cur();
  if (!f || S.cropEdit || S.mode !== 'loupe') return;
  if (S.zoom) {
    S.zoom = null;
    zoomImage?.bitmap.close();
    zoomImage = null;
    $('#stage').classList.remove('zoomed');
    return draw();
  }
  S.zoom = at ? { u: at.u, v: at.v } : { u: 0.5, v: 0.5 };
  $('#stage').classList.add('zoomed');
  draw();
  loadZoom(f);
}

let dragging = null;
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || S.mode !== 'loupe' || S.cropEdit) return;
  dragging = { x: e.clientX, y: e.clientY, moved: false };
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragging.x;
  const dy = e.clientY - dragging.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true;
  if (S.zoom && dragging.moved && disp) {
    $('#stage').classList.add('dragging');
    const dpr = stageSize().dpr;
    S.zoom.u -= (dx * dpr) / disp.full.w;
    S.zoom.v -= (dy * dpr) / disp.full.h;
    dragging.x = e.clientX;
    dragging.y = e.clientY;
    draw();
  }
});
window.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  const d = dragging;
  dragging = null;
  $('#stage').classList.remove('dragging');
  if (d.moved) return;
  if (S.picking) return pickWhite(e);
  const at = toImage(e.clientX, e.clientY);
  if (S.zoom || at) toggleZoom(at && fullCoords(at));
});
function fullCoords(at) {
  if (S.zoom) return at;
  const f = cur();
  const c = !S.cropEdit && f?.crop ? f.crop : { x: 0, y: 0, w: 1, h: 1 };
  const u = (at.bx - disp.src.x) / disp.src.w;
  const v = (at.by - disp.src.y) / disp.src.h;
  return { u: c.x + u * c.w, v: c.y + v * c.h };
}

new ResizeObserver(() => {
  if (!S.sess || $('#game').hidden) return;
  if (S.mode === 'loupe') {
    draw();
    if (S.cropEdit) placeCropBox();
  } else renderGrid();
  renderStrip();
}).observe($('#stage'));

// ---------------------------------------------------------------------------
// Chrome: info, badges, panel
// ---------------------------------------------------------------------------
function flagEl(f) {
  if (f.flag === 1) return h('span', { class: 'flag pick', title: 'Pick', text: '✓' });
  if (f.flag === -1) return h('span', { class: 'flag reject', title: 'Reject', text: '✕' });
  return null;
}
const starsText = (n) => (n ? '★'.repeat(n) : '');

function updateChrome() {
  const f = cur();
  $('#loupe-info').textContent = f ? `${S.idx + 1} / ${S.order.length} · ${f.name} · ${camLabel(f)} · ${fmtTime(adjusted(f))}${f.jpg && f.nef ? ' · RAW+JPG' : f.nef ? ' · RAW' : ''}` : '';
  $('#loupe-badges').replaceChildren(...(f ? [flagEl(f), h('span', { class: 'stars', text: starsText(f.stars) })].filter(Boolean) : []));
  renderPanel();
}

function renderPanel() {
  const f = cur();
  for (const t of $$('#panel-tabs button')) t.classList.toggle('on', t.dataset.tab === S.tab);
  for (const t of $$('#panel .tab')) t.hidden = t.dataset.tab !== S.tab;
  if (!f) return;
  if (document.activeElement !== $('#players')) $('#players').value = f.players || '';
  if (document.activeElement !== $('#custom-caption')) $('#custom-caption').value = f.caption || '';
  renderCaption();
  renderLookPanel();
  renderCropPanel();
  const ex = f.ex || {};
  const off = S.sess.cameras?.[f.cam]?.offset || 0;
  $('#frame-info').replaceChildren(
    ...[
      ['File', [f.jpg && f.jpg.rel, f.nef && f.nef.rel, f.asset && f.asset.file].filter(Boolean).join('\n')],
      ['Camera', `${camLabel(f)}${ex.lens ? ` · ${ex.lens}` : ''}`],
      ['Exposure', [ex.exposure, ex.fnumber && `f/${Math.round(ex.fnumber * 10) / 10}`, ex.iso && `ISO ${ex.iso}`, ex.focal && `${Math.round(ex.focal)} mm`].filter(Boolean).join(' · ')],
      ['Time', `${fmtDate(f.t)} ${fmtTime(f.t)}${off ? ` (camera) → ${fmtTime(adjusted(f))}` : ''}`],
      ['Size', `${f.o >= 5 ? f.h : f.w} × ${f.o >= 5 ? f.w : f.h}`],
    ]
      .filter(([, v]) => v)
      .flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]),
  );
}

function renderCaption() {
  const f = cur();
  if (!f) return;
  const players = parsePlayers($('#players').value, S.sess.game, S.rosters);
  $('#player-chips').replaceChildren(...players.map((p) => h('span', { class: `chip ${p.side}${p.known ? '' : ' unknown'}`, title: p.known ? '' : 'Not in the roster', text: `${p.side === 'away' ? 'a' : ''}#${p.num} ${p.known ? p.name : '?'}${p.team ? ` · ${p.team}` : ''}` })));
  $('#caption-preview').textContent = captionFor({ ...f, players: $('#players').value, caption: $('#custom-caption').value || null }, S.sess.game, S.rosters) || '—';
}

// ---------------------------------------------------------------------------
// Updating photos (with undo)
// ---------------------------------------------------------------------------
let saveChain = Promise.resolve();
function persist(ids, set) {
  saveChain = saveChain.then(() => api('PATCH', `/s/${S.sess.id}/frames`, { ids, set })).catch(fail);
}

function setFrames(ids, set, { undo = true, advance = false } = {}) {
  const frames = ids.map((id) => S.byId.get(id)).filter(Boolean);
  if (!frames.length) return;
  if (undo) {
    S.undo.push(frames.map((f) => ({ id: f.id, prev: Object.fromEntries(Object.keys(set).map((k) => [k, f[k] ?? null])) })));
    if (S.undo.length > 100) S.undo.shift();
  }
  for (const f of frames) Object.assign(f, set);
  persist(frames.map((f) => f.id), set);
  if ('crop' in set) for (const f of frames) for (const k of [...cache.keys()]) if (k.startsWith(`${f.id}|`) && k !== disp?.key) cache.delete(k);
  renderFilters();
  if (advance && S.autoAdvance && S.idx < S.order.length - 1 && S.selection.size <= 1) return step(1);
  show();
}

function undo() {
  const last = S.undo.pop();
  if (!last) return toast('Nothing to undo');
  for (const { id, prev } of last) setFrames([id], prev, { undo: false });
  const first = S.order.findIndex((f) => f.id === last[0].id);
  if (first >= 0) go(first);
  toast('Undone');
}

const targets = () => (S.mode === 'grid' && S.selection.size > 1 ? [...S.selection] : cur() ? [cur().id] : []);
const flag = (v) => setFrames(targets(), { flag: v }, { advance: true });
const stars = (n) => setFrames(targets(), { stars: n }, { advance: true });

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------
let capTimer;
$('#players').addEventListener('input', () => {
  renderCaption();
  clearTimeout(capTimer);
  const id = cur()?.id;
  capTimer = setTimeout(() => id && setFrames([id], { players: $('#players').value.trim() }), 500);
});
function savePlayers() {
  clearTimeout(capTimer);
  const f = cur();
  if (f && (f.players || '') !== $('#players').value.trim()) setFrames([f.id], { players: $('#players').value.trim() });
}
$('#players').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    savePlayers();
    if (e.shiftKey) nextWithPlayers(1);
    else $('#players').blur();
  } else if (e.key === 'Escape') {
    $('#players').blur();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    savePlayers();
    nextWithPlayers(e.key === 'ArrowDown' ? 1 : -1);
  }
});
// Move on while typing players: the field stays focused, showing the next photo's players.
function nextWithPlayers(d) {
  step(d);
  $('#players').value = cur()?.players || '';
  $('#players').select();
  renderCaption();
}
$('#custom-caption').addEventListener('input', () => {
  renderCaption();
  clearTimeout(capTimer);
  const id = cur()?.id;
  capTimer = setTimeout(() => id && setFrames([id], { caption: $('#custom-caption').value.trim() || null }), 600);
});
$('#custom-caption').addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) {
    e.preventDefault();
    clearTimeout(capTimer);
    const f = cur();
    if (f) setFrames([f.id], { caption: $('#custom-caption').value.trim() || null });
    $('#custom-caption').blur();
  }
});
function samePlayers() {
  const f = cur();
  const i = S.frames.indexOf(f);
  const prev = S.frames.slice(0, i).reverse().find((x) => x.players);
  if (!f || !prev) return toast('No earlier photo has players yet');
  setFrames([f.id], { players: prev.players });
  toast(`Players: ${prev.players}`);
}
$('#same-players').onclick = samePlayers;
$('#clear-caption').onclick = () => cur() && setFrames([cur().id], { players: '', caption: null });

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------
const SLIDERS = [
  ['exposure', 'Exposure', -3, 3, 0.05],
  ['temp', 'Temp', -100, 100, 1],
  ['tint', 'Tint', -100, 100, 1],
  ['contrast', 'Contrast', -100, 100, 1],
  ['highlights', 'Highlights', -100, 100, 1],
  ['shadows', 'Shadows', -100, 100, 1],
  ['saturation', 'Saturation', -100, 100, 1],
];
$('#sliders').replaceChildren(
  ...SLIDERS.map(([key, label, min, max, st]) =>
    h(
      'div',
      { class: 'slider' },
      h('label', { for: `s-${key}`, title: 'Double-click to reset', ondblclick: () => setLook({ [key]: 0 }), text: label }),
      h('input', { type: 'range', id: `s-${key}`, min, max, step: st, oninput: (e) => setLook({ [key]: Number(e.target.value) }, { live: true }), onchange: (e) => setLook({ [key]: Number(e.target.value) }) }),
      h('output', { id: `o-${key}` }),
    ),
  ),
);

function renderLookPanel() {
  const f = cur();
  const own = Boolean(f?.look);
  $('#scope-game').classList.toggle('on', !own);
  $('#scope-photo').classList.toggle('on', own);
  $('#look-note').textContent = own ? 'This photo has its own look.' : 'Changes apply to the whole game.';
  const look = effectiveLook(f);
  for (const [key] of SLIDERS) {
    const v = look[key] || 0;
    if (document.activeElement !== $(`#s-${key}`)) $(`#s-${key}`).value = v;
    $(`#o-${key}`).textContent = key === 'exposure' ? `${v > 0 ? '+' : ''}${v.toFixed(2)}` : String(Math.round(v));
  }
}

let lookTimer;
function setLook(change, { live = false } = {}) {
  const f = cur();
  if (!f) return;
  if (f.look) {
    f.look = { ...f.look, ...change };
    if (!live) setFrames([f.id], { look: f.look });
  } else {
    S.sess.look = { ...LOOK_DEFAULTS, ...S.sess.look, ...change };
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => api('PATCH', `/s/${S.sess.id}`, { look: S.sess.look }).catch(fail), live ? 400 : 0);
  }
  renderLookPanel();
  draw();
}

$('#scope-game').onclick = () => cur()?.look && setFrames([cur().id], { look: null });
$('#scope-photo').onclick = () => cur() && !cur().look && setFrames([cur().id], { look: { ...LOOK_DEFAULTS, ...S.sess.look } });
$('#look-reset').onclick = () => (cur()?.look ? setFrames([cur().id], { look: null }) : setLook({ ...LOOK_DEFAULTS }));
function copyLook() {
  S.clipboard = { ...effectiveLook(cur()) };
  toast('Look copied');
}
function pasteLook(toPicks = false) {
  if (!S.clipboard) return toast('Copy a look first (Ctrl+C)');
  const ids = toPicks ? S.frames.filter((f) => f.flag === 1).map((f) => f.id) : targets();
  if (!ids.length) return toast('No picks yet');
  setFrames(ids, { look: { ...S.clipboard } });
  toast(toPicks ? `Look pasted to ${ids.length} picks` : 'Look pasted');
}
$('#look-copy').onclick = copyLook;
$('#look-paste').onclick = () => pasteLook(false);
$('#look-paste-picks').onclick = () => pasteLook(true);

function startPick() {
  if (S.mode !== 'loupe' || !disp) return;
  S.picking = !S.picking;
  $('#stage').classList.toggle('picking', S.picking);
  if (S.picking) toast('Click on the ice to set white balance');
}
$('#wb-pick').onclick = () => {
  S.tab = 'look';
  renderPanel();
  startPick();
};

function samplerFor() {
  if (sampler?.bitmap === disp.bitmap) return sampler;
  const c = new OffscreenCanvas(disp.bitmap.width, disp.bitmap.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(disp.bitmap, 0, 0);
  sampler = { bitmap: disp.bitmap, ctx };
  return sampler;
}

function pickWhite(e) {
  S.picking = false;
  $('#stage').classList.remove('picking');
  const at = toImage(e.clientX, e.clientY);
  if (!at || at.img !== disp.bitmap) return toast('Click on the photo (not at 100%)');
  const x = Math.round(at.bx);
  const y = Math.round(at.by);
  const img = samplerFor().ctx.getImageData(Math.max(0, x - 4), Math.max(0, y - 4), 9, 9);
  setLook(neutralize(sampleAt(img, 4, 4, 4)));
  toast('White balance set from the ice');
}

function autoWhite() {
  if (!disp) return;
  const k = Math.min(1, 400 / Math.max(disp.bitmap.width, disp.bitmap.height));
  const c = new OffscreenCanvas(Math.round(disp.bitmap.width * k), Math.round(disp.bitmap.height * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(disp.bitmap, 0, 0, c.width, c.height);
  const ice = iceColor(ctx.getImageData(0, 0, c.width, c.height));
  if (!ice) return toast('Not enough ice in this photo — try one with more ice, or pick it (W)', { error: true });
  setLook(neutralize(ice));
  toast('White balance set from the ice');
}
$('#wb-auto').onclick = autoWhite;

// ---------------------------------------------------------------------------
// Crop
// ---------------------------------------------------------------------------
const RATIOS = [
  ['free', 'Free'],
  ['3:2', '3:2'],
  ['4:5', '4:5'],
  ['16:9', '16:9'],
  ['1:1', '1:1'],
  ['9:16', '9:16'],
];
const ROTATED = { '3:2': '2:3', '2:3': '3:2', '4:5': '5:4', '5:4': '4:5', '16:9': '9:16', '9:16': '16:9', '1:1': '1:1', free: 'free' };
const ratioValue = (key) => {
  if (key === 'free') return 0;
  const [a, b] = key.split(':').map(Number);
  return a / b;
};

function renderCropPanel() {
  const ratio = S.cropEdit?.ratio || cur()?.crop?.ratio || 'free';
  $('#ratios').replaceChildren(...RATIOS.map(([key, label]) => h('button', { class: ratio === key || ROTATED[ratio] === key ? 'on' : '', onclick: () => setRatio(key) }, label)));
  $('#crop-edit').textContent = S.cropEdit ? 'Apply (Enter)' : 'Crop (C)';
}

function startCrop() {
  const f = cur();
  if (!f || S.mode !== 'loupe') return;
  if (S.zoom) toggleZoom();
  S.tab = 'crop';
  S.cropEdit = { ...(f.crop || { x: 0, y: 0, w: 1, h: 1, ratio: 'free' }) };
  $('#crop-layer').hidden = false;
  disp = null;
  show();
}
const imageAspect = () => (disp ? disp.full.w / disp.full.h : 1.5);

function setRatio(key) {
  if (!S.cropEdit) startCrop();
  if (!S.cropEdit) return;
  const c = S.cropEdit;
  c.ratio = key;
  const r = ratioValue(key);
  if (r) {
    const A = imageAspect();
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    let w = Math.max(c.w, 0.2);
    let hh = (w * A) / r;
    if (hh > 1) {
      hh = 1;
      w = (hh * r) / A;
    }
    if (w > 1) {
      w = 1;
      hh = (w * A) / r;
    }
    c.w = w;
    c.h = hh;
    c.x = Math.min(1 - w, Math.max(0, cx - w / 2));
    c.y = Math.min(1 - hh, Math.max(0, cy - hh / 2));
  }
  placeCropBox();
  renderCropPanel();
}
const rotateCrop = () => S.cropEdit && setRatio(ROTATED[S.cropEdit.ratio] || 'free');

function placeCropBox() {
  if (!S.cropEdit || !lastDst) return;
  const dpr = stageSize().dpr;
  const c = S.cropEdit;
  Object.assign($('#crop-box').style, {
    left: `${(lastDst.x + c.x * lastDst.w) / dpr}px`,
    top: `${(lastDst.y + c.y * lastDst.h) / dpr}px`,
    width: `${(c.w * lastDst.w) / dpr}px`,
    height: `${(c.h * lastDst.h) / dpr}px`,
  });
}

$('#crop-box').addEventListener('mousedown', (e) => {
  e.preventDefault();
  const c = S.cropEdit;
  if (!c || !lastDst) return;
  const dpr = stageSize().dpr;
  const handle = e.target.dataset.h;
  const start = { x: e.clientX, y: e.clientY, c: { ...c } };
  const A = imageAspect();
  const r = ratioValue(c.ratio);
  const move = (ev) => {
    const dx = ((ev.clientX - start.x) * dpr) / lastDst.w;
    const dy = ((ev.clientY - start.y) * dpr) / lastDst.h;
    const s = start.c;
    if (!handle) {
      c.x = Math.max(0, Math.min(1 - s.w, s.x + dx));
      c.y = Math.max(0, Math.min(1 - s.h, s.y + dy));
    } else {
      // Keep the opposite corner fixed.
      const ax = handle.includes('w') ? s.x + s.w : s.x;
      const ay = handle.includes('n') ? s.y + s.h : s.y;
      const px = Math.max(0, Math.min(1, (handle.includes('w') ? s.x : s.x + s.w) + dx));
      const py = Math.max(0, Math.min(1, (handle.includes('n') ? s.y : s.y + s.h) + dy));
      let w = Math.max(0.03, Math.abs(px - ax));
      let hh = Math.max(0.03, Math.abs(py - ay));
      if (r) {
        hh = (w * A) / r;
        const maxH = handle.includes('n') ? ay : 1 - ay;
        if (hh > maxH) {
          hh = maxH;
          w = (hh * r) / A;
        }
      }
      c.w = Math.min(w, handle.includes('w') ? ax : 1 - ax);
      c.h = r ? (c.w * A) / r : Math.min(hh, handle.includes('n') ? ay : 1 - ay);
      c.x = handle.includes('w') ? ax - c.w : ax;
      c.y = handle.includes('n') ? ay - c.h : ay;
    }
    placeCropBox();
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

function applyCrop() {
  const f = cur();
  const c = S.cropEdit;
  S.cropEdit = null;
  $('#crop-layer').hidden = true;
  if (!f || !c) return show();
  const whole = c.x < 0.001 && c.y < 0.001 && c.w > 0.999 && c.h > 0.999;
  disp = null;
  setFrames([f.id], { crop: whole ? null : { x: c.x, y: c.y, w: c.w, h: c.h, ratio: c.ratio } });
}
function cancelCrop() {
  S.cropEdit = null;
  $('#crop-layer').hidden = true;
  disp = null;
  show();
}
$('#crop-edit').onclick = () => (S.cropEdit ? applyCrop() : startCrop());
$('#crop-rotate').onclick = () => (S.cropEdit ? rotateCrop() : (startCrop(), rotateCrop()));
$('#crop-clear').onclick = () => {
  S.cropEdit = null;
  $('#crop-layer').hidden = true;
  disp = null;
  if (cur()) setFrames([cur().id], { crop: null });
};

// ---------------------------------------------------------------------------
// Grid and filmstrip (only the visible thumbnails exist in the page)
// ---------------------------------------------------------------------------
const CELL_W = 210;
const CELL_H = 176;
function renderGrid(scrollToCurrent = false) {
  const grid = $('#grid');
  if (grid.hidden) return;
  const inner = $('#grid-inner');
  const cols = Math.max(1, Math.floor(grid.clientWidth / CELL_W));
  const cw = grid.clientWidth / cols;
  S.cols = cols;
  inner.style.height = `${Math.ceil(S.order.length / cols) * CELL_H}px`;
  if (scrollToCurrent) {
    const row = Math.floor(S.idx / cols);
    if (row * CELL_H < grid.scrollTop || (row + 1) * CELL_H > grid.scrollTop + grid.clientHeight) grid.scrollTop = row * CELL_H - grid.clientHeight / 2 + CELL_H / 2;
  }
  const first = Math.max(0, Math.floor(grid.scrollTop / CELL_H) - 2) * cols;
  const last = Math.min(S.order.length, (Math.ceil((grid.scrollTop + grid.clientHeight) / CELL_H) + 2) * cols);
  const cells = [];
  for (let i = first; i < last; i++) {
    const f = S.order[i];
    cells.push(
      h(
        'div',
        {
          class: `cell${i === S.idx ? ' cur' : ''}${S.selection.has(f.id) ? ' sel' : ''}${f.flag === -1 ? ' rejected' : ''}`,
          style: `left:${(i % cols) * cw}px;top:${Math.floor(i / cols) * CELL_H}px;width:${cw}px;height:${CELL_H}px`,
          onclick: (e) => gridClick(i, e),
          ondblclick: () => setMode('loupe'),
        },
        h('div', { class: 'box' }, thumbImg(f), flagEl(f), h('div', { class: 'lbl' }, h('span', { text: `${f.name} · ${fmtTime(adjusted(f), false)}` }), h('span', { class: 'stars', text: starsText(f.stars) }))),
      ),
    );
  }
  inner.replaceChildren(...cells);
}
$('#grid').addEventListener('scroll', () => requestAnimationFrame(() => renderGrid()));

function gridClick(i, e) {
  const f = S.order[i];
  if (e.shiftKey && S.anchor !== null) {
    const [a, b] = [Math.min(S.anchor, i), Math.max(S.anchor, i)];
    S.selection = new Set(S.order.slice(a, b + 1).map((x) => x.id));
  } else if (e.ctrlKey || e.metaKey) {
    if (S.selection.has(f.id)) S.selection.delete(f.id);
    else S.selection.add(f.id);
    S.anchor = i;
  } else {
    S.selection = new Set([f.id]);
    S.anchor = i;
  }
  S.idx = i;
  updateChrome();
  renderGrid();
}

const THUMB_W = 118;
function renderStrip(scrollToCurrent = false) {
  const strip = $('#strip');
  const inner = $('#strip-inner');
  inner.style.width = `${S.order.length * THUMB_W + 8}px`;
  if (scrollToCurrent) {
    const x = S.idx * THUMB_W;
    if (x < strip.scrollLeft + THUMB_W || x > strip.scrollLeft + strip.clientWidth - THUMB_W * 2) strip.scrollLeft = x - strip.clientWidth / 2 + THUMB_W / 2;
  }
  const first = Math.max(0, Math.floor(strip.scrollLeft / THUMB_W) - 4);
  const last = Math.min(S.order.length, Math.ceil((strip.scrollLeft + strip.clientWidth) / THUMB_W) + 4);
  const items = [];
  for (let i = first; i < last; i++) {
    const f = S.order[i];
    items.push(
      h(
        'div',
        { class: `thumb${i === S.idx ? ' cur' : ''}${f.flag === -1 ? ' rejected' : ''}`, style: `left:${i * THUMB_W + 4}px`, title: `${f.name} · ${fmtTime(adjusted(f))}`, onclick: () => go(i) },
        thumbImg(f),
        flagEl(f),
        h('span', { class: 'stars', text: starsText(f.stars) }),
      ),
    );
  }
  inner.replaceChildren(...items);
}
$('#strip').addEventListener('scroll', () => requestAnimationFrame(() => renderStrip()));
$('#strip').addEventListener(
  'wheel',
  (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      $('#strip').scrollLeft += e.deltaY;
      e.preventDefault();
    }
  },
  { passive: false },
);

function setMode(mode) {
  S.mode = mode;
  if (mode === 'grid' && S.zoom) toggleZoom();
  if (mode === 'grid' && S.cropEdit) cancelCrop();
  $('#grid').hidden = mode !== 'grid';
  $('#strip').hidden = mode === 'grid';
  $('#view-loupe').classList.toggle('on', mode === 'loupe');
  $('#view-grid').classList.toggle('on', mode === 'grid');
  if (mode === 'loupe') S.selection = new Set(cur() ? [cur().id] : []);
  show();
}
$('#view-loupe').onclick = () => setMode('loupe');
$('#view-grid').onclick = () => setMode('grid');
$('#auto-advance').onchange = (e) => (S.autoAdvance = e.target.checked);
for (const b of $$('#panel-tabs button')) b.onclick = () => ((S.tab = b.dataset.tab), renderPanel());

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------
const typing = (el) => el && !el.closest('dialog:not([open])') && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

window.addEventListener('keydown', (e) => {
  if ($('#game').hidden || document.querySelector('dialog[open]')) return;
  if (typing(e.target)) return;
  const k = e.key;
  const ctrl = e.ctrlKey || e.metaKey;
  const grid = S.mode === 'grid';

  if (S.cropEdit) {
    if (k === 'Enter') return e.preventDefault(), applyCrop();
    if (k === 'Escape') return cancelCrop();
    if (k === 'r' || k === 'R') return rotateCrop();
  }
  if (ctrl && (k === 'z' || k === 'Z')) return e.preventDefault(), undo();
  if (ctrl && (k === 'e' || k === 'E')) return e.preventDefault(), openExport();
  if (ctrl && (k === 'c' || k === 'C')) return e.preventDefault(), copyLook();
  if (ctrl && (k === 'v' || k === 'V')) return e.preventDefault(), pasteLook(e.shiftKey);
  if (ctrl && (k === 'a' || k === 'A') && grid) {
    e.preventDefault();
    S.selection = new Set(S.order.map((f) => f.id));
    return renderGrid();
  }
  if (ctrl || e.altKey) return;

  switch (k) {
    case 'ArrowRight':
    case 'ArrowLeft': {
      e.preventDefault();
      const d = k === 'ArrowRight' ? 1 : -1;
      if (grid) return gridMove(d, e.shiftKey);
      // Holding the key skims thumbnails; the full photo loads on release.
      S.skimming = e.repeat;
      return step(d, { skim: e.repeat });
    }
    case 'ArrowDown':
    case 'ArrowUp':
      if (grid) {
        e.preventDefault();
        return gridMove((k === 'ArrowDown' ? 1 : -1) * (S.cols || 1), e.shiftKey);
      }
      return;
    case 'Home':
      return go(0);
    case 'End':
      return go(S.order.length - 1);
    case ' ':
    case 'p':
    case 'P':
      e.preventDefault();
      return flag(1);
    case 'x':
    case 'X':
      return flag(-1);
    case 'u':
    case 'U':
      return flag(0);
    case '0':
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
      return stars(Number(k));
    case 'z':
    case 'Z':
      return toggleZoom();
    case 'g':
    case 'G':
      return setMode('grid');
    case 'e':
    case 'E':
      return setMode('loupe');
    case 'Enter':
      e.preventDefault();
      if (grid) return setMode('loupe');
      S.tab = 'caption';
      renderPanel();
      return $('#players').select();
    case 't':
    case 'T':
      e.preventDefault();
      S.tab = 'caption';
      renderPanel();
      return $('#custom-caption').focus();
    case '=':
      return samePlayers();
    case 'c':
    case 'C':
      return startCrop();
    case 'w':
      return startPick();
    case 'W':
      return autoWhite();
    case '\\':
      S.before = true;
      $('#before-label').hidden = false;
      return draw();
    case 'a':
    case 'A':
      S.autoAdvance = !S.autoAdvance;
      $('#auto-advance').checked = S.autoAdvance;
      return toast(`Auto-advance ${S.autoAdvance ? 'on' : 'off'}`);
    case '?':
      return $('#dlg-help').showModal();
    case 'Escape':
      if (S.picking) return startPick();
      if (S.zoom) return toggleZoom();
      if (grid && S.selection.size > 1) {
        S.selection = new Set([cur().id]);
        return renderGrid();
      }
      return;
    default:
  }
});
window.addEventListener('keyup', (e) => {
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && S.skimming) {
    S.skimming = false;
    if (S.mode === 'loupe') show();
  }
  if (e.key === '\\' && S.before) {
    S.before = false;
    $('#before-label').hidden = true;
    draw();
  }
});

function gridMove(d, extend) {
  const i = Math.max(0, Math.min(S.order.length - 1, S.idx + d));
  if (extend) {
    if (S.anchor === null) S.anchor = S.idx;
    const [a, b] = [Math.min(S.anchor, i), Math.max(S.anchor, i)];
    S.selection = new Set(S.order.slice(a, b + 1).map((x) => x.id));
  } else {
    S.selection = new Set([S.order[i].id]);
    S.anchor = i;
  }
  S.idx = i;
  updateChrome();
  renderGrid(true);
}

// ---------------------------------------------------------------------------
// Game setup
// ---------------------------------------------------------------------------
function parseOffset(text) {
  const s = String(text).trim();
  if (!s) return 0;
  const m = /^([+-])?(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  let secs = 0;
  for (const p of [m[2], m[3], m[4]].filter((x) => x !== undefined).map(Number)) secs = secs * 60 + p;
  return m[1] === '-' ? -secs : secs;
}
function fmtOffset(secs) {
  if (!secs) return '0';
  const a = Math.abs(secs);
  const hh = Math.floor(a / 3600);
  const mm = Math.floor((a % 3600) / 60);
  const ss = Math.round((a % 60) * 10) / 10;
  return `${secs < 0 ? '-' : '+'}${hh ? `${hh}:${pad(mm)}` : mm}:${pad(ss)}`;
}

async function openSetup() {
  const dlg = $('#dlg-setup');
  const form = $('#setup-form');
  const g = S.sess.game;
  for (const k of ['home', 'away', 'league', 'venue', 'city', 'country', 'byline', 'credit', 'copyright', 'keywords']) form.elements[k].value = g[k] || '';
  form.elements.template.value = g.template || DEFAULT_TEMPLATE;
  form.elements.dateStyle.value = g.dateStyle || 'en-US';
  const state = S.state || (await api('GET', '/state'));
  $('#teams').replaceChildren(...state.teams.map((t) => h('option', { value: t })));
  async function loadRoster(side) {
    const team = form.elements[side].value.trim();
    $(`#roster-${side}-label`).textContent = team ? `${team} roster` : `${side === 'home' ? 'Home' : 'Away'} roster`;
    if (!team) return;
    const r = await api('GET', `/rosters/${encodeURIComponent(team)}`).catch(() => ({ players: [] }));
    form.elements[side === 'home' ? 'rosterHome' : 'rosterAway'].value = rosterText(r.players);
    preview();
  }
  form.elements.home.onchange = () => loadRoster('home');
  form.elements.away.onchange = () => loadRoster('away');
  await Promise.all([loadRoster('home'), loadRoster('away')]);

  const sample = cur() || S.frames[0];
  function preview() {
    const game = Object.fromEntries(['home', 'away', 'league', 'venue', 'city', 'country', 'byline', 'template', 'dateStyle'].map((k) => [k, form.elements[k].value]));
    const rosters = { [game.home]: parseRoster(form.elements.rosterHome.value), [game.away]: parseRoster(form.elements.rosterAway.value) };
    const home = rosters[game.home][0];
    const away = rosters[game.away]?.[0];
    const players = sample?.players || [home && home.num, away && `a${away.num}`].filter(Boolean).join(' ');
    $('#template-preview').textContent = captionFor({ t: sample?.t ?? Date.now(), players, caption: null }, game, rosters);
  }
  form.oninput = preview;
  $('#tokens').replaceChildren(
    ...TOKENS.map((t) =>
      h('button', {
        type: 'button',
        class: 'chip',
        text: `{${t}}`,
        onclick: () => {
          const ta = form.elements.template;
          const pos = ta.selectionStart ?? ta.value.length;
          ta.value = `${ta.value.slice(0, pos)}{${t}}${ta.value.slice(ta.selectionEnd ?? pos)}`;
          ta.focus();
          preview();
        },
      }),
    ),
  );
  preview();

  const firstOf = (cam) => S.frames.find((f) => f.cam === cam);
  $('#cameras').replaceChildren(
    ...Object.entries(S.sess.cameras).map(([key, c]) => {
      const f = firstOf(key);
      return h(
        'div',
        { class: 'cam-row' },
        h('div', {}, h('b', { text: c.label }), h('div', { class: 'muted small', text: `${S.frames.filter((x) => x.cam === key).length} photos · first at ${f ? fmtTime(f.t, false) : '–'} (camera clock)` })),
        h('input', { 'data-cam': key, 'data-kind': 'label', value: c.label, title: 'Name' }),
        h('input', { 'data-cam': key, 'data-kind': 'offset', value: fmtOffset(c.offset), title: 'Clock fix, e.g. +2:05 (add 2 min 5 s) or -1:00:00', placeholder: '+0:00' }),
        h('span', { class: 'muted small', text: 'clock fix' }),
      );
    }),
  );

  const connected = (id) => S.cards.has(id) && !S.missing?.some((m) => m.src.id === id);
  $('#sources').replaceChildren(
    ...S.sess.sources.map((s) =>
      h(
        'div',
        { class: 'src-row' },
        h('div', {}, `💾 ${s.label}`, connected(s.id) ? '' : h('span', { class: 'badge off', text: ' not connected' })),
        isImmich()
          ? ''
          : h('button', {
              type: 'button',
              text: connected(s.id) ? 'Rescan (new photos)' : 'Connect…',
              onclick: async () => {
                dlg.close();
                if (!connected(s.id)) return $('#reconnect-btn').click();
                const { frames } = await scanCards([S.cards.get(s.id)], s.id);
                await api('POST', `/s/${S.sess.id}/frames`, { frames: frames.map((f) => ({ ...f, src: s.id })), cameras: camerasFor(frames, S.sess.cameras) });
                await loadSession(S.sess.id, { keep: true });
                toast(`${s.label} rescanned`);
              },
            }),
      ),
    ),
    isImmich()
      ? ''
      : h(
          'div',
          {},
          h('button', {
            type: 'button',
            text: '+ Add a card (second camera)',
            onclick: async () => {
              const card = await pickCard().catch(fail);
              if (!card) return;
              dlg.close();
              const used = new Set(S.sess.sources.map((x) => x.id));
              let id = 'a';
              while (used.has(id)) id = String.fromCharCode(id.charCodeAt(0) + 1);
              const { frames } = await scanCards([card], id);
              await api('POST', `/s/${S.sess.id}/frames`, { sources: [{ id, label: card.label }], frames, cameras: camerasFor(frames, S.sess.cameras) });
              S.cards.set(id, card);
              if (card.handle) await saveHandle(`${S.sess.id}:${id}`, card.handle);
              await loadSession(S.sess.id, { keep: true });
              await connectCards(false);
              openSetup();
            },
          }),
        ),
  );

  dlg.onclose = async () => {
    if (dlg.returnValue !== 'save') return;
    const game = Object.fromEntries(['home', 'away', 'league', 'venue', 'city', 'country', 'byline', 'credit', 'copyright', 'keywords', 'template', 'dateStyle'].map((k) => [k, form.elements[k].value.trim()]));
    const cameras = {};
    for (const input of $$('#cameras input')) {
      const c = (cameras[input.dataset.cam] ??= {});
      if (input.dataset.kind === 'label') c.label = input.value;
      else {
        const off = parseOffset(input.value);
        if (off === null) toast(`Clock fix “${input.value}” not understood; use e.g. +2:05`, { error: true });
        else c.offset = off;
      }
    }
    try {
      if (game.home) await api('PUT', `/rosters/${encodeURIComponent(game.home)}`, { players: parseRoster(form.elements.rosterHome.value) });
      if (game.away) await api('PUT', `/rosters/${encodeURIComponent(game.away)}`, { players: parseRoster(form.elements.rosterAway.value) });
      await api('PATCH', `/s/${S.sess.id}`, { game, cameras });
      S.state = await api('GET', '/state');
      await loadSession(S.sess.id, { keep: true });
    } catch (err) {
      fail(err);
    }
  };
  dlg.returnValue = '';
  dlg.showModal();
}
$('#btn-setup').onclick = openSetup;
$('#game-title').onclick = openSetup;

// ---------------------------------------------------------------------------
// Export: rendered here, written to a folder you choose (or a ZIP)
// ---------------------------------------------------------------------------
let exporting = null;
let exportRoot = null;
// Folder access (Edge/Chrome); the tests provide a private folder instead.
const canWriteFolders = () => hasFolderAccess || Boolean(window.__rinksideExportDir);
function exportIds(scope) {
  if (scope === 'selected') return S.frames.filter((f) => S.selection.has(f.id)).map((f) => f.id);
  if (scope === 'rated') return S.frames.filter((f) => f.flag === 1 || (f.stars > 0 && f.flag !== -1)).map((f) => f.id);
  if (scope === 'kept') return S.frames.filter((f) => f.flag !== -1).map((f) => f.id);
  return S.frames.filter((f) => f.flag === 1).map((f) => f.id);
}

async function openExport() {
  const dlg = $('#dlg-export');
  const form = $('#export-form');
  const ex = S.sess.export || {};
  form.elements.scope.value = ex.scope || 'picks';
  form.elements.longEdge.value = ex.longEdge ?? 2048;
  form.elements.quality.value = ex.quality ?? 90;
  form.elements.pattern.value = ex.pattern || '{date}_{home}-{away}_{seq}';
  form.elements.folder.value = slug(gameTitle(S.sess.game, S.frames[0]?.t)) || 'RinkSide';
  form.elements.originals.checked = Boolean(ex.originals) && canWriteFolders();
  form.elements.originals.disabled = isImmich() || !canWriteFolders();
  $('#zip-note').hidden = canWriteFolders();
  $('#export-folder-field').hidden = !hasFolderAccess;
  exportRoot ||= await loadHandle('export-root');
  $('#export-folder').textContent = hasFolderAccess ? (exportRoot ? `📁 ${exportRoot.name}` : 'No folder chosen yet') : '';
  const refresh = () => {
    $('#q-val').textContent = form.elements.quality.value;
    const f = S.frames.find((x) => x.flag === 1) || S.frames[0];
    $('#name-preview').textContent = f ? `${fileName(form.elements.pattern.value, f, S.sess.game, 1, camLabel(f))}.jpg` : '';
    const n = exportIds(form.elements.scope.value).length;
    $('#export-go').textContent = `Export ${n} photo${n === 1 ? '' : 's'}`;
    $('#export-go').disabled = !n || Boolean(exporting);
  };
  form.oninput = refresh;
  $('#export-progress').hidden = true;
  refresh();
  dlg.onclose = () => {
    if (exporting) exporting.cancelled = true;
  };
  dlg.showModal();
}
$('#btn-export').onclick = openExport;
$('#export-pick').onclick = async () => {
  try {
    const dir = await pickExportFolder();
    if (!dir) return;
    exportRoot = dir;
    await saveHandle('export-root', dir);
    $('#export-folder').textContent = `📁 ${dir.name}`;
  } catch (err) {
    fail(err);
  }
};

const sourceExifFor = async (f) => {
  if (isImmich()) return exifFromDetails(f.ex, f.t);
  for (const kind of ['jpg', 'nef']) {
    if (!f[kind]) continue;
    const exif = await sourceExif(await fileFor(f, kind)).catch(() => null);
    if (exif) return exif;
  }
  return exifFromDetails(f.ex, f.t);
};

$('#export-go').onclick = async () => {
  const form = $('#export-form');
  const options = {
    scope: form.elements.scope.value,
    longEdge: Number(form.elements.longEdge.value) || 0,
    quality: Number(form.elements.quality.value) || 90,
    pattern: form.elements.pattern.value.trim(),
    originals: form.elements.originals.checked,
  };
  const ids = new Set(exportIds(options.scope));
  const prog = $('#export-progress');
  const bar = $('i', prog);
  const msg = $('.msg', prog);
  // Where to write: a folder (Edge/Chrome) or a ZIP download.
  let dir = null;
  let zip = null;
  try {
    if (canWriteFolders()) {
      const root = window.__rinksideExportDir || exportRoot || (await pickExportFolder());
      if (!root) return;
      if (!window.__rinksideExportDir) {
        exportRoot = root;
        await saveHandle('export-root', root);
        if (!(await writable(root))) return toast('RinkSide needs permission to write to that folder', { error: true });
      }
      dir = await root.getDirectoryHandle(form.elements.folder.value.trim() || 'RinkSide', { create: true });
    } else zip = new Zip();
  } catch (err) {
    return fail(err);
  }
  api('PATCH', `/s/${S.sess.id}`, { export: options }).catch(() => {});
  S.sess.export = options;
  prog.hidden = false;
  $('#export-go').disabled = true;
  exporting = { cancelled: false };
  const job = exporting;
  const sorted = S.frames.filter((f) => ids.has(f.id));
  const taken = new Set();
  const plan = [];
  let seq = 0;
  for (const f of sorted) {
    const base = fileName(options.pattern, f, S.sess.game, ++seq, camLabel(f));
    plan.push({ f, name: dir ? await freeName(dir, base, '.jpg', taken) : uniqueZipName(base, taken) });
  }
  let done = 0;
  let originals = 0;
  const errors = [];
  const t0 = performance.now();
  const where = dir ? `${(window.__rinksideExportDir || exportRoot).name}/${dir.name}` : 'a ZIP';
  const render = () => {
    bar.style.width = `${(done / plan.length) * 100}%`;
    msg.textContent = `${done} / ${plan.length} written to ${where}${errors.length ? ` · ${errors.length} failed` : ''}`;
  };
  render();
  const queue = [...plan];
  const origDir = dir && options.originals && !isImmich() ? await dir.getDirectoryHandle('Originals', { create: true }) : null;
  const origTaken = new Set();
  const workers = Array.from({ length: Math.min(2, queue.length) }, () => new Worker(new URL('./export-worker.js', import.meta.url), { type: 'module' }));
  await Promise.all(
    workers.map(async (w) => {
      while (queue.length && !job.cancelled) {
        const { f, name } = queue.shift();
        try {
          const blob = await fullOf(f);
          const look = effectiveLook(f);
          const res = await new Promise((resolve) => {
            w.onmessage = (e) => resolve(e.data);
            w.onerror = (e) => resolve({ ok: false, error: e.message });
            w.postMessage({ id: f.id, blob, crop: f.crop, look: isNeutral(look) ? null : look, longEdge: options.longEdge, quality: options.quality });
          });
          if (!res.ok) throw new Error(res.error);
          const meta = frameMeta(S.sess, f, S.rosters);
          const out = tagJpeg(new Uint8Array(res.jpeg), { exif: await sourceExifFor(f), width: res.width, height: res.height, meta });
          if (dir) await writeFile(dir, name, out);
          else zip.add(name, out);
          if (origDir) originals += await copyOriginals(f, origDir, origTaken, meta);
        } catch (err) {
          errors.push(`${f.name}: ${err.message}`);
        }
        done++;
        render();
      }
      w.terminate();
    }),
  );
  if (zip && done) {
    const a = h('a', { href: URL.createObjectURL(zip.blob()), download: `${form.elements.folder.value.trim() || 'RinkSide'}.zip` });
    document.body.append(a);
    a.click();
    a.remove();
  }
  exporting = null;
  bar.style.width = '100%';
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  msg.textContent = `${job.cancelled ? 'Stopped. ' : ''}${done - errors.length} photo(s) exported to ${where} in ${secs} s${originals ? `, ${originals} original file(s) copied` : ''}${errors.length ? ` · ${errors.length} failed: ${errors.slice(0, 3).join('; ')}` : ''}`;
  $('#export-go').disabled = false;
};

function uniqueZipName(base, taken) {
  let name = `${base}.jpg`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}-${i}.jpg`;
  taken.add(name.toLowerCase());
  return name;
}

// The picked NEF + JPG, byte for byte, with an XMP sidecar for Lightroom.
// Both bodies write DSC_0001: the camera name is added when a name is taken.
async function copyOriginals(f, dir, taken, meta) {
  const files = [];
  for (const kind of ['nef', 'jpg']) if (f[kind]) files.push(await fileFor(f, kind));
  const ext = (file) => file.name.slice(file.name.lastIndexOf('.'));
  const cam = slug(camLabel(f) || 'cam');
  const clash = async (stem) => {
    for (const file of [...files, { name: `${stem}.xmp` }]) {
      const n = `${stem}${ext(file)}`;
      if (taken.has(n.toLowerCase())) return true;
      try {
        await dir.getFileHandle(n);
        return true;
      } catch {
        // free
      }
    }
    return false;
  };
  let stem = f.name;
  if (await clash(stem)) stem = `${f.name}_${cam}`;
  for (let i = 2; await clash(stem); i++) stem = `${f.name}_${cam}-${i}`;
  for (const file of files) {
    taken.add(`${stem}${ext(file)}`.toLowerCase());
    await writeFile(dir, `${stem}${ext(file)}`, file);
  }
  taken.add(`${stem}.xmp`);
  await writeFile(dir, `${stem}.xmp`, new TextEncoder().encode(xmpPacket(meta, { sidecar: true })));
  return files.length;
}

// ---------------------------------------------------------------------------
// Sync to Immich
// ---------------------------------------------------------------------------
const SYNC_KEYS = ['scope', 'includeRaw', 'favorite', 'pickTag', 'rejects', 'caption', 'rating', 'tags', 'album', 'albumName'];
let syncStatus = null;
async function openSync() {
  const dlg = $('#dlg-sync');
  const form = $('#sync-form');
  const o = S.sess.sync?.options || {};
  for (const k of SYNC_KEYS) {
    const el = form.elements[k];
    if (el.type === 'checkbox') el.checked = Boolean(o[k]);
    else el.value = o[k] ?? '';
  }
  form.elements.albumName.placeholder = gameTitle(S.sess.game, S.frames[0]?.t);
  $('#sync-local').hidden = isImmich();
  const synced = Object.keys(S.sess.sync?.assets || {}).length;
  const who = S.state?.user?.name;
  $('#sync-target').textContent = `To your Immich${who ? ` (${who})` : ''}${S.sess.sync?.last ? ` · last synced ${new Date(S.sess.sync.last).toLocaleString()} (${synced} photos)` : ''}`;
  $('#sync-progress').hidden = !syncStatus;
  $('#people').hidden = true;
  $('#people-go').hidden = !synced;
  dlg.showModal();
}
$('#btn-sync').onclick = openSync;

$('#sync-go').onclick = async () => {
  if (syncStatus?.state === 'running') return;
  const form = $('#sync-form');
  const options = {};
  for (const k of SYNC_KEYS) {
    const el = form.elements[k];
    options[k] = el.type === 'checkbox' ? el.checked : el.value.trim();
  }
  S.sess.sync = { ...S.sess.sync, options: { ...S.sess.sync?.options, ...options } };
  const status = (syncStatus = { state: 'running', step: '', done: 0, total: 0, errors: [], summary: { uploaded: 0, alreadyThere: 0, updated: 0 } });
  $('#sync-go').disabled = true;
  const timer = setInterval(() => renderSync(status), 300);
  try {
    await api('PATCH', `/s/${S.sess.id}`, { sync: { options } });
    await runSync(S.sess, S.rosters, fileFor, status);
    status.state = 'done';
  } catch (err) {
    Object.assign(status, { state: 'error', message: err.message });
  }
  clearInterval(timer);
  renderSync(status);
  $('#sync-go').disabled = false;
  $('#people-go').hidden = !Object.keys(S.sess.sync?.assets || {}).length;
};

function renderSync(s) {
  const prog = $('#sync-progress');
  prog.hidden = false;
  $('i', prog).style.width = s.total ? `${(s.done / s.total) * 100}%` : s.state === 'done' ? '100%' : '8%';
  const sum = s.summary;
  $('.msg', prog).textContent =
    s.state === 'running'
      ? `${s.step}${s.total ? ` ${s.done} / ${s.total}` : ''}${s.current ? ` · ${s.current}` : ''}`
      : s.state === 'done'
        ? `Done: ${sum.uploaded} uploaded, ${sum.alreadyThere} already in Immich, ${sum.updated} captions/ratings updated${S.sess.sync.albumName ? ` · album “${S.sess.sync.albumName}”` : ''}.`
        : `Stopped: ${s.message}`;
  $('.errors', prog).replaceChildren(...s.errors.slice(0, 50).map((e) => h('li', { text: e })));
}

$('#people-go').onclick = async () => {
  const box = $('#people');
  box.hidden = false;
  box.replaceChildren(h('p', { class: 'muted small', text: 'Looking at faces Immich found in the synced photos…' }));
  try {
    const r = await suggestPeople(S.sess, S.rosters);
    if (!r.suggestions.length) {
      box.replaceChildren(h('p', { class: 'muted small', text: `No suggestions from ${r.checked} captioned photos. Immich needs to finish face recognition first, and photos need players.` }));
      return;
    }
    box.replaceChildren(
      h('p', { class: 'muted small', text: 'Tick the faces to name in Immich:' }),
      ...r.suggestions.map((s) =>
        h(
          'label',
          { class: 'person' },
          h('img', { src: immichUrl(`/people/${s.personId}/thumbnail`), alt: '' }),
          h('div', {}, h('b', { text: s.suggestion }), h('div', { class: 'muted small', text: `${s.currentName ? `now “${s.currentName}” · ` : ''}${s.photos} photos · ${Math.round(s.confidence * 100)}% sure` })),
          h('input', { type: 'checkbox', checked: s.confidence >= 0.75, dataset: { person: s.personId, name: s.suggestion } }),
        ),
      ),
      h(
        'div',
        { class: 'row small' },
        h('button', {
          type: 'button',
          class: 'primary',
          text: 'Name the ticked people',
          onclick: async () => {
            const names = $$('input[data-person]', box).filter((i) => i.checked);
            try {
              for (const i of names) await immich('PUT', `/people/${i.dataset.person}`, { body: { name: i.dataset.name } });
              toast(`${names.length} people named in Immich`);
            } catch (err) {
              fail(err);
            }
          },
        }),
      ),
    );
  } catch (err) {
    box.replaceChildren(h('p', { class: 'muted small', text: err.message }));
  }
};

// ---------------------------------------------------------------------------
// Immich albums
// ---------------------------------------------------------------------------
$('#open-album').onclick = async () => {
  const dlg = $('#dlg-albums');
  const list = $('#album-list');
  list.replaceChildren(h('p', { class: 'muted', text: 'Loading albums…' }));
  dlg.showModal();
  try {
    const albums = (await immich('GET', '/albums')).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    const render = () => {
      const q = $('#album-filter').value.toLowerCase();
      list.replaceChildren(
        ...albums
          .filter((a) => a.albumName.toLowerCase().includes(q))
          .map((a) =>
            h(
              'button',
              {
                type: 'button',
                onclick: async () => {
                  dlg.close();
                  try {
                    const { frames, assets, applied } = framesFromAssets(await albumAssets(a.id));
                    const cameras = {};
                    for (const f of frames) cameras[f.cam] ??= { label: cameraLabel(f.cam), model: f.cam, offset: 0 };
                    const { id } = await api('POST', '/sessions', { mode: 'immich', name: a.albumName, immichAlbum: { id: a.id, name: a.albumName }, frames, cameras, sync: { assets, applied } });
                    openGame(id);
                  } catch (err) {
                    fail(err);
                  }
                },
              },
              h('span', { text: a.albumName }),
              h('span', { class: 'muted small', text: `${a.assetCount} · ${fmtDate(Date.parse(a.startDate))}` }),
            ),
          ),
      );
    };
    $('#album-filter').oninput = render;
    render();
  } catch (err) {
    list.replaceChildren(h('p', { class: 'muted', text: err.message }));
  }
};

$('#btn-help').onclick = () => $('#dlg-help').showModal();
$('#go-home').onclick = showHome;
// Don't leave keyboard focus in a closed dialog (it would swallow shortcuts).
for (const d of $$('dialog')) d.addEventListener('close', () => d.contains(document.activeElement) && document.activeElement.blur());

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
if (!renderer) toast('This browser has no WebGL 2, so the look preview is off. Use a current Edge or Chrome.', { error: true, ms: 10000 });
const startId = new URLSearchParams(location.search).get('game');
api('GET', '/state')
  .then((state) => {
    S.state = state;
    return startId ? openGame(startId) : showHome();
  })
  .catch(() => showHome());

// For the automated tests.
window.rinkside = { S, go, flag, stars, setLook, autoWhite, setMode, toggleZoom, startCrop, applyCrop, setRatio, rotateCrop, cur, draw, connectCards, get disp() { return disp; } };
