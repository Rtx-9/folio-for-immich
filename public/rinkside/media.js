// Reading camera files and writing metadata, in the browser: TIFF/EXIF, JPEG
// segments, Nikon NEF previews, pairing NEF+JPG, and EXIF/IPTC/XMP for exports.
// Works on Blob/File, so it runs on files straight from the card (and in Node
// for the tests). Nothing here modifies a source file.
import { captionFor, gameTitle, headlineFor, keywordsFor, parsePlayers } from './caption.js';

const te = new TextEncoder();
const td = new TextDecoder();
export const utf8 = (s) => te.encode(String(s));
export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const latin1 = (u8, a = 0, b = u8.length) => String.fromCharCode(...u8.subarray(a, b));
const eq = (u8, at, s) => latin1(u8, at, at + s.length) === s;

// ---- random access to a Blob/File in cached 64 KB blocks ---------------------------

export class Source {
  constructor(blob) {
    this.blob = blob;
    this.size = blob.size;
    this.blocks = new Map();
  }

  async bytes(offset, length) {
    if (offset < 0 || length < 0 || offset + length > this.size) throw new Error('Read past end of file');
    if (length > 262144) return new Uint8Array(await this.blob.slice(offset, offset + length).arrayBuffer());
    const B = 65536;
    const first = Math.floor(offset / B);
    const parts = [];
    for (let b = first; b * B < offset + length; b++) {
      let block = this.blocks.get(b);
      if (!block) {
        block = new Uint8Array(await this.blob.slice(b * B, Math.min(this.size, (b + 1) * B)).arrayBuffer());
        if (this.blocks.size > 48) this.blocks.delete(this.blocks.keys().next().value);
        this.blocks.set(b, block);
      }
      parts.push(block);
    }
    const all = parts.length === 1 ? parts[0] : concat(...parts);
    const start = offset - first * B;
    return all.subarray(start, start + length);
  }
}

// ---- TIFF / EXIF ---------------------------------------------------------------------

const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
export const TAG = {
  NewSubfileType: 0x00fe, ImageWidth: 0x0100, ImageLength: 0x0101, BitsPerSample: 0x0102, Compression: 0x0103,
  Photometric: 0x0106, ImageDescription: 0x010e, Make: 0x010f, Model: 0x0110, StripOffsets: 0x0111, Orientation: 0x0112,
  SamplesPerPixel: 0x0115, StripByteCounts: 0x0117, Software: 0x0131, DateTime: 0x0132, Artist: 0x013b, SubIFDs: 0x014a,
  JpegOffset: 0x0201, JpegLength: 0x0202, Copyright: 0x8298, ExposureTime: 0x829a, FNumber: 0x829d, ExifIFD: 0x8769,
  GPSIFD: 0x8825, ISO: 0x8827, DateTimeOriginal: 0x9003, OffsetTimeOriginal: 0x9011, FocalLength: 0x920a, MakerNote: 0x927c,
  SubSecTimeOriginal: 0x9291, PixelXDimension: 0xa002, PixelYDimension: 0xa003, InteropIFD: 0xa005, BodySerialNumber: 0xa431, LensModel: 0xa434,
};

const view = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

// Parse a TIFF structure starting at `base` (offsets inside are relative to it).
export async function parseTiff(src, base = 0) {
  const head = await src.bytes(base, 8);
  const order = latin1(head, 0, 2);
  if (order !== 'II' && order !== 'MM') throw new Error('Not a TIFF structure');
  const le = order === 'II';
  if (view(head).getUint16(2, le) !== 42) throw new Error('Not a TIFF structure');
  const tiff = { src, base, le };
  const seen = new Set();
  async function readIfd(offset) {
    if (!offset || seen.has(offset) || base + offset + 2 > src.size) return null;
    seen.add(offset);
    const n = view(await src.bytes(base + offset, 2)).getUint16(0, le);
    if (n > 1000 || base + offset + 2 + n * 12 + 4 > src.size) return null;
    const raw = await src.bytes(base + offset + 2, n * 12 + 4);
    const v = view(raw);
    const entries = new Map();
    for (let i = 0; i < n; i++) {
      const o = i * 12;
      const tag = v.getUint16(o, le);
      const type = v.getUint16(o + 2, le);
      const count = v.getUint32(o + 4, le);
      const size = (TYPE_SIZE[type] || 1) * count;
      entries.set(tag, size <= 4 ? { tag, type, count, size, inline: raw.slice(o + 8, o + 8 + size) } : { tag, type, count, size, offset: v.getUint32(o + 8, le) });
    }
    return { offset, entries, next: v.getUint32(n * 12, le) };
  }
  tiff.ifd0 = await readIfd(view(head).getUint32(4, le));
  if (!tiff.ifd0) throw new Error('Empty TIFF');
  tiff.ifd1 = await readIfd(tiff.ifd0.next);
  const ptr = async (ifd, tag) => {
    const v = ifd && (await values(tiff, ifd.entries.get(tag)));
    return v?.length ? readIfd(v[0]) : null;
  };
  tiff.exif = await ptr(tiff.ifd0, TAG.ExifIFD);
  tiff.gps = await ptr(tiff.ifd0, TAG.GPSIFD);
  tiff.subIfds = [];
  const queue = [tiff.ifd0];
  while (queue.length) {
    const ifd = queue.shift();
    for (const off of (await values(tiff, ifd.entries.get(TAG.SubIFDs))) || []) {
      const sub = await readIfd(off);
      if (sub) {
        tiff.subIfds.push(sub);
        queue.push(sub);
      }
    }
  }
  return tiff;
}

