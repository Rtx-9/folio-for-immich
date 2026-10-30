// A tiny fake Immich server for developing Folio without a real Immich.
// It implements only the endpoints Folio uses, plus a fake web UI with a sidebar.
// Photos come from picsum.photos (falls back to generated gradients offline).
//
//   node dev/mock-immich.js          → http://localhost:2283
//   IMMICH_URL=http://localhost:2283 node src/server.js
//   open http://localhost:2284/auth/login and click "Sign in"
import crypto from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT) || 2283;
const SESSION = 'mock-session-token';
const API_KEY = 'mock-api-key-0123456789';

const uuid = (seed) => {
  const hex = crypto.createHash('sha1').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const rng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const me = { id: uuid('user-wisp'), name: 'Wisp', email: 'wisp@example.com', isAdmin: true };
const friend = { id: uuid('user-friend'), name: 'Floh', email: 'floh@example.com' };

const PICSUM = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 25, 27, 28, 29, 36, 37, 39, 40, 42, 43, 47, 48, 49, 50, 54, 56, 57, 58, 59, 60, 61, 62, 64, 65, 68, 69, 70, 71, 74, 75, 76, 77, 78, 79, 82, 83, 84, 85, 88, 91, 92, 96, 98, 99, 100, 101, 102, 103, 104, 106, 107, 108, 110, 111, 112, 113, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 133, 134, 135, 136, 137, 139, 140, 141, 142, 143, 144, 145, 146, 147, 149, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185];
const RATIOS = [1.5, 1.5, 1.5, 0.667, 0.667, 1.333, 0.75, 1, 1.778];

const ALBUMS = [
  { name: 'Emma & Jonas — Wedding', count: 42, start: '2026-06-13', end: '2026-06-14', owner: me, desc: 'Ceremony at Villa Aurora, dinner and dancing until sunrise.' },
  { name: 'Lapland Road Trip', count: 36, start: '2026-02-08', end: '2026-02-19', owner: me, desc: '' },
  { name: 'Studio Portraits', count: 18, start: '2026-09-22', end: '2026-09-22', owner: me, desc: 'Autumn mini-sessions.' },
  { name: 'Helsinki Design Week', count: 28, start: '2025-09-04', end: '2025-09-14', owner: me, desc: '' },
  { name: 'Summer Cottage', count: 32, start: '2025-07-01', end: '2025-07-20', owner: me, desc: '' },
  { name: 'Flohy', count: 12, start: '2026-10-02', end: '2026-10-03', owner: friend, desc: '' },
].map((a, ai) => {
  const rand = rng(ai + 7);
  const id = uuid(`album-${a.name}`);
  const t0 = new Date(`${a.start}T09:00:00Z`).getTime();
  const t1 = new Date(`${a.end}T22:00:00Z`).getTime();
  const assets = Array.from({ length: a.count }, (_, i) => ({
    id: uuid(`asset-${a.name}-${i}`),
    picsum: PICSUM[(ai * 23 + i * 7) % PICSUM.length],
    ratio: RATIOS[Math.floor(rand() * RATIOS.length)],
    date: new Date(t0 + ((t1 - t0) * i) / Math.max(1, a.count - 1)).toISOString(),
  }));
  return { ...a, id, assets };
});
// Uploaded photos live in Immich's own storage, in folders with meaningless names.
for (const album of ALBUMS) for (const a of album.assets) a.path = `/data/upload/${album.owner.id}/${a.id.slice(0, 2)}/${a.id.slice(2, 4)}/${a.id}.jpg`;

