import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Used to cache-bust the browser files and to tell open editors to reload after an update.
export const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const bool = (value, fallback) => (value === undefined || value === '' ? fallback : !/^(0|false|no|off)$/i.test(value));

export const config = {
  port: Number(process.env.PORT) || 2284,
  host: process.env.HOST || '0.0.0.0',
  // Where Folio reaches the Immich server (inside Docker this is usually http://immich-server:2283).
  immichUrl: (process.env.IMMICH_URL || 'http://localhost:2283').replace(/\/+$/, ''),
  dataDir: process.env.FOLIO_DATA ? path.resolve(process.env.FOLIO_DATA) : path.join(root, 'data'),
  // Optional absolute URL visitors use, e.g. https://photos.example.com (used for link previews).
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  // Forward everything that is not a Folio route to Immich, so Folio can sit in front of it.
  proxy: bool(process.env.FOLIO_PROXY, true),
  // Add a "Folio" entry to Immich's sidebar when proxying.
  inject: bool(process.env.FOLIO_INJECT, true),
  // Optional extra sidebar entry pointing at RinkSide (e.g. http://localhost:2285 on your laptop).
  rinksideUrl: (process.env.RINKSIDE_URL || '').trim(),
  maxUploadBytes: (Number(process.env.FOLIO_MAX_UPLOAD_MB) || 15) * 1024 * 1024,
};
