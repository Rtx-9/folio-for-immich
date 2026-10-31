// Memory cards and export folders on this computer. Edge and Chrome let a page
// open a folder you pick (File System Access); the handle is remembered in this
// browser so a game can be reopened later. Other browsers fall back to a
// folder upload field, which has to be picked again after a reload.
import { isPhoto } from './media.js';

export const hasFolderAccess = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

// ---- tiny IndexedDB key/value store for folder handles ----------------------------
let dbPromise;
function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('rinkside', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('handles', mode);
    const req = fn(tx.objectStore('handles'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
export const saveHandle = (key, handle) => idb('readwrite', (s) => s.put(handle, key)).catch(() => {});
export const loadHandle = (key) => idb('readonly', (s) => s.get(key)).catch(() => null);

// ---- a card: a folder handle, or files from the fallback picker ----------------------
export class Card {
  constructor({ handle = null, files = null, label }) {
    this.handle = handle;
    this.files = files; // Map rel → File (fallback picker)
    this.label = label || handle?.name || 'Card';
    this.cache = new Map();
  }

  async permission(ask = false) {
    if (!this.handle) return this.files ? 'granted' : 'denied';
    const opts = { mode: 'read' };
    let state = await this.handle.queryPermission(opts);
    if (state !== 'granted' && ask) state = await this.handle.requestPermission(opts);
    return state;
  }

  // Every photo on the card as { rel, file }, rel using "/".
  async list() {
    if (this.files) return [...this.files].filter(([rel]) => isPhoto(rel.split('/').pop())).map(([rel, file]) => ({ rel, file }));
    const out = [];
    const walk = async (dir, prefix, depth) => {
      for await (const [name, h] of dir.entries()) {
        if (h.kind === 'directory') {
          if (depth < 8 && !/^(\.|\$|System Volume Information$)/i.test(name)) await walk(h, `${prefix}${name}/`, depth + 1);
        } else if (isPhoto(name)) {
          out.push({ rel: `${prefix}${name}`, file: await h.getFile() });
        }
      }
    };
    await walk(this.handle, '', 0);
    for (const e of out) this.cache.set(e.rel, e.file);
    return out;
  }

  async file(rel) {
    if (this.files) {
      const f = this.files.get(rel);
      if (!f) throw new Error(`${rel} ei ole valitussa kansiossa`);
      return f;
    }
    if (this.cache.has(rel)) return this.cache.get(rel);
    const parts = rel.split('/');
    let dir = this.handle;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    const f = await (await dir.getFileHandle(parts.at(-1))).getFile();
    if (this.cache.size > 4000) this.cache.clear();
    this.cache.set(rel, f);
    return f;
  }
}

// Ask for a folder. Returns a Card, or null if cancelled.
export async function pickCard() {
  if (hasFolderAccess) {
    try {
      const handle = await window.showDirectoryPicker({ id: 'rinkside-card', mode: 'read' });
      return new Card({ handle });
    } catch (err) {
      if (err.name === 'AbortError') return null;
      throw err;
    }
  }
  return pickWithInput();
}

// Fallback: <input webkitdirectory>. Also used by the automated tests.
export function pickWithInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.id = 'card-input';
    input.hidden = true;
    document.body.append(input);
    input.onchange = () => {
      const files = new Map();
      let label = 'Card';
      for (const f of input.files) {
        const parts = (f.webkitRelativePath || f.name).split('/');
        label = parts[0] || label;
        files.set(parts.slice(1).join('/') || f.name, f);
      }
      input.remove();
      resolve(files.size ? new Card({ files, label }) : null);
    };
    input.oncancel = () => {
      input.remove();
      resolve(null);
    };
    input.click();
  });
}

// ---- export folders -----------------------------------------------------------------------
export async function pickExportFolder() {
  if (!hasFolderAccess) return null;
  try {
    return await window.showDirectoryPicker({ id: 'rinkside-export', mode: 'readwrite', startIn: 'pictures' });
  } catch (err) {
    if (err.name === 'AbortError') return null;
    throw err;
  }
}

export async function writable(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function exists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

// A name in `dir` that isn't taken yet: photo.jpg, photo-2.jpg, …
export async function freeName(dir, base, ext, taken = new Set()) {
  let name = `${base}${ext}`;
  for (let i = 2; taken.has(name.toLowerCase()) || (await exists(dir, name)); i++) name = `${base}-${i}${ext}`;
  taken.add(name.toLowerCase());
  return name;
}

export async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  if (data instanceof Blob) await data.stream().pipeTo(w);
  else {
    await w.write(data);
    await w.close();
  }
}

// ---- ZIP (stored, no compression) for browsers without folder access ------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export class Zip {
  constructor() {
    this.parts = [];
    this.central = [];
    this.offset = 0;
  }

  add(name, data) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, this.offset, true);
    this.parts.push(new Uint8Array(local.buffer), nameBytes, data);
    this.central.push(new Uint8Array(cen.buffer), nameBytes);
    this.offset += 30 + nameBytes.length + data.length;
  }

  blob() {
    const size = this.central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.central.length / 2, true);
    end.setUint16(10, this.central.length / 2, true);
    end.setUint32(12, size, true);
    end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }
}
