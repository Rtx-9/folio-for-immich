// Tiny JSON-file database. Folio stores a handful of page records, so a single
// file written atomically is simpler and sturdier than running a database.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const file = path.join(config.dataDir, 'folio.json');
export const uploadsDir = path.join(config.dataDir, 'uploads');

let db;
let timer;

export function load() {
  fs.mkdirSync(uploadsDir, { recursive: true });
  try {
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    db = { version: 1, secret: crypto.randomBytes(32).toString('hex'), pages: [] };
    flush();
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      flush();
      process.exit(0);
    });
  }
}

export function flush() {
  clearTimeout(timer);
  timer = undefined;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, file);
}

export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 150);
}

export const secret = () => db.secret;
export const randomId = (bytes = 8) => crypto.randomBytes(bytes).toString('hex');

export const pages = {
  all: () => db.pages,
  byOwner: (ownerId) => db.pages.filter((p) => p.ownerId === ownerId),
  byId: (id) => db.pages.find((p) => p.id === id),
  bySlug: (slug) => db.pages.find((p) => p.slug === slug),
  insert(page) {
    db.pages.push(page);
    save();
    return page;
  },
  remove(id) {
    db.pages = db.pages.filter((p) => p.id !== id);
    save();
  },
};
