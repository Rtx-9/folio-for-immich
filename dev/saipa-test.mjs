// End-to-end test for SAIPA against the mock Immich (needs internet for Liiga's schedule).
//   node dev/mock-immich.js &   node src/server.js &   node dev/saipa-test.mjs
const BASE = process.env.FOLIO_URL || 'http://localhost:2284';
const H = { cookie: 'immich_access_token=mock-session-token', 'x-folio': '1', 'content-type': 'application/json' };
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures++;
};
const api = async (path, opts = {}) => {
  const res = await fetch(`${BASE}/_folio/api/saipa${path}`, { ...opts, headers: H, body: opts.body && JSON.stringify(opts.body) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

check('SAIPA page is served', (await fetch(`${BASE}/saipa`)).status === 200);
check('API requires sign-in', (await fetch(`${BASE}/_folio/api/saipa/state`)).status === 401);

const { data: folders } = await api('/folders');
const hockey = '/mnt/photos/Hockey';
check('parent folders can be picked', folders.folders.includes(hockey) && folders.folders.some((f) => f.includes('/Hockey/2026-27/')), JSON.stringify(folders).slice(0, 200));
check('Immich’s internal upload folders are hidden', !folders.folders.some((f) => f.includes('/upload')) && folders.hidden > 0, JSON.stringify(folders).slice(0, 300));

async function syncWith(settings) {
  const put = await api('/settings', { method: 'PUT', body: settings });
  if (put.status !== 200) return { put };
  let status;
  await sleep(300);
  for (let i = 0; i < 160; i++) {
    status = (await api('/status')).data;
    if (status.state === 'done' || status.state === 'error') break;
    await sleep(500);
  }
  return { put, status, lib: (await api('/library')).data };
}

// Source 1: an album (the usual setup when photos are uploaded to Immich).
const albums = (await (await fetch(`${BASE}/_folio/api/albums`, { headers: H })).json()).albums;
const saipaAlbum = albums.find((a) => a.name.startsWith('SaiPa'));
const { status, lib } = await syncWith({ source: 'album', albumIds: [saipaAlbum.id] });
check('sync from an album finishes', status.state === 'done', JSON.stringify(status));
check('empty album choice is refused and nothing changes', (await api('/settings', { method: 'PUT', body: { source: 'album', albumIds: [] } })).status === 400 && (await api('/state')).data.settings.albumIds[0] === saipaAlbum.id);

const games = lib.sections.filter((s) => s.kind === 'game');
const days = lib.sections.filter((s) => s.kind === 'day');
check('photos are sorted into 6 real SaiPa games', games.length === 6, games.map((g) => `${g.game.home.name}-${g.game.away.name} ${g.date}`).join(', '));
const karpat = games.find((g) => g.date === '2026-10-20');
check('SaiPa–Kärpät 20.10.2026 is found', karpat && karpat.game.home.name === 'SaiPa' && karpat.game.away.name === 'Kärpät' && karpat.items.length === 14, JSON.stringify(karpat?.game));
check('preseason and playoff games are included', games.some((g) => g.game.serie === 'Preseason') && games.some((g) => g.game.serie === 'Playoffs'));
check('the training day is its own day section', days.length === 1 && days[0].date === '2026-09-05' && days[0].items.length === 6, JSON.stringify(days.map((d) => [d.date, d.items.length])));
check('newest first', lib.sections[0].date >= lib.sections.at(-1).date);
check('IPTC and XMP were read', lib.withMetadata > 50 && lib.withMetadata < lib.photos, `${lib.withMetadata} of ${lib.photos}`);
check('nothing from outside the folder', lib.photos === 67, String(lib.photos));

const search = async (q) => (await api(`/search?q=${encodeURIComponent(q)}`)).data;
const r1 = await search('Kari torjunta');
check('“Kari torjunta” finds Kari Piiroinen’s saves', r1.total > 0 && !r1.partial, JSON.stringify(r1).slice(0, 200));
const firstId = r1.sections[0].items[0][0];
const { data: detail } = await api(`/asset/${firstId}`);
check('photo details have the IPTC caption', /Piiroinen/.test(detail.meta?.caption) && /torj/i.test(detail.meta.caption), JSON.stringify(detail.meta));
check('photo details include the game and camera', detail.exif?.model === 'EOS R3' && (detail.game ? detail.game.home && detail.game.away : true));
const r2 = await search('karpat');
check('“karpat” (no umlauts) finds the Kärpät game', r2.sections.some((s) => s.date === '2026-10-20') && r2.sections.every((s) => s.game?.away.name === 'Kärpät' || s.game?.home.name === 'Kärpät'), r2.sections.map((s) => s.date).join());
const r3 = await search('Niinisari');
check('typo “Niinisari” finds Niinisaari', r3.total > 0);
const r4 = await search('20.10.2026');
check('a date finds that game, including photos without IPTC', r4.total === 14, String(r4.total));
const r5 = await search('qwxz');
check('nonsense finds nothing', r5.total === 0);

const details = await Promise.all(karpat.items.map((it) => api(`/asset/${it[0]}`)));
check('photos without IPTC report it', details.some((d) => d.data.meta === null && d.data.checked) && details.some((d) => d.data.meta?.caption), '');
check('original download streams', (await fetch(`${BASE}/_folio/api/saipa/original/${firstId}`, { headers: H })).status === 200);
check('unknown photo is refused', (await api('/asset/00000000-0000-4000-a000-000000000000')).status === 404);

// Source 2: every photo in the library taken during a SaiPa game (no setup).
const auto = await syncWith({ source: 'games' });
const autoGames = auto.lib.sections.filter((s) => s.kind === 'game');
check('“every game photo” finds the game photos without an album', auto.status.state === 'done' && autoGames.length >= 6 && autoGames.reduce((n, s) => n + s.items.length, 0) >= 61, JSON.stringify(auto.status));
check('“every game photo” skips non-game days', auto.lib.sections.every((s) => s.kind === 'game'));

// Source 3: a folder (external libraries).
const byFolder = await syncWith({ source: 'folder', folder: hockey, subfolders: true });
check('a folder with subfolders works too', byFolder.status.state === 'done' && byFolder.lib.photos === 67, String(byFolder.lib?.photos));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