export async function data(tiff, entry) {
  if (!entry) return null;
  if (entry.inline) return entry.inline;
  if (tiff.base + entry.offset + entry.size > tiff.src.size) return null;
  return tiff.src.bytes(tiff.base + entry.offset, entry.size);
}

export async function values(tiff, entry) {
  const b = await data(tiff, entry);
  if (!b) return null;
  const v = view(b);
  const { le } = tiff;
  const out = [];
  const n = entry.count;
  switch (entry.type) {
    case 2:
      return td.decode(b).replace(/\0[\s\S]*$/, '').trim();
    case 1:
    case 7:
      return [...b];
    case 3:
      for (let i = 0; i < n; i++) out.push(v.getUint16(i * 2, le));
      return out;
    case 8:
      for (let i = 0; i < n; i++) out.push(v.getInt16(i * 2, le));
      return out;
    case 4:
    case 13:
      for (let i = 0; i < n; i++) out.push(v.getUint32(i * 4, le));
      return out;
    case 9:
      for (let i = 0; i < n; i++) out.push(v.getInt32(i * 4, le));
      return out;
    case 5:
      for (let i = 0; i < n; i++) out.push(v.getUint32(i * 8, le) / (v.getUint32(i * 8 + 4, le) || 1));
      return out;
    case 10:
      for (let i = 0; i < n; i++) out.push(v.getInt32(i * 8, le) / (v.getInt32(i * 8 + 4, le) || 1));
      return out;
    default:
      return [...b];
  }
}
const num = async (t, ifd, tag) => {
  const v = ifd ? await values(t, ifd.entries.get(tag)) : null;
  return Array.isArray(v) ? v[0] : undefined;
};
const str = async (t, ifd, tag) => {
  const v = ifd ? await values(t, ifd.entries.get(tag)) : null;
  return typeof v === 'string' && v ? v : undefined;
};

// New entries, in the given byte order.
export const enc = {
  ascii: (tag, s) => {
    const d = concat(utf8(s), new Uint8Array([0]));
    return { tag, type: 2, count: d.length, data: d };
  },
  short: (le, tag, ...ns) => {
    const d = new Uint8Array(ns.length * 2);
    ns.forEach((n, i) => view(d).setUint16(i * 2, n, le));
    return { tag, type: 3, count: ns.length, data: d };
  },
  long: (le, tag, ...ns) => {
    const d = new Uint8Array(ns.length * 4);
    ns.forEach((n, i) => view(d).setUint32(i * 4, n, le));
    return { tag, type: 4, count: ns.length, data: d };
  },
  rational: (le, tag, ...pairs) => {
    const d = new Uint8Array(pairs.length * 8);
    pairs.forEach(([a, b], i) => {
      view(d).setUint32(i * 8, a, le);
      view(d).setUint32(i * 8 + 4, b, le);
    });
    return { tag, type: 5, count: pairs.length, data: d };
  },
  undefined: (tag, bytes) => ({ tag, type: 7, count: bytes.length, data: bytes }),
};

async function copyEntry(tiff, entry) {
  const d = await data(tiff, entry);
  return d && { tag: entry.tag, type: entry.type, count: entry.count, data: d.slice() };
}

