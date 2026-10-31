// A small fake Immich (v3 API subset) for testing RinkSide's "Sync to Immich"
// and "Open an Immich album" without a real server. Validates requests the way
// Immich's DTOs do for the fields RinkSide uses.
//   node dev/rinkside/mock-immich-v3.mjs [port]   API key or session cookie: test-key
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || 2390;
const KEY = 'test-key';
const uuid = () => crypto.randomUUID();
const sampleJpeg = () => {
  const f = path.join(here, 'samples', 'Z50II', 'DCIM', '100NZ50_', 'DSC_0006.JPG');
  return fs.existsSync(f) ? fs.readFileSync(f) : Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
};

const db = { assets: new Map(), albums: new Map(), tags: new Map(), stacks: [], people: new Map(), log: [], auth: { apiKey: 0, cookie: 0 } };

// An existing album, for "Open an Immich album".
const old = { id: uuid(), albumName: '2026-10-01 SaiPa vs Kärpät', assets: [] };
for (let i = 0; i < 3; i++) {
  const id = uuid();
  db.assets.set(id, {
    id,
    originalFileName: `DSC_09${i}0.JPG`,
    originalMimeType: 'image/jpeg',
    type: 'IMAGE',
    checksum: crypto.createHash('sha1').update(`old-${i}`).digest('base64'),
    localDateTime: `2026-10-01T18:3${i}:00.000Z`,
    fileCreatedAt: `2026-10-01T15:3${i}:00.000Z`,
    isFavorite: i === 0,
    visibility: 'timeline',
    description: i === 1 ? 'Old caption' : '',
    rating: i === 2 ? 4 : null,
    tags: new Set(),
    exifInfo: { make: 'NIKON CORPORATION', model: 'NIKON Z50_2', exifImageWidth: 5568, exifImageHeight: 3712, orientation: '1', exposureTime: '1/1000', fNumber: 2.8, iso: 3200, focalLength: 200, lensModel: 'NIKKOR Z DX 50-250mm' },
  });
  old.assets.push(id);
}
db.albums.set(old.id, old);
const person = { id: uuid(), name: '' };
db.people.set(person.id, person);

