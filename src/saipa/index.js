// SAIPA: one Immich folder of hockey photos, sorted into SaiPa games.
//
// Folio lists the folder through Immich, reads each JPEG's IPTC/XMP header (only
// the first few hundred KB of the file), and matches the photo's local clock time
// to the game that was on. Everything is cached per user in data/saipa/<user>.json,
// so later syncs only read new or changed photos.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from '../config.js';
import { HttpError, readJson, send, sendJson } from '../http.js';
import * as immich from '../immich.js';
import { readMetadata, scanJpeg } from '../iptc.js';
import { seasonGames, seasonOf } from './liiga.js';
import { SearchIndex } from './search.js';

const dir = path.join(config.dataDir, 'saipa');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// source: 'album' (one or more Immich albums), 'games' (every photo in the library taken
// during a SaiPa game) or 'folder' (a folder, for external libraries).
const DEFAULTS = { source: null, albumIds: [], folder: null, subfolders: true, clockOffset: 0, before: 60, after: 210, team: 'saipa' };
const SOURCES = ['album', 'games', 'folder'];

export const configured = (s) =>
  (s.source === 'album' && s.albumIds.length > 0) || s.source === 'games' || (s.source === 'folder' && Boolean(s.folder));
const AUTO_SYNC_MS = 10 * 60e3;

// ---- per-user library ------------------------------------------------------------------

const libraries = new Map();

function library(userId) {
  let lib = libraries.get(userId);
  if (lib) return lib;
  const file = path.join(dir, `${userId.replace(/[^a-z0-9-]/gi, '')}.json`);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    data = { settings: { ...DEFAULTS }, assets: {}, syncedAt: null };
  }
  data.settings = { ...DEFAULTS, ...data.settings };
  if (!data.settings.source && data.settings.folder) data.settings.source = 'folder'; // set up before sources existed
  lib = { file, data, version: 0, timer: null, built: null, index: null };
  libraries.set(userId, lib);
  return lib;
}

function persist(lib, now = false) {
  clearTimeout(lib.timer);
  const write = () => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${lib.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(lib.data));
    fs.renameSync(tmp, lib.file);
  };
  if (now) write();
  else lib.timer = setTimeout(write, 1000);
}

const changed = (lib) => {
  lib.version++;
  lib.built = null;
  lib.index = null;
};

// ---- reading the folder from Immich ---------------------------------------------------------

async function mapLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

async function listFolder(auth, root, subfolders) {
  const paths = (await immich.api('GET', '/view/folder/unique-paths', { auth })) || [];
  const base = trimSlash(root);
  const wanted = paths.filter((p) => {
    const t = trimSlash(p);
    return t === base || (subfolders && t.startsWith(`${base}/`));
  });
  const assets = [];
  await mapLimit(wanted, 4, async (p) => {
    const list = await immich.api('GET', '/view/folder', { auth, query: { path: p } });
    if (Array.isArray(list)) assets.push(...list);
  });
  return assets;
}

// Every asset matching a metadata search, page by page.
async function searchAll(auth, filter) {
  const out = [];
  for (let page = 1; page; ) {
    const result = await immich.api('POST', '/search/metadata', { auth, body: { ...filter, page, size: 1000 } });
    out.push(...(result?.assets?.items || []));
    const next = Number(result?.assets?.nextPage);
    page = Number.isFinite(next) && next > page ? next : 0;
  }
  return out;
}

