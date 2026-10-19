import fs from 'node:fs';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function send(res, status, body = '', headers = {}) {
  if (res.headersSent) return res.end();
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, { 'content-length': buf.length, ...headers });
  res.end(buf);
}

export const sendJson = (res, status, data, headers = {}) =>
  send(res, status, JSON.stringify(data), {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });

export const sendHtml = (res, status, html, headers = {}) =>
  send(res, status, html, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });

export const redirect = (res, location, status = 303, headers = {}) => send(res, status, '', { location, ...headers });

export function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'That file is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit) {
  const body = await readBody(req, limit);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

export async function readForm(req) {
  const body = await readBody(req, 64 * 1024);
  return Object.fromEntries(new URLSearchParams(body.toString('utf8')));
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    const raw = part.slice(i + 1).trim();
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

export function isSecure(req) {
  return Boolean(req.socket.encrypted) || (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

export function cookie(req, name, value, { maxAge, path: cookiePath = '/', httpOnly = true } = {}) {
  let out = `${name}=${encodeURIComponent(value)}; Path=${cookiePath}; SameSite=Lax`;
  if (httpOnly) out += '; HttpOnly';
  if (isSecure(req)) out += '; Secure';
  if (maxAge !== undefined) out += `; Max-Age=${maxAge}`;
  return out;
}

export function origin(req, publicUrl) {
  if (publicUrl) return publicUrl;
  const proto = isSecure(req) ? 'https' : 'http';
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

export function serveFile(req, res, file, { cache = 'no-cache' } = {}) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not found', { 'content-type': 'text/plain' });
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': cache });
      return res.end();
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': cache,
      'x-content-type-options': 'nosniff',
      etag,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

// JSON that is safe to drop inside a <script> tag.
export const safeJson = (value) =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