// A hockey folder for SAIPA, shot at real SaiPa games (local Finnish time), plus a
// training day that isn't a game. Most photos carry IPTC, some only XMP, some nothing.
const HOCKEY_SHOOTS = [
  { local: '2025-09-09T18:10', minutes: 170, n: 12, folder: '2025-26/2025-09-09 SaiPa-KalPa', opp: 'KalPa', city: 'Lappeenranta', arena: 'Lappeenrannan jäähalli' },
  { local: '2025-09-13T16:45', minutes: 150, n: 8, folder: '2025-26/2025-09-13 KooKoo-SaiPa', opp: 'KooKoo', city: 'Kouvola', arena: 'Kouvolan jäähalli' },
  { local: '2026-03-28T16:40', minutes: 190, n: 10, folder: '2025-26/2026-03-28 SaiPa-Ässät', opp: 'Ässät', city: 'Lappeenranta', arena: 'Lappeenrannan jäähalli' },
  { local: '2026-08-27T17:45', minutes: 150, n: 7, folder: '2026-27/2026-08-27 SaiPa-Jukurit', opp: 'Jukurit', city: 'Lappeenranta', arena: 'Lappeenrannan jäähalli' },
  { local: '2026-09-01T18:05', minutes: 165, n: 10, folder: '2026-27/2026-09-01 SaiPa-Tappara', opp: 'Tappara', city: 'Lappeenranta', arena: 'Lappeenrannan jäähalli' },
  { local: '2026-09-05T11:00', minutes: 90, n: 6, folder: '2026-27/Treenit', opp: null, city: 'Lappeenranta', arena: 'Lappeenrannan jäähalli' },
  { local: '2026-10-20T18:00', minutes: 180, n: 14, folder: '2026-27/2026-10-20 SaiPa-Kärpät', opp: 'Kärpät', city: 'Lappeenranta', arena: 'Lappeenrannan jäähalli' },
];
const CAPTIONS = [
  (o) => `Kari Piiroinen torjuu maalin SaiPa–${o} -pelissä`,
  (o) => `Samuli Niinisaari juhlii maaliaan ${o}a vastaan`,
  () => 'SaiPan kannattajat tunnelmissa päätykatsomossa',
  () => 'Maalivahti Kari Piiroinen venyy torjuntaan',
  (o) => `Patrik Siikanen laukoo, ${o}n puolustus taklaa`,
  () => 'Aloitus keskialueella toisessa erässä',
  (o) => `SaiPa kiittää yleisöä ottelun jälkeen. SaiPa–${o}`,
  () => 'Petrus Palmu ja Santeri Airola tuulettavat',
];
const TRAINING = ['Aamuharjoitukset Kisapuiston hallissa', 'Valmentaja ohjeistaa', 'Kari Piiroinen maalivahtiharjoituksissa'];
// The hockey photos come from an external library (real folder names) and are
// also collected in an album, so all three SAIPA sources can be tested.
const hockey = { name: 'SaiPa 2025–2027', owner: me, desc: '', id: uuid('hockey-folder'), assets: [] };
HOCKEY_SHOOTS.forEach((shoot, si) => {
  const rand = rng(100 + si);
  const start = Date.parse(`${shoot.local}:00Z`);
  for (let i = 0; i < shoot.n; i++) {
    const local = new Date(start + (shoot.minutes * 60e3 * i) / Math.max(1, shoot.n - 1)).toISOString();
    const caption = shoot.opp ? CAPTIONS[(i + si) % CAPTIONS.length](shoot.opp) : TRAINING[i % TRAINING.length];
    const kind = i % 7 === 3 ? 'none' : i % 7 === 5 ? 'xmp' : 'iptc';
    const n = 4400 + si * 100 + i;
    hockey.assets.push({
      id: uuid(`hockey-${si}-${i}`),
      picsum: PICSUM[(si * 31 + i * 11 + 5) % PICSUM.length],
      ratio: [1.5, 1.5, 0.667, 1.5, 1.778][Math.floor(rand() * 5)],
      local,
      // Finnish summer time: UTC+3 (close enough for a mock).
      date: new Date(Date.parse(local) - 3 * 3600e3).toISOString(),
      path: `/mnt/photos/Hockey/${shoot.folder}/IMG_${n}.jpg`,
      meta:
        kind === 'none'
          ? null
          : {
              kind,
              caption,
              headline: shoot.opp ? `SaiPa–${shoot.opp}` : 'SaiPan harjoitukset',
              keywords: ['SaiPa', 'Liiga', 'jääkiekko', ...(shoot.opp ? [shoot.opp] : ['harjoitukset']), ...(caption.match(/Kari Piiroinen|Samuli Niinisaari|Patrik Siikanen|Petrus Palmu/g) || [])],
              byline: 'Wisp / Alluvisuals',
              credit: 'Alluvisuals',
              copyright: '© 2026 Alluvisuals',
              city: shoot.city,
              sublocation: shoot.arena,
              country: 'Suomi',
            },
    });
  }
});
ALBUMS.push(hockey);
const assetIndex = new Map(ALBUMS.flatMap((album) => album.assets.map((asset) => [asset.id, { asset, album }])));
const folderOf = (a) => a.path.replace(/\/[^/]*$/, '');