// Photos taken around SaiPa games anywhere in the library. Only months that have
// photos are searched. The search window is widened by 4 hours because cameras
// without a time zone can make Immich's UTC times a few hours off; the exact
// matching happens later, on the camera's local clock.
async function listGamePhotos(auth, s) {
  const buckets = (await immich.timelineBuckets({ visibility: 'timeline' }, { auth })) || [];
  const months = new Set(buckets.map((b) => String(b.timeBucket).slice(0, 7)));
  const seasons = [...new Set([...months].map((m) => seasonOf(`${m}-01`)))];
  const games = (await Promise.all(seasons.map((season) => seasonGames(season, s.team)))).flat();
  const wanted = games.filter((g) => months.has(g.local.slice(0, 7)) && Date.parse(g.start) < Date.now());
  const pad = 4 * 3600e3;
  const found = [];
  await mapLimit(wanted, 4, async (g) => {
    const start = Date.parse(g.start);
    const items = await searchAll(auth, {
      takenAfter: new Date(start - s.before * 60e3 - pad).toISOString(),
      takenBefore: new Date(start + s.after * 60e3 + pad).toISOString(),
    });
    found.push(...items);
  });
  return found;
}

async function listSource(auth, s) {
  let assets;
  if (s.source === 'album') {
    assets = [];
    for (const albumId of s.albumIds) assets.push(...(await searchAll(auth, { albumIds: [albumId] })));
  } else if (s.source === 'games') {
    assets = await listGamePhotos(auth, s);
  } else {
    assets = await listFolder(auth, s.folder, s.subfolders);
  }
  return [...new Map(assets.map((a) => [a.id, a])).values()];
}

function rowFrom(a) {
  let w = a.width || a.exifInfo?.exifImageWidth;
  let h = a.height || a.exifInfo?.exifImageHeight;
  if (!a.width && [5, 6, 7, 8].includes(Number(a.exifInfo?.orientation))) [w, h] = [h, w];
  return {
    t: String(a.localDateTime || a.fileCreatedAt || '').slice(0, 19),
    r: w && h ? Math.round((w / h) * 1000) / 1000 : 1.5,
    v: a.type === 'VIDEO' ? 1 : 0,
    d: a.duration ?? null,
    n: a.originalFileName || '',
    p: a.originalPath || '',
    mime: a.originalMimeType || '',
    u: a.checksum || a.updatedAt || '',
  };
}

// The first `bytes` of the original file. Uses a Range request and stops reading
// once it has enough, in case the server sends the whole file anyway.
function fetchBytes(auth, id, bytes) {
  return new Promise((resolve, reject) => {
    immich
      .request('GET', `/api/assets/${id}/original`, { headers: { ...auth.headers, range: `bytes=0-${bytes - 1}` } })
      .then((res) => {
        if (res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`Immich responded ${res.statusCode}`));
        }
        const chunks = [];
        let size = 0;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          resolve(Buffer.concat(chunks).subarray(0, bytes));
        };
        res.on('data', (c) => {
          chunks.push(c);
          size += c.length;
          if (size >= bytes) {
            finish();
            res.destroy();
          }
        });
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', (err) => (finished ? null : reject(err)));
      }, reject);
  });
}

async function readIptc(auth, id) {
  let want = 192 * 1024;
  let scan;
  for (let attempt = 0; attempt < 4; attempt++) {
    const buf = await fetchBytes(auth, id, want);
    scan = scanJpeg(buf);
    if (!scan.jpeg) return null;
    if (scan.done || !scan.need || buf.length < want) break; // got it, or the file ended
    want = Math.min(Math.max(scan.need + 64 * 1024, want * 2), 4 * 1024 * 1024);
  }
  return readMetadata(scan);
}

async function readMeta(auth, id, row) {
  const jpeg = /jpe?g$/i.test(row.mime) || /\.jpe?g$/i.test(row.n);
  if (jpeg) return readIptc(auth, id);
  if (row.v) return null;
  // HEIC/RAW/PNG: fall back to the caption Immich extracted.
  const asset = await immich.api('GET', `/assets/${id}`, { auth });
  return asset?.exifInfo?.description ? { caption: asset.exifInfo.description } : null;
}

// ---- sync ---------------------------------------------------------------------------------

const jobs = new Map();

export function syncStatus(userId) {
  return jobs.get(userId) || { state: 'idle' };
}

