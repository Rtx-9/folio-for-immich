// RinkSide's server side inside Folio: it stores each user's games (picks,
// stars, captions, looks, crops), rosters and settings, and passes RinkSide's
// Immich calls through with the user's own Immich login. Photos themselves are
// read from the card by the browser and never pass through here, except when
// they're uploaded to Immich.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { config } from './config.js';
import { HttpError, readJson, sendJson } from './http.js';
import { api as immichApi } from './immich.js';
import * as liiga from './liiga.js';

const ROOT = path.join(config.dataDir, 'rinkside');

const LOOK_KEYS = ['exposure', 'temp', 'tint', 'contrast', 'highlights', 'shadows', 'saturation'];
const GAME_FIELDS = ['home', 'away', 'league', 'venue', 'city', 'country', 'byline', 'credit', 'copyright', 'keywords', 'template', 'dateStyle', 'date', 'tagPlayers', 'liigaGame', 'liigaDate'];
const REMEMBERED = ['league', 'venue', 'city', 'country', 'byline', 'credit', 'copyright', 'keywords', 'template', 'dateStyle', 'tagPlayers'];
export const EXPORT_DEFAULTS = { longEdge: 2048, quality: 90, pattern: '{pvm}_{koti}-{vieras}_{nro}', scope: 'picks', originals: false, folder: '', dest: 'folder', album: '', stack: true };
export const SYNC_DEFAULTS = { scope: 'picks', includeRaw: true, favorite: true, pickTag: true, rejects: 'archive', caption: true, rating: true, tags: true, album: true, albumName: '' };

// ---- storage: one folder per Immich user -------------------------------------------

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, data);
  fs.renameSync(`${file}.tmp`, file);
}
function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const userDir = (user) => path.join(ROOT, user.id.replace(/[^a-zA-Z0-9-]/g, ''));
const sessionFile = (user, id) => path.join(userDir(user), 'games', `${id}.json`);
const validId = (id) => /^[a-f0-9]{12}$/.test(id);

// Debounced writes, so holding a key while culling doesn't hammer the disk.
const pending = new Map();
function saveLater(file, data) {
  clearTimeout(pending.get(file)?.timer);
  pending.set(file, { data, timer: setTimeout(() => flushOne(file), 300) });
}
function flushOne(file) {
  const p = pending.get(file);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(file);
  writeAtomic(file, JSON.stringify(p.data));
}
export function flushRinkside() {
  for (const file of [...pending.keys()]) flushOne(file);
}
const load = (file, fallback) => pending.get(file)?.data ?? readJsonFile(file, fallback);

