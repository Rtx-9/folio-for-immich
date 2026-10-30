// End-to-end test for RinkSide inside Folio: fake Z50II + D3 cards are opened in
// a real (headless) Edge/Chrome, culled with the keyboard, captioned, given a
// look and a crop, exported (checked with Pillow, an independent reader) and
// synced to a mock Immich v3 through Folio with the user's Immich login.
//   node dev/rinkside-test.mjs [--shots]    (needs Python with Pillow, and Edge or Chrome)
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../public/rinkside/caption.js';
import { md5 } from '../public/rinkside/media.js';
import { launch } from './rinkside/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dev = path.join(here, 'rinkside');
const tmp = path.join(dev, '.tmp', 'test');
const shots = process.argv.includes('--shots') ? path.join(dev, '.tmp', 'shots') : null;
const PY = process.platform === 'win32' ? 'python' : 'python3';
const MOCK = 2390;
const PORT = 2393;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { cookie: 'immich_access_token=test-key', 'x-folio': '1', 'content-type': 'application/json' };
async function api(method, p, body) {
  const res = await fetch(`${BASE}/_folio/api/rinkside${p}`, { method, headers: H, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const mockState = async () => (await fetch(`http://localhost:${MOCK}/__state`)).json();
const pillow = (...files) => JSON.parse(execFileSync(PY, [path.join(dev, 'check_metadata.py'), ...files], { encoding: 'utf8' }));

// ---------------------------------------------------------------- captions
console.log('Captions, rosters, IPTC digest');
const roster = C.parseRoster('23 Matti Virtanen\n#12 Joni Ikonen\n7. Aku Ankka\nKalle Kiekko 31\n\n');
check('roster lines in several formats', roster.length === 4 && roster[2].num === '7' && roster[3].num === '31' && roster[3].name === 'Kalle Kiekko', roster);
const game = { home: 'HIFK', away: 'Tappara', league: 'Liiga', venue: 'Helsinki Ice Hall', city: 'Helsinki', dateStyle: 'en-US' };
const rosters = { HIFK: C.parseRoster('23 Matti Virtanen\n7 Aku Ankka\n31 Kalle Kiekko'), Tappara: C.parseRoster('12 Joni Ikonen\n4 Ville Varis\n88 Pekka Puck') };
const t = Date.UTC(2026, 9, 29, 18, 31, 5);
const cap = (frame, g = game) => C.captionFor({ t, ...frame }, g, rosters);
check('“23 a12” fills the template', cap({ players: '23 a12' }) === 'Matti Virtanen (HIFK) and Joni Ikonen (Tappara) during the Liiga game between HIFK and Tappara at Helsinki Ice Hall, Helsinki, on October 29, 2026.', cap({ players: '23 a12' }));
check('empty league and arena are cleaned up', cap({ players: '23' }, { ...game, league: '', venue: '' }) === 'Matti Virtanen (HIFK) during the game between HIFK and Tappara, Helsinki, on October 29, 2026.');
check('no players: sentence starts with a capital', cap({ players: '' }).startsWith('During the Liiga game'));
check('empty city leaves no double comma', cap({ players: 'a4' }, { ...game, city: '' }) === 'Ville Varis (Tappara) during the Liiga game between HIFK and Tappara at Helsinki Ice Hall, on October 29, 2026.');
check('Finnish date style', cap({ players: '23 a12 7' }, { ...game, dateStyle: 'fi' }).includes('Matti Virtanen (HIFK), Joni Ikonen (Tappara) ja Aku Ankka (HIFK)') && cap({}, { ...game, dateStyle: 'fi' }).endsWith('29.10.2026.'));
check('Photo Mechanic codes \\23\\ and \\a12\\', cap({ caption: '\\23\\ scores past \\a12\\ at {venue}' }) === 'Matti Virtanen scores past Joni Ikonen at Helsinki Ice Hall');
check('unknown code stays visible', cap({ caption: 'Save by \\a99\\' }) === 'Save by \\a99\\');
check('file name pattern', C.fileName('{date}_{home}-{away}_{seq}', { t, name: 'DSC_0001' }, { home: 'Kärpät', away: 'HIFK' }, 7) === '2026-10-29_Karpat-HIFK_007');
const { createHash } = await import('node:crypto');
const probe = new TextEncoder().encode('Kärpät–HIFK '.repeat(40));
check('MD5 for the IPTC digest matches Node', Buffer.from(md5(probe)).toString('hex') === createHash('md5').update(probe).digest('hex'));

// ---------------------------------------------------------------- servers
const samples = path.join(dev, 'samples');
if (!fs.existsSync(path.join(samples, 'D3'))) execFileSync(process.execPath, [path.join(dev, 'make-samples.mjs')], { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
if (shots) fs.mkdirSync(shots, { recursive: true });
const procs = [];
const start = (args, env = {}) => {
  const p = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', (d) => process.stderr.write(`[${path.basename(args[0])}] ${d}`));
  procs.push(p);
  return p;
};
let mock = start(['dev/rinkside/mock-immich-v3.mjs', String(MOCK)]);
start(['src/server.js'], { IMMICH_URL: `http://localhost:${MOCK}`, PORT: String(PORT), FOLIO_DATA: path.join(tmp, 'folio-data') });
const waitUp = async (url) => {
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`${url} did not start`);
};
await waitUp(`http://localhost:${MOCK}/__state`);
await waitUp(`${BASE}/rinkside`);
let page;

try {
  check('RinkSide needs an Immich login', (await fetch(`${BASE}/_folio/api/rinkside/state`)).status === 401);
  check('the Immich pass-through only allows what RinkSide uses', (await fetch(`${BASE}/_folio/api/rinkside/immich/admin/users`, { headers: H })).status === 404);
  const inject = await (await fetch(`${BASE}/_folio/inject.js`)).text();
  check('a RinkSide item is added to Immich’s sidebar', inject.includes("href: '/rinkside'"));

  // -------------------------------------------------------------- open the cards in the browser
  console.log('Opening the cards (in the browser)');
  page = await launch({ width: 1440, height: 900 });
  // Use the folder-upload field (the native folder picker can't be scripted).
  await page.initScript('delete window.showDirectoryPicker; delete Window.prototype.showDirectoryPicker;');
  await page.goto(`${BASE}/rinkside`);
  await page.eval(`document.cookie = 'immich_access_token=test-key; path=/'`);
  await page.goto(`${BASE}/rinkside`);
  await page.wait(`!document.querySelector('#home').hidden && !document.querySelector('#open-card').hidden`);
  const Z = path.join(samples, 'Z50II');
  const D3 = path.join(samples, 'D3');
  await page.eval(`document.querySelector('#open-card').click()`);
  await page.wait(`document.querySelector('#card-input')`);
  await page.setFiles('#card-input', [Z]);
  await page.wait(`!document.querySelector('#add-card').hidden`);
  await page.eval(`document.querySelector('#add-card').click()`);
  await page.wait(`document.querySelector('#card-input')`);
  await page.setFiles('#card-input', [D3]);
  await page.wait(`document.querySelectorAll('#chosen-cards .chip').length === 2`);
  await page.eval(`document.querySelector('#start-game').click()`);
  await page.wait(`window.rinkside && rinkside.S.sess && rinkside.S.frames.length && document.querySelector('#dlg-setup').open`, 30000);
  const sid = await page.eval('rinkside.S.sess.id');
  let sess = (await api('GET', `/s/${sid}`)).data;
  const byName = (cam, name) => sess.frames.find((f) => f.name === name && sess.cameras[f.cam].label === cam);
  check('25 files on two cards become 14 frames', sess.frames.length === 14, sess.frames.length);
  check('NEF+JPG pairs are joined; NEF-only frames kept', sess.frames.filter((f) => f.jpg && f.nef).length === 11 && sess.frames.filter((f) => f.nef && !f.jpg).length === 2);
  check('both bodies’ DSC_0001 stay separate', byName('Z50II', 'DSC_0001') && byName('D3', 'DSC_0001') && byName('Z50II', 'DSC_0001').id !== byName('D3', 'DSC_0001').id);
  check('files keep their card paths', byName('Z50II', 'DSC_0001').jpg.rel === 'DCIM/100NZ50_/DSC_0001.JPG', byName('Z50II', 'DSC_0001').jpg.rel);
  check('sub-second times and portrait orientation are read', byName('Z50II', 'DSC_0002').t - byName('Z50II', 'DSC_0001').t === 200 && byName('Z50II', 'DSC_0004').o === 8 && byName('D3', 'DSC_0003').o === 6);
  await sleep(600);
  check('games are stored per Immich user', fs.existsSync(path.join(tmp, 'folio-data', 'rinkside', '0f1e2d3c-0000-4000-8000-000000000001', 'games', `${sid}.json`)));

  // -------------------------------------------------------------- game setup (through the dialog)
  const d3Key = Object.keys(sess.cameras).find((k) => sess.cameras[k].label === 'D3');
  await page.eval(`(() => {
    const f = document.querySelector('#setup-form');
    const set = (k, v) => { f.elements[k].value = v; f.elements[k].dispatchEvent(new Event('input', { bubbles: true })); };
    set('home', 'HIFK'); set('away', 'Tappara'); set('league', 'Liiga'); set('venue', 'Helsinki Ice Hall'); set('city', 'Helsinki'); set('country', 'Finland');
    set('byline', 'Test Shooter'); set('credit', 'RinkSide Test'); set('copyright', '© 2026 Test Shooter'); set('keywords', 'ice hockey, jääkiekko');
    set('rosterHome', '23 Matti Virtanen\\n7 Aku Ankka\\n31 Kalle Kiekko\\n10 Teemu Testi');
    set('rosterAway', '12 Joni Ikonen\\n4 Ville Varis\\n88 Pekka Puck');
    document.querySelector('#cameras input[data-cam=${JSON.stringify(d3Key)}][data-kind=offset]').value = '+2:05';
  })()`);
  check('the template example updates as you type', /during the Liiga game between HIFK and Tappara/.test(await page.eval(`document.querySelector('#template-preview').textContent`)));
  await page.eval(`document.querySelector('#setup-form button[value=save]').click()`);
  await page.wait(`rinkside.S.sess.game.home === 'HIFK' && rinkside.S.rosters.HIFK?.length === 4`);
  check('rosters are remembered per team', (await api('GET', '/rosters/Tappara')).data.players.length === 3);

  // -------------------------------------------------------------- culling
  console.log('Culling (keyboard)');
  await page.wait('rinkside.disp && rinkside.disp.id === rinkside.cur().id', 20000);
  const order = await page.eval('rinkside.S.order.map((f) => rinkside.S.sess.cameras[f.cam].label + " " + f.name)');
  check('the D3 clock fix merges both bodies into one timeline', order.slice(0, 4).join() === 'Z50II DSC_0001,D3 DSC_0001,Z50II DSC_0002,D3 DSC_0002', order.slice(0, 4));
  await page.key('Home', { keyCode: 36 });
  await page.wait('rinkside.S.idx === 0 && rinkside.disp && rinkside.disp.id === rinkside.cur().id');
  const key = (k, opts = {}) => page.key(k, { keyCode: opts.keyCode ?? k.toUpperCase().charCodeAt(0), text: opts.text ?? (k.length === 1 ? k : undefined), modifiers: opts.modifiers });
  const idx = () => page.eval('rinkside.S.idx');
  const goTo = async (cam, name) => {
    const i = await page.eval(`rinkside.S.order.findIndex((f) => f.name === ${JSON.stringify(name)} && rinkside.S.sess.cameras[f.cam].label === ${JSON.stringify(cam)})`);
    await page.eval(`rinkside.go(${i})`);
    await page.wait(`rinkside.disp && rinkside.disp.id === rinkside.cur().id`);
  };
  await key('p');
  check('P picks and auto-advances', (await idx()) === 1);
  await key('x');
  await key('4');
  check('X rejects, 4 rates, both advance', (await idx()) === 3);
  await key('p');
  await page.key('Home', { keyCode: 36 });
  await page.key('Enter', { keyCode: 13, text: '\r' });
  check('Enter focuses the players field', (await page.eval('document.activeElement.id')) === 'players');
  await page.type('23 a12');
  await page.key('Enter', { keyCode: 13, text: '\r' });
  await sleep(150);
  check('caption preview names the players', (await page.eval('document.querySelector("#caption-preview").textContent')).startsWith('Matti Virtanen (HIFK) and Joni Ikonen (Tappara) during the Liiga game'));
  await page.key('ArrowRight', { keyCode: 39 });
  await page.key('ArrowRight', { keyCode: 39 });
  await key('=', { keyCode: 187 });
  await key('p');
  await goTo('D3', 'DSC_0002');
  await page.key('Enter', { keyCode: 13, text: '\r' });
  await page.type('23');
  await page.key('Enter', { keyCode: 13, text: '\r' });
  for (const [cam, name] of [['Z50II', 'DSC_0004'], ['Z50II', 'DSC_0005'], ['D3', 'DSC_0004'], ['Z50II', 'DSC_0007'], ['D3', 'DSC_0003'], ['Z50II', 'DSC_0006']]) {
    await goTo(cam, name);
    await key('p');
  }
  await goTo('Z50II', 'DSC_0005');
  await page.key('Enter', { keyCode: 13, text: '\r' });
  await page.type('a12 a4');
  await page.key('Enter', { keyCode: 13, text: '\r', modifiers: 8 });
  check('Shift+Enter saves the players and moves on', (await page.eval('rinkside.cur().name')) !== 'DSC_0005' && (await page.eval('document.activeElement.id')) === 'players');
  await page.key('Escape', { keyCode: 27 });
  await goTo('Z50II', 'DSC_0008');
  await key('x');
  await page.eval('rinkside.go(rinkside.S.idx - 1)');
  await page.key('z', { keyCode: 90, modifiers: 2 });
  await sleep(100);
  check('Ctrl+Z undoes the reject', (await page.eval('rinkside.S.frames.find((f) => f.name === "DSC_0008" && rinkside.S.sess.cameras[f.cam].label === "Z50II").flag')) === 0);

  await page.key('Home', { keyCode: 36 });
  await page.wait('rinkside.disp && rinkside.disp.id === rinkside.cur().id');
  await page.keyDown('ArrowRight', { keyCode: 39 });
  for (let i = 0; i < 3; i++) await page.keyDown('ArrowRight', { keyCode: 39, repeat: true });
  const skim = await page.eval('({ skimming: rinkside.S.skimming, idx: rinkside.S.idx, decoded: rinkside.disp?.id === rinkside.cur().id, thumb: !document.querySelector("#skim").hidden })');
  check('holding → skims thumbnails without decoding', skim.skimming && skim.idx === 4 && skim.thumb && !skim.decoded, skim);
  await page.keyUp('ArrowRight', { keyCode: 39 });
  await page.wait('rinkside.disp && rinkside.disp.id === rinkside.cur().id && document.querySelector("#skim").hidden');
  check('releasing the key loads the full photo', true);
  await key('z');
  await page.wait('!document.querySelector("#zoom-label").hidden');
  check('Z zooms to 100%', Boolean(await page.eval('rinkside.S.zoom')));
  await key('z');
  const picks = await page.eval('rinkside.S.frames.filter((f) => f.flag === 1).length');
  await page.eval('[...document.querySelectorAll("#filters button")].find((b) => b.textContent.startsWith("Picks")).click()');
  check('Picks filter shows only the 9 picks', (await page.eval('rinkside.S.order.length')) === picks && picks === 9, picks);
  await page.eval('[...document.querySelectorAll("#filters button")].find((b) => b.textContent.startsWith("All")).click()');

  // -------------------------------------------------------------- look and crop
  console.log('Look and crop');
  await goTo('Z50II', 'DSC_0001');
  await key('W', { keyCode: 87, modifiers: 8 });
  await sleep(500);
  check('Shift+W sets white balance from the ice (warms the blue cast)', (await page.eval('rinkside.S.sess.look.temp')) > 10);
  await goTo('Z50II', 'DSC_0002');
  await page.eval('document.querySelector("#scope-photo").click()');
  await page.eval('rinkside.setLook({ exposure: 1 })');
  await key('c', { keyCode: 67, modifiers: 2 });
  await goTo('Z50II', 'DSC_0007');
  await key('v', { keyCode: 86, modifiers: 2 });
  check('a photo’s own look can be copied and pasted', (await page.eval('rinkside.cur().look?.exposure')) === 1);
  await page.eval('document.querySelector("#scope-game").click()');
  await goTo('Z50II', 'DSC_0001');
  await key('c');
  await page.wait('!document.querySelector("#crop-layer").hidden && rinkside.disp');
  await page.eval('rinkside.setRatio("4:5")');
  await page.key('Enter', { keyCode: 13, text: '\r' });
  await page.wait('rinkside.cur().crop');
  const crop = await page.eval('rinkside.cur().crop');
  check('crop 4:5 is stored', crop.ratio === '4:5' && Math.abs((crop.w * 5568) / (crop.h * 3712) - 0.8) < 0.01, crop);
  await page.wait('rinkside.disp && rinkside.disp.id === rinkside.cur().id');
  if (shots) {
    await sleep(300);
    await page.screenshot(path.join(shots, '1-loupe.png'));
    await key('g');
    await sleep(900);
    await page.screenshot(path.join(shots, '2-grid.png'));
    await key('e');
  }
  await sleep(800); // let the last saves land
  sess = (await api('GET', `/s/${sid}`)).data;
  check('picks, stars, players, look and crop are saved in Folio', sess.frames.filter((f) => f.flag === 1).length === 9 && byName('Z50II', 'DSC_0002').stars === 4 && byName('Z50II', 'DSC_0001').players === '23 a12' && byName('Z50II', 'DSC_0002').look?.exposure === 1 && byName('Z50II', 'DSC_0001').crop?.ratio === '4:5' && sess.look.temp > 10);

  // -------------------------------------------------------------- export (to a private browser folder)
  console.log('Export');
  // An in-memory folder with the File System Access API's shape (the headless
  // browser's private storage isn't usable from this profile).
  await page.eval(`(() => {
    const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
    class Dir {
      constructor(name) { this.name = name; this.kind = 'directory'; this.items = new Map(); }
      async getDirectoryHandle(n, o = {}) { if (!this.items.has(n)) { if (!o.create) throw notFound(); this.items.set(n, new Dir(n)); } return this.items.get(n); }
      async getFileHandle(n, o = {}) {
        if (!this.items.has(n)) { if (!o.create) throw notFound(); this.items.set(n, { kind: 'file', name: n, data: null, async createWritable() { const chunks = []; const f = this; const ws = new WritableStream({ write(c) { chunks.push(c); }, close() { f.data = new Blob(chunks); } }); ws.write = async (d) => chunks.push(d); ws.close = async () => { f.data = new Blob(chunks); }; return ws; }, async getFile() { return new File([this.data], this.name); } }); }
        return this.items.get(n);
      }
      async *entries() { yield* this.items.entries(); }
    }
    window.__rinksideExportDir = new Dir('Pictures');
  })()`);
  await key('e', { keyCode: 69, modifiers: 2 });
  await page.wait('document.querySelector("#dlg-export").open');
  await page.eval(`(() => { const f = document.querySelector('#export-form'); f.elements.scope.value = 'picks'; f.elements.longEdge.value = '1600'; f.elements.quality.value = '88'; f.elements.folder.value = 'Game'; f.elements.originals.checked = true; f.dispatchEvent(new Event('input')); })()`);
  await page.eval('document.querySelector("#export-go").click()');
  await page.wait('/exported to/.test(document.querySelector("#export-progress .msg").textContent)', 90000);
  const exportMsg = await page.eval('document.querySelector("#export-progress .msg").textContent');
  check('export finishes', /^9 photo\(s\) exported/.test(exportMsg) && !/failed/.test(exportMsg), exportMsg);
  if (shots) await page.screenshot(path.join(shots, '3-export.png'));
  await page.eval('document.querySelector("#dlg-export").close()');
  // Copy the exported files out of the browser to check them.
  const outDir = path.join(tmp, 'export');
  const listing = await page.eval(`(async () => {
    const out = [];
    const walk = async (dir, prefix) => { for await (const [name, h] of dir.entries()) { if (h.kind === 'directory') await walk(h, prefix + name + '/'); else out.push(prefix + name); } };
    await walk(await window.__rinksideExportDir.getDirectoryHandle('Game'), '');
    return out;
  })()`);
  for (const rel of listing) {
    const b64 = await page.eval(`(async () => {
      let dir = await window.__rinksideExportDir.getDirectoryHandle('Game');
      const parts = ${JSON.stringify(rel)}.split('/');
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
      const buf = new Uint8Array(await (await (await dir.getFileHandle(parts.at(-1))).getFile()).arrayBuffer());
      let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768));
      return btoa(s);
    })()`);
    fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(outDir, rel), Buffer.from(b64, 'base64'));
  }
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.jpg'));
  check('one JPEG per pick, named by the pattern', files.length === 9 && files.every((f) => /^2026-10-29_HIFK-Tappara_\d{3}\.jpg$/.test(f)), files);
  const report = pillow(...files.map((f) => path.join(outDir, f)));
  const all = (fn) => report.every(fn);
  check('Pillow: orientation reset to 1, long edge 1600', all((r) => r.exif.Orientation === 1 && Math.max(...r.size) <= 1600 && Math.max(...r.size) >= 1500));
  check('Pillow: original EXIF kept (camera, time, exposure, ISO)', all((r) => /NIKON/.test(r.exif.Model) && r.exif.DateTimeOriginal?.startsWith('2026:10:29') && r.exif.ExposureTime === 0.001 && r.exif.ISOSpeedRatings === 3200));
  check('Pillow: EXIF size matches the new pixels', all((r) => r.exif.ExifImageWidth === r.size[0] && r.exif.ExifImageHeight === r.size[1]));
  check('Pillow: IPTC caption, byline, copyright, credit, place, date', all((r) => r.iptc['Caption-Abstract'] && r.iptc['By-line'] === 'Test Shooter' && r.iptc.CopyrightNotice === '© 2026 Test Shooter' && r.iptc.Credit === 'RinkSide Test' && r.iptc.City === 'Helsinki' && r.iptc['Sub-location'] === 'Helsinki Ice Hall' && r.iptc.DateCreated === '20261029'), report[0].iptc);
  check('Pillow: IPTC keywords include game keywords, teams and players', report.some((r) => ['ice hockey', 'jääkiekko', 'Liiga', 'HIFK', 'Tappara', 'Matti Virtanen'].every((k) => r.iptc.Keywords?.includes(k))));
  check('Pillow: XMP matches IPTC', all((r) => r.xmp && r.xmp['dc:description'] === r.iptc['Caption-Abstract'] && r.xmp['dc:creator'] === 'Test Shooter' && r.xmp['photoshop:City'] === 'Helsinki'));
  const first = report.find((r) => r.iptc['Caption-Abstract'].startsWith('Matti Virtanen (HIFK) and Joni Ikonen') && Math.abs(r.size[0] / r.size[1] - 0.8) < 0.01);
  check('crop 4:5 applied to the exported pixels', Boolean(first), report.map((r) => r.size));
  const portraits = report.filter((r) => r.size[1] > r.size[0] && Math.abs(r.size[0] / r.size[1] - 2 / 3) < 0.01);
  check('portrait frames export upright', portraits.length === 2 && all((r) => r.top_brightness < 90), report.map((r) => [r.file, r.size, r.top_brightness]));
  const bright = report.find((r) => r !== first && r.iptc['Caption-Abstract'].startsWith('Matti Virtanen (HIFK) and Joni Ikonen'));
  const other = report.find((r) => r.iptc['Caption-Abstract'].startsWith('During') && r.size[0] > r.size[1]);
  check('a +1 EV photo look exports brighter', bright && other && bright.mean[0] > other.mean[0] + 15, [bright?.mean, other?.mean]);
  check('NEF-only frame exports from its embedded preview', report.some((r) => r.iptc['Caption-Abstract'].startsWith('Joni Ikonen (Tappara) and Ville Varis') && r.size[0] === 1600));
  const originals = fs.readdirSync(path.join(outDir, 'Originals')).sort();
  check('originals copied with sidecars; DSC_0002 from both bodies kept apart', ['DSC_0002.JPG', 'DSC_0002.NEF', 'DSC_0002.xmp', 'DSC_0002_D3.JPG', 'DSC_0002_D3.NEF', 'DSC_0002_D3.xmp', 'DSC_0004.NEF', 'DSC_0004_D3.NEF'].every((f) => originals.includes(f)), originals);
  check('copied originals are byte-identical', fs.readFileSync(path.join(outDir, 'Originals', 'DSC_0002.NEF')).equals(fs.readFileSync(path.join(Z, 'DCIM', '100NZ50_', 'DSC_0002.NEF'))));
  const sidecar = fs.readFileSync(path.join(outDir, 'Originals', 'DSC_0002.xmp'), 'utf8');
  check('sidecar has caption, 4-star rating and pick tag', /<dc:description>[\s\S]*Matti Virtanen/.test(sidecar) && /xmp:Rating="4"/.test(sidecar) && /photomechanic:Tagged="True"/.test(sidecar));

  // -------------------------------------------------------------- reopen: the card must be connected again
  console.log('Reopening the game');
  await page.goto(`${BASE}/rinkside?game=${sid}`);
  await page.wait(`window.rinkside && rinkside.S.frames.length && !document.querySelector('#reconnect').hidden`, 20000);
  check('after a reload it asks for the card (picks are still there)', (await page.eval('rinkside.S.frames.filter((f) => f.flag === 1).length')) === 9);
  await page.eval(`document.querySelector('#reconnect-btn').click()`);
  await page.wait(`document.querySelector('#card-input')`);
  await page.setFiles('#card-input', [D3]);
  await sleep(500);
  check('the wrong card is refused', !(await page.eval(`document.querySelector('#reconnect').hidden`)) && /isn't Z50II/.test(await page.eval(`document.querySelector('#toast').textContent`)), await page.eval(`document.querySelector('#toast').textContent`));
  await page.eval(`document.querySelector('#reconnect-btn').click()`);
  await page.wait(`document.querySelector('#card-input')`);
  await page.setFiles('#card-input', [Z]);
  await page.wait(`document.querySelector('#reconnect-btn').textContent.includes('D3')`);
  await page.eval(`document.querySelector('#reconnect-btn').click()`);
  await page.wait(`document.querySelector('#card-input')`);
  await page.setFiles('#card-input', [D3]);
  await page.wait(`document.querySelector('#reconnect').hidden && rinkside.disp && rinkside.disp.id === rinkside.cur().id`, 20000);
  check('with both cards connected the photos show again', true);

  // -------------------------------------------------------------- sync
  console.log('Sync to Immich (mock, through Folio with the Immich login)');
  const runSync = async (options) => {
    await page.eval('document.querySelector("#btn-sync").click()');
    await page.wait('document.querySelector("#dlg-sync").open');
    if (options) {
      await page.eval(`(() => { const f = document.querySelector('#sync-form'); const o = ${JSON.stringify(options)}; for (const [k, v] of Object.entries(o)) { const el = f.elements[k]; if (el.type === 'checkbox') el.checked = v; else el.value = v; } })()`);
    }
    await page.eval('document.querySelector("#sync-go").click()');
    await page.wait('!document.querySelector("#sync-go").disabled && /^(Done|Stopped)/.test(document.querySelector("#sync-progress .msg").textContent)', 90000);
    const msg = await page.eval('document.querySelector("#sync-progress .msg").textContent');
    const errors = await page.eval('[...document.querySelectorAll("#sync-progress .errors li")].map((l) => l.textContent)');
    await page.eval('document.querySelector("#dlg-sync").close()');
    return { msg, errors };
  };
  let s = await runSync({ scope: 'picks', includeRaw: true, rejects: 'archive' });
  let st = await mockState();
  const uploaded = st.assets.filter((a) => a.sidecar);
  const pickFiles = sess.frames.filter((f) => f.flag === 1).reduce((n, f) => n + (f.jpg ? 1 : 0) + (f.nef ? 1 : 0), 0);
  check('picks uploaded straight from the card (JPG + NEF)', s.msg.startsWith(`Done: ${pickFiles} uploaded`) && uploaded.length === pickFiles && !s.errors.length, s);
  check('uploads went through Folio with the Immich login (no API key)', st.auth.apiKey === 0 && st.auth.cookie > 20, st.auth);
  check('uploaded files are byte-identical to the card (SHA-1)', uploaded.some((a) => a.originalFileName === 'DSC_0005.NEF' && a.checksum === createHash('sha1').update(fs.readFileSync(path.join(Z, 'DCIM', '100NZ50_', 'DSC_0005.NEF'))).digest('base64')));
  check('RAW+JPG pairs are stacked, JPG on top', st.stacks.length === sess.frames.filter((f) => f.flag === 1 && f.jpg && f.nef).length && st.stacks.every((x) => /\.JPG$/.test(st.assets.find((a) => a.id === x.primaryAssetId).originalFileName)));
  check('picks became favorites', uploaded.every((a) => a.isFavorite));
  const zA = st.assets.filter((a) => a.originalFileName.startsWith('DSC_0001') && a.description?.startsWith('Matti'));
  check('captions became descriptions', zA.length === 2 && zA[0].description.startsWith('Matti Virtanen (HIFK) and Joni Ikonen (Tappara) during the Liiga game'));
  check('players, teams and pick tags', zA.every((a) => ['Players/Matti Virtanen', 'Players/Joni Ikonen', 'Teams/HIFK', 'Teams/Tappara', 'RinkSide/Pick'].every((x) => a.tags.includes(x))), zA.map((a) => a.tags));
  check('stars became ratings', uploaded.filter((a) => a.rating === 4).length === 2);
  const album = st.albums.find((a) => a.albumName === '2026-10-29 HIFK vs Tappara');
  check('game album created with every upload', album && album.assets.length === pickFiles);
  const before = st.log.filter((l) => l === 'POST /api/assets').length;
  s = await runSync();
  st = await mockState();
  check('syncing again uploads nothing (checksums match)', s.msg.startsWith('Done: 0 uploaded') && st.log.filter((l) => l === 'POST /api/assets').length === before, s.msg);
  await api('PATCH', `/s/${sid}/frames`, { ids: [byName('Z50II', 'DSC_0001').id], set: { players: '7' } });
  await page.eval(`rinkside.S.byId.get(${JSON.stringify(byName('Z50II', 'DSC_0001').id)}).players = '7'`);
  s = await runSync();
  st = await mockState();
  const zB = st.assets.find((a) => a.id === zA[0].id);
  check('changed players: description and tags follow, old tags removed', zB.description.startsWith('Aku Ankka (HIFK)') && zB.tags.includes('Players/Aku Ankka') && !zB.tags.includes('Players/Matti Virtanen'), zB);
  s = await runSync({ scope: 'all', includeRaw: false });
  st = await mockState();
  const rej = st.assets.find((a) => a.sidecar?.includes('xmp:Rating="-1"'));
  check('full card: rejects archived with rating -1, not in the album', rej && rej.visibility === 'archive' && rej.rating === -1 && !st.albums.find((a) => a.albumName === '2026-10-29 HIFK vs Tappara').assets.includes(rej.id), s);
  check('nothing was deleted in Immich', !st.log.some((l) => l.startsWith('DELETE /api/assets')));
  sess = (await api('GET', `/s/${sid}`)).data;
  check('sync progress is saved in Folio', Object.keys(sess.sync.assets).length === 14 && sess.sync.last && sess.sync.albumName === '2026-10-29 HIFK vs Tappara');

  // People
  await page.eval('document.querySelector("#btn-sync").click()');
  await page.eval('document.querySelector("#people-go").click()');
  await page.wait('document.querySelector("#people input[data-person]") || /No suggestions/.test(document.querySelector("#people").textContent)', 20000);
  check('suggests a name for an Immich person', (await page.eval('document.querySelector("#people input[data-person]")?.dataset.name')) === 'Matti Virtanen');
  await page.eval('document.querySelector("#people .primary").click()');
  await sleep(500);
  check('names the person in Immich', (await mockState()).people[0].name === 'Matti Virtanen');
  await page.eval('document.querySelector("#dlg-sync").close()');

  // Offline
  mock.kill();
  await sleep(300);
  s = await runSync();
  check('Immich unreachable: sync stops with a clear message', /^Stopped: .*(reach Immich)/.test(s.msg), s.msg);

  // -------------------------------------------------------------- an Immich album
  console.log('Open an Immich album');
  mock = start(['dev/rinkside/mock-immich-v3.mjs', String(MOCK)]);
  await waitUp(`http://localhost:${MOCK}/__state`);
  await page.eval('document.querySelector("#go-home").click()');
  await page.wait(`!document.querySelector('#home').hidden && document.querySelectorAll('.game-row').length === 1`);
  await page.eval('document.querySelector("#open-album").click()');
  await page.wait(`[...document.querySelectorAll('#album-list button')].some((b) => b.textContent.includes('SaiPa vs Kärpät'))`);
  await page.eval(`[...document.querySelectorAll('#album-list button')].find((b) => b.textContent.includes('SaiPa vs Kärpät')).click()`);
  await page.wait(`rinkside.S.sess?.mode === 'immich' && rinkside.disp && rinkside.disp.id === rinkside.cur().id`, 20000);
  await page.eval('document.querySelector("dialog[open]")?.close()');
  const s2 = await page.eval('rinkside.S.sess.id');
  const sess2 = (await api('GET', `/s/${s2}`)).data;
  check('album opens as a game with its favorites, stars and captions', sess2.frames.length === 3 && sess2.frames[0].flag === 1 && sess2.frames[2].stars === 4 && sess2.frames[1].caption === 'Old caption');
  await api('PATCH', `/s/${s2}`, { game: { home: 'SaiPa', away: 'Kärpät', league: 'Liiga' } });
  await api('PUT', '/rosters/SaiPa', { players: [{ num: '33', name: 'Kari Piiroinen' }] });
  await api('PATCH', `/s/${s2}/frames`, { ids: [sess2.frames[0].id], set: { stars: 2, players: '33' } });
  await api('PATCH', `/s/${s2}/frames`, { ids: [sess2.frames[1].id], set: { flag: -1 } });
  await page.goto(`${BASE}/rinkside?game=${s2}`);
  await page.wait(`rinkside.S.sess?.mode === 'immich' && rinkside.disp`, 20000);
  s = await runSync();
  st = await mockState();
  const [a0, a1, a2] = sess2.frames.map((f) => st.assets.find((a) => a.id === f.id));
  check('album sync updates Immich in place, no uploads', s.msg.startsWith('Done') && !st.log.includes('POST /api/assets') && a0.rating === 2 && a0.description.startsWith('Kari Piiroinen (SaiPa) during the Liiga game') && a0.tags.includes('Players/Kari Piiroinen'), [s, a0]);
  check('album sync: reject archived, existing caption and stars kept', a1.visibility === 'archive' && a1.rating === -1 && a1.description === 'Old caption' && a2.rating === 4);

  const errors = page.logs.filter((l) => /^(error|exception)/.test(l));
  check('no errors in the browser console', !errors.length, errors);
} finally {
  await page?.close();
  for (const p of procs) p.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
