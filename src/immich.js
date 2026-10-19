// Minimal Immich API client (targets the Immich v3 API).
//
// Every call takes a credential: either `{ auth }` (the signed-in user's headers,
// used by the editor) or `{ key }` (an album shared-link key, used to serve
// public pages without ever handing that key to visitors).
import http from 'node:http';
import https from 'node:https';
import { config } from './config.js';

export class ImmichError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const agentFor = (url) => (url.protocol === 'https:' ? https : http);

export function request(method, pathAndQuery, { headers = {}, body } = {}) {
  const url = new URL(config.immichUrl + pathAndQuery);
  return new Promise((resolve, reject) => {
    const req = agentFor(url).request(url, { method, headers }, resolve);
    req.on('error', (err) => reject(new ImmichError(502, `Could not reach Immich at ${config.immichUrl} (${err.code || err.message})`)));
    req.end(body);
  });
}

const readAll = (res) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });

function buildPath(path, { key, query } = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) q.set(k, String(v));
  if (key) q.set('key', key);
  const qs = q.toString();
  return `/api${path}${qs ? `?${qs}` : ''}`;
}

export async function api(method, path, { auth, key, query, body } = {}) {
  const headers = { accept: 'application/json', ...(auth?.headers || {}) };
  let payload;
  if (body !== undefined) {
    payload = Buffer.from(JSON.stringify(body));
    headers['content-type'] = 'application/json';
    headers['content-length'] = payload.length;
  }
  const res = await request(method, buildPath(path, { key, query }), { headers, body: payload });
  const buf = await readAll(res);
  if (res.statusCode >= 400) {
    let message = `Immich responded ${res.statusCode}`;
    try {
      const parsed = JSON.parse(buf.toString('utf8'));
      message = [].concat(parsed.message || parsed.error || message).join(', ');
    } catch {}
    throw new ImmichError(res.statusCode, message);
  }
  if (!buf.length) return null;
  const text = buf.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---- users & albums -------------------------------------------------------

export const getMe = (auth) => api('GET', '/users/me', { auth });
export const listAlbums = (auth) => api('GET', '/albums', { auth });
export const getAlbum = (id, cred) => api('GET', `/albums/${encodeURIComponent(id)}`, cred);

// Album responses no longer embed assets in Immich v3, so walk the timeline.
export async function albumAssets(albumId, cred, order = 'desc') {
  const query = { albumId, order: order === 'asc' ? 'asc' : 'desc' };
  const buckets = await api('GET', '/timeline/buckets', { ...cred, query });
  const pages = await mapLimit(buckets || [], 4, (b) =>
    api('GET', '/timeline/bucket', { ...cred, query: { ...query, timeBucket: b.timeBucket } }),
  );
  const assets = [];
  for (const page of pages) {
    const ids = page?.id || [];
    for (let i = 0; i < ids.length; i++) {
      if (page.isTrashed?.[i]) continue;
      assets.push({
        id: ids[i],
        video: page.isImage ? !page.isImage[i] : false,
        ratio: Math.round((Number(page.ratio?.[i]) || 1.5) * 1000) / 1000,
        duration: page.duration?.[i] ?? null,
        date: page.fileCreatedAt?.[i] ?? null,
      });
    }
  }
  return assets;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---- shared links -------------------------------------------------------------

export const createAlbumLink = (auth, albumId, { description, allowDownload, expiresAt }) =>
  api('POST', '/shared-links', {
    auth,
    body: {
      type: 'ALBUM',
      albumId,
      description,
      allowDownload,
      allowUpload: false,
      showMetadata: false,
      ...(expiresAt ? { expiresAt } : {}),
    },
  });

export const updateLink = (auth, id, patch) => api('PATCH', `/shared-links/${encodeURIComponent(id)}`, { auth, body: patch });
export const deleteLink = (auth, id) => api('DELETE', `/shared-links/${encodeURIComponent(id)}`, { auth });

// ---- streaming ----------------------------------------------------------------

const PASS_REQUEST = ['range', 'if-none-match', 'if-modified-since', 'if-range'];
const PASS_RESPONSE = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

// Stream an Immich binary endpoint (thumbnail, original, video) to the visitor.
export async function pipe(req, res, path, { auth, key, query, method = 'GET', body, cache, disposition } = {}) {
  const headers = { ...(auth?.headers || {}) };
  for (const h of PASS_REQUEST) if (req.headers[h]) headers[h] = req.headers[h];
  let payload;
  if (body !== undefined) {
    payload = Buffer.from(JSON.stringify(body));
    headers['content-type'] = 'application/json';
    headers['content-length'] = payload.length;
  }
  const up = await request(method, buildPath(path, { key, query }), { headers, body: payload });
  const out = { 'x-content-type-options': 'nosniff' };
  for (const h of PASS_RESPONSE) if (up.headers[h]) out[h] = up.headers[h];
  if (up.statusCode < 400) {
    if (cache) out['cache-control'] = cache;
    if (disposition) out['content-disposition'] = disposition;
    else if (up.headers['content-disposition']) out['content-disposition'] = up.headers['content-disposition'];
  } else {
    out['cache-control'] = 'no-store';
  }
  res.writeHead(up.statusCode, out);
  up.pipe(res);
  res.on('close', () => up.destroy());
}

export async function fetchBuffer(path, cred) {
  const res = await request('GET', buildPath(path, cred), { headers: { ...(cred.auth?.headers || {}) } });
  const buf = await readAll(res);
  if (res.statusCode >= 400) throw new ImmichError(res.statusCode, `Immich responded ${res.statusCode}`);
  return { buffer: buf, type: res.headers['content-type'] || '' };
}
