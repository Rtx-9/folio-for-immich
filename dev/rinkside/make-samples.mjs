// Generate two fake memory cards that imitate a Nikon Z50II and a Nikon D3:
// RAW+JPEG pairs, a portrait frame, NEFs without a JPG, a JPG without a NEF,
// identical file names on both bodies and a D3 clock that is 2 min 5 s slow.
//   node dev/rinkside/make-samples.mjs [outDir]      (needs Python with Pillow)
//
// The TIFF writer here is deliberately separate from RinkSide's own, so the
// samples test RinkSide's reader instead of mirroring it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(here, 'samples'));

const HOME = [200, 30, 45];
const AWAY = [240, 240, 240];
const Z = {
  card: 'Z50II', folder: 'DCIM/100NZ50_', make: 'NIKON CORPORATION', model: 'NIKON Z50_2', serial: '6012345', w: 5568, h: 3712,
  raw: [5600, 3728], lens: 'NIKKOR Z DX 50-250mm f/4.5-6.3 VR', tz: '+02:00', previewSub: true, mpf: true, clock: 0,
};
const D3 = { card: 'D3', folder: 'DCIM/100ND3__', make: 'NIKON CORPORATION', model: 'NIKON D3', w: 4256, h: 2832, raw: [4288, 2848], lens: '', clock: -125 };

// [camera, number, true local time (s after 18:31:00), files, orientation, players]
const SHOTS = [
  [Z, 1, 5.1, 'both', 1, [[23, HOME], [12, AWAY]]],
  [Z, 2, 5.3, 'both', 1, [[23, HOME], [12, AWAY]]],
  [Z, 3, 5.5, 'both', 1, [[23, HOME]]],
  [Z, 4, 61, 'both', 8, [[7, HOME]]],
  [Z, 5, 140.25, 'nef', 1, [[12, AWAY], [4, AWAY]]],
  [Z, 6, 600, 'jpg', 1, [[31, HOME]]],
  [Z, 7, 852, 'both', 1, [[23, HOME], [88, AWAY]]],
  [Z, 8, 1900.2, 'both', 1, [[10, HOME]]],
  [D3, 1, 5.2, 'both', 1, [[12, AWAY], [23, HOME]]],
  [D3, 2, 5.4, 'both', 1, [[12, AWAY]]],
  [D3, 3, 300, 'both', 6, [[31, HOME]]],
  [D3, 4, 420, 'nef', 1, [[4, AWAY]]],
  [D3, 5, 860, 'both', 1, [[88, AWAY]]],
  [D3, 6, 1905, 'both', 1, [[10, HOME], [12, AWAY]]],
];

// ---- tiny TIFF builder ------------------------------------------------------
const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };
function tiff(le, ifds, blobs) {
  // ifds: [{ name, entries: [[tag, type, value | (L) => value]], next? }]; blobs: { name: Buffer }
  const count = (type, v) => (type === 2 ? Buffer.byteLength(v) + 1 : type === 7 ? v.length : type === 5 ? v.length : v.length);
  const L = { ifd: {}, blob: {}, len: {} };
  let pos = 8;
  for (const ifd of ifds) {
    L.ifd[ifd.name] = pos;
    pos += 2 + ifd.entries.length * 12 + 4;
    for (const [, type, v, fnCount = 1] of ifd.entries) {
      const n = typeof v === 'function' ? fnCount : count(type, v);
      const size = SIZE[type] * n;
      if (size > 4) pos += size + (size & 1);
    }
  }
  for (const [name, b] of Object.entries(blobs)) {
    L.blob[name] = pos;
    L.len[name] = b.length;
    pos += b.length + (b.length & 1);
  }
  const out = Buffer.alloc(pos);
  const w16 = (n, o) => (le ? out.writeUInt16LE(n, o) : out.writeUInt16BE(n, o));
  const w32 = (n, o) => (le ? out.writeUInt32LE(n, o) : out.writeUInt32BE(n, o));
  out.write(le ? 'II' : 'MM', 0, 'latin1');
  w16(42, 2);
  w32(8, 4);
  for (const ifd of ifds) {
    let o = L.ifd[ifd.name];
    let d = o + 2 + ifd.entries.length * 12 + 4;
    w16(ifd.entries.length, o);
    o += 2;
    for (const [tag, type, raw] of [...ifd.entries].sort((a, b) => a[0] - b[0])) {
      const v = typeof raw === 'function' ? raw(L) : raw;
      const n = count(type, v);
      const size = SIZE[type] * n;
      w16(tag, o);
      w16(type, o + 2);
      w32(n, o + 4);
      let at = o + 8;
      if (size > 4) {
        w32(d, o + 8);
        at = d;
        d += size + (size & 1);
      }
      if (type === 2) out.write(`${v}\0`, at, 'utf8');
      else if (type === 7 || type === 1) Buffer.from(v).copy(out, at);
      else if (type === 3) v.forEach((x, i) => w16(x, at + i * 2));
      else if (type === 4) v.forEach((x, i) => w32(x, at + i * 4));
      else if (type === 5) v.forEach(([a, b], i) => (w32(a, at + i * 8), w32(b, at + i * 8 + 4)));
      o += 12;
    }
    w32(ifd.next ? L.ifd[ifd.next] : 0, o);
  }
  for (const [name, b] of Object.entries(blobs)) b.copy(out, L.blob[name]);
  return out;
}