// IPTC (APP13, UTF-8) or XMP (APP1) metadata, inserted right after the JPEG's SOI marker.
function withMetadata(jpeg, meta) {
  if (!meta || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const u16 = (n) => Buffer.from([n >> 8, n & 255]);
  let segment;
  if (meta.kind === 'iptc') {
    const fields = [
      [105, meta.headline],
      [120, meta.caption],
      ...meta.keywords.map((k) => [25, k]),
      [80, meta.byline],
      [110, meta.credit],
      [116, meta.copyright],
      [90, meta.city],
      [92, meta.sublocation],
      [101, meta.country],
    ];
    const iim = Buffer.concat([
      Buffer.from([0x1c, 1, 90, 0, 3, 0x1b, 0x25, 0x47]), // coded character set: UTF-8
      ...fields.map(([ds, v]) => {
        const d = Buffer.from(v, 'utf8');
        return Buffer.concat([Buffer.from([0x1c, 2, ds]), u16(d.length), d]);
      }),
    ]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(iim.length);
    const payload = Buffer.concat([Buffer.from('Photoshop 3.0\0', 'latin1'), Buffer.from('8BIM', 'latin1'), Buffer.from([4, 4, 0, 0]), size, iim, iim.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
    segment = Buffer.concat([Buffer.from([0xff, 0xed]), u16(payload.length + 2), payload]);
  } else {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:City="${esc(meta.city)}" photoshop:Credit="${esc(meta.credit)}"><dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(meta.caption)}</rdf:li></rdf:Alt></dc:description><dc:subject><rdf:Bag>${meta.keywords.map((k) => `<rdf:li>${esc(k)}</rdf:li>`).join('')}</rdf:Bag></dc:subject><dc:creator><rdf:Seq><rdf:li>${esc(meta.byline)}</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>`;
    const payload = Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xml, 'utf8')]);
    segment = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(payload.length + 2), payload]);
  }
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

const assetDto = (a, album) => ({
  id: a.id,
  type: 'IMAGE',
  originalFileName: a.path.split('/').pop(),
  originalPath: a.path,
  originalMimeType: 'image/jpeg',
  localDateTime: a.local ? `${a.local.slice(0, 19)}.000Z` : a.date,
  fileCreatedAt: a.date,
  width: Math.round(a.ratio * 4000),
  height: 4000,
  checksum: `sum-${a.id.slice(0, 8)}`,
  updatedAt: a.date,
  isTrashed: false,
  duration: null,
  ownerId: album.owner.id,
});
const links = new Map();

// ---- helpers ----------------------------------------------------------------------

const json = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
const authed = (req) => cookies(req).immich_access_token === SESSION || req.headers['x-api-key'] === API_KEY;
const linkByKey = (key) => [...links.values()].find((l) => l.key === key);
const readBody = (req) => new Promise((r) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => r(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}));
});

// Album-level access: an album link for that album, or the signed-in user.
function access(req, url, albumId) {
  const key = url.searchParams.get('key');
  if (key) {
    const link = linkByKey(key);
    if (!link || (link.expiresAt && new Date(link.expiresAt) < new Date())) return false;
    return link.type === 'ALBUM' && (!albumId || link.albumId === albumId);
  }
  return authed(req);
}

// Asset-level access: also allows individual links that contain the asset.
function assetAccess(req, url, hit) {
  const key = url.searchParams.get('key');
  if (key) {
    const link = linkByKey(key);
    if (!link || (link.expiresAt && new Date(link.expiresAt) < new Date())) return false;
    return link.type === 'ALBUM' ? link.albumId === hit.album.id : link.assetIds.includes(hit.asset.id);
  }
  return authed(req);
}

const myAssets = () => ALBUMS.filter((a) => a.owner === me).flatMap((a) => a.assets);
const columns = (items) => ({
  id: items.map((a) => a.id),
  ratio: items.map((a) => a.ratio),
  isImage: items.map(() => true),
  isTrashed: items.map(() => false),
  duration: items.map(() => null),
  fileCreatedAt: items.map((a) => a.date),
  thumbhash: items.map(() => null),
});

const albumDto = (a) => ({
  id: a.id,
  albumName: a.name,
  description: a.desc,
  albumThumbnailAssetId: a.assets[0]?.id ?? null,
  assetCount: a.assets.length,
  startDate: a.assets[0]?.date,
  endDate: a.assets.at(-1)?.date,
  createdAt: a.assets[0]?.date,
  updatedAt: a.assets.at(-1)?.date,
  lastModifiedAssetTimestamp: a.assets.at(-1)?.date,
  albumUsers: [{ role: 'owner', user: a.owner }, ...(a.owner === me ? [] : [{ role: 'editor', user: me }])],
  shared: a.owner !== me,
  hasSharedLink: [...links.values()].some((l) => l.albumId === a.id),
  isActivityEnabled: true,
  order: 'asc',
});

const imageCache = new Map();
async function image(asset, size) {
  const long = size === 'thumbnail' ? 360 : size === 'original' ? 2400 : 1440;
  const w = asset.ratio >= 1 ? long : Math.round(long * asset.ratio);
  const h = asset.ratio >= 1 ? Math.round(long / asset.ratio) : long;
  const key = `${asset.id}:${size}`;
  if (!imageCache.has(key)) {
    imageCache.set(
      key,
      fetch(`https://picsum.photos/id/${asset.picsum}/${w}/${h}.jpg`)
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return { type: 'image/jpeg', body: Buffer.from(await r.arrayBuffer()) };
        })
        .catch(() => {
          const hue = parseInt(asset.id.slice(0, 2), 16) * 1.4;
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,62%)"/><stop offset="1" stop-color="hsl(${hue + 50},55%,32%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
          return { type: 'image/svg+xml', body: Buffer.from(svg) };
        }),
    );
  }
  return imageCache.get(key);
}

