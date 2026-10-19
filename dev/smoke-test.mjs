// End-to-end smoke test against the mock Immich.
//   node dev/mock-immich.js &   node src/server.js &   node dev/smoke-test.mjs
const BASE = process.env.FOLIO_URL || 'http://localhost:2284';
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

// --- auth & CSRF
check('editor API requires sign-in', (await req('/_folio/api/pages')).status === 401);
check('mutations require X-Folio header', (await req('/_folio/api/pages', { method: 'POST', headers: AUTH, body: {} })).status === 403);
check('static files cannot escape public/', (await req('/_folio/static/..%2Fsrc%2Fserver.js')).status === 404);

// --- create & publish
const { data: albums } = await api('/albums');
const mine = albums.albums.filter((a) => a.owned);
const shared = albums.albums.find((a) => !a.owned);
const created = await api('/pages', { method: 'POST', body: { title: 'Smoke test', preset: 'midnight', albumIds: [mine[0].id] } });
check('create page', created.status === 201, JSON.stringify(created.data));
const page = created.data.page;
check('share link created for owned album', page.linked.includes(mine[0].id));

const draft = { ...page.draft, albums: [...page.draft.albums, { albumId: shared.id }], title: '<script>alert(1)</script>' };
const saved = await api(`/pages/${page.id}/draft`, { method: 'PUT', body: { draft } });
check('album you do not own reports a link error', saved.data.linkErrors?.length === 1, JSON.stringify(saved.data.linkErrors));

check('unpublished page is 404', (await req(`/p/${page.slug}`)).status === 404);
await api(`/pages/${page.id}/publish`, { method: 'POST' });
const live = await req(`/p/${page.slug}`);
const html = await live.text();
check('published page is 200', live.status === 200);
check('user text is escaped', !html.includes('<script>alert(1)') && html.includes('&lt;script&gt;'));
await new Promise((r) => setTimeout(r, 400)); // the store flushes to disk on a short debounce
const keys = Object.values(JSON.parse(await (await import('node:fs/promises')).readFile(process.env.FOLIO_DATA ? `${process.env.FOLIO_DATA}/folio.json` : new URL('../data/folio.json', import.meta.url))).pages.find((p) => p.id === page.id).links).map((l) => l.key);
check('share keys never reach the page', keys.length > 0 && keys.every((k) => !html.includes(k)) && !/key=/.test(html));

const assets = await (await req(`/p/${page.slug}/api/album/${mine[0].id}`)).json();
check('album assets listed', assets.assets.length === mine[0].count, `${assets.assets.length} vs ${mine[0].count}`);
const assetId = assets.assets[0].id;
check('thumbnail streams', (await req(`/p/${page.slug}/m/${mine[0].id}/${assetId}/thumbnail`)).status === 200);
check('asset via an album not on the page is refused', (await req(`/p/${page.slug}/m/${mine[1].id}/${assetId}/thumbnail`)).status === 404);
const zipInfo = await (await req(`/p/${page.slug}/dl/${mine[0].id}`)).json();
const zip = await req(`/p/${page.slug}/dl/${mine[0].id}/0`);
check('zip download', zip.status === 200 && /attachment/.test(zip.headers.get('content-disposition')), JSON.stringify(zipInfo));

// --- downloads off
await api(`/pages/${page.id}`, { method: 'PATCH', body: { sharing: { allowDownload: false } } });
check('original blocked when downloads are off', (await req(`/p/${page.slug}/m/${mine[0].id}/${assetId}/original`)).status === 403);
check('zip blocked when downloads are off', (await req(`/p/${page.slug}/dl/${mine[0].id}`)).status === 403);

// --- password
await api(`/pages/${page.id}/password`, { method: 'POST', body: { password: 'hunter22' } });
check('locked page shows password form', (await req(`/p/${page.slug}`)).status === 401);
check('locked media is refused', (await req(`/p/${page.slug}/m/${mine[0].id}/${assetId}/thumbnail`)).status === 401);
const form = (pw) => ({ method: 'POST', json: false, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${pw}` });
check('wrong password rejected', (await req(`/p/${page.slug}/unlock`, form('nope'))).status === 401);
const unlock = await req(`/p/${page.slug}/unlock`, form('hunter22'));
const cookie = unlock.headers.get('set-cookie')?.split(';')[0];
check('right password unlocks', unlock.status === 303 && Boolean(cookie));
check('unlocked visitor sees page', (await req(`/p/${page.slug}`, { headers: { cookie } })).status === 200);
await api(`/pages/${page.id}/password`, { method: 'POST', body: { password: 'changed1' } });
check('changing password signs visitors out', (await req(`/p/${page.slug}`, { headers: { cookie } })).status === 401);
await api(`/pages/${page.id}/password`, { method: 'POST', body: { password: null } });

// --- expiry & slugs
await api(`/pages/${page.id}`, { method: 'PATCH', body: { sharing: { expiresAt: '2020-01-01T00:00:00Z' } } });
check('expired page is 410', (await req(`/p/${page.slug}`)).status === 410);
await api(`/pages/${page.id}`, { method: 'PATCH', body: { sharing: { expiresAt: null } } });
const other = await api('/pages', { method: 'POST', body: { title: 'Smoke test' } });
check('duplicate titles get unique slugs', other.data.page.slug !== page.slug, other.data.page.slug);
check('slug collisions are refused', (await api(`/pages/${other.data.page.id}`, { method: 'PATCH', body: { slug: page.slug } })).status === 409);

// --- cleanup
check('delete page', (await api(`/pages/${page.id}`, { method: 'DELETE' })).status === 200);
await api(`/pages/${other.data.page.id}`, { method: 'DELETE' });
check('deleted page is gone', (await req(`/p/${page.slug}`)).status === 404);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