// ---- pixels (Pillow) --------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rinkside-samples-'));
const jobs = [];
const pix = (name, job) => {
  const out = path.join(tmp, name);
  jobs.push({ ...job, out });
  return () => fs.readFileSync(out);
};

const pad = (n, k = 2) => String(n).padStart(k, '0');
function stamp(cam, sec) {
  const t = new Date(Date.UTC(2026, 9, 29, 18, 31, 0) + Math.round((sec + cam.clock) * 1000));
  const sub = pad(Math.round((t.getUTCMilliseconds() / 10)));
  return { dt: `${t.getUTCFullYear()}:${pad(t.getUTCMonth() + 1)}:${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`, sub };
}

const plan = SHOTS.map(([cam, n, sec, files, orientation, players]) => {
  const name = `DSC_${pad(n, 4)}`;
  const label = `${cam.card} ${name}`;
  const base = { players, label, orientation, cast: cam === Z ? [192, 212, 240] : [214, 214, 200] };
  return {
    cam, name, sec, files, orientation,
    full: pix(`${cam.card}-${name}-full.jpg`, { ...base, w: cam.w, h: cam.h, quality: 88 }),
    nefFull: files !== 'jpg' && pix(`${cam.card}-${name}-nef.jpg`, { ...base, w: cam.w, h: cam.h, quality: 80 }),
    mid: pix(`${cam.card}-${name}-mid.jpg`, { ...base, w: 640, h: Math.round((640 * cam.h) / cam.w), quality: 80 }),
    thumb: pix(`${cam.card}-${name}-thumb.jpg`, { ...base, w: 160, h: 120, quality: 80 }),
    rgb: pix(`${cam.card}-${name}-thumb.rgb`, { ...base, w: 160, h: 120, rgb: true }),
  };
});
execFileSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(here, 'render.py')], { input: JSON.stringify(jobs), stdio: ['pipe', 'inherit', 'inherit'] });

const stripJfif = (jpeg) => {
  // Pillow writes a JFIF APP0 first; cameras don't.
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) return Buffer.concat([jpeg.subarray(0, 2), jpeg.subarray(4 + jpeg.readUInt16BE(4))]);
  return jpeg;
};
const seg = (marker, payload) => {
  const h = Buffer.from([0xff, marker, 0, 0]);
  h.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([h, payload]);
};

function exifEntries(cam, shot) {
  const { dt, sub } = stamp(cam, shot.sec);
  const ifd0 = [
    [0x010f, 2, cam.make],
    [0x0110, 2, cam.model],
    [0x0112, 3, [shot.orientation]],
    [0x011a, 5, [[300, 1]]],
    [0x011b, 5, [[300, 1]]],
    [0x0128, 3, [2]],
    [0x0131, 2, 'Ver.01.10'],
    [0x0132, 2, dt],
    [0x0213, 3, [2]],
  ];
  const makerTiff = tiff(false, [{ name: 'm', entries: [[0x0001, 7, Buffer.from('0211')], [0x0002, 3, [0, 3200]]] }], {});
  const exif = [
    [0x829a, 5, [[1, 1000]]],
    [0x829d, 5, [[28, 10]]],
    [0x8827, 3, [3200]],
    [0x9000, 7, Buffer.from('0231')],
    [0x9003, 2, dt],
    [0x9004, 2, dt],
    [0x920a, 5, [[2000, 10]]],
    [0x927c, 7, Buffer.concat([Buffer.from('Nikon\0\x02\x11\0\0', 'latin1'), makerTiff])],
    [0x9291, 2, sub],
    [0x9290, 2, sub],
    [0xa001, 3, [1]],
  ];
  if (cam.tz) exif.push([0x9011, 2, cam.tz]);
  if (cam.serial) exif.push([0xa431, 2, cam.serial]);
  if (cam.lens) exif.push([0xa434, 2, cam.lens]);
  return { ifd0, exif };
}