function startSync(userId, auth) {
  const current = jobs.get(userId);
  if (current && ['listing', 'reading'].includes(current.state)) return current;
  const lib = library(userId);
  const status = { state: 'listing', done: 0, total: 0, failed: 0, startedAt: Date.now() };
  jobs.set(userId, status);

  (async () => {
    const listed = await listSource(auth, lib.data.settings);
    const seen = new Set();
    for (const a of listed) {
      if (a.isTrashed || !UUID.test(a.id)) continue;
      seen.add(a.id);
      const row = rowFrom(a);
      const old = lib.data.assets[a.id];
      lib.data.assets[a.id] = old && old.u === row.u ? { ...row, m: old.m, x: old.x } : row;
    }
    for (const id of Object.keys(lib.data.assets)) if (!seen.has(id)) delete lib.data.assets[id];
    changed(lib);

    const todo = Object.keys(lib.data.assets).filter((id) => !lib.data.assets[id].x);
    Object.assign(status, { state: 'reading', total: todo.length });
    await mapLimit(todo, 6, async (id) => {
      const row = lib.data.assets[id];
      try {
        row.m = await readMeta(auth, id, row);
        row.x = 1;
      } catch {
        status.failed++;
      }
      status.done++;
      if (status.done % 200 === 0) {
        changed(lib);
        persist(lib);
      }
    });
    lib.data.syncedAt = Date.now();
    changed(lib);
    persist(lib, true);
    Object.assign(status, { state: 'done', finishedAt: Date.now() });
  })().catch((err) => {
    Object.assign(status, { state: 'error', message: err.message, finishedAt: Date.now() });
  });
  return status;
}

// ---- games & sections -------------------------------------------------------------------------

const toMs = (wallClock) => Date.parse(`${wallClock.length === 16 ? `${wallClock}:00` : wallClock}Z`);

async function gamesFor(lib) {
  const s = lib.data.settings;
  const seasons = new Set();
  for (const a of Object.values(lib.data.assets)) if (a.t) seasons.add(seasonOf(a.t));
  const lists = await Promise.all([...seasons].sort().map((season) => seasonGames(season, s.team)));
  return lists.flat();
}

const gameView = (g) => ({
  id: g.id,
  serie: g.serie,
  local: g.local,
  home: g.home,
  away: g.away,
  ended: g.ended,
  finishedType: g.finishedType,
  arena: g.arena,
  city: g.city,
  spectators: g.spectators,
});

// Sort photos into games (by local clock time) and leftover days, newest first.
async function build(lib) {
  if (lib.built && lib.built.version === lib.version && Date.now() - lib.built.at < 5 * 60e3) return lib.built;
  const s = lib.data.settings;
  const games = (await gamesFor(lib)).map((g) => ({ g, start: toMs(g.local) })).sort((a, b) => a.start - b.start);
  const offset = s.clockOffset * 60e3;
  const byGame = new Map();
  const byDay = new Map();
  const gameOf = new Map();
  const assets = Object.entries(lib.data.assets)
    .filter(([, a]) => a.t)
    .sort((x, y) => x[1].t.localeCompare(y[1].t));

  for (const [id, a] of assets) {
    const t = toMs(a.t) + offset;
    let best = null;
    for (const w of games) {
      if (w.start - s.before * 60e3 > t) break;
      if (t <= w.start + s.after * 60e3 && (!best || Math.abs(t - w.start) < Math.abs(t - best.start))) best = w;
    }
    const item = [id, a.r, a.v || 0, a.d ?? null];
    if (best) {
      gameOf.set(id, best.g);
      if (!byGame.has(best.g.id)) byGame.set(best.g.id, { game: best.g, items: [] });
      byGame.get(best.g.id).items.push(item);
    } else if (s.source !== 'games') {
      // ("games" only collects photos around game times; leftovers aren't hockey.)
      const day = new Date(t).toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(item);
    }
  }

  const sections = [
    ...[...byGame.values()].map(({ game, items }) => ({ key: game.id, kind: 'game', date: game.local.slice(0, 10), sort: game.local, game: gameView(game), items })),
    ...[...byDay].map(([day, items]) => ({ key: `day-${day}`, kind: 'day', date: day, sort: `${day}T00:00`, items })),
  ].sort((a, b) => b.sort.localeCompare(a.sort));

  lib.built = { version: lib.version, at: Date.now(), sections, gameOf, gamesFound: games.length };
  return lib.built;
}