function send(res, status, data, type = 'application/json') {
  res.writeHead(status, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}
const bad = (res, msg) => send(res, 400, { message: msg, statusCode: 400 });
const body = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
const json = async (req) => JSON.parse((await body(req)).toString() || '{}');

const assetDto = (a) => ({
  id: a.id,
  type: a.type,
  originalFileName: a.originalFileName,
  originalMimeType: a.originalMimeType,
  localDateTime: a.localDateTime,
  fileCreatedAt: a.fileCreatedAt,
  isFavorite: a.isFavorite,
  visibility: a.visibility,
  isTrashed: Boolean(a.isTrashed),
  checksum: a.checksum,
  exifInfo: { ...a.exifInfo, description: a.description, rating: a.rating },
  tags: [...a.tags].map((id) => db.tags.get(id)),
});

const validRating = (r) => r === null || r === -1 || (Number.isInteger(r) && r >= 1 && r <= 5);
const fromChecksum = (c) => Buffer.from(c, c.length === 28 ? 'base64' : 'hex').toString('base64');

function upsertTag(value) {
  let parentId = null;
  let tag;
  const parts = value.split('/');
  for (let i = 0; i < parts.length; i++) {
    const full = parts.slice(0, i + 1).join('/');
    tag = [...db.tags.values()].find((t) => t.value === full);
    if (!tag) {
      tag = { id: uuid(), name: parts[i], value: full, parentId };
      db.tags.set(tag.id, tag);
    }
    parentId = tag.id;
  }
  return tag;
}

const LIIGA_GAME = {
  id: 2709999,
  season: 2027,
  start: '2026-10-29T16:30:00Z',
  ended: true,
  homeTeam: { teamName: 'HIFK', gameStartDateTime: '2026-10-29T18:30:00+02:00', logos: { darkBg: null } },
  awayTeam: { teamName: 'Tappara', gameStartDateTime: '2026-10-29T18:30:00+02:00', logos: { darkBg: null } },
  iceRink: { name: 'Helsinki Ice Hall I', city: 'HELSINKI' },
};
const OTHER_GAME = { ...LIIGA_GAME, id: 2709998, homeTeam: { ...LIIGA_GAME.homeTeam, teamName: 'Kärpät' }, awayTeam: { ...LIIGA_GAME.awayTeam, teamName: 'Lukko' }, iceRink: { name: 'Oulun Energia Areena', city: 'OULU' } };
const liigaPlayer = (team, jersey, first, last, role, extra = {}) => ({ teamName: team, jersey, firstName: first, lastName: last, roleCode: role, pictureUrl: `http://localhost:${PORT}/liiga-photos/${jersey}.png`, removed: false, ...extra });
const HOME_LINEUP = [liigaPlayer('HIFK', 23, 'Matti', 'Virtanen', 'KH'), liigaPlayer('HIFK', 7, 'Aku', 'Ankka', 'OP'), liigaPlayer('HIFK', 31, 'Kalle', 'Kiekko', 'MV'), liigaPlayer('HIFK', 10, 'Teemu', 'Testi', 'VL'), liigaPlayer('HIFK', 99, 'Not', 'Dressed', 'VL', { removed: true })];
const AWAY_LINEUP = [liigaPlayer('Tappara', 12, 'Joni', 'Ikonen', 'KH'), liigaPlayer('Tappara', 4, 'Ville', 'Varis', 'VP'), liigaPlayer('Tappara', 88, 'Pekka', 'Puck', 'OL')];
function liiga(req, res, url) {
  db.log.push(`LIIGA ${url.pathname}${url.search}`);
  const p = url.pathname.replace('/liiga/api/v2', '');
  if (p === '/games') return send(res, 200, url.searchParams.get('tournament') === 'runkosarja' && url.searchParams.get('season') === '2027' ? [LIIGA_GAME, OTHER_GAME] : []);
  if (p === `/games/2027/${LIIGA_GAME.id}`) return send(res, 200, { game: LIIGA_GAME, homeTeamPlayers: HOME_LINEUP, awayTeamPlayers: AWAY_LINEUP });
  if (p === '/players/stats/summed/2027/2027/runkosarja/true') return send(res, 200, [...HOME_LINEUP, ...AWAY_LINEUP, liigaPlayer('Kärpät', 5, 'Oskari', 'Oulu', 'OP')]);
  return send(res, 404, { message: 'no such Liiga path' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let m;
  if ((m = p.match(/^\/__asset\/(.+)$/))) {
    const a = db.assets.get(m[1]);
    return a?.bytes ? send(res, 200, a.bytes, 'image/jpeg') : send(res, 404, { message: 'no bytes' });
  }
  if (p === '/__state') {
    return send(res, 200, {
      assets: [...db.assets.values()].map((a) => ({ ...assetDto(a), description: a.description, rating: a.rating, sidecar: a.sidecar || null, tags: [...a.tags].map((id) => db.tags.get(id).value) })),
      albums: [...db.albums.values()],
      tags: [...db.tags.values()],
      stacks: db.stacks,
      people: [...db.people.values()],
      log: db.log,
      auth: db.auth,
    });
  }
  // A tiny liiga.fi: one game day with lineups and player photos.
  if (p.startsWith('/liiga/')) return liiga(req, res, url);
  if ((m = p.match(/^\/liiga-photos\/(\d+)\.png$/))) return send(res, 200, sampleJpeg(), 'image/png');
  if (!p.startsWith('/api/')) return send(res, 404, { message: 'Not found' });
  const cookie = /(?:^|;\s*)immich_access_token=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (req.headers['x-api-key'] !== KEY && cookie !== KEY) return send(res, 401, { message: 'Invalid user token' });
  db.auth[req.headers['x-api-key'] === KEY ? 'apiKey' : 'cookie']++;
  db.log.push(`${req.method} ${p}`);

  if (p === '/api/server/ping') return send(res, 200, { res: 'pong' });
  if (p === '/api/users/me') return send(res, 200, { id: '0f1e2d3c-0000-4000-8000-000000000001', name: 'Test Photographer', email: 'test@example.com', isAdmin: true });

  if (p === '/api/albums' && req.method === 'GET') return send(res, 200, [...db.albums.values()].map((a) => ({ id: a.id, albumName: a.albumName, assetCount: a.assets.length, startDate: '2026-10-01T18:30:00.000Z' })));
  if (p === '/api/albums' && req.method === 'POST') {
    const b = await json(req);
    if (!b.albumName) return bad(res, 'albumName should not be empty');
    const album = { id: uuid(), albumName: b.albumName, assets: [...new Set(b.assetIds || [])] };
    db.albums.set(album.id, album);
    return send(res, 201, { id: album.id, albumName: album.albumName, assetCount: album.assets.length });
  }
  if ((m = p.match(/^\/api\/albums\/([^/]+)\/assets$/)) && req.method === 'PUT') {
    const album = db.albums.get(m[1]);
    if (!album) return bad(res, 'Album not found');
    const { ids } = await json(req);
    return send(res, 200, ids.map((id) => (album.assets.includes(id) ? { id, success: false, error: 'duplicate' } : (album.assets.push(id), { id, success: true }))));
  }

  if (p === '/api/search/metadata' && req.method === 'POST') {
    const b = await json(req);
    let items = [...db.assets.values()];
    if (b.albumIds?.length) items = items.filter((a) => b.albumIds.every((id) => db.albums.get(id)?.assets.includes(a.id)));
    const size = Math.min(1000, b.size || 250);
    const page = b.page || 1;
    const slice = items.slice((page - 1) * size, page * size);
    return send(res, 200, { albums: { items: [] }, assets: { items: slice.map(assetDto), total: items.length, count: slice.length, nextPage: page * size < items.length ? String(page + 1) : null } });
  }

  if (p === '/api/assets/bulk-upload-check' && req.method === 'POST') {
    const { assets } = await json(req);
    return send(res, 200, {
      results: assets.map(({ id, checksum }) => {
        const hit = [...db.assets.values()].find((a) => a.checksum === fromChecksum(checksum));
        return hit ? { id, action: 'reject', reason: 'duplicate', assetId: hit.id, isTrashed: false } : { id, action: 'accept' };
      }),
    });
  }

  if (p === '/api/assets' && req.method === 'POST') {
    const raw = await body(req);
    const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: raw }).formData();
    const allowed = new Set(['assetData', 'fileCreatedAt', 'fileModifiedAt', 'filename', 'duration', 'isFavorite', 'visibility', 'livePhotoVideoId', 'metadata', 'sidecarData']);
    for (const k of form.keys()) if (!allowed.has(k)) return bad(res, `property ${k} should not exist`);
    const file = form.get('assetData');
    if (!file || !form.get('fileCreatedAt') || !form.get('fileModifiedAt')) return bad(res, 'assetData, fileCreatedAt and fileModifiedAt are required');
    if (Number.isNaN(Date.parse(form.get('fileCreatedAt')))) return bad(res, 'fileCreatedAt must be a Date instance');
    // Like Immich's canUploadFile: each file is checked against body.filename if given, else its own name.
    for (const [field, test] of [['assetData', /\.(jpe?g|nef|nrw|heic|png|tiff?|dng|webp)$/i], ['sidecarData', /\.xmp$/i]]) {
      const f = form.get(field);
      const checked = form.get('filename') || f?.name || '';
      if (f && !test.test(checked)) return bad(res, `Unsupported file type ${checked}`);
    }
    const data = Buffer.from(await file.arrayBuffer());
    const checksum = crypto.createHash('sha1').update(data).digest('base64');
    if (req.headers['x-immich-checksum'] && fromChecksum(req.headers['x-immich-checksum']) !== checksum) return bad(res, 'checksum mismatch');
    const dupe = [...db.assets.values()].find((a) => a.checksum === checksum);
    if (dupe) return send(res, 200, { id: dupe.id, status: 'duplicate' });
    const sidecar = form.get('sidecarData');
    const id = uuid();
    const name = form.get('filename') || file.name;
    db.assets.set(id, {
      id,
      originalFileName: name,
      originalMimeType: /\.nef$/i.test(name) ? 'image/x-nikon-nef' : 'image/jpeg',
      type: 'IMAGE',
      checksum,
      size: data.length,
      localDateTime: form.get('fileCreatedAt'),
      fileCreatedAt: form.get('fileCreatedAt'),
      isFavorite: form.get('isFavorite') === 'true',
      visibility: 'timeline',
      description: '',
      rating: null,
      tags: new Set(),
      sidecar: sidecar ? await sidecar.text() : null,
      bytes: data.length < 8e6 ? data : null,
      exifInfo: {},
    });
    return send(res, 201, { id, status: 'created' });
  }

  if (p === '/api/assets' && req.method === 'DELETE') {
    const b = await json(req);
    for (const id of b.ids || []) {
      if (b.force) db.assets.delete(id);
      else if (db.assets.has(id)) db.assets.get(id).isTrashed = true;
    }
    return send(res, 204, '', 'text/plain');
  }
  if (p === '/api/assets' && req.method === 'PUT') {
    const b = await json(req);
    if (!Array.isArray(b.ids)) return bad(res, 'ids must be an array');
    if ('rating' in b && !validRating(b.rating)) return bad(res, 'rating must be -1, 1-5 or null');
    if ('visibility' in b && !['archive', 'timeline', 'hidden', 'locked'].includes(b.visibility)) return bad(res, 'visibility must be one of archive, timeline, hidden, locked');
    for (const id of b.ids) {
      const a = db.assets.get(id);
      if (!a) return bad(res, 'Not found or no asset.update access');
      for (const k of ['isFavorite', 'visibility', 'rating', 'description']) if (k in b) a[k] = b[k];
    }
    return send(res, 204, '', 'text/plain');
  }
  if ((m = p.match(/^\/api\/assets\/([0-9a-f-]{36})$/))) {
    const a = db.assets.get(m[1]);
    if (!a) return bad(res, 'Not found');
    if (req.method === 'GET') return send(res, 200, assetDto(a));
    if (req.method === 'PUT') {
      const b = await json(req);
      if ('rating' in b && !validRating(b.rating)) return bad(res, 'rating must be -1, 1-5 or null');
      for (const k of ['isFavorite', 'visibility', 'rating', 'description']) if (k in b) a[k] = b[k];
      return send(res, 200, assetDto(a));
    }
  }
  if ((m = p.match(/^\/api\/assets\/([0-9a-f-]{36})\/(thumbnail|original)$/))) {
    if (!db.assets.has(m[1])) return bad(res, 'Not found');
    return send(res, 200, sampleJpeg(), 'image/jpeg');
  }

  if (p === '/api/tags' && req.method === 'PUT') {
    const { tags } = await json(req);
    return send(res, 200, tags.map((t) => upsertTag(t)));
  }
  if ((m = p.match(/^\/api\/tags\/([^/]+)\/assets$/))) {
    if (!db.tags.has(m[1])) return bad(res, 'Tag not found');
    const { ids } = await json(req);
    for (const id of ids) {
      const a = db.assets.get(id);
      if (!a) continue;
      if (req.method === 'PUT') a.tags.add(m[1]);
      else a.tags.delete(m[1]);
    }
    return send(res, 200, ids.map((id) => ({ id, success: true })));
  }

  if (p === '/api/stacks' && req.method === 'POST') {
    const { assetIds } = await json(req);
    if (!Array.isArray(assetIds) || assetIds.length < 2) return bad(res, 'assetIds must contain at least 2 elements');
    // Like Immich: assets already in a stack are moved, and emptied stacks go away.
    for (const old of db.stacks) old.assetIds = old.assetIds.filter((id) => !assetIds.includes(id));
    db.stacks = db.stacks.filter((x) => x.assetIds.length >= 2);
    const stack = { id: uuid(), primaryAssetId: assetIds[0], assetIds };
    db.stacks.push(stack);
    return send(res, 201, stack);
  }

  // Faces: pretend face recognition found one person in every photo whose
  // description mentions Matti Virtanen.
  if (p === '/api/faces') {
    const a = db.assets.get(url.searchParams.get('id'));
    if (!a) return bad(res, 'Not found');
    return send(res, 200, /Matti Virtanen/.test(a.description || '') ? [{ id: uuid(), person: { ...person } }] : []);
  }
  if ((m = p.match(/^\/api\/people\/([^/]+)\/thumbnail$/))) return send(res, 200, sampleJpeg(), 'image/jpeg');
  if ((m = p.match(/^\/api\/people\/([^/]+)$/)) && req.method === 'PUT') {
    const pp = db.people.get(m[1]);
    if (!pp) return bad(res, 'Not found');
    Object.assign(pp, await json(req));
    return send(res, 200, pp);
  }

  send(res, 404, { message: `Mock has no ${req.method} ${p}` });
});

server.listen(PORT, '127.0.0.1', () => console.log(`Mock Immich on http://localhost:${PORT} (API key: ${KEY})`));
