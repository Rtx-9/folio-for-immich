// Reads IPTC (IIM, in the JPEG APP13 segment) and XMP metadata from the start of
// a JPEG. Only the header is needed, so callers can fetch just the first bytes.

const IIM = {
  5: 'title', // Object Name
  15: 'category',
  20: 'supplementalCategories',
  25: 'keywords',
  40: 'instructions',
  55: 'dateCreated',
  60: 'timeCreated',
  80: 'byline',
  85: 'bylineTitle',
  90: 'city',
  92: 'sublocation',
  95: 'state',
  100: 'countryCode',
  101: 'country',
  103: 'jobId',
  105: 'headline',
  110: 'credit',
  115: 'source',
  116: 'copyright',
  118: 'contact',
  120: 'caption',
  122: 'captionWriter',
};
const REPEATABLE = new Set(['keywords', 'supplementalCategories', 'byline']);

// Walk the JPEG markers. Returns the APP13 and XMP payloads that fit in `buf`,
// plus `need` (an offset to fetch from) when a wanted segment runs past the end.
export function scanJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return { jpeg: false };
  let off = 2;
  const out = { jpeg: true, app13: null, xmp: null, need: null, done: false };
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) break;
    const marker = buf[off + 1];
    if (marker === 0xff) {
      off++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) {
      out.done = true; // start of image data: no more metadata
      return out;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      off += 2;
      continue;
    }
    const len = buf.readUInt16BE(off + 2);
    const start = off + 4;
    const end = off + 2 + len;
    if (end > buf.length) {
      out.need = end; // segment continues beyond what we have
      return out;
    }
    const seg = buf.subarray(start, end);
    if (marker === 0xed && seg.subarray(0, 13).toString('latin1') === 'Photoshop 3.0') out.app13 = seg;
    if (marker === 0xe1 && seg.subarray(0, 29).toString('latin1') === 'http://ns.adobe.com/xap/1.0/\0') out.xmp = seg.subarray(29);
    off = end;
  }
  out.need = out.done ? null : Math.max(buf.length, off + 4);
  return out;
}

function decodeText(bytes, utf8) {
  if (utf8) return bytes.toString('utf8');
  const asUtf8 = bytes.toString('utf8');
  // Not flagged as UTF-8: use it anyway if it decodes cleanly, else Latin-1.
  return asUtf8.includes('�') ? bytes.toString('latin1') : asUtf8;
}

// Photoshop image resource blocks → IPTC-NAA (0x0404) → IIM datasets.
export function parseApp13(seg) {
  let off = 14; // "Photoshop 3.0\0"
  let iim = null;
  while (off + 12 <= seg.length) {
    if (seg.subarray(off, off + 4).toString('latin1') !== '8BIM') break;
    const id = seg.readUInt16BE(off + 4);
    const nameLen = seg[off + 6];
    let p = off + 7 + nameLen;
    if ((nameLen + 1) % 2) p++; // name is padded to even length
    const size = seg.readUInt32BE(p);
    p += 4;
    if (id === 0x0404) iim = seg.subarray(p, p + size);
    off = p + size + (size % 2);
  }
  if (!iim) return null;

  const raw = {};
  let utf8 = false;
  let i = 0;
  while (i + 5 <= iim.length) {
    if (iim[i] !== 0x1c) {
      i++;
      continue;
    }
    const record = iim[i + 1];
    const dataset = iim[i + 2];
    let size = iim.readUInt16BE(i + 3);
    let p = i + 5;
    if (size & 0x8000) {
      const n = size & 0x7fff;
      size = 0;
      for (let k = 0; k < n; k++) size = size * 256 + iim[p + k];
      p += n;
    }
    const data = iim.subarray(p, p + size);
    if (record === 1 && dataset === 90 && data.toString('latin1').includes('%G')) utf8 = true;
    if (record === 2 && IIM[dataset]) (raw[IIM[dataset]] ||= []).push(data);
    i = p + size;
  }
  const out = {};
  for (const [key, values] of Object.entries(raw)) {
    const texts = values.map((v) => decodeText(v, utf8).replace(/\0+$/, '').trim()).filter(Boolean);
    if (!texts.length) continue;
    out[key] = REPEATABLE.has(key) ? texts : texts[0];
  }
  if (out.dateCreated && /^\d{8}$/.test(out.dateCreated)) {
    const d = out.dateCreated;
    out.dateCreated = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }
  return Object.keys(out).length ? out : null;
}

const unxml = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .trim();

// Values of an XMP property, whether written as an element (with rdf:Alt/Bag/Seq
// lists) or as an attribute.
function xmpValues(xml, prop) {
  const name = prop.replace(':', '\\:');
  const el = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  if (el) {
    const items = [...el[1].matchAll(/<rdf:li(?:\s[^>]*)?>([\s\S]*?)<\/rdf:li>/g)].map((m) => unxml(m[1]));
    return (items.length ? items : [unxml(el[1])]).filter(Boolean);
  }
  const attr = xml.match(new RegExp(`\\s${name}="([^"]*)"`));
  return attr ? [unxml(attr[1])].filter(Boolean) : [];
}

const XMP = {
  caption: ['dc:description'],
  title: ['dc:title'],
  headline: ['photoshop:Headline'],
  keywords: ['dc:subject'],
  byline: ['dc:creator'],
  bylineTitle: ['photoshop:AuthorsPosition'],
  credit: ['photoshop:Credit'],
  source: ['photoshop:Source'],
  copyright: ['dc:rights'],
  city: ['photoshop:City'],
  sublocation: ['Iptc4xmpCore:Location'],
  state: ['photoshop:State'],
  country: ['photoshop:Country'],
  countryCode: ['Iptc4xmpCore:CountryCode'],
  instructions: ['photoshop:Instructions'],
  jobId: ['photoshop:TransmissionReference'],
  category: ['photoshop:Category'],
  captionWriter: ['photoshop:CaptionWriter'],
  dateCreated: ['photoshop:DateCreated'],
};

// XMP is usually UTF-8 but may be UTF-16 (either byte order).
function xmpText(seg) {
  if (seg.length > 1 && seg[0] === 0 && seg[1] !== 0) {
    const swapped = Buffer.from(seg.subarray(0, seg.length - (seg.length % 2)));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  if (seg.length > 1 && seg[1] === 0 && seg[0] !== 0) return seg.toString('utf16le');
  return seg.toString('utf8');
}

export function parseXmp(seg) {
  const xml = xmpText(seg);
  const out = {};
  for (const [key, props] of Object.entries(XMP)) {
    for (const prop of props) {
      const values = xmpValues(xml, prop);
      if (!values.length) continue;
      out[key] = REPEATABLE.has(key) ? values : values[0];
      break;
    }
  }
  return Object.keys(out).length ? out : null;
}

// IIM first (what most photo desks write), XMP fills any gaps.
export function readMetadata(scan) {
  const iim = scan.app13 ? parseApp13(scan.app13) : null;
  const xmp = scan.xmp ? parseXmp(scan.xmp) : null;
  if (!iim && !xmp) return null;
  return { ...(xmp || {}), ...(iim || {}) };
}