function listGames(user) {
  const dir = path.join(userDir(user), 'games');
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function getSession(user, id) {
  if (!validId(id)) throw new HttpError(404, 'Peliä ei löytynyt');
  const s = load(sessionFile(user, id), null);
  if (!s) throw new HttpError(404, 'Peliä ei löytynyt');
  return s;
}

function summary(s) {
  const frames = s.frames || [];
  return {
    id: s.id,
    name: s.name,
    mode: s.mode,
    updated: s.updated,
    count: frames.length,
    picks: frames.filter((f) => f.flag === 1).length,
    first: frames.reduce((m, f) => Math.min(m, f.t), Infinity),
    game: { home: s.game?.home || '', away: s.game?.away || '', league: s.game?.league || '' },
    sources: (s.sources || []).map((x) => ({ id: x.id, label: x.label })),
    synced: s.sync?.last || null,
  };
}

// ---- validation ----------------------------------------------------------------------

const num = (v, lo, hi, d = 0) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');

export function sanitizeLook(look) {
  if (!look || typeof look !== 'object') return null;
  return Object.fromEntries(LOOK_KEYS.map((k) => [k, Math.round(num(look[k], k === 'exposure' ? -5 : -100, k === 'exposure' ? 5 : 100) * 100) / 100]));
}
// A preset may set only some of the sliders.
function sanitizePartialLook(look) {
  const out = {};
  for (const k of LOOK_KEYS) if (look && Number.isFinite(Number(look[k]))) out[k] = Math.round(num(look[k], k === 'exposure' ? -5 : -100, k === 'exposure' ? 5 : 100) * 100) / 100;
  return out;
}
function sanitizeCrop(c) {
  if (!c || typeof c !== 'object') return null;
  const crop = { x: num(c.x, 0, 1), y: num(c.y, 0, 1), w: num(c.w, 0, 1), h: num(c.h, 0, 1), ratio: str(c.ratio, 10) || 'free', angle: Math.round(num(c.angle, -45, 45) * 100) / 100 };
  if (crop.w < 0.01 || crop.h < 0.01) return null;
  crop.w = Math.min(crop.w, 1 - crop.x);
  crop.h = Math.min(crop.h, 1 - crop.y);
  return crop;
}
function sanitizeUserFields(set) {
  const out = {};
  if (set.flag !== undefined) out.flag = [1, -1, 0].includes(set.flag) ? set.flag : 0;
  if (set.stars !== undefined) out.stars = Math.round(num(set.stars, 0, 5));
  if (set.players !== undefined) out.players = str(set.players, 200);
  if (set.caption !== undefined) out.caption = set.caption ? str(set.caption, 2000) : null;
  if (set.look !== undefined) out.look = sanitizeLook(set.look);
  if (set.crop !== undefined) out.crop = sanitizeCrop(set.crop);
  return out;
}
const pick = (obj, defaults) => Object.fromEntries(Object.keys(defaults).filter((k) => obj && k in obj).map((k) => [k, typeof defaults[k] === 'number' ? Number(obj[k]) || 0 : typeof defaults[k] === 'boolean' ? Boolean(obj[k]) : str(obj[k], 300)]));

// Frames come from the browser's card scan: keep only the fields RinkSide uses.
function sanitizeFrame(f) {
  if (!f || typeof f.id !== 'string' || !/^[A-Za-z0-9-]{6,40}$/.test(f.id)) return null;
  const file = (x) =>
    x && {
      rel: str(x.rel, 500),
      size: num(x.size, 0, 1e12),
      mtime: num(x.mtime, 0, 1e14),
      ...(x.pv && { pv: x.pv }),
      ...(x.sm && { sm: x.sm }),
      ...(x.rgb && { rgb: x.rgb }),
    };
  return {
    id: f.id,
    src: str(f.src, 40),
    cam: str(f.cam, 200),
    name: str(f.name, 200),
    t: num(f.t, -1e14, 1e14),
    tz: f.tz ? str(f.tz, 10) : undefined,
    w: num(f.w, 1, 1e6, 3),
    h: num(f.h, 1, 1e6, 2),
    o: Math.round(num(f.o, 1, 8, 1)),
    ex: f.ex && typeof f.ex === 'object' ? Object.fromEntries(Object.entries(f.ex).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, typeof v === 'number' ? v : str(String(v), 200)])) : {},
    ...(f.jpg && { jpg: file(f.jpg) }),
    ...(f.nef && { nef: file(f.nef) }),
    ...(f.asset && { asset: { id: str(f.asset.id, 40), mime: str(f.asset.mime, 100), file: str(f.asset.file, 300) } }),
    flag: 0,
    stars: 0,
    players: '',
    caption: null,
    look: null,
    crop: null,
    ...sanitizeUserFields(f),
  };
}

function newSession(user, body) {
  const settings = load(path.join(userDir(user), 'settings.json'), {});
  const remembered = Object.fromEntries(REMEMBERED.map((k) => [k, settings.lastGame?.[k] ?? '']));
  return {
    id: crypto.randomBytes(6).toString('hex'),
    v: 1,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    name: str(body.name, 200),
    mode: body.mode === 'immich' ? 'immich' : 'card',
    immichAlbum: body.immichAlbum ? { id: str(body.immichAlbum.id, 40), name: str(body.immichAlbum.name, 300) } : undefined,
    sources: [],
    cameras: {},
    game: { home: '', away: '', ...remembered, ...pickGame(body.game) },
    look: sanitizeLook({}),
    frames: [],
    export: { ...EXPORT_DEFAULTS },
    sync: { options: { ...SYNC_DEFAULTS, ...(body.mode === 'immich' && { album: false }) }, assets: {}, applied: {}, sums: {}, inAlbum: [] },
  };
}
const pickGame = (g) => Object.fromEntries(GAME_FIELDS.filter((k) => typeof g?.[k] === 'string').map((k) => [k, g[k].slice(0, 4000)]));

