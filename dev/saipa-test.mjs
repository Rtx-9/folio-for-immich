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
const hockey = folders.folders.find((f) => /\/Hockey$/.test(f)) || '/mnt/photos/Hockey';
check('parent folders can be picked', folders.folders.includes(hockey) && folders.folders.some((f) => f.includes('/Hockey/2026-27/')), JSON.stringify(folders).slice(0, 200));

await api('/settings', { method: 'PUT', body: { folder: hockey, subfolders: true } });
let status;
for (let i = 0; i < 120; i++) {
  status = (await api('/status')).data;
  if (status.state === 'done' || status.state === 'error') break;
  await sleep(500);
}
check('sync finishes', status.state === 'done', JSON.stringify(status));

const { data: lib } = await api('/library');
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

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