const fiDate = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d}.${m}.${y}`;
};

async function searchIndex(lib) {
  const built = await build(lib);
  if (lib.index && lib.index.version === lib.version && lib.index.built === built) return lib.index;
  const docs = Object.entries(lib.data.assets).map(([id, a]) => {
    const m = a.m || {};
    const g = built.gameOf.get(id);
    const primary = [m.caption, m.headline, m.title, [].concat(m.keywords || []).join(' '), [].concat(m.byline || []).join(' '), m.sublocation, m.city, m.category, [].concat(m.supplementalCategories || []).join(' ')]
      .filter(Boolean)
      .join(' ');
    const context = [g ? `${g.home.name} ${g.away.name} ${g.serie} ${g.arena || ''} ${fiDate(g.local)}` : '', a.t ? fiDate(a.t) : '', a.n.replace(/\.[^.]+$/, '')].join(' ');
    return { id, primary, context };
  });
  lib.index = { version: lib.version, built, engine: new SearchIndex(docs) };
  return lib.index;
}

function sendJsonGz(req, res, data) {
  const body = Buffer.from(JSON.stringify(data));
  if (body.length > 2048 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    return send(res, 200, zlib.gzipSync(body), {
      'content-type': 'application/json; charset=utf-8',
      'content-encoding': 'gzip',
      vary: 'accept-encoding',
      'cache-control': 'no-store',
    });
  }
  return sendJson(res, 200, data);
}

// ---- API ----------------------------------------------------------------------------------------

function stateView(userId) {
  const lib = library(userId);
  return {
    settings: lib.data.settings,
    ready: configured(lib.data.settings),
    syncedAt: lib.data.syncedAt,
    photos: Object.keys(lib.data.assets).length,
    withMetadata: Object.values(lib.data.assets).filter((a) => a.m).length,
    status: syncStatus(userId),
  };
}

export async function saipaApi(req, res, url, sub, auth) {
  const userId = auth.user.id;
  const lib = library(userId);
  const method = req.method;
  let m;

  if (sub === '/state' && method === 'GET') {
    const s = lib.data.settings;
    if (configured(s) && (!lib.data.syncedAt || Date.now() - lib.data.syncedAt > AUTO_SYNC_MS)) startSync(userId, auth);
    return sendJson(res, 200, stateView(userId));
  }
  if (sub === '/status' && method === 'GET') return sendJson(res, 200, syncStatus(userId));
  if (sub === '/sync' && method === 'POST') {
    if (!configured(lib.data.settings)) throw new HttpError(400, 'Choose where your hockey photos are first.');
    return sendJson(res, 200, startSync(userId, auth));
  }
  if (sub === '/folders' && method === 'GET') {
    // Immich only lists folders that directly hold photos; add their parents too,
    // so a top folder like /photos/Hockey (with one subfolder per game) can be picked.
    // Immich's own storage (upload/<user id>/ab/cd, thumbs, …) has meaningless names: hide it.
    const internal = /\/(upload|library|thumbs|encoded-video|profile|backups)\/[0-9a-f-]{36}(\/|$)|\/(upload|thumbs|encoded-video)$/i;
    const paths = (await immich.api('GET', '/view/folder/unique-paths', { auth })) || [];
    const all = new Set();
    let hidden = 0;
    for (const p of paths.map(trimSlash)) {
      if (internal.test(p)) {
        hidden++;
        continue;
      }
      const parts = p.split('/');
      for (let i = parts.length; i > 1; i--) all.add(parts.slice(0, i).join('/') || '/');
    }
    return sendJson(res, 200, { folders: [...all].filter((f) => f && f !== '/').sort((a, b) => a.localeCompare(b)), hidden });
  }
  if (sub === '/settings' && method === 'PUT') {
    const body = await readJson(req);
    const s = { ...lib.data.settings }; // validated as a copy, saved only if usable
    const int =(v, min, max, fallback) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : fallback);
    const before = JSON.stringify([s.source, s.albumIds, s.folder, s.subfolders, s.before, s.after]);
    if (SOURCES.includes(body.source)) s.source = body.source;
    if (Array.isArray(body.albumIds)) s.albumIds = [...new Set(body.albumIds.filter((id) => typeof id === 'string' && UUID.test(id)))].slice(0, 200);
    if (typeof body.folder === 'string' && body.folder.trim()) s.folder = trimSlash(body.folder.trim()).slice(0, 1000);
    if (typeof body.subfolders === 'boolean') s.subfolders = body.subfolders;
    s.clockOffset = int(body.clockOffset, -1440, 1440, s.clockOffset);
    s.before = int(body.before, 0, 600, s.before);
    s.after = int(body.after, 30, 720, s.after);
    if (!configured(s)) throw new HttpError(400, s.source === 'album' ? 'Pick at least one album.' : s.source === 'folder' ? 'Pick a folder.' : 'Choose where your hockey photos are.');
    lib.data.settings = s;
    changed(lib);
    persist(lib, true);
    // Which photos belong to the archive changed: look again.
    if (before !== JSON.stringify([s.source, s.albumIds, s.folder, s.subfolders, s.before, s.after])) startSync(userId, auth);
    return sendJson(res, 200, stateView(userId));
  }

  if (sub === '/library' && method === 'GET') {
    const built = await build(lib);
    return sendJsonGz(req, res, { sections: built.sections, gamesFound: built.gamesFound, ...stateView(userId) });
  }

  if (sub === '/search' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').slice(0, 200);
    const { built, engine } = await searchIndex(lib);
    const result = engine.search(q);
    const score = new Map(result.ids.map((r) => [r.id, r.score]));
    const sections = built.sections
      .map((sec) => ({ ...sec, items: sec.items.filter((it) => score.has(it[0])) }))
      .filter((sec) => sec.items.length);
    return sendJsonGz(req, res, { q, words: result.words, partial: result.partial, total: score.size, sections });
  }

  if ((m = sub.match(/^\/asset\/([0-9a-f-]+)$/i)) && method === 'GET') {
    const row = lib.data.assets[m[1]];
    if (!row) throw new HttpError(404, 'Not in your hockey folder');
    const built = await build(lib);
    const game = built.gameOf.get(m[1]);
    let exif = null;
    try {
      const asset = await immich.api('GET', `/assets/${m[1]}`, { auth });
      const e = asset?.exifInfo || {};
      exif = {
        make: e.make || null,
        model: e.model || null,
        lens: e.lensModel || null,
        focalLength: e.focalLength ?? null,
        fNumber: e.fNumber ?? null,
        exposureTime: e.exposureTime || null,
        iso: e.iso ?? null,
        width: e.exifImageWidth ?? asset?.width ?? null,
        height: e.exifImageHeight ?? asset?.height ?? null,
        fileSize: e.fileSizeInByte ?? null,
      };
    } catch {}
    return sendJson(res, 200, {
      id: m[1],
      time: row.t,
      file: row.n,
      path: row.p,
      video: Boolean(row.v),
      meta: row.m || null,
      checked: Boolean(row.x),
      game: game ? { ...gameView(game), scorers: game.scorers } : null,
      exif,
    });
  }

  if ((m = sub.match(/^\/original\/([0-9a-f-]+)$/i)) && method === 'GET') {
    if (!lib.data.assets[m[1]]) throw new HttpError(404, 'Not found');
    return immich.pipe(req, res, `/assets/${m[1]}/original`, { auth, cache: 'private, max-age=3600' });
  }

  throw new HttpError(404, 'Not found');
}