function makeJpg(cam, shot) {
  const { ifd0, exif } = exifEntries(cam, shot);
  const thumb = shot.thumb();
  const exifTiff = tiff(
    false,
    [
      { name: 'ifd0', entries: [...ifd0, [0x8769, 4, (L) => [L.ifd.exif]]], next: 'ifd1' },
      { name: 'exif', entries: [...exif, [0xa002, 4, [cam.w]], [0xa003, 4, [cam.h]]] },
      { name: 'ifd1', entries: [[0x0103, 3, [6]], [0x0201, 4, (L) => [L.blob.thumb]], [0x0202, 4, [thumb.length]]] },
    ],
    { thumb },
  );
  const app1 = seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exifTiff]));
  const main = stripJfif(shot.full());
  if (!cam.mpf) return Buffer.concat([main.subarray(0, 2), app1, main.subarray(2)]);
  // Multi-Picture Format: the main image, then a 640 px preview after it.
  const preview = stripJfif(shot.mid());
  const mpf = (mainLen, prevOffset) =>
    seg(0xe2, Buffer.concat([
      Buffer.from('MPF\0', 'latin1'),
      tiff(false, [{ name: 'mp', entries: [[0xb000, 7, Buffer.from('0100')], [0xb001, 4, [2]], [0xb002, 7, (() => {
        const e = Buffer.alloc(32);
        e.writeUInt32BE(0x20030000, 0);
        e.writeUInt32BE(mainLen, 4);
        e.writeUInt32BE(0, 8);
        e.writeUInt32BE(0x00010001, 16);
        e.writeUInt32BE(preview.length, 20);
        e.writeUInt32BE(prevOffset, 24);
        return e;
      })()]] }], {}),
    ]));
  const mpfAt = 2 + app1.length + 4 + 4; // marker + length, then "MPF\0": offsets count from the TIFF header
  const mainLen = 2 + app1.length + mpf(0, 0).length + main.length - 2;
  return Buffer.concat([main.subarray(0, 2), app1, mpf(mainLen, mainLen - mpfAt), main.subarray(2), preview]);
}

function makeNef(cam, shot) {
  const { ifd0, exif } = exifEntries(cam, shot);
  const full = stripJfif(shot.nefFull());
  const blobs = { rgb: shot.rgb(), full, raw: Buffer.alloc(4096, 0x5a) };
  const subs = [];
  if (cam.previewSub) {
    blobs.mid = stripJfif(shot.mid());
    subs.push({ name: 'mid', entries: [[0x00fe, 4, [1]], [0x0103, 3, [6]], [0x0201, 4, (L) => [L.blob.mid]], [0x0202, 4, [blobs.mid.length]], [0x0213, 3, [2]]] });
  }
  const fullIfd = { name: 'full', entries: [[0x00fe, 4, [1]], [0x0103, 3, [6]], [0x0201, 4, (L) => [L.blob.full]], [0x0202, 4, [full.length]], [0x0213, 3, [2]]] };
  const rawIfd = {
    name: 'raw',
    entries: [[0x00fe, 4, [0]], [0x0100, 4, [cam.raw[0]]], [0x0101, 4, [cam.raw[1]]], [0x0102, 3, [14]], [0x0103, 3, [34713]], [0x0106, 3, [32803]], [0x0111, 4, (L) => [L.blob.raw]], [0x0115, 3, [1]], [0x0116, 4, [cam.raw[1]]], [0x0117, 4, [4096]]],
  };
  // Z cameras: small preview, raw, full preview. D3: full preview, raw.
  subs.push(...(cam.previewSub ? [rawIfd, fullIfd] : [fullIfd, rawIfd]));
  return tiff(
    false,
    [
      {
        name: 'ifd0',
        entries: [
          ...ifd0,
          [0x00fe, 4, [1]], [0x0100, 4, [160]], [0x0101, 4, [120]], [0x0102, 3, [8, 8, 8]], [0x0103, 3, [1]], [0x0106, 3, [2]],
          [0x0111, 4, (L) => [L.blob.rgb]], [0x0115, 3, [3]], [0x0116, 4, [120]], [0x0117, 4, [57600]], [0x011c, 3, [1]],
          [0x014a, 4, (L) => subs.map((s) => L.ifd[s.name]), subs.length],
          [0x8769, 4, (L) => [L.ifd.exif]],
        ],
      },
      ...subs,
      { name: 'exif', entries: exif },
    ],
    blobs,
  );
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const shot of plan) {
  const dir = path.join(OUT, shot.cam.card, shot.cam.folder);
  fs.mkdirSync(dir, { recursive: true });
  if (shot.files !== 'nef') fs.writeFileSync(path.join(dir, `${shot.name}.JPG`), makeJpg(shot.cam, shot));
  if (shot.files !== 'jpg') fs.writeFileSync(path.join(dir, `${shot.name}.NEF`), makeNef(shot.cam, shot));
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Sample cards written to ${OUT}`);