// A TIFF block with IFD0 and optional EXIF and GPS sub-IFDs.
export function writeTiff(le, { ifd0 = [], exif = [], gps = [] }) {
  const ptrEntry = (tag, target) => ({ tag, type: 4, count: 1, data: new Uint8Array(4), target });
  const list = [{ entries: [...ifd0] }];
  if (exif.length) {
    list[0].entries.push(ptrEntry(TAG.ExifIFD, list.length));
    list.push({ entries: [...exif] });
  }
  if (gps.length) {
    list[0].entries.push(ptrEntry(TAG.GPSIFD, list.length));
    list.push({ entries: [...gps] });
  }
  let pos = 8;
  for (const ifd of list) {
    ifd.entries = [...new Map(ifd.entries.map((e) => [e.tag, e])).values()].sort((a, b) => a.tag - b.tag);
    ifd.offset = pos;
    pos += 2 + ifd.entries.length * 12 + 4;
    for (const e of ifd.entries) if (e.data.length > 4) pos += e.data.length + (e.data.length & 1);
  }
  for (const ifd of list) for (const e of ifd.entries) if (e.target !== undefined) view(e.data).setUint32(0, list[e.target].offset, le);
  const out = new Uint8Array(pos);
  const v = view(out);
  out.set(utf8(le ? 'II' : 'MM'), 0);
  v.setUint16(2, 42, le);
  v.setUint32(4, 8, le);
  for (const ifd of list) {
    let o = ifd.offset;
    let d = o + 2 + ifd.entries.length * 12 + 4;
    v.setUint16(o, ifd.entries.length, le);
    o += 2;
    for (const e of ifd.entries) {
      v.setUint16(o, e.tag, le);
      v.setUint16(o + 2, e.type, le);
      v.setUint32(o + 4, e.count, le);
      if (e.data.length > 4) {
        v.setUint32(o + 8, d, le);
        out.set(e.data, d);
        d += e.data.length + (e.data.length & 1);
      } else out.set(e.data, o + 8);
      o += 12;
    }
    v.setUint32(o, 0, le);
  }
  return out;
}

// ---- JPEG segments --------------------------------------------------------------------

const EXIF_ID = utf8('Exif\0\0');
const XMP_ID = utf8('http://ns.adobe.com/xap/1.0/\0');

export function segments(buf) {
  const out = [];
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return out;
  let o = 2;
  while (o + 4 <= buf.length) {
    if (buf[o] !== 0xff) break;
    const marker = buf[o + 1];
    if (marker === 0xff) {
      o++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += 2;
      continue;
    }
    const len = (buf[o + 2] << 8) | buf[o + 3];
    out.push({ marker, start: o, end: o + 2 + len, payloadStart: o + 4, payload: buf.subarray(o + 4, Math.min(buf.length, o + 2 + len)), complete: o + 2 + len <= buf.length });
    if (marker === 0xda || marker === 0xd9) break;
    o += 2 + len;
  }
  return out;
}

export function frameSize(segs) {
  const sof = segs.find((s) => s.marker >= 0xc0 && s.marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(s.marker));
  if (!sof || sof.payload.length < 5) return null;
  return { width: (sof.payload[3] << 8) | sof.payload[4], height: (sof.payload[1] << 8) | sof.payload[2] };
}

const exifSeg = (segs) => segs.find((s) => s.marker === 0xe1 && eq(s.payload, 0, 'Exif\0\0'));

// Previews in a Multi-Picture Format segment (Nikon puts a 640 px one there).
export function mpfImages(segs) {
  const seg = segs.find((s) => s.marker === 0xe2 && eq(s.payload, 0, 'MPF\0'));
  if (!seg || !seg.complete) return [];
  const t = seg.payload.subarray(4);
  const base = seg.payloadStart + 4;
  const le = eq(t, 0, 'II');
  const v = view(t);
  try {
    const ifd = v.getUint32(4, le);
    const n = v.getUint16(ifd, le);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (v.getUint16(e, le) !== 0xb002) continue;
      const count = v.getUint32(e + 4, le);
      const off = v.getUint32(e + 8, le);
      const images = [];
      for (let k = 1; k < count / 16; k++) {
        const size = v.getUint32(off + k * 16 + 4, le);
        const start = v.getUint32(off + k * 16 + 8, le);
        if (size) images.push({ offset: base + start, length: size });
      }
      return images;
    }
  } catch {
    // damaged MPF: ignore
  }
  return [];
}

