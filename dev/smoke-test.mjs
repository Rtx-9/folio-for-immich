// End-to-end smoke test against the mock Immich.
//   node dev/mock-immich.js &   node src/server.js &   node dev/smoke-test.mjs
import fs from 'node:fs/promises';
import { sanitizeDraft } from '../src/themes.js';

const BASE = process.env.FOLIO_URL || 'http://localhost:2284';
const DATA = process.env.FOLIO_DATA ? `${process.env.FOLIO_DATA}/folio.json` : new URL('../data/folio.json', import.meta.url);
const AUTH = { cookie: 'immich_access_token=mock-session-token' };
let failures = 0;

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures++;
};
const req = (path, { method = 'GET', headers = {}, body, json = true } = {}) =>
  fetch(BASE + path, {
    method,
    redirect: 'manual',
    headers: { ...(json && body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : json ? JSON.stringify(body) : body,
  });
const api = async (path, opts = {}) => {
  const res = await req(`/_folio/api${path}`, { ...opts, headers: { ...AUTH, 'x-folio': '1', ...(opts.headers || {}) } });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const status = async (path, headers) => (await req(path, { headers })).status;
const stored = async (id) => {
  await new Promise((r) => setTimeout(r, 400)); // the store flushes to disk on a short debounce
  return JSON.parse(await fs.readFile(DATA, 'utf8')).pages.find((p) => p.id === id);
};

// --- migration of version-1 pages (no server needed)
const migrated = sanitizeDraft({
  title: 'Old page',
  intro: 'Hello there',
  albums: [{ albumId: '11111111-2222-4333-a444-555555555555' }],
  layout: { albumStyle: 'tiles', columns: 4, width: 'wide' },
  hero: { style: 'banner', height: 'compact' },
});
check(
  'v1 pages migrate to blocks',
  migrated.blocks.length === 2 && migrated.blocks[0].type === 'text' && migrated.blocks[1].albumStyle === 'tiles' && migrated.hero.size === 42 && migrated.layout.width === 'wide',
  JSON.stringify(migrated.blocks),
);
check('migration is stable', JSON.stringify(sanitizeDraft(migrated)) === JSON.stringify(migrated));

// --- auth & CSRF
check('editor API requires sign-in', (await req('/_folio/api/pages')).status === 401);
check('mutations require X-Folio header', (await req('/_folio/api/pages', { method: 'POST', headers: AUTH, body: {} })).status === 403);
check('static files cannot escape public/', (await status('/_folio/static/..%2Fsrc%2Fserver.js')) === 404);

// --- create from a template & publish
const { data: albums } = await api('/albums');
const mine = albums.albums.filter((a) => a.owned);
const shared = albums.albums.find((a) => !a.owned);
const { data: meta } = await api('/meta');
check('templates and presets are offered', meta.templates.length >= 6 && meta.presets.length >= 15 && Object.keys(meta.fonts).length >= 30);

const created = await api('/pages', { method: 'POST', body: { title: 'Smoke test', preset: 'midnight', template: 'event', albumIds: [mine[0].id] } });
check('create page from template', created.status === 201 && created.data.page.draft.blocks.some((b) => b.type === 'photos'), JSON.stringify(created.data).slice(0, 200));
const page = created.data.page;
check('share link created for owned album', page.linked.includes(mine[0].id));

const draft = structuredClone(page.draft);
const albumsBlock = draft.blocks.find((b) => b.type === 'albums');
albumsBlock.albums.push({ albumId: shared.id });
draft.title = '<script>alert(1)</script>';
const saved = await api(`/pages/${page.id}/draft`, { method: 'PUT', body: { draft } });
check('album you do not own reports a link error', saved.data.linkErrors?.length === 1, JSON.stringify(saved.data.linkErrors));

// --- photos block with hand-picked photos
const { data: lib } = await api('/library/buckets');
check('library timeline is listed', lib.buckets.length > 0);
const { data: bucket } = await api(`/library/bucket?timeBucket=${encodeURIComponent(lib.buckets[0].timeBucket)}`);
const picked = bucket.assets.slice(0, 3);
const photosBlock = draft.blocks.find((b) => b.type === 'photos');
photosBlock.photos = picked.map((a) => ({ ...a, caption: 'Hello' }));
const withPhotos = await api(`/pages/${page.id}/draft`, { method: 'PUT', body: { draft: saved.data.page.draft.blocks ? { ...saved.data.page.draft, blocks: saved.data.page.draft.blocks.map((b) => (b.id === photosBlock.id ? photosBlock : b)) } : draft } });
check('photos block gets an individual link', withPhotos.data.page.linked.includes(photosBlock.id), JSON.stringify(withPhotos.data.linkErrors));
const search = await api('/search', { method: 'POST', body: { query: 'beach' } });
check('smart search returns photos', search.status === 200 && search.data.assets.length > 0);

check('unpublished page is 404', (await status(`/p/${page.slug}`)) === 404);
await api(`/pages/${page.id}/publish`, { method: 'POST' });
const live = await req(`/p/${page.slug}`);
const html = await live.text();
check('published page is 200', live.status === 200);
check('user text is escaped', !html.includes('<script>alert(1)') && html.includes('&lt;script&gt;'));
check('photos block is embedded with captions', html.includes(`id="photos-${photosBlock.id}"`) && html.includes('"caption":"Hello"'));
const record = await stored(page.id);
const keys = Object.values(record.links).map((l) => l.key);
check('share keys never reach the page', keys.length >= 2 && keys.every((k) => !html.includes(k)) && !/key=/.test(html));

const assets = await (await req(`/p/${page.slug}/api/album/${mine[0].id}`)).json();
check('album assets listed', assets.assets.length === mine[0].count, `${assets.assets.length} vs ${mine[0].count}`);
const assetId = assets.assets[0].id;
check('album thumbnail streams', (await status(`/p/${page.slug}/m/${mine[0].id}/${assetId}/thumbnail`)) === 200);
check('asset via an album not on the page is refused', (await status(`/p/${page.slug}/m/${mine[1].id}/${assetId}/thumbnail`)) === 404);
check('picked photo streams', (await status(`/p/${page.slug}/m/${photosBlock.id}/${picked[0].id}/preview`)) === 200);
const notPicked = bucket.assets.find((a) => !picked.some((p) => p.id === a.id)) || assets.assets.find((a) => !picked.some((p) => p.id === a.id));
check('unpicked photo via the block link is refused', (await status(`/p/${page.slug}/m/${photosBlock.id}/${notPicked.id}/preview`)) !== 200);
const zip = await req(`/p/${page.slug}/dl/${mine[0].id}/0`);
check('album zip download', zip.status === 200 && /attachment/.test(zip.headers.get('content-disposition')));
const blockZip = await (await req(`/p/${page.slug}/dl/${photosBlock.id}`)).json();
check('photos block zip lists only its photos', blockZip.parts?.[0]?.count === 3, JSON.stringify(blockZip));

// Removing a photo from the draft must not break the live page until publish.
const live2 = (await api(`/pages/${page.id}`)).data.page.draft;
live2.blocks.find((b) => b.id === photosBlock.id).photos.shift();
await api(`/pages/${page.id}/draft`, { method: 'PUT', body: { draft: live2 } });
check('removed photo still works on the live page', (await status(`/p/${page.slug}/m/${photosBlock.id}/${picked[0].id}/preview`)) === 200);
await api(`/pages/${page.id}/publish`, { method: 'POST' });
check('removed photo is unshared after publishing', (await status(`/p/${page.slug}/m/${photosBlock.id}/${picked[0].id}/preview`)) !== 200);
check('remaining photos still work', (await status(`/p/${page.slug}/m/${photosBlock.id}/${picked[1].id}/preview`)) === 200);

// --- downloads off
await api(`/pages/${page.id}`, { method: 'PATCH', body: { sharing: { allowDownload: false } } });
check('original blocked when downloads are off', (await status(`/p/${page.slug}/m/${mine[0].id}/${assetId}/original`)) === 403);
check('zip blocked when downloads are off', (await status(`/p/${page.slug}/dl/${mine[0].id}`)) === 403);

// --- password
await api(`/pages/${page.id}/password`, { method: 'POST', body: { password: 'hunter22' } });
check('locked page shows password form', (await status(`/p/${page.slug}`)) === 401);
check('locked media is refused', (await status(`/p/${page.slug}/m/${mine[0].id}/${assetId}/thumbnail`)) === 401);
const form = (pw) => ({ method: 'POST', json: false, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${pw}` });
check('wrong password rejected', (await req(`/p/${page.slug}/unlock`, form('nope'))).status === 401);
const unlock = await req(`/p/${page.slug}/unlock`, form('hunter22'));
const cookie = unlock.headers.get('set-cookie')?.split(';')[0];
check('right password unlocks', unlock.status === 303 && Boolean(cookie));
check('unlocked visitor sees page', (await status(`/p/${page.slug}`, { cookie })) === 200);
await api(`/pages/${page.id}/password`, { method: 'POST', body: { password: 'changed1' } });
check('changing password signs visitors out', (await status(`/p/${page.slug}`, { cookie })) === 401);
await api(`/pages/${page.id}/password`, { method: 'POST', body: { password: null } });

// --- expiry & slugs
await api(`/pages/${page.id}`, { method: 'PATCH', body: { sharing: { expiresAt: '2020-01-01T00:00:00Z' } } });
check('expired page is 410', (await status(`/p/${page.slug}`)) === 410);
await api(`/pages/${page.id}`, { method: 'PATCH', body: { sharing: { expiresAt: null } } });
const other = await api('/pages', { method: 'POST', body: { title: 'Smoke test', template: 'blank' } });
check('blank template has no blocks', other.data.page.draft.blocks.length === 0);
check('duplicate titles get unique slugs', other.data.page.slug !== page.slug, other.data.page.slug);
check('slug collisions are refused', (await api(`/pages/${other.data.page.id}`, { method: 'PATCH', body: { slug: page.slug } })).status === 409);

// --- preview edit mode
const preview = await (await req(`/_folio/preview/${page.id}?edit=1`, { headers: AUTH })).text();
check('preview edit mode is flagged', preview.includes('is-editing') && preview.includes('"edit":true'));

// --- cleanup
check('delete page', (await api(`/pages/${page.id}`, { method: 'DELETE' })).status === 200);
await api(`/pages/${other.data.page.id}`, { method: 'DELETE' });
check('deleted page is gone', (await status(`/p/${page.slug}`)) === 404);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
