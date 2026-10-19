import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkPassword,
  getAuth,
  hashPassword,
  isUnlocked,
  KEY_COOKIE,
  requireAuth,
  resolveUser,
  unlockCookieName,
  unlockToken,
} from './auth.js';
import { config } from './config.js';
import {
  cookie,
  HttpError,
  origin,
  readBody,
  readForm,
  readJson,
  redirect,
  send,
  sendHtml,
  sendJson,
  serveFile,
} from './http.js';
import * as immich from './immich.js';
import {
  createPage,
  deletePage,
  ensureLinks,
  isExpired,
  ownedPage,
  pruneImages,
  pruneLinks,
  repairLink,
  storeImage,
  summary,
  syncLinkSettings,
  validateSlug,
} from './pages.js';
import * as proxy from './proxy.js';
import { dateLabel, renderAlbum, renderIndex, renderLocked, renderMessage } from './render.js';
import { load, pages, save, uploadsDir } from './store.js';
import { FONTS, OPTIONS, PRESETS, sanitizeDraft } from './themes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC = path.join(ROOT, 'public');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- small caches -----------------------------------------------------------------

const memo = new Map();
async function cached(key, ttl, fn) {
  const hit = memo.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  memo.set(key, { value, expires: Date.now() + ttl });
  if (memo.size > 2000) memo.delete(memo.keys().next().value);
  return value;
}

// ---- public site (shared by live pages and the editor preview) ------------------------

async function resolveAlbums(page, cfg, base) {
  return Promise.all(
    cfg.albums.map(async (entry) => {
      const link = page.links[entry.albumId];
      const fallback = { ...entry, title: entry.title || 'Album unavailable', missing: true, href: '#' };
      if (!link) return fallback;
      try {
        const album = await cached(`album:${link.key}`, 60_000, () => immich.getAlbum(entry.albumId, { key: link.key }));
        const coverId = entry.coverAssetId || album.albumThumbnailAssetId;
        return {
          albumId: entry.albumId,
          title: entry.title.trim() || album.albumName || 'Untitled album',
          description: entry.description.trim() || album.description || '',
          section: entry.section,
          count: album.assetCount ?? null,
          start: album.startDate || null,
          end: album.endDate || null,
          order: album.order || 'desc',
          dateText: dateLabel(album.startDate, album.endDate),
          coverUrl: coverId ? `${base}/m/${entry.albumId}/${coverId}/preview` : null,
          href: `${base}/a/${entry.albumId}`,
        };
      } catch (err) {
        return { ...fallback, error: err.message };
      }
    }),
  );
}

const unlockAttempts = new Map();
function rateLimited(req) {
  const ip = req.socket.remoteAddress;
  const now = Date.now();
  const entry = unlockAttempts.get(ip) || { count: 0, reset: now + 60_000 };
  if (entry.reset < now) Object.assign(entry, { count: 0, reset: now + 60_000 });
  entry.count++;
  unlockAttempts.set(ip, entry);
  return entry.count > 10;
}

const downloadSets = new Map();
const zipName = (name, part, parts) => {
  const base = `${name || 'album'}${parts > 1 ? ` (part ${part + 1} of ${parts})` : ''}.zip`;
  return `attachment; filename="${base.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(base)}`;
};

