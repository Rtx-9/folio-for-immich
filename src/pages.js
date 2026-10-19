// Page records and the Immich shared links that back them.
//
// Each album on a page gets its own private Immich "album" shared link, and each
// Photos block gets an "individual" shared link holding exactly its photos.
// Folio keeps the link keys on the server and streams photos through itself, so
// visitors only ever see the Folio page, and the page's password/expiry/download
// rules apply.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './http.js';
import * as immich from './immich.js';
import { pages, randomId, save, uploadsDir } from './store.js';
import { albumEntries, defaultDraft, photoBlocks } from './themes.js';

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

export function createPage(user, { title, preset, template, albumIds = [] }) {
  const now = new Date().toISOString();
  const draft = defaultDraft(String(title || '').trim().slice(0, 120) || 'Untitled page', preset, template);
  if (albumIds.length) {
    let block = draft.blocks.find((b) => b.type === 'albums');
    if (!block) {
      block = { id: randomId(), type: 'albums', heading: '', albums: [], albumStyle: 'cards', columns: 3, grouping: 'none', sort: 'custom', showCounts: true, showDates: true };
      draft.blocks.push(block);
    }
    block.albums = albumIds.map((albumId) => ({ albumId, title: '', description: '', section: '', coverAssetId: null }));
  }
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
  const albums = albumEntries(page.draft);
  const photos = photoBlocks(page.draft).flatMap((b) => b.photos);
  return {
    id: page.id,
    slug: page.slug,
    title: page.draft.title,
    subtitle: page.draft.subtitle,
    cover: page.draft.cover,
    firstAlbum: albums[0] || null,
    firstPhoto: photos[0]?.id || null,
    theme: page.draft.theme,
    albumCount: albums.length,
    photoCount: photos.length,
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
const configs = (page) => [page.draft, page.published].filter(Boolean);

// Every album ref and photos-block ref (with the union of its photos) that the
// draft or the live page needs. A block's link must keep photos that only the
// live copy still shows, or publishing a draft would break the live page.
function wantedLinks(page) {
  const albums = new Set();
  const blocks = new Map();
  for (const cfg of configs(page)) {
    for (const a of albumEntries(cfg)) albums.add(a.albumId);
    for (const b of photoBlocks(cfg)) {
      const set = blocks.get(b.id) || new Set();
      for (const p of b.photos) set.add(p.id);
      blocks.set(b.id, set);
    }
  }
  return { albums, blocks };
}

const linkSettings = (page) => ({
  description: linkDescription(page),
  allowDownload: page.sharing.allowDownload,
  allowUpload: false,
  showMetadata: false,
  ...(page.sharing.expiresAt ? { expiresAt: page.sharing.expiresAt } : {}),
});

// Make sure every album and Photos block has a working shared link.
export async function ensureLinks(page, auth) {
  const errors = [];
  const { albums, blocks } = wantedLinks(page);

  for (const albumId of albums) {
    if (page.links[albumId]) continue;
    try {
      const link = await immich.api('POST', '/shared-links', { auth, body: { type: 'ALBUM', albumId, ...linkSettings(page) } });
      page.links[albumId] = { id: link.id, key: link.key };
    } catch (err) {
      errors.push({ ref: albumId, albumId, message: err.message });
    }
  }

  for (const [blockId, wanted] of blocks) {
    const link = page.links[blockId];
    try {
      if (!link) {
        if (!wanted.size) continue;
        const created = await immich.api('POST', '/shared-links', { auth, body: { type: 'INDIVIDUAL', assetIds: [...wanted], ...linkSettings(page) } });
        page.links[blockId] = { id: created.id, key: created.key, assets: [...wanted] };
        continue;
      }
      const have = new Set(link.assets || []);
      const add = [...wanted].filter((id) => !have.has(id));
      const remove = [...have].filter((id) => !wanted.has(id));
      if (add.length) {
        const result = await immich.api('PUT', `/shared-links/${link.id}/assets`, { auth, body: { assetIds: add } });
        const failed = (result || []).filter((r) => !r.success && r.error !== 'duplicate');
        if (failed.length) errors.push({ ref: blockId, message: `${failed.length} photo(s) could not be shared (${failed[0].error})` });
        const ok = new Set(failed.map((r) => r.assetId));
        add.filter((id) => !ok.has(id)).forEach((id) => have.add(id));
      }
      if (remove.length) {
        await immich.api('DELETE', `/shared-links/${link.id}/assets`, { auth, body: { assetIds: remove } });
        remove.forEach((id) => have.delete(id));
      }
      link.assets = [...have];
    } catch (err) {
      errors.push({ ref: blockId, message: err.message });
    }
  }
  save();
  return errors;
}

// Delete links nothing uses any more, and shrink photo links to what's still shown.
export async function pruneLinks(page, auth) {
  const { albums, blocks } = wantedLinks(page);
  for (const [ref, link] of Object.entries(page.links)) {
    if (albums.has(ref)) continue;
    if (blocks.has(ref) && blocks.get(ref).size) continue;
    await immich.deleteLink(auth, link.id).catch(() => {});
    delete page.links[ref];
  }
  save();
  return ensureLinks(page, auth);
}

export async function syncLinkSettings(page, auth) {
  const patch = { allowDownload: page.sharing.allowDownload, expiresAt: page.sharing.expiresAt || null, description: linkDescription(page) };
  await Promise.all(Object.values(page.links).map((link) => immich.updateLink(auth, link.id, patch).catch(() => {})));
}

// A link deleted in Immich's UI makes the album 404 on the page; recreate it.
export async function repairLink(page, auth, ref) {
  const old = page.links[ref];
  if (old) await immich.deleteLink(auth, old.id).catch(() => {});
  delete page.links[ref];
  return ensureLinks(page, auth);
}

export async function deletePage(page, auth) {
  await Promise.all(Object.values(page.links).map((link) => immich.deleteLink(auth, link.id).catch(() => {})));
  for (const image of page.images) fs.rm(path.join(uploadsDir, image), () => {});
  pages.remove(page.id);
}

export function pruneImages(page) {
  const used = new Set(configs(page).flatMap((c) => [c.cover, c.logo]).filter(Boolean));
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
