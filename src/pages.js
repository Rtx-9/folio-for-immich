// Page records and the Immich shared links that back them.
//
// Each album on a page gets its own private Immich shared link. Folio keeps the
// link key on the server and streams photos through itself, so visitors only ever
// see the Folio page, and the page's password/expiry/download rules apply.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './http.js';
import * as immich from './immich.js';
import { pages, randomId, save, uploadsDir } from './store.js';
import { defaultDraft } from './themes.js';

const RESERVED = new Set(['new', 'api', 'admin', 'login', 'static', 'folio']);

export function slugify(text) {
  return (
    String(text || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'page'
  );
}

export function validateSlug(slug, pageId) {
  if (typeof slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(slug)) {
    throw new HttpError(400, 'Use 1–60 lowercase letters, numbers and dashes.');
  }
  if (RESERVED.has(slug)) throw new HttpError(400, 'That address is reserved.');
  const other = pages.bySlug(slug);
  if (other && other.id !== pageId) throw new HttpError(409, 'Another page already uses that address.');
  return slug;
}

export function uniqueSlug(base) {
  let slug = slugify(base);
  if (RESERVED.has(slug)) slug = `${slug}-page`;
  let candidate = slug;
  for (let i = 2; pages.bySlug(candidate); i++) candidate = `${slug}-${i}`;
  return candidate;
}

export function createPage(user, { title, preset, albumIds = [] }) {
  const now = new Date().toISOString();
  const draft = defaultDraft(String(title || '').trim().slice(0, 120) || 'Untitled page', preset);
  draft.albums = albumIds.map((albumId) => ({ albumId, title: '', description: '', section: '', coverAssetId: null }));
  return pages.insert({
    id: randomId(),
    ownerId: user.id,
    slug: uniqueSlug(draft.title),
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    draft,
    published: null,
    links: {},
    images: [],
    sharing: { allowDownload: true, noindex: true, expiresAt: null },
    password: null,
    views: 0,
  });
}

export function ownedPage(id, user) {
  const page = pages.byId(id);
  if (!page || page.ownerId !== user.id) throw new HttpError(404, 'Page not found');
  return page;
}

export const isExpired = (page) => Boolean(page.sharing.expiresAt && new Date(page.sharing.expiresAt) <= new Date());
export const hasChanges = (page) => !page.published || JSON.stringify(page.draft) !== JSON.stringify(page.published);

export function summary(page) {
  return {
    id: page.id,
    slug: page.slug,
    title: page.draft.title,
    subtitle: page.draft.subtitle,
    cover: page.draft.cover,
    firstAlbum: page.draft.albums[0] || null,
    theme: page.draft.theme,
    albumCount: page.draft.albums.length,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    publishedAt: page.publishedAt,
    live: Boolean(page.published),
    hasChanges: hasChanges(page),
    expired: isExpired(page),
    hasPassword: Boolean(page.password),
    sharing: page.sharing,
    views: page.views || 0,
  };
}

const linkDescription = (page) => `Folio · ${page.draft.title}`.slice(0, 200);

// Make sure every album referenced by the draft has a working shared link.
export async function ensureLinks(page, auth, albumIds = page.draft.albums.map((a) => a.albumId)) {
  const errors = [];
  for (const albumId of albumIds) {
    if (page.links[albumId]) continue;
    try {
      const link = await immich.createAlbumLink(auth, albumId, {
        description: linkDescription(page),
        allowDownload: page.sharing.allowDownload,
        expiresAt: page.sharing.expiresAt,
      });
      page.links[albumId] = { id: link.id, key: link.key };
    } catch (err) {
      errors.push({ albumId, message: err.message });
    }
  }
  if (Object.keys(page.links).length) save();
  return errors;
}

// Delete links for albums that neither the draft nor the live page uses.
export async function pruneLinks(page, auth) {
  const used = new Set([...page.draft.albums, ...(page.published?.albums || [])].map((a) => a.albumId));
  for (const [albumId, link] of Object.entries(page.links)) {
    if (used.has(albumId)) continue;
    await immich.deleteLink(auth, link.id).catch(() => {});
    delete page.links[albumId];
  }
  save();
}

export async function syncLinkSettings(page, auth) {
  const patch = { allowDownload: page.sharing.allowDownload, expiresAt: page.sharing.expiresAt || null, description: linkDescription(page) };
  await Promise.all(Object.values(page.links).map((link) => immich.updateLink(auth, link.id, patch).catch(() => {})));
}

// A link deleted in Immich's UI makes the album 404 on the page; recreate it.
export async function repairLink(page, auth, albumId) {
  const old = page.links[albumId];
  if (old) await immich.deleteLink(auth, old.id).catch(() => {});
  delete page.links[albumId];
  return ensureLinks(page, auth, [albumId]);
}

export async function deletePage(page, auth) {
  await Promise.all(Object.values(page.links).map((link) => immich.deleteLink(auth, link.id).catch(() => {})));
  for (const image of page.images) fs.rm(path.join(uploadsDir, image), () => {});
  pages.remove(page.id);
}

export function pruneImages(page) {
  const used = new Set([page.draft.cover, page.draft.logo, page.published?.cover, page.published?.logo].filter(Boolean));
  page.images = page.images.filter((image) => {
    if (used.has(image)) return true;
    fs.rm(path.join(uploadsDir, image), () => {});
    return false;
  });
}

// ---- uploaded images -----------------------------------------------------------

const SIGNATURES = [
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'gif', test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { ext: 'avif', test: (b) => b.subarray(4, 12).toString('latin1') === 'ftypavif' },
];

export function storeImage(page, buffer) {
  const kind = SIGNATURES.find((s) => buffer.length > 12 && s.test(buffer));
  if (!kind) throw new HttpError(415, 'Please upload a JPEG, PNG, WebP, GIF or AVIF image.');
  const name = `${randomId(10)}.${kind.ext}`;
  fs.writeFileSync(path.join(uploadsDir, name), buffer);
  page.images.push(name);
  save();
  return name;
}