// Merge newly scanned frames: user fields of known frames are kept.
function mergeFrames(sess, frames) {
  const byId = new Map(sess.frames.map((f) => [f.id, f]));
  for (const raw of frames || []) {
    const f = sanitizeFrame(raw);
    if (!f) continue;
    const old = byId.get(f.id);
    if (old) for (const k of ['flag', 'stars', 'players', 'caption', 'look', 'crop']) f[k] = old[k];
    byId.set(f.id, f);
  }
  sess.frames = [...byId.values()];
}

function applySync(sess, sync) {
  if (!sync || typeof sync !== 'object') return;
  const s = sess.sync;
  if (sync.options) s.options = { ...SYNC_DEFAULTS, ...s.options, ...pick(sync.options, SYNC_DEFAULTS) };
  // Progress written by the browser during a sync: which files are in Immich and what was set there.
  for (const k of ['assets', 'applied', 'sums', 'exports']) if (sync[k] && typeof sync[k] === 'object') s[k] = { ...s[k], ...sync[k] };
  if (Array.isArray(sync.inAlbum)) s.inAlbum = [...new Set([...(s.inAlbum || []), ...sync.inAlbum.map(String)])];
  for (const k of ['albumId', 'albumName', 'last']) if (typeof sync[k] === 'string') s[k] = sync[k].slice(0, 300);
}

// ---- Immich pass-through ----------------------------------------------------------------

// Only what RinkSide needs, with the user's Immich login added server-side.
const ALLOWED = [
  ['GET', /^\/server\/ping$/],
  ['GET', /^\/users\/me$/],
  ['GET', /^\/albums$/],
  ['POST', /^\/albums$/],
  ['PUT', /^\/albums\/[0-9a-f-]{36}\/assets$/],
  ['POST', /^\/search\/metadata$/],
  ['POST', /^\/assets\/bulk-upload-check$/],
  ['POST', /^\/assets$/],
  ['PUT', /^\/assets$/],
  ['PUT', /^\/assets\/[0-9a-f-]{36}$/],
  ['GET', /^\/assets\/[0-9a-f-]{36}\/(thumbnail|original)$/],
  ['PUT', /^\/tags$/],
  ['PUT', /^\/tags\/[0-9a-f-]{36}\/assets$/],
  ['DELETE', /^\/tags\/[0-9a-f-]{36}\/assets$/],
  ['POST', /^\/stacks$/],
  ['GET', /^\/faces$/],
  ['GET', /^\/people\/[0-9a-f-]{36}\/thumbnail$/],
  ['PUT', /^\/people\/[0-9a-f-]{36}$/],
];
const target = new URL(config.immichUrl);
const lib = target.protocol === 'https:' ? https : http;
const prefix = target.pathname.replace(/\/+$/, '');

function passThrough(req, res, apiPath, search, auth) {
  if (!ALLOWED.some(([m, re]) => m === req.method && re.test(apiPath))) throw new HttpError(404, 'Ei käytettävissä');
  const headers = { ...auth.headers };
  for (const h of ['content-type', 'content-length', 'accept', 'range', 'x-immich-checksum']) if (req.headers[h]) headers[h] = req.headers[h];
  const upstream = lib.request(
    { protocol: target.protocol, hostname: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80), method: req.method, path: `${prefix}/api${apiPath}${search}`, headers },
    (up) => {
      const out = {};
      for (const h of ['content-type', 'content-length', 'content-disposition', 'cache-control', 'etag']) if (up.headers[h]) out[h] = up.headers[h];
      if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location) {
        // fullsize/preview redirects: keep them inside the pass-through.
        const loc = new URL(up.headers.location, config.immichUrl);
        out.location = `/_folio/api/rinkside/immich${loc.pathname.replace(/^.*?\/api/, '')}${loc.search}`;
      }
      res.writeHead(up.statusCode, out);
      up.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    if (!res.headersSent) sendJson(res, 502, { error: `Folio ei saa yhteyttä Immichiin (${err.code || err.message})` });
    else res.destroy();
  });
  res.on('close', () => !res.writableFinished && upstream.destroy());
  req.pipe(upstream);
}

