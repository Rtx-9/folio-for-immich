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
const assetIndex = new Map(ALBUMS.flatMap((album) => album.assets.map((asset) => [asset.id, { asset, album }])));
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

function access(req, url, albumId) {
  const key = url.searchParams.get('key');
  if (key) {
    const link = linkByKey(key);
    if (!link || (link.expiresAt && new Date(link.expiresAt) < new Date())) return false;
    return !albumId || link.albumId === albumId;
  }
  return authed(req);
}

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
        return json(res, 200, ALBUMS.map(albumDto));
      }
      if ((m = p.match(/^\/api\/albums\/([^/]+)$/))) {
        const album = ALBUMS.find((a) => a.id === m[1]);
        if (!album || !access(req, url, album.id)) return json(res, 400, { message: 'Not found or no album.read access' });
        return json(res, 200, albumDto(album));
      }

      if (p === '/api/shared-links' && req.method === 'POST') {
        if (!authed(req)) return json(res, 401, { message: 'Authentication required' });
        const body = await readBody(req);
        const album = ALBUMS.find((a) => a.id === body.albumId);
        if (!album || album.owner !== me) return json(res, 400, { message: 'Not found or no album.share access' });
        const link = { id: crypto.randomUUID(), key: crypto.randomBytes(24).toString('base64url'), type: 'ALBUM', ...body, createdAt: new Date().toISOString() };
        links.set(link.id, link);
        console.log(`[mock] created shared link for "${album.name}"`);
        return json(res, 201, link);
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
        const album = ALBUMS.find((a) => a.id === url.searchParams.get('albumId'));
        if (!album || !access(req, url, album.id)) return json(res, 401, { message: 'Not allowed' });
        const desc = url.searchParams.get('order') === 'desc';
        const sorted = desc ? [...album.assets].reverse() : album.assets;
        const bucketOf = (a) => `${a.date.slice(0, 7)}-01T00:00:00.000Z`;
        if (p.endsWith('buckets')) {
          const counts = new Map();
          for (const a of sorted) counts.set(bucketOf(a), (counts.get(bucketOf(a)) || 0) + 1);
          return json(res, 200, [...counts].map(([timeBucket, count]) => ({ timeBucket, count })));
        }
        const items = sorted.filter((a) => bucketOf(a) === url.searchParams.get('timeBucket'));
        return json(res, 200, {
          id: items.map((a) => a.id),
          ratio: items.map((a) => a.ratio),
          isImage: items.map(() => true),
          isTrashed: items.map(() => false),
          duration: items.map(() => null),
          fileCreatedAt: items.map((a) => a.date),
          thumbhash: items.map(() => null),
        });
      }

      if ((m = p.match(/^\/api\/assets\/([^/]+)\/(thumbnail|original|video\/playback)$/))) {
        const hit = assetIndex.get(m[1]);
        if (!hit || !access(req, url, hit.album.id)) return json(res, 401, { message: 'Not allowed' });
        if (m[2] === 'video/playback') return json(res, 404, { message: 'No video' });
        const size = m[2] === 'original' ? 'original' : url.searchParams.get('size') || 'thumbnail';
        const img = await image(hit.asset, size);
        const headers = { 'content-type': img.type, 'content-length': img.body.length, 'cache-control': 'private, max-age=86400' };
        if (m[2] === 'original') headers['content-disposition'] = `attachment; filename="IMG_${hit.asset.id.slice(0, 6)}.jpg"`;
        res.writeHead(200, headers);
        return res.end(img.body);
      }

      if (p === '/api/download/info' && req.method === 'POST') {
        const body = await readBody(req);
        const album = ALBUMS.find((a) => a.id === body.albumId);
        if (!album || !access(req, url, album.id)) return json(res, 401, { message: 'Not allowed' });
        return json(res, 200, { totalSize: album.assets.length * 4e6, archives: [{ size: album.assets.length * 4e6, assetIds: album.assets.map((a) => a.id) }] });
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
            ? `<h1>Photos</h1><p>Mock Immich. The “Pages” link in the sidebar was added by Folio.</p><p><a class="btn" href="/folio" data-sveltekit-reload>Open Pages</a></p>`
            : `<h1>Welcome</h1><p><a class="btn" href="/auth/login">Sign in</a></p>`,
        ),
      );
    } catch (err) {
      console.error(err);
      json(res, 500, { message: err.message });
    }
  })
  .listen(PORT, () => console.log(`Mock Immich on http://localhost:${PORT}  (API key: ${API_KEY})`));