export function segment(marker, payload) {
  if (payload.length + 2 > 0xffff) throw new Error(`Segment too large (${payload.length} bytes)`);
  return concat(new Uint8Array([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload);
}

// Replace a JPEG's metadata (APP0, EXIF/XMP APP1, APP13) with `insert`.
export function withSegments(jpeg, insert) {
  const segs = segments(jpeg);
  const sos = segs.find((s) => s.marker === 0xda);
  if (!sos) throw new Error('Not a JPEG image');
  const kept = segs.filter((s) => ![0xda, 0xe0, 0xe1, 0xed].includes(s.marker)).map((s) => jpeg.subarray(s.start, s.end));
  return concat(jpeg.subarray(0, 2), ...insert, ...kept, jpeg.subarray(sos.start));
}

// An embedded preview with the photo's orientation written into it.
export function oriented(jpeg, orientation = 1) {
  const segs = segments(jpeg);
  if (!segs.length || (!segs.some((s) => s.marker === 0xe1) && orientation === 1)) return jpeg;
  const exif = orientation === 1 ? [] : [segment(0xe1, concat(EXIF_ID, writeTiff(false, { ifd0: [enc.short(false, TAG.Orientation, orientation)] })))];
  return withSegments(jpeg, exif);
}

// 24-bit BMP from the 8-bit RGB thumbnail inside a NEF, turned upright.
export function rgbToBmp(rgb, w, h, orientation = 1) {
  const swap = orientation >= 5;
  const W = swap ? h : w;
  const H = swap ? w : h;
  const row = (W * 3 + 3) & ~3;
  const out = new Uint8Array(54 + row * H);
  const v = view(out);
  out.set(utf8('BM'), 0);
  v.setUint32(2, out.length, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, W, true);
  v.setInt32(22, -H, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, row * H, true);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sx;
      let sy;
      switch (orientation) {
        case 2: [sx, sy] = [w - 1 - x, y]; break;
        case 3: [sx, sy] = [w - 1 - x, h - 1 - y]; break;
        case 4: [sx, sy] = [x, h - 1 - y]; break;
        case 5: [sx, sy] = [y, x]; break;
        case 6: [sx, sy] = [y, h - 1 - x]; break;
        case 7: [sx, sy] = [w - 1 - y, h - 1 - x]; break;
        case 8: [sx, sy] = [w - 1 - y, x]; break;
        default: [sx, sy] = [x, y];
      }
      const s = (sy * w + sx) * 3;
      const d = 54 + y * row + x * 3;
      out[d] = rgb[s + 2];
      out[d + 1] = rgb[s + 1];
      out[d + 2] = rgb[s];
    }
  }
  return out;
}

// ---- reading a card --------------------------------------------------------------------

export const isPhoto = (name) => /\.(jpe?g|nef|nrw)$/i.test(name) && !name.startsWith('._');
const isRaw = (name) => /\.(nef|nrw)$/i.test(name);
const fmtExposure = (t) => (!t ? undefined : t >= 0.3 ? `${Math.round(t * 10) / 10}s` : `1/${Math.round(1 / t)}`);

// Camera time as a wall-clock number (ms as if local time were UTC).
export function wallClock(dto, subsec) {
  const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(dto || '');
  if (!m) return undefined;
  const ms = subsec && /^\d+$/.test(subsec) ? Math.round(Number(`0.${subsec}`) * 1000) : 0;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
  return Number.isFinite(t) ? t : undefined;
}

async function jpegDims(src, offset, length) {
  try {
    return frameSize(segments(await src.bytes(offset, Math.min(length, 65536))));
  } catch {
    return null;
  }
}

async function readExif(tiff) {
  const { ifd0, exif } = tiff;
  const t = {
    make: await str(tiff, ifd0, TAG.Make),
    model: await str(tiff, ifd0, TAG.Model),
    orientation: (await num(tiff, ifd0, TAG.Orientation)) || 1,
    dto: await str(tiff, exif, TAG.DateTimeOriginal),
    subsec: await str(tiff, exif, TAG.SubSecTimeOriginal),
    tz: await str(tiff, exif, TAG.OffsetTimeOriginal),
    serial: await str(tiff, exif, TAG.BodySerialNumber),
    lens: await str(tiff, exif, TAG.LensModel),
    exposure: fmtExposure(await num(tiff, exif, TAG.ExposureTime)),
    fnumber: await num(tiff, exif, TAG.FNumber),
    iso: await num(tiff, exif, TAG.ISO),
    focal: await num(tiff, exif, TAG.FocalLength),
  };
  if (!t.dto) t.dto = await str(tiff, ifd0, TAG.DateTime);
  if (t.orientation < 1 || t.orientation > 8) t.orientation = 1;
  return t;
}