// ---- routes ---------------------------------------------------------------------------------

export async function rinksideApi(req, res, url, p, auth) {
  const { user } = auth;
  const method = req.method;
  let m;

  // Re-exporting a photo moves its earlier RinkSide edit to Immich's trash. Only
  // edits RinkSide itself uploaded can go, and never permanently.
  if (p === '/immich/assets' && method === 'DELETE') {
    const { ids } = await readJson(req);
    const edits = new Set();
    for (const f of listGames(user)) for (const e of Object.values(load(f, null)?.sync?.exports || {})) edits.add(e.id);
    const allowed = (Array.isArray(ids) ? ids : []).filter((id) => edits.has(id));
    if (allowed.length) await immichApi('DELETE', '/assets', { auth, body: { ids: allowed, force: false } });
    return sendJson(res, 200, { trashed: allowed.length });
  }
  if ((m = p.match(/^\/immich(\/.*)$/))) return passThrough(req, res, m[1], url.search, auth);

  const settingsFile = path.join(userDir(user), 'settings.json');
  const rostersFile = path.join(userDir(user), 'rosters.json');

  if (p === '/state' && method === 'GET') {
    const sessions = listGames(user)
      .map((f) => load(f, null))
      .filter(Boolean)
      .map(summary)
      .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
    const settings = load(settingsFile, {});
    return sendJson(res, 200, { user, sessions, teams: Object.keys(load(rostersFile, {})).sort((a, b) => a.localeCompare(b)), settings: { exportFolder: settings.exportFolder || '' }, presets: settings.lookPresets || [] });
  }

  if (p === '/settings' && method === 'PUT') {
    const body = await readJson(req);
    const s = load(settingsFile, {});
    if (typeof body.exportFolder === 'string') s.exportFolder = body.exportFolder.slice(0, 200);
    saveLater(settingsFile, s);
    return sendJson(res, 200, { ok: true });
  }

  // Your own look presets.
  if (p === '/presets' && method === 'PUT') {
    const body = await readJson(req);
    const s = load(settingsFile, {});
    s.lookPresets = (Array.isArray(body.presets) ? body.presets : []).slice(0, 100).map((x) => ({ name: str(x.name, 60) || 'Preset', look: sanitizePartialLook(x.look) })).filter((x) => Object.keys(x.look).length);
    saveLater(settingsFile, s);
    return sendJson(res, 200, { presets: s.lookPresets });
  }

  // Liiga: games by date, lineups, rosters and player photos.
  if (p === '/liiga/games' && method === 'GET') return sendJson(res, 200, { games: await liiga.gamesOn(url.searchParams.get('date') || '') });
  if (p === '/liiga/teams' && method === 'GET') return sendJson(res, 200, { teams: await liiga.teams(Number(url.searchParams.get('season')) || liiga.seasonOf(new Date().toISOString().slice(0, 10))) });
  if ((m = p.match(/^\/liiga\/game\/(\d{4})\/(\d+)$/)) && method === 'GET') return sendJson(res, 200, await liiga.lineup(Number(m[1]), m[2]));
  if (p === '/liiga/roster' && method === 'GET') return sendJson(res, 200, { players: await liiga.roster(Number(url.searchParams.get('season')), url.searchParams.get('team') || '') });
  if (p === '/liiga/photo' && method === 'GET') {
    const buf = await liiga.photo(url.searchParams.get('u') || '');
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length, 'cache-control': 'private, max-age=2592000, immutable' });
    return res.end(buf);
  }

  if ((m = p.match(/^\/rosters\/(.+)$/))) {
    const team = decodeURIComponent(m[1]).trim().slice(0, 100);
    if (!team) throw new HttpError(400, 'Joukkueen nimi puuttuu');
    const all = load(rostersFile, {});
    if (method === 'GET') return sendJson(res, 200, { team, players: all[team] || [] });
    if (method === 'PUT') {
      const { players } = await readJson(req);
      all[team] = (Array.isArray(players) ? players : [])
        .slice(0, 200)
        .map((x) => ({ num: str(String(x.num), 3), name: str(x.name, 100), ...(typeof x.photo === 'string' && /^https?:\/\//.test(x.photo) && { photo: x.photo.slice(0, 500) }), ...(x.pos && { pos: str(x.pos, 10) }) }))
        .filter((x) => x.num && x.name);
      saveLater(rostersFile, all);
      return sendJson(res, 200, { team, players: all[team] });
    }
  }

  if (p === '/sessions' && method === 'POST') {
    const body = await readJson(req, 32 * 1024 * 1024);
    const sess = newSession(user, body);
    sess.sources = (body.sources || []).slice(0, 10).map((s) => ({ id: str(s.id, 10), label: str(s.label, 200) }));
    mergeFrames(sess, body.frames);
    if (body.cameras) for (const [k, c] of Object.entries(body.cameras)) sess.cameras[str(k, 200)] = { label: str(c.label, 40), model: str(c.model, 100), offset: num(c.offset, -172800, 172800) };
    if (body.sync?.assets) applySync(sess, { assets: body.sync.assets, applied: body.sync.applied });
    saveLater(sessionFile(user, sess.id), sess);
    return sendJson(res, 200, { id: sess.id });
  }

  if (!(m = p.match(/^\/s\/([a-f0-9]{12})(\/.*)?$/))) throw new HttpError(404, 'Not found');
  const sess = getSession(user, m[1]);
  const sub = m[2] || '';
  const save = () => {
    sess.updated = new Date().toISOString();
    saveLater(sessionFile(user, sess.id), sess);
  };

  if (sub === '' && method === 'GET') {
    const all = load(rostersFile, {});
    const teams = [sess.game.home, sess.game.away].filter(Boolean);
    return sendJson(res, 200, { ...sess, rosters: Object.fromEntries(teams.map((t) => [t, all[t] || []])) });
  }
  if (sub === '' && method === 'DELETE') {
    pending.delete(sessionFile(user, sess.id));
    fs.rmSync(sessionFile(user, sess.id), { force: true });
    return sendJson(res, 200, { ok: true });
  }
  if (sub === '' && method === 'PATCH') {
    const body = await readJson(req, 4 * 1024 * 1024);
    if (typeof body.name === 'string') sess.name = body.name.slice(0, 200);
    if (body.game) {
      Object.assign(sess.game, pickGame(body.game));
      const s = load(settingsFile, {});
      s.lastGame = Object.fromEntries(REMEMBERED.map((k) => [k, sess.game[k] || '']));
      saveLater(settingsFile, s);
    }
    if (body.look) sess.look = sanitizeLook(body.look);
    if (body.cameras) for (const [k, c] of Object.entries(body.cameras)) if (sess.cameras[k]) {
      if (c.offset !== undefined) sess.cameras[k].offset = Math.round(num(c.offset, -172800, 172800) * 10) / 10;
      if (typeof c.label === 'string' && c.label.trim()) sess.cameras[k].label = c.label.trim().slice(0, 40);
    }
    if (body.export) sess.export = { ...EXPORT_DEFAULTS, ...sess.export, ...pick(body.export, EXPORT_DEFAULTS) };
    applySync(sess, body.sync);
    save();
    return sendJson(res, 200, { ok: true });
  }
  if (sub === '/frames' && method === 'PATCH') {
    const { ids = [], set = {} } = await readJson(req, 4 * 1024 * 1024);
    const clean = sanitizeUserFields(set);
    const want = new Set(ids);
    let n = 0;
    for (const f of sess.frames) if (want.has(f.id)) {
      Object.assign(f, clean);
      n++;
    }
    save();
    return sendJson(res, 200, { updated: n });
  }
  // A card was added or rescanned in the browser.
  if (sub === '/frames' && method === 'POST') {
    const body = await readJson(req, 32 * 1024 * 1024);
    for (const s of body.sources || []) if (!sess.sources.some((x) => x.id === s.id)) sess.sources.push({ id: str(s.id, 10), label: str(s.label, 200) });
    mergeFrames(sess, body.frames);
    for (const [k, c] of Object.entries(body.cameras || {})) sess.cameras[k] ??= { label: str(c.label, 40), model: str(c.model, 100), offset: 0 };
    save();
    return sendJson(res, 200, { count: sess.frames.length });
  }

  throw new HttpError(404, 'Not found');
}
