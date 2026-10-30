// RinkSide's data and Immich side: games are stored by Folio (per Immich user),
// and Immich is reached through Folio with your own Immich login. Sync runs here
// in the browser, uploading straight from the card.
import { gameTitle, parsePlayers } from './caption.js';
import { frameMeta, sha1Hex, xmpPacket } from './media.js';

const BASE = '/_folio/api/rinkside';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'x-folio': '1', ...(body !== undefined && { 'content-type': 'application/json' }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Your last changes may not be saved; check the connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `${res.status} ${res.statusText}`);
  return data;
}

// ---- Immich, through Folio ----------------------------------------------------------------
export const immichUrl = (path) => `${BASE}/immich${path}`;

export async function immich(method, path, { body, form, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(immichUrl(path), {
      method,
      headers: { 'x-folio': '1', accept: 'application/json', ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, "Can't reach Immich. Your work is saved; try again when the connection is back.");
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = [].concat(data?.message || data?.error || `${res.status} ${res.statusText}`).join(', ');
    throw new ApiError(res.status, res.status === 401 ? 'Sign in to Immich again (your session ended).' : msg);
  }
  return data;
}

export async function albumAssets(albumId) {
  const out = [];
  let page = 1;
  while (page) {
    const r = await immich('POST', '/search/metadata', { body: { albumIds: [albumId], size: 1000, page, withExif: true, order: 'asc' } });
    out.push(...r.assets.items);
    page = r.assets.nextPage ? Number(r.assets.nextPage) : 0;
  }
  return out;
}

// A game made from an Immich album: frames point at assets, and the current
// Immich state is recorded so sync only sends what you change.
export function framesFromAssets(assets) {
  const frames = [];
  const assetsMap = {};
  const applied = {};
  for (const a of assets.filter((x) => x.type === 'IMAGE')) {
    const ex = a.exifInfo || {};
    const swap = ['5', '6', '7', '8'].includes(String(ex.orientation));
    const [w, h] = [ex.exifImageWidth || a.width || 3, ex.exifImageHeight || a.height || 2];
    const rating = ex.rating ?? null;
    const archived = a.visibility === 'archive' || a.isArchived === true;
    frames.push({
      id: a.id,
      src: 'immich',
      cam: ex.model || '?',
      name: (a.originalFileName || a.id).replace(/\.[^.]+$/, ''),
      t: Date.parse(a.localDateTime) || Date.parse(a.fileCreatedAt),
      w: swap ? h : w,
      h: swap ? w : h,
      o: 1,
      asset: { id: a.id, mime: a.originalMimeType || '', file: a.originalFileName || '' },
      ex: { make: ex.make, model: ex.model, lens: ex.lensModel, exposure: ex.exposureTime, fnumber: ex.fNumber, iso: ex.iso, focal: ex.focalLength },
      flag: a.isFavorite ? 1 : rating === -1 || archived ? -1 : 0,
      stars: rating > 0 ? rating : 0,
      caption: ex.description || null,
    });
    assetsMap[a.id] = { asset: a.id };
    applied[a.id] = { description: ex.description || '', rating, isFavorite: Boolean(a.isFavorite), archived, tags: [] };
  }
  return { frames, assets: assetsMap, applied };
}

// ---- sync --------------------------------------------------------------------------------------
export const PICK_TAG = 'RinkSide/Pick';
export const REJECT_TAG = 'RinkSide/Reject';
const inScope = (f, scope) => (scope === 'all' ? true : scope === 'kept' ? f.flag !== -1 : f.flag === 1);
const isoWithZone = (t, tz) => `${new Date(t).toISOString().slice(0, 19)}${/^[+-]\d\d:\d\d$/.test(tz || '') ? tz : 'Z'}`;

// Make Immich match RinkSide. `fileFor(frame, kind)` gives the card File.
// `status` is updated as it goes; progress is saved after every upload, so a
// sync that stops halfway simply continues next time.
export async function runSync(sess, rosters, fileFor, status) {
  const opts = sess.sync.options;
  const sync = sess.sync;
  sync.assets ||= {};
  sync.applied ||= {};
  sync.sums ||= {};
  sync.inAlbum ||= [];
  const step = (name, total = 0) => Object.assign(status, { step: name, done: 0, total });
  const saveProgress = (extra = {}) => api('PATCH', `/s/${sess.id}`, { sync: { assets: sync.assets, applied: sync.applied, sums: sync.sums, ...extra } });
  const frameById = new Map(sess.frames.map((f) => [f.id, f]));

  step('Connecting to Immich');
  await immich('GET', '/server/ping');

  if (sess.mode !== 'immich') {
    const files = [];
    for (const f of sess.frames) {
      if (!inScope(f, opts.scope)) continue;
      const kinds = f.jpg ? (opts.includeRaw && f.nef ? ['jpg', 'nef'] : ['jpg']) : ['nef'];
      for (const kind of kinds) if (!sync.assets[f.id]?.[kind]) files.push({ frame: f, kind, info: f[kind] });
    }
    if (files.length) {
      step('Checking what Immich already has', files.length);
      for (const it of files) {
        const key = `${it.frame.src}|${it.info.rel}|${it.info.size}|${it.info.mtime}`;
        try {
          it.file = await fileFor(it.frame, it.kind);
          sync.sums[key] ??= await sha1Hex(it.file);
          it.sum = sync.sums[key];
        } catch (err) {
          status.errors.push(`${it.info.rel}: ${err.message}`);
        }
        status.done++;
      }
      const ready = files.filter((it) => it.sum);
      const results = [];
      for (let i = 0; i < ready.length; i += 500) {
        const r = await immich('POST', '/assets/bulk-upload-check', { body: { assets: ready.slice(i, i + 500).map((it, k) => ({ id: String(i + k), checksum: it.sum })) } });
        results.push(...r.results);
      }
      const toUpload = [];
      for (const r of results) {
        const it = ready[Number(r.id)];
        if (r.action === 'reject' && r.assetId) {
          (sync.assets[it.frame.id] ??= {})[it.kind] = r.assetId;
          status.summary.alreadyThere++;
        } else if (r.action === 'reject') status.errors.push(`${it.info.rel}: Immich refused it (${r.reason})`);
        else toUpload.push(it);
      }
      await saveProgress();

      step('Uploading', toUpload.length);
      for (const it of toUpload) {
        status.current = it.file.name;
        try {
          const form = new FormData();
          form.set('fileCreatedAt', isoWithZone(it.frame.t, it.frame.tz));
          form.set('fileModifiedAt', new Date(it.info.mtime || Date.now()).toISOString());
          form.set('filename', it.file.name);
          form.set('assetData', it.file, it.file.name);
          form.set('sidecarData', new Blob([xmpPacket(frameMeta(sess, it.frame, rosters), { sidecar: true })], { type: 'application/xml' }), `${it.file.name}.xmp`);
          const res = await immich('POST', '/assets', { form, headers: { 'x-immich-checksum': it.sum } });
          (sync.assets[it.frame.id] ??= {})[it.kind] = res.id;
          if (res.status === 'duplicate') status.summary.alreadyThere++;
          else status.summary.uploaded++;
          // Save just this photo's progress (keeps each request small).
          await api('PATCH', `/s/${sess.id}`, { sync: { assets: { [it.frame.id]: sync.assets[it.frame.id] } } });
        } catch (err) {
          if (err.status === 0) throw err;
          status.errors.push(`${it.info.rel}: ${err.message}`);
        }
        status.done++;
      }
      status.current = '';

      // RAW+JPG pairs become one stack, JPG on top.
      for (const [fid, a] of Object.entries(sync.assets)) {
        if (a.jpg && a.nef && !a.stacked) {
          try {
            await immich('POST', '/stacks', { body: { assetIds: [a.jpg, a.nef] } });
          } catch (err) {
            status.errors.push(`Stack for ${frameById.get(fid)?.name}: ${err.message}`);
          }
          a.stacked = true;
        }
      }
      await saveProgress();
    }
  }

  // Make every synced asset match: description, rating, favorite, archive, tags.
  const wanted = new Map();
  for (const [fid, a] of Object.entries(sync.assets)) {
    const f = frameById.get(fid);
    if (!f) continue;
    const meta = frameMeta(sess, f, rosters);
    const tags = [...(opts.tags ? meta.tags : []), ...(opts.pickTag && f.flag === 1 ? [PICK_TAG] : []), ...(opts.rejects === 'tag' && f.flag === -1 ? [REJECT_TAG] : [])];
    for (const id of [a.jpg, a.nef, a.asset].filter(Boolean)) {
      wanted.set(id, {
        description: opts.caption ? meta.caption : undefined,
        rating: opts.rating ? (f.flag === -1 ? -1 : f.stars || null) : undefined,
        isFavorite: opts.favorite ? f.flag === 1 : undefined,
        archived: opts.rejects === 'archive' ? f.flag === -1 : undefined,
        tags,
        frame: f,
      });
    }
  }

  step('Updating captions and ratings', wanted.size);
  for (const [id, w] of wanted) {
    const was = sync.applied[id] || {};
    const dto = {};
    if (w.description !== undefined && w.description !== (was.description ?? '')) dto.description = w.description;
    if (w.rating !== undefined && w.rating !== (was.rating ?? null)) dto.rating = w.rating;
    if (Object.keys(dto).length) {
      try {
        await immich('PUT', `/assets/${id}`, { body: dto });
        sync.applied[id] = { ...was, ...dto };
        status.summary.updated++;
      } catch (err) {
        if (err.status === 0) throw err;
        status.errors.push(`${w.frame.name}: ${err.message}`);
      }
    }
    status.done++;
  }
  await saveProgress();

  step('Favorites and archive');
  for (const [field, dto] of [
    ['isFavorite', (v) => ({ isFavorite: v })],
    ['archived', (v) => ({ visibility: v ? 'archive' : 'timeline' })],
  ]) {
    for (const value of [true, false]) {
      const ids = [...wanted].filter(([id, w]) => w[field] === value && (sync.applied[id]?.[field] ?? false) !== value).map(([id]) => id);
      if (!ids.length) continue;
      await immich('PUT', '/assets', { body: { ids, ...dto(value) } });
      for (const id of ids) sync.applied[id] = { ...sync.applied[id], [field]: value };
    }
  }

  step('Tags');
  const names = [...new Set([...[...wanted.values()].flatMap((w) => w.tags), ...Object.values(sync.applied).flatMap((a) => a.tags || [])])];
  const tagIds = new Map();
  if (names.length) for (const t of await immich('PUT', '/tags', { body: { tags: names } })) tagIds.set(t.value, t.id);
  for (const name of names) {
    const id = tagIds.get(name);
    if (!id) continue;
    const add = [...wanted].filter(([aid, w]) => w.tags.includes(name) && !(sync.applied[aid]?.tags || []).includes(name)).map(([aid]) => aid);
    const remove = [...wanted].filter(([aid, w]) => !w.tags.includes(name) && (sync.applied[aid]?.tags || []).includes(name)).map(([aid]) => aid);
    if (add.length) await immich('PUT', `/tags/${id}/assets`, { body: { ids: add } });
    if (remove.length) await immich('DELETE', `/tags/${id}/assets`, { body: { ids: remove } });
  }
  for (const [aid, w] of wanted) sync.applied[aid] = { ...sync.applied[aid], tags: w.tags };
  await saveProgress();

  // One album per game (not for games opened from an Immich album).
  const extra = {};
  if (opts.album && sess.mode !== 'immich') {
    step('Album');
    const name = opts.albumName || gameTitle(sess.game, sess.frames[0]?.t);
    const ids = [...wanted].filter(([id, w]) => w.frame.flag !== -1 && !sync.inAlbum.includes(id)).map(([id]) => id);
    if (ids.length) {
      const albums = await immich('GET', '/albums');
      let album = (sync.albumId && albums.find((a) => a.id === sync.albumId)) || albums.find((a) => a.albumName === name);
      if (album) await immich('PUT', `/albums/${album.id}/assets`, { body: { ids } });
      else album = await immich('POST', '/albums', { body: { albumName: name, assetIds: ids } });
      Object.assign(extra, { albumId: album.id, albumName: album.albumName || name, inAlbum: ids });
      sync.albumId = extra.albumId;
      sync.albumName = extra.albumName;
      sync.inAlbum.push(...ids);
    }
  }
  sync.last = new Date().toISOString();
  await saveProgress({ ...extra, last: sync.last });
}

// ---- export to Immich: the edited JPEGs ------------------------------------------------------------
export const EDIT_TAG = 'RinkSide/Edit';

// What decides the pixels of an edit; if it hasn't changed, the photo isn't uploaded again.
export function editSignature(f, look, options) {
  const src = f.jpg || f.nef || f.asset || {};
  return JSON.stringify([src.rel || src.id, src.size || 0, look || null, f.crop || null, options.longEdge, options.quality]);
}

async function albumFor(ctx) {
  if (ctx.albumId) return ctx.albumId;
  const albums = await immich('GET', '/albums');
  const album = albums.find((a) => a.albumName === ctx.albumName) || (await immich('POST', '/albums', { body: { albumName: ctx.albumName, assetIds: [] } }));
  ctx.albumId = album.id;
  return album.id;
}

async function tagIds(ctx, names) {
  const missing = names.filter((n) => !ctx.tags.has(n));
  if (missing.length) for (const t of await immich('PUT', '/tags', { body: { tags: missing } })) ctx.tags.set(t.value, t.id);
  return names.map((n) => ctx.tags.get(n)).filter(Boolean);
}

// Upload (or keep) one edited photo and make its caption, rating, tags, album
// and stack match. `render()` is only called when the pixels changed.
// ctx: { albumName, stack, tags: Map }. Returns 'uploaded' | 'unchanged'.
export async function exportEdit(ctx, sess, f, rosters, { sig, name, render }) {
  const sync = sess.sync;
  sync.exports ||= {};
  sync.applied ||= {};
  const prev = sync.exports[f.id];
  const meta = frameMeta(sess, f, rosters);
  let id = prev?.id;
  let result = 'unchanged';
  if (!prev || prev.sig !== sig) {
    const bytes = await render();
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const sum = await sha1Hex(blob);
    const form = new FormData();
    form.set('fileCreatedAt', isoWithZone(f.t, f.tz));
    form.set('fileModifiedAt', new Date().toISOString());
    form.set('filename', name);
    form.set('assetData', blob, name);
    form.set('sidecarData', new Blob([xmpPacket(meta, { sidecar: true })], { type: 'application/xml' }), `${name}.xmp`);
    id = (await immich('POST', '/assets', { form, headers: { 'x-immich-checksum': sum } })).id;
    // The earlier edit of this photo goes to Immich's trash (restorable there).
    if (prev?.id && prev.id !== id) await immich('DELETE', '/assets', { body: { ids: [prev.id], force: false } }).catch(() => {});
    sync.exports[f.id] = { id, sig, stacked: false };
    delete sync.applied[prev?.id];
    result = 'uploaded';
  }

  // Caption, rating, favorite and tags, only what differs from last time.
  const was = sync.applied[id] || {};
  const dto = {};
  if (meta.caption !== (was.description ?? '')) dto.description = meta.caption;
  const rating = f.stars || null;
  if (rating !== (was.rating ?? null)) dto.rating = rating;
  if (Object.keys(dto).length) await immich('PUT', `/assets/${id}`, { body: dto });
  if (f.flag === 1 && !was.isFavorite) await immich('PUT', '/assets', { body: { ids: [id], isFavorite: true } });
  const tags = [...meta.tags, EDIT_TAG];
  const oldTags = was.tags || [];
  const ids = await tagIds(ctx, [...new Set([...tags, ...oldTags])]);
  const byName = new Map([...ctx.tags].filter(([, v]) => ids.includes(v)));
  for (const t of tags.filter((x) => !oldTags.includes(x))) await immich('PUT', `/tags/${byName.get(t)}/assets`, { body: { ids: [id] } });
  for (const t of oldTags.filter((x) => !tags.includes(x))) if (byName.get(t)) await immich('DELETE', `/tags/${byName.get(t)}/assets`, { body: { ids: [id] } });
  sync.applied[id] = { ...was, ...('description' in dto && { description: dto.description }), ...('rating' in dto && { rating }), isFavorite: was.isFavorite || f.flag === 1, tags };

  if (result === 'uploaded') {
    await immich('PUT', `/albums/${await albumFor(ctx)}/assets`, { body: { ids: [id] } });
    // On top of the synced original (and its NEF), so Immich shows the edit first.
    const orig = sync.assets?.[f.id];
    const under = orig ? [orig.jpg, orig.nef, orig.asset].filter(Boolean) : [];
    if (ctx.stack && under.length) {
      await immich('POST', '/stacks', { body: { assetIds: [id, ...under] } });
      sync.exports[f.id].stacked = true;
    }
  }
  await api('PATCH', `/s/${sess.id}`, { sync: { exports: { [f.id]: sync.exports[f.id] }, applied: { [id]: sync.applied[id] } } });
  return result;
}

// ---- Immich People: suggest names from captioned photos ---------------------------------------------
export async function suggestPeople(sess, rosters, { limit = 400 } = {}) {
  const byPerson = new Map();
  let checked = 0;
  for (const f of sess.frames) {
    if (checked >= limit) break;
    const a = sess.sync?.assets?.[f.id];
    const assetId = a?.jpg || a?.asset || a?.nef;
    const players = parsePlayers(f.players, sess.game, rosters).filter((p) => p.known);
    if (!assetId || !players.length) continue;
    checked++;
    let faces = [];
    try {
      faces = await immich('GET', `/faces?id=${assetId}`);
    } catch (err) {
      if (err.status === 0) throw err;
      continue;
    }
    const people = [...new Map(faces.filter((x) => x.person).map((x) => [x.person.id, x.person])).values()];
    for (const person of people) {
      const e = byPerson.get(person.id) || { personId: person.id, currentName: person.name || '', photos: 0, votes: new Map() };
      e.photos++;
      // One player and one face counts more than a crowded photo.
      const weight = 1 / (players.length * people.length);
      for (const p of players) e.votes.set(p.name, (e.votes.get(p.name) || 0) + weight);
      byPerson.set(person.id, e);
    }
  }
  const out = [];
  for (const e of byPerson.values()) {
    const total = [...e.votes.values()].reduce((s, v) => s + v, 0);
    const [name, score] = [...e.votes].sort((a, b) => b[1] - a[1])[0] || [];
    if (!name || e.photos < 2) continue;
    const confidence = score / total;
    if (confidence < 0.5 || e.currentName === name) continue;
    out.push({ personId: e.personId, currentName: e.currentName, suggestion: name, photos: e.photos, confidence: Math.round(confidence * 100) / 100 });
  }
  return { checked, suggestions: out.sort((a, b) => b.confidence - a.confidence || b.photos - a.photos) };
}