// What RinkSide needs to know about one file, from its header only.
export async function inspect(file) {
  const src = new Source(file);
  const info = { kind: isRaw(file.name) ? 'nef' : 'jpg', size: file.size, mtime: file.lastModified || 0 };
  if (info.kind === 'jpg') {
    const segs = segments(await src.bytes(0, Math.min(src.size, 196608)));
    const dims = frameSize(segs);
    if (!dims) throw new Error('Not a readable JPEG');
    info.w = dims.width;
    info.h = dims.height;
    const app1 = exifSeg(segs);
    let tiff = null;
    if (app1?.complete) {
      try {
        tiff = await parseTiff(src, app1.payloadStart + 6);
        Object.assign(info, await readExif(tiff));
      } catch {
        tiff = null;
      }
    }
    const smalls = [];
    for (const im of mpfImages(segs)) {
      const d = await jpegDims(src, im.offset, im.length);
      if (d) smalls.push({ o: im.offset, l: im.length, w: d.width, h: d.height });
    }
    if (tiff?.ifd1) {
      const off = await num(tiff, tiff.ifd1, TAG.JpegOffset);
      const len = await num(tiff, tiff.ifd1, TAG.JpegLength);
      if (off && len && tiff.base + off + len <= src.size) {
        const d = await jpegDims(src, tiff.base + off, len);
        if (d) smalls.push({ o: tiff.base + off, l: len, w: d.width, h: d.height });
      }
    }
    info.smalls = smalls.sort((a, b) => a.w - b.w);
    return info;
  }
  const tiff = await parseTiff(src, 0);
  Object.assign(info, await readExif(tiff));
  const jpegs = [];
  for (const ifd of [tiff.ifd0, ...tiff.subIfds, tiff.ifd1].filter(Boolean)) {
    const compression = await num(tiff, ifd, TAG.Compression);
    const off = await num(tiff, ifd, TAG.JpegOffset);
    const len = await num(tiff, ifd, TAG.JpegLength);
    if (off && len && off + len <= src.size) {
      const d = await jpegDims(src, off, len);
      if (d) jpegs.push({ o: off, l: len, w: d.width, h: d.height });
      continue;
    }
    const w = await num(tiff, ifd, TAG.ImageWidth);
    const h = await num(tiff, ifd, TAG.ImageLength);
    if ((compression === 6 || compression === 7) && w) {
      const so = await num(tiff, ifd, TAG.StripOffsets);
      const sl = await num(tiff, ifd, TAG.StripByteCounts);
      const d = so && sl && so + sl <= src.size && (await jpegDims(src, so, sl));
      if (d) jpegs.push({ o: so, l: sl, w: d.width, h: d.height });
    } else if (compression === 1 && (await num(tiff, ifd, TAG.Photometric)) === 2 && w && w <= 640) {
      const so = await num(tiff, ifd, TAG.StripOffsets);
      const spp = await num(tiff, ifd, TAG.SamplesPerPixel);
      const bits = ifd.entries.has(TAG.BitsPerSample) ? await values(tiff, ifd.entries.get(TAG.BitsPerSample)) : null;
      if (so && spp === 3 && (!bits || bits[0] === 8) && so + w * h * 3 <= src.size) info.rgb = { o: so, l: w * h * 3, w, h };
    } else if (w && h && (await num(tiff, ifd, TAG.NewSubfileType)) === 0 && (!info.w || w > info.w)) {
      info.w = w;
      info.h = h;
    }
  }
  jpegs.sort((a, b) => a.w - b.w);
  if (!jpegs.length) throw new Error('This raw file has no embedded preview');
  info.preview = jpegs.at(-1);
  if (!info.w || info.preview.w > info.w * 0.9) {
    info.w = info.preview.w;
    info.h = info.preview.h;
  }
  info.smalls = jpegs.slice(0, -1);
  return info;
}

export async function hash(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', utf8(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function cameraLabel(model = 'Camera') {
  return String(model).replace(/^NIKON\s+/i, '').replace(/_2$/, 'II').trim() || 'Camera';
}

const baseName = (rel) => rel.split('/').pop().replace(/\.[^.]+$/, '');