async function site(req, res, { page, cfg, base, rest, preview }) {
  const allowed = (albumId) => cfg.albums.some((a) => a.albumId === albumId) && page.links[albumId];
  const host = origin(req, config.publicUrl);
  let m;

  if (rest === '' || rest === '/') {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    const albums = await resolveAlbums(page, cfg, base);
    if (!preview) {
      page.views = (page.views || 0) + 1;
      save();
    }
    return sendHtml(res, 200, renderIndex({ cfg, page, base, albums, origin: host, preview }));
  }

  if ((m = rest.match(/^\/a\/([0-9a-f-]+)\/?$/i))) {
    if (!allowed(m[1])) throw new HttpError(404, 'Album not found');
    const albums = await resolveAlbums(page, cfg, base);
    const album = albums.find((a) => a.albumId === m[1]);
    if (!album || album.missing) throw new HttpError(404, 'Album not found');
    return sendHtml(res, 200, renderAlbum({ cfg, page, base, album, albums, origin: host, preview }));
  }

  if ((m = rest.match(/^\/api\/album\/([0-9a-f-]+)$/i))) {
    if (!allowed(m[1])) throw new HttpError(404, 'Album not found');
    const { key } = page.links[m[1]];
    const album = await cached(`album:${key}`, 60_000, () => immich.getAlbum(m[1], { key }));
    const assets = await cached(`assets:${key}:${album.order}`, preview ? 10_000 : 60_000, () =>
      immich.albumAssets(m[1], { key }, album.order),
    );
    return sendJson(res, 200, { assets });
  }

  if ((m = rest.match(/^\/m\/([0-9a-f-]+)\/([0-9a-f-]+)\/(thumbnail|preview|original|video)$/i))) {
    const [, albumId, assetId, size] = m;
    if (!allowed(albumId) || !UUID.test(assetId)) throw new HttpError(404, 'Not found');
    const { key } = page.links[albumId];
    const cache = 'private, max-age=604800';
    if (size === 'original') {
      if (!page.sharing.allowDownload) throw new HttpError(403, 'Downloads are turned off for this page.');
      return immich.pipe(req, res, `/assets/${assetId}/original`, { key, cache });
    }
    if (size === 'video') return immich.pipe(req, res, `/assets/${assetId}/video/playback`, { key, cache });
    return immich.pipe(req, res, `/assets/${assetId}/thumbnail`, { key, query: { size }, cache });
  }

  if ((m = rest.match(/^\/dl\/([0-9a-f-]+)(?:\/(\d+))?$/i))) {
    const [, albumId, part] = m;
    if (!allowed(albumId)) throw new HttpError(404, 'Not found');
    if (!page.sharing.allowDownload) throw new HttpError(403, 'Downloads are turned off for this page.');
    const { key } = page.links[albumId];
    const info = await cached(`dl:${key}`, 10 * 60_000, () => immich.api('POST', '/download/info', { key, body: { albumId } }));
    const archives = info?.archives || [];
    if (part === undefined) {
      return sendJson(res, 200, { parts: archives.map((a, i) => ({ index: i, size: a.size, count: a.assetIds.length })) });
    }
    const archive = archives[Number(part)];
    if (!archive) throw new HttpError(404, 'Not found');
    const albums = await resolveAlbums(page, cfg, base);
    const name = albums.find((a) => a.albumId === albumId)?.title;
    return immich.pipe(req, res, '/download/archive', {
      key,
      method: 'POST',
      body: { assetIds: archive.assetIds },
      disposition: zipName(name, Number(part), archives.length),
      cache: 'no-store',
    });
  }

  throw new HttpError(404, 'Not found');
}

async function publicRoutes(req, res, url) {
  const m = url.pathname.match(/^\/p\/([a-z0-9-]+)(\/.*)?$/);
  const page = m && pages.bySlug(m[1]);
  if (!page || !page.published) {
    return sendHtml(res, 404, renderMessage('Page not found', 'This page does not exist or is no longer shared.'));
  }
  if (isExpired(page)) {
    return sendHtml(res, 410, renderMessage('This page has expired', 'Ask the person who shared it for a new link.', 410));
  }
  const base = `/p/${page.slug}`;
  const rest = m[2] || '';
  const cfg = page.published;

  if (rest === '/unlock' && req.method === 'POST') {
    if (rateLimited(req)) return sendHtml(res, 429, renderLocked({ cfg, page, base, error: 'Too many attempts. Wait a minute and try again.' }));
    const form = await readForm(req);
    if (!page.password || checkPassword(page.password, form.password)) {
      const headers = page.password
        ? { 'set-cookie': cookie(req, unlockCookieName(page.id), unlockToken(page.id, page.password), { path: base, maxAge: 60 * 60 * 24 * 30 }) }
        : {};
      return redirect(res, base, 303, headers);
    }
    return sendHtml(res, 401, renderLocked({ cfg, page, base, error: 'That password is not right.' }));
  }

  if (!isUnlocked(req, page)) {
    if (rest === '' || rest === '/' || rest.startsWith('/a/')) return sendHtml(res, 401, renderLocked({ cfg, page, base }));
    throw new HttpError(401, 'Locked');
  }
  return site(req, res, { page, cfg, base, rest, preview: false });
}

async function previewRoutes(req, res, url) {
  const m = url.pathname.match(/^\/_folio\/preview\/([a-z0-9]+)(\/.*)?$/);
  if (!m) throw new HttpError(404, 'Not found');
  const auth = await requireAuth(req);
  const page = ownedPage(m[1], auth.user);
  return site(req, res, { page, cfg: page.draft, base: `/_folio/preview/${page.id}`, rest: m[2] || '', preview: true });
}

// ---- editor API ---------------------------------------------------------------------

const editorView = (page) => ({
  ...summary(page),
  draft: page.draft,
  linked: Object.keys(page.links),
});