// ---- fake web UI -------------------------------------------------------------------

const navItem = (href, label, d) =>
  `<div><a href="${href}" class="nav-item"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="${d}"/></svg><span>${label}</span></a></div>`;
const shell = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>Immich (mock)</title>
<style>body{margin:0;font:15px system-ui;background:#000;color:#ddd;display:grid;grid-template-columns:250px 1fr;min-height:100vh}
nav{padding:20px 12px;border-right:1px solid #222}.nav-item{display:flex;gap:16px;align-items:center;padding:12px 18px;border-radius:0 999px 999px 0;color:#ddd;text-decoration:none}
.nav-item:hover{background:#1c1c1c}main{padding:40px}h1{font-weight:500;color:#adcbfa}button,a.btn{background:#adcbfa;color:#000;border:0;border-radius:99px;padding:10px 20px;font:inherit;cursor:pointer;text-decoration:none}</style></head>
<body><nav aria-label="primary"><p style="padding:0 18px;font-weight:700;color:#adcbfa;font-size:22px">immich <small style="font-size:11px;color:#888">mock</small></p>
${navItem('/photos', 'Photos', 'M22 16V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2m-11-4 2 2.7 3-3.7 4 5H8l3-4M2 6v14a2 2 0 0 0 2 2h14v-2H4V6H2z')}
${navItem('/explore', 'Explore', 'M9.5 3A6.5 6.5 0 0 1 16 9.5c0 1.6-.6 3.1-1.6 4.2l.3.3h.8l5 5-1.5 1.5-5-5v-.8l-.3-.3A6.5 6.5 0 1 1 9.5 3m0 2C7 5 5 7 5 9.5S7 14 9.5 14 14 12 14 9.5 12 5 9.5 5z')}
${navItem('/sharing', 'Sharing', 'M16 13c-.3 0-.7 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5m-8 0c-2.3 0-7 1.2-7 3.5V19h14v-2.5c0-2.3-4.7-3.5-7-3.5m0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6m8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6z')}
${navItem('/albums', 'Albums', 'M19 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4l3 3 3-3h4a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z')}
</nav><main>${body}</main></body></html>`;

// ---- server -----------------------------------------------------------------------

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;
    let m;
    try {
      if (p === '/api/users/me') return authed(req) ? json(res, 200, me) : json(res, 401, { message: 'Authentication required' });

      if (p === '/api/albums' && req.method === 'GET') {
        if (!authed(req)) return json(res, 401, { message: 'Authentication required' });
        return json(res, 200, ALBUMS.filter((a) => !a.hidden).map(albumDto));
      }
      if ((m = p.match(/^\/api\/albums\/([^/]+)$/))) {
        const album = ALBUMS.find((a) => a.id === m[1]);
        if (!album || !access(req, url, album.id)) return json(res, 400, { message: 'Not found or no album.read access' });
        return json(res, 200, albumDto(album));
      }

      if (p === '/api/shared-links' && req.method === 'POST') {
        if (!authed(req)) return json(res, 401, { message: 'Authentication required' });
        const body = await readBody(req);
        const base = { id: crypto.randomUUID(), key: crypto.randomBytes(24).toString('base64url'), createdAt: new Date().toISOString() };
        if (body.type === 'INDIVIDUAL') {
          const ids = body.assetIds || [];
          if (!ids.length || ids.some((id) => assetIndex.get(id)?.album.owner !== me)) return json(res, 400, { message: 'Not found or no sharedLink.create access' });
          const link = { ...base, ...body, assetIds: [...ids] };
          links.set(link.id, link);
          console.log(`[mock] created individual link with ${ids.length} photos`);
          return json(res, 201, link);
        }
        const album = ALBUMS.find((a) => a.id === body.albumId);
        if (!album || album.owner !== me) return json(res, 400, { message: 'Not found or no album.share access' });
        const link = { ...base, type: 'ALBUM', ...body };
        links.set(link.id, link);
        console.log(`[mock] created shared link for "${album.name}"`);
        return json(res, 201, link);
      }
      if ((m = p.match(/^\/api\/shared-links\/([^/]+)\/assets$/))) {
        if (!authed(req)) return json(res, 401, { message: 'Authentication required' });
        const link = links.get(m[1]);
        if (!link || link.type !== 'INDIVIDUAL') return json(res, 400, { message: 'Invalid shared link type' });
        const { assetIds = [] } = await readBody(req);
        const result = assetIds.map((assetId) => {
          const has = link.assetIds.includes(assetId);
          if (req.method === 'PUT') {
            if (has) return { assetId, success: false, error: 'duplicate' };
            if (assetIndex.get(assetId)?.album.owner !== me) return { assetId, success: false, error: 'no_permission' };
            link.assetIds.push(assetId);
            return { assetId, success: true };
          }
          if (!has) return { assetId, success: false, error: 'not_found' };
          link.assetIds = link.assetIds.filter((id) => id !== assetId);
          return { assetId, success: true };
        });
        return json(res, 200, result);
      }
      if ((m = p.match(/^\/api\/shared-links\/([^/]+)$/))) {
        if (!authed(req)) return json(res, 401, { message: 'Authentication required' });
        const link = links.get(m[1]);
        if (!link) return json(res, 400, { message: 'Shared link not found' });
        if (req.method === 'DELETE') {
          links.delete(m[1]);
          console.log('[mock] deleted shared link');
          res.writeHead(204);
          return res.end();
        }
        if (req.method === 'PATCH') Object.assign(link, await readBody(req));
        return json(res, 200, link);
      }

      if (p === '/api/timeline/buckets' || p === '/api/timeline/bucket') {
        const albumId = url.searchParams.get('albumId');
        let source;
        if (albumId) {
          const album = ALBUMS.find((a) => a.id === albumId);
          if (!album || !access(req, url, album.id)) return json(res, 401, { message: 'Not allowed' });
          source = album.assets;
        } else {
          if (!authed(req)) return json(res, 401, { message: 'Authentication required' });
          source = [...myAssets()].sort((a, b) => a.date.localeCompare(b.date));
        }
        const desc = url.searchParams.get('order') === 'desc';
        const sorted = desc ? [...source].reverse() : source;
        const bucketOf = (a) => `${a.date.slice(0, 7)}-01T00:00:00.000Z`;
        if (p.endsWith('buckets')) {
          const counts = new Map();
          for (const a of sorted) counts.set(bucketOf(a), (counts.get(bucketOf(a)) || 0) + 1);
          return json(res, 200, [...counts].map(([timeBucket, count]) => ({ timeBucket, count })));
        }
        return json(res, 200, columns(sorted.filter((a) => bucketOf(a) === url.searchParams.get('timeBucket'))));
      }

      if (p === '/api/view/folder/unique-paths') {
        if (!authed(req)) return json(res, 401, { message: 'Authentication required' });
        return json(res, 200, [...new Set([...assetIndex.values()].filter((h) => h.album.owner === me).map((h) => folderOf(h.asset)))].sort());
      }
      if (p === '/api/view/folder') {
        if (!authed(req)) return json(res, 401, { message: 'Authentication required' });
        const folder = url.searchParams.get('path');
        return json(res, 200, [...assetIndex.values()].filter((h) => h.album.owner === me && folderOf(h.asset) === folder).map((h) => assetDto(h.asset, h.album)));
      }
      if ((m = p.match(/^\/api\/assets\/([0-9a-f-]{36})$/)) && req.method === 'GET') {
        const hit = assetIndex.get(m[1]);
        if (!hit || !authed(req)) return json(res, 400, { message: 'Not found or no asset.read access' });
        return json(res, 200, {
          ...assetDto(hit.asset, hit.album),
          exifInfo: { make: 'Canon', model: 'EOS R3', lensModel: 'RF70-200mm F2.8 L IS USM', focalLength: 135, fNumber: 2.8, exposureTime: '1/1000', iso: 6400, exifImageWidth: Math.round(hit.asset.ratio * 4000), exifImageHeight: 4000, fileSizeInByte: 9_800_000, description: hit.asset.meta?.caption || null },
        });
      }

      if (p === '/api/search/metadata' && req.method === 'POST') {
        if (!authed(req)) return json(res, 401, { message: 'Authentication required' });
        const body = await readBody(req);
        const after = body.takenAfter ? Date.parse(body.takenAfter) : -Infinity;
        const before = body.takenBefore ? Date.parse(body.takenBefore) : Infinity;
        const hits = [...assetIndex.values()]
          .filter((hit) => hit.album.owner === me)
          .filter((hit) => !body.albumIds?.length || body.albumIds.includes(hit.album.id))
          .filter((hit) => Date.parse(hit.asset.date) >= after && Date.parse(hit.asset.date) <= before)
          .sort((x, y) => y.asset.date.localeCompare(x.asset.date));
        const size = Math.min(1000, body.size || 250);
        const page = body.page || 1;
        const items = hits.slice((page - 1) * size, page * size).map((hit) => assetDto(hit.asset, hit.album));
        const nextPage = page * size < hits.length ? String(page + 1) : null;
        return json(res, 200, { albums: { items: [], total: 0, count: 0 }, assets: { items, total: hits.length, count: items.length, nextPage } });
      }

      if (p === '/api/search/smart' && req.method === 'POST') {
        if (!authed(req)) return json(res, 401, { message: 'Authentication required' });
        const { query = '' } = await readBody(req);
        const seed = [...query].reduce((s, c) => s + c.charCodeAt(0), 0);
        const items = myAssets()
          .filter((_, i) => (i + seed) % 4 === 0)
          .slice(0, 24)
          .map((a) => ({ id: a.id, type: 'IMAGE', width: Math.round(a.ratio * 1000), height: 1000, fileCreatedAt: a.date, duration: null }));
        return json(res, 200, { albums: { items: [], total: 0, count: 0 }, assets: { items, total: items.length, count: items.length, nextPage: null } });
      }

      if ((m = p.match(/^\/api\/assets\/([^/]+)\/(thumbnail|original|video\/playback)$/))) {
        const hit = assetIndex.get(m[1]);
        if (!hit || !assetAccess(req, url, hit)) return json(res, 401, { message: 'Not allowed' });
        if (m[2] === 'video/playback') return json(res, 404, { message: 'No video' });
        const size = m[2] === 'original' ? 'original' : url.searchParams.get('size') || 'thumbnail';
        let img = await image(hit.asset, size);
        if (m[2] === 'original' && hit.asset.meta) img = { ...img, body: withMetadata(img.body, hit.asset.meta) };
        const headers = { 'content-type': img.type, 'content-length': img.body.length, 'cache-control': 'private, max-age=86400' };
        if (m[2] === 'original') headers['content-disposition'] = `attachment; filename="IMG_${hit.asset.id.slice(0, 6)}.jpg"`;
        res.writeHead(200, headers);
        return res.end(img.body);
      }

      if (p === '/api/download/info' && req.method === 'POST') {
        const body = await readBody(req);
        let ids;
        if (body.assetIds) {
          const hits = body.assetIds.map((id) => assetIndex.get(id));
          if (hits.some((hit) => !hit || !assetAccess(req, url, hit))) return json(res, 401, { message: 'Not allowed' });
          ids = body.assetIds;
        } else {
          const album = ALBUMS.find((a) => a.id === body.albumId);
          if (!album || !access(req, url, album.id)) return json(res, 401, { message: 'Not allowed' });
          ids = album.assets.map((a) => a.id);
        }
        return json(res, 200, { totalSize: ids.length * 4e6, archives: [{ size: ids.length * 4e6, assetIds: ids }] });
      }
      if (p === '/api/download/archive' && req.method === 'POST') {
        const body = Buffer.from('PK\u0005\u0006' + '\0'.repeat(18), 'latin1'); // an empty zip
        res.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length });
        return res.end(body);
      }

      if (p.startsWith('/api/')) return json(res, 404, { message: `Mock does not implement ${req.method} ${p}` });

      if (p === '/auth/login') {
        if (url.searchParams.has('go')) {
          res.writeHead(302, {
            'set-cookie': `immich_access_token=${SESSION}; Path=/; HttpOnly; SameSite=Lax`,
            location: url.searchParams.get('continue') || '/photos',
          });
          return res.end();
        }
        const next = encodeURIComponent(url.searchParams.get('continue') || '/photos');
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(shell(`<h1>Sign in</h1><p>This is the mock Immich.</p><a class="btn" href="/auth/login?go=1&continue=${next}">Sign in as Wisp</a>`));
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        shell(
          authed(req)
            ? `<h1>Photos</h1><p>Mock Immich. The “Folio” link in the sidebar was added by Folio.</p><p><a class="btn" href="/folio" data-sveltekit-reload>Open Folio</a></p>`
            : `<h1>Welcome</h1><p><a class="btn" href="/auth/login">Sign in</a></p>`,
        ),
      );
    } catch (err) {
      console.error(err);
      json(res, 500, { message: err.message });
    }
  })
  .listen(PORT, () => console.log(`Mock Immich on http://localhost:${PORT}  (API key: ${API_KEY})`));