// Files → frames: NEF+JPG pairs by camera, name and capture time. Two bodies
// both writing DSC_0001 stay separate because their cameras (or times) differ.
export async function pairFrames(sourceId, files) {
  const groups = new Map();
  for (const f of files) {
    const cam = f.serial ? `${f.model || '?'}#${f.serial}` : `${f.model || '?'}@${sourceId}`;
    const key = `${cam}|${baseName(f.rel).toLowerCase()}|${f.dto || f.mtime}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { cam, key }));
    if (g[f.kind]) groups.set(`${key}|${f.rel}`, { cam, key: `${key}|${f.rel}`, [f.kind]: f });
    else g[f.kind] = f;
  }
  const frames = [];
  for (const g of groups.values()) {
    const m = g.jpg || g.nef;
    const meta = (f) => f && { rel: f.rel, size: f.size, mtime: f.mtime, ...(f.preview && { pv: f.preview }), ...(f.smalls?.length && { sm: f.smalls }), ...(f.rgb && { rgb: f.rgb }) };
    frames.push({
      id: (await hash(`${sourceId}|${g.key}`)).slice(0, 12),
      src: sourceId,
      cam: g.cam,
      name: baseName(m.rel),
      t: wallClock(m.dto, m.subsec) ?? m.mtime,
      tz: m.tz,
      w: m.w,
      h: m.h,
      o: m.orientation || 1,
      ex: { model: m.model, make: m.make, lens: m.lens, exposure: m.exposure, fnumber: m.fnumber, iso: m.iso, focal: m.focal },
      ...(g.jpg && { jpg: meta(g.jpg) }),
      ...(g.nef && { nef: meta(g.nef) }),
    });
  }
  return frames;
}

// Read every photo on a card. `entries` are { rel, file }; onProgress(done, total).
export async function scanFiles(sourceId, entries, onProgress = () => {}) {
  const out = [];
  const errors = [];
  let done = 0;
  let next = 0;
  async function worker() {
    while (next < entries.length) {
      const { rel, file } = entries[next++];
      try {
        out.push({ rel, ...(await inspect(file)) });
      } catch (err) {
        errors.push({ file: rel, error: err.message });
      }
      onProgress(++done, entries.length);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return { frames: await pairFrames(sourceId, out), errors, files: entries.length };
}

// The biggest image to show: the camera JPEG, or the NEF's full-size preview.
export function displaySource(frame) {
  if (frame.jpg && (!frame.nef?.pv || frame.w >= frame.nef.pv.w * 0.95)) return 'jpg';
  return frame.nef ? 'nef' : 'jpg';
}

const slice = async (file, { o, l }) => new Uint8Array(await file.slice(o, o + l).arrayBuffer());

// `fileFor(kind)` returns the File for 'jpg' or 'nef'.
export async function fullBlob(frame, fileFor) {
  if (displaySource(frame) === 'jpg') return fileFor('jpg');
  const nef = await fileFor('nef');
  return new Blob([oriented(await slice(nef, frame.nef.pv), frame.o)], { type: 'image/jpeg' });
}

export async function thumbBlob(frame, fileFor) {
  const kinds = ['jpg', 'nef'].filter((k) => frame[k]);
  for (const big of [true, false]) {
    for (const k of kinds) {
      const sm = frame[k].sm || [];
      const pick = big ? sm.find((s) => Math.max(s.w, s.h) >= 300) : sm.at(-1);
      if (pick) return new Blob([oriented(await slice(await fileFor(k), pick), frame.o)], { type: 'image/jpeg' });
    }
  }
  if (frame.nef?.rgb) {
    const { w, h } = frame.nef.rgb;
    return new Blob([rgbToBmp(await slice(await fileFor('nef'), frame.nef.rgb), w, h, frame.o)], { type: 'image/bmp' });
  }
  return fullBlob(frame, fileFor);
}

// ---- metadata for exports ----------------------------------------------------------------

export function localOffset(t) {
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  const off = -local.getTimezoneOffset();
  const a = Math.abs(off);
  return `${off < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

export function frameMeta(session, frame, rosters = {}) {
  const game = session.game || {};
  const players = parsePlayers(frame.players, game, rosters).filter((p) => p.known);
  return {
    caption: captionFor(frame, game, rosters),
    headline: headlineFor(game),
    title: gameTitle(game, frame.t),
    event: gameTitle(game, frame.t),
    byline: game.byline || '',
    credit: game.credit || '',
    copyright: game.copyright || '',
    city: game.city || '',
    country: game.country || '',
    venue: game.venue || '',
    keywords: keywordsFor(frame, game, rosters),
    people: players.map((p) => p.name),
    tags: [...players.map((p) => `Players/${p.name}`), ...[game.home, game.away].filter(Boolean).map((t) => `Teams/${t}`)],
    rating: frame.flag === -1 ? -1 : frame.stars || 0,
    pick: frame.flag === 1,
    t: frame.t,
    tz: frame.tz || localOffset(frame.t),
  };
}

const pad = (n, k = 2) => String(n).padStart(k, '0');
function stamp(t) {
  const d = new Date(t);
  const Y = d.getUTCFullYear();
  const [M, D, h, m, s] = [d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map((x) => pad(x));
  return { exif: `${Y}:${M}:${D} ${h}:${m}:${s}`, iso: `${Y}-${M}-${D}T${h}:${m}:${s}`, iptcDate: `${Y}${M}${D}`, iptcTime: `${h}${m}${s}` };
}

const IFD0_KEEP = new Set([TAG.Make, TAG.Model, 0x011a, 0x011b, 0x0128, TAG.DateTime, 0x0213]);
const EXIF_DROP = new Set([TAG.InteropIFD, TAG.MakerNote, TAG.PixelXDimension, TAG.PixelYDimension, 0xa420]);

// The camera EXIF of a source file, as entries that can be written again.
export async function sourceExif(file) {
  const src = new Source(file);
  let tiff;
  if (isRaw(file.name || '')) tiff = await parseTiff(src, 0);
  else {
    const app1 = exifSeg(segments(await src.bytes(0, Math.min(src.size, 131072))));
    if (!app1) return null;
    tiff = await parseTiff(src, app1.payloadStart + 6);
  }
  const ok = (e) => e.type >= 1 && e.type <= 12 && e.size <= 16384;
  const copy = async (ifd, keep) => {
    const out = [];
    for (const e of ifd?.entries.values() || []) {
      if (!keep(e) || !ok(e)) continue;
      const c = await copyEntry(tiff, e).catch(() => null);
      if (c) out.push(c);
    }
    return out;
  };
  // Nikon maker notes carry their own TIFF header, so they survive being moved.
  let makerNote = null;
  const mn = tiff.exif?.entries.get(TAG.MakerNote);
  if (mn && mn.size < 60000) {
    const c = await copyEntry(tiff, mn).catch(() => null);
    if (c && eq(c.data, 0, 'Nikon\0')) makerNote = c;
  }
  return { le: tiff.le, ifd0: await copy(tiff.ifd0, (e) => IFD0_KEEP.has(e.tag)), exif: await copy(tiff.exif, (e) => !EXIF_DROP.has(e.tag)), gps: await copy(tiff.gps, () => true), makerNote };
}

// EXIF from the details Immich keeps (photos opened from an Immich album).
export function exifFromDetails(ex = {}, t) {
  const le = false;
  const ifd0 = [];
  const exif = [];
  if (ex.make) ifd0.push(enc.ascii(TAG.Make, ex.make));
  if (ex.model) ifd0.push(enc.ascii(TAG.Model, ex.model));
  const m = /^1\/(\d+)$/.exec(ex.exposure || '');
  if (m) exif.push(enc.rational(le, TAG.ExposureTime, [1, Number(m[1])]));
  else if (parseFloat(ex.exposure)) exif.push(enc.rational(le, TAG.ExposureTime, [Math.round(parseFloat(ex.exposure) * 1000), 1000]));
  if (ex.fnumber) exif.push(enc.rational(le, TAG.FNumber, [Math.round(ex.fnumber * 10), 10]));
  if (ex.iso) exif.push(enc.short(le, TAG.ISO, Math.min(65535, ex.iso)));
  if (ex.focal) exif.push(enc.rational(le, TAG.FocalLength, [Math.round(ex.focal * 10), 10]));
  if (ex.lens) exif.push(enc.ascii(TAG.LensModel, ex.lens));
  if (Number.isFinite(t)) exif.push(enc.ascii(TAG.DateTimeOriginal, stamp(t).exif));
  return { le, ifd0, exif, gps: [], makerNote: null };
}

function exifSegmentFor(src, { width, height, meta }) {
  const le = src?.le ?? false;
  const s = src || { ifd0: [], exif: [], gps: [] };
  const ifd0 = [...s.ifd0, enc.short(le, TAG.Orientation, 1), enc.ascii(TAG.Software, 'RinkSide')];
  if (meta.caption) ifd0.push(enc.ascii(TAG.ImageDescription, meta.caption));
  if (meta.byline) ifd0.push(enc.ascii(TAG.Artist, meta.byline));
  if (meta.copyright) ifd0.push(enc.ascii(TAG.Copyright, meta.copyright));
  const exif = [...s.exif, enc.long(le, TAG.PixelXDimension, width), enc.long(le, TAG.PixelYDimension, height)];
  if (!exif.some((e) => e.tag === TAG.DateTimeOriginal) && Number.isFinite(meta.t)) exif.push(enc.ascii(TAG.DateTimeOriginal, stamp(meta.t).exif));
  if (!exif.some((e) => e.tag === 0x9000)) exif.push(enc.undefined(0x9000, utf8('0232')));
  const build = (extra) => concat(EXIF_ID, writeTiff(le, { ifd0, exif: [...exif, ...extra], gps: s.gps }));
  let payload = build(s.makerNote ? [s.makerNote] : []);
  if (payload.length > 65000) payload = build([]);
  return segment(0xe1, payload);
}

// IPTC IIM in a Photoshop APP13 block, UTF-8.
function clip(s, bytes) {
  const b = utf8(s);
  if (b.length <= bytes) return String(s);
  let end = bytes;
  while (end > 0 && (b[end] & 0xc0) === 0x80) end--;
  return td.decode(b.subarray(0, end));
}
const iim = (record, ds, value) => {
  const d = value instanceof Uint8Array ? value : utf8(value);
  return concat(new Uint8Array([0x1c, record, ds, d.length >> 8, d.length & 255]), d);
};

export function iimBlock(meta) {
  const sets = [iim(1, 90, new Uint8Array([0x1b, 0x25, 0x47])), iim(2, 0, new Uint8Array([0, 4]))];
  const add = (ds, v, max) => v && sets.push(iim(2, ds, clip(v, max)));
  add(5, meta.title, 64);
  add(105, meta.headline, 256);
  add(120, meta.caption, 2000);
  for (const k of meta.keywords || []) add(25, k, 64);
  add(80, meta.byline, 64);
  add(110, meta.credit, 64);
  add(116, meta.copyright, 128);
  add(92, meta.venue, 64);
  add(90, meta.city, 64);
  add(101, meta.country, 64);
  if (Number.isFinite(meta.t)) {
    const st = stamp(meta.t);
    add(55, st.iptcDate, 8);
    add(60, `${st.iptcTime}${(meta.tz || '+00:00').replace(':', '')}`, 11);
  }
  return concat(...sets);
}

function irb(id, d) {
  const head = new Uint8Array(12);
  head.set(utf8('8BIM'), 0);
  view(head).setUint16(4, id);
  view(head).setUint32(8, d.length);
  return concat(head, d, d.length % 2 ? new Uint8Array(1) : new Uint8Array(0));
}

function iptcSegment(meta) {
  const block = iimBlock(meta);
  // The MD5 digest tells Lightroom and Photo Mechanic that IPTC and XMP agree.
  return segment(0xed, concat(utf8('Photoshop 3.0\0'), irb(0x0404, block), irb(0x0425, md5(block))));
}

const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const alt = (tag, v) => (v ? `<${tag}><rdf:Alt><rdf:li xml:lang="x-default">${x(v)}</rdf:li></rdf:Alt></${tag}>` : '');
const bag = (tag, list, kind = 'Bag') => (list?.length ? `<${tag}><rdf:${kind}>${list.map((v) => `<rdf:li>${x(v)}</rdf:li>`).join('')}</rdf:${kind}></${tag}>` : '');

export function xmpPacket(meta, { sidecar = false } = {}) {
  const attrs = [
    ['xmp:CreatorTool', 'RinkSide'],
    ['photoshop:Headline', meta.headline],
    ['photoshop:Credit', meta.credit],
    ['photoshop:City', meta.city],
    ['photoshop:Country', meta.country],
    ['Iptc4xmpCore:Location', meta.venue],
    ['photoshop:DateCreated', Number.isFinite(meta.t) ? `${stamp(meta.t).iso}${meta.tz || ''}` : ''],
    ['xmp:Rating', meta.rating ? String(meta.rating) : ''],
    ['photomechanic:Tagged', sidecar && meta.pick ? 'True' : ''],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `\n   ${k}="${x(v)}"`)
    .join('');
  const body = [
    alt('dc:description', meta.caption),
    alt('dc:title', meta.title),
    bag('dc:creator', meta.byline ? [meta.byline] : [], 'Seq'),
    alt('dc:rights', meta.copyright),
    bag('dc:subject', meta.keywords),
    bag('Iptc4xmpExt:PersonInImage', meta.people),
    alt('Iptc4xmpExt:Event', meta.event),
    bag('lr:hierarchicalSubject', (meta.tags || []).map((t) => t.replace(/\//g, '|'))),
  ].join('\n   ');
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="RinkSide">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
   xmlns:dc="http://purl.org/dc/elements/1.1/"
   xmlns:xmp="http://ns.adobe.com/xap/1.0/"
   xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
   xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
   xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
   xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
   xmlns:photomechanic="http://ns.camerabits.com/photomechanic/1.0/"${attrs}>
   ${body}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

// Put EXIF, XMP and IPTC into a JPEG encoded by the browser.
export function tagJpeg(jpeg, { exif, width, height, meta }) {
  return withSegments(jpeg, [exifSegmentFor(exif, { width, height, meta }), segment(0xe1, concat(XMP_ID, utf8(xmpPacket(meta)))), iptcSegment(meta)]);
}

// ---- MD5 (only for the IPTC digest; WebCrypto has no MD5) ---------------------------------

const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
export function md5(bytes) {
  const n = (((bytes.length + 8) >>> 6) + 1) * 64;
  const buf = new Uint8Array(n);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const v = view(buf);
  v.setUint32(n - 8, (bytes.length * 8) >>> 0, true);
  v.setUint32(n - 4, Math.floor(bytes.length / 0x20000000), true);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let off = 0; off < n; off += 64) {
    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let F;
      let g;
      if (i < 16) [F, g] = [(B & C) | (~B & D), i];
      else if (i < 32) [F, g] = [(D & B) | (~D & C), (5 * i + 1) % 16];
      else if (i < 48) [F, g] = [B ^ C ^ D, (3 * i + 5) % 16];
      else [F, g] = [C ^ (B | ~D), (7 * i) % 16];
      F = (F + A + K[i] + v.getUint32(off + g * 4, true)) >>> 0;
      A = D;
      D = C;
      C = B;
      const s = S[(i >> 4) * 4 + (i % 4)];
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((w, i) => view(out).setUint32(i * 4, w, true));
  return out;
}

export async function sha1Hex(blob) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', await blob.arrayBuffer()));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