async function editorApi(req, res, url) {
  const p = url.pathname.slice('/_folio/api'.length);
  const method = req.method;
  let m;

  if (p === '/meta') {
    return sendJson(res, 200, { presets: PRESETS, fonts: FONTS, options: OPTIONS, immichUrl: config.proxy ? '/' : null });
  }

  // Custom header requirement blocks cross-site form posts (CSRF).
  if (method !== 'GET' && method !== 'HEAD' && req.headers['x-folio'] !== '1') throw new HttpError(403, 'Missing X-Folio header');

  if (p === '/login' && method === 'POST') {
    const { apiKey } = await readJson(req);
    if (typeof apiKey !== 'string' || apiKey.length < 10) throw new HttpError(400, 'Paste an Immich API key.');
    const auth = await resolveUser({ 'x-api-key': apiKey.trim() });
    if (!auth) throw new HttpError(401, 'Immich did not accept that API key.');
    return sendJson(res, 200, { user: auth.user }, { 'set-cookie': cookie(req, KEY_COOKIE, apiKey.trim(), { maxAge: 60 * 60 * 24 * 30 }) });
  }
  if (p === '/logout' && method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'set-cookie': cookie(req, KEY_COOKIE, '', { maxAge: 0 }) });
  }

  if (p === '/me') {
    const auth = await getAuth(req);
    if (!auth) throw new HttpError(401, 'Not signed in');
    return sendJson(res, 200, { user: auth.user });
  }

  const auth = await requireAuth(req);
  const { user } = auth;

  if (p === '/albums' && method === 'GET') {
    const albums = await immich.listAlbums(auth);
    return sendJson(res, 200, {
      albums: albums
        .map((a) => ({
          id: a.id,
          name: a.albumName,
          count: a.assetCount,
          thumb: a.albumThumbnailAssetId,
          start: a.startDate || null,
          end: a.endDate || null,
          dateText: dateLabel(a.startDate, a.endDate),
          // albumUsers[0] is always the owner in Immich v3.
          owned: a.albumUsers?.[0]?.user?.id ? a.albumUsers[0].user.id === user.id : true,
          ownerName: a.albumUsers?.[0]?.user?.name || '',
          updatedAt: a.lastModifiedAssetTimestamp || a.updatedAt,
        }))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
    });
  }
  if ((m = p.match(/^\/albums\/([0-9a-f-]+)\/assets$/i)) && method === 'GET') {
    const album = await immich.getAlbum(m[1], { auth });
    const assets = await immich.albumAssets(m[1], { auth }, album.order);
    return sendJson(res, 200, { assets });
  }
  if ((m = p.match(/^\/thumb\/([0-9a-f-]+)$/i)) && method === 'GET') {
    if (!UUID.test(m[1])) throw new HttpError(404, 'Not found');
    const size = url.searchParams.get('size') === 'preview' ? 'preview' : 'thumbnail';
    return immich.pipe(req, res, `/assets/${m[1]}/thumbnail`, { auth, query: { size }, cache: 'private, max-age=86400' });
  }

  if (p === '/pages' && method === 'GET') {
    const list = pages
      .byOwner(user.id)
      .map(summary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sendJson(res, 200, { pages: list });
  }
  if (p === '/pages' && method === 'POST') {
    const body = await readJson(req);
    const albumIds = (Array.isArray(body.albumIds) ? body.albumIds : []).filter((id) => typeof id === 'string' && UUID.test(id));
    const page = createPage(user, { title: body.title, preset: body.preset, albumIds });
    const linkErrors = await ensureLinks(page, auth);
    return sendJson(res, 201, { page: editorView(page), linkErrors });
  }

  if (!(m = p.match(/^\/pages\/([a-z0-9]+)(\/.*)?$/))) throw new HttpError(404, 'Not found');
  const page = ownedPage(m[1], user);
  const sub = m[2] || '';
  const touch = () => {
    page.updatedAt = new Date().toISOString();
    save();
  };

  if (sub === '' && method === 'GET') return sendJson(res, 200, { page: editorView(page) });

  if (sub === '' && method === 'DELETE') {
    await deletePage(page, auth);
    return sendJson(res, 200, { ok: true });
  }

  if (sub === '/draft' && method === 'PUT') {
    const body = await readJson(req, 512 * 1024);
    page.draft = sanitizeDraft(body.draft);
    touch();
    const linkErrors = await ensureLinks(page, auth);
    return sendJson(res, 200, { page: editorView(page), linkErrors });
  }

  if (sub === '' && method === 'PATCH') {
    const body = await readJson(req);
    if (body.slug !== undefined) page.slug = validateSlug(String(body.slug).trim().toLowerCase(), page.id);
    if (body.sharing) {
      const s = body.sharing;
      if (typeof s.allowDownload === 'boolean') page.sharing.allowDownload = s.allowDownload;
      if (typeof s.noindex === 'boolean') page.sharing.noindex = s.noindex;
      if (s.expiresAt !== undefined) {
        if (s.expiresAt === null || s.expiresAt === '') page.sharing.expiresAt = null;
        else {
          const date = new Date(s.expiresAt);
          if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Invalid expiry date');
          page.sharing.expiresAt = date.toISOString();
        }
      }
      await syncLinkSettings(page, auth);
    }
    touch();
    return sendJson(res, 200, { page: editorView(page) });
  }

  if (sub === '/password' && method === 'POST') {
    const { password } = await readJson(req);
    if (password === null || password === '') page.password = null;
    else if (typeof password === 'string' && password.length >= 4 && password.length <= 200) page.password = hashPassword(password);
    else throw new HttpError(400, 'Use at least 4 characters.');
    touch();
    return sendJson(res, 200, { page: editorView(page) });
  }

  if (sub === '/publish' && method === 'POST') {
    const linkErrors = await ensureLinks(page, auth);
    page.published = structuredClone(page.draft);
    page.publishedAt = new Date().toISOString();
    touch();
    await pruneLinks(page, auth);
    pruneImages(page);
    await syncLinkSettings(page, auth);
    return sendJson(res, 200, { page: editorView(page), linkErrors });
  }
  if (sub === '/unpublish' && method === 'POST') {
    page.published = null;
    page.publishedAt = null;
    touch();
    return sendJson(res, 200, { page: editorView(page) });
  }
  if (sub === '/discard' && method === 'POST') {
    if (page.published) page.draft = structuredClone(page.published);
    touch();
    await pruneLinks(page, auth);
    return sendJson(res, 200, { page: editorView(page) });
  }

  if ((m = sub.match(/^\/repair\/([0-9a-f-]+)$/i)) && method === 'POST') {
    const linkErrors = await repairLink(page, auth, m[1]);
    memo.clear();
    return sendJson(res, 200, { page: editorView(page), linkErrors });
  }

  if (sub === '/images' && method === 'POST') {
    const buffer = await readBody(req, config.maxUploadBytes);
    const image = storeImage(page, buffer);
    return sendJson(res, 201, { image });
  }
  if (sub === '/images/from-asset' && method === 'POST') {
    const { assetId } = await readJson(req);
    if (typeof assetId !== 'string' || !UUID.test(assetId)) throw new HttpError(400, 'Invalid asset');
    const { buffer } = await immich.fetchBuffer(`/assets/${assetId}/thumbnail`, { auth, query: { size: 'preview' } });
    const image = storeImage(page, buffer);
    return sendJson(res, 201, { image });
  }

  throw new HttpError(404, 'Not found');
}

// ---- router -------------------------------------------------------------------------

async function handle(req, res) {
  const url = new URL(req.url, 'http://folio.local');
  const p = url.pathname;

  if (p === '/folio' || p.startsWith('/folio/')) return serveFile(req, res, path.join(STATIC, 'editor.html'));
  if (p === '/_folio/inject.js') return serveFile(req, res, path.join(STATIC, 'inject.js'));
  if (p.startsWith('/_folio/static/')) {
    const file = path.join(STATIC, path.normalize(p.slice('/_folio/static/'.length)).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(STATIC + path.sep)) throw new HttpError(404, 'Not found');
    return serveFile(req, res, file);
  }
  if (p.startsWith('/_folio/img/')) {
    const name = p.slice('/_folio/img/'.length);
    if (!/^[a-z0-9]+\.(jpg|png|webp|gif|avif)$/.test(name)) throw new HttpError(404, 'Not found');
    return serveFile(req, res, path.join(uploadsDir, name), { cache: 'public, max-age=31536000, immutable' });
  }
  if (p.startsWith('/_folio/api/')) return editorApi(req, res, url);
  if (p.startsWith('/_folio/preview/')) return previewRoutes(req, res, url);
  if (p === '/p' || p.startsWith('/p/')) return publicRoutes(req, res, url);
  if (config.proxy) return proxy.web(req, res);
  if (p === '/') return redirect(res, '/folio', 302);
  throw new HttpError(404, 'Not found');
}

function onError(req, res, err) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500 && !(err instanceof immich.ImmichError)) console.error(err);
  if (res.headersSent) return res.destroy();
  const message = status >= 500 && !(err instanceof immich.ImmichError) ? 'Something went wrong' : err.message;
  const wantsJson = req.url.startsWith('/_folio/api/') || !(req.headers.accept || '').includes('text/html');
  if (wantsJson) return sendJson(res, status, { error: message });
  return sendHtml(res, status, renderMessage(status === 404 ? 'Not found' : 'Something went wrong', message, status));
}

load();
const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => onError(req, res, err));
});
server.on('upgrade', proxy.upgrade);
server.listen(config.port, config.host, () => {
  console.log(`Folio listening on http://localhost:${config.port}  →  Immich at ${config.immichUrl}`);
  console.log(`Editor: http://localhost:${config.port}/folio`);
});
