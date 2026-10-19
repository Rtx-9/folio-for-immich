// Server-side rendering of public pages (and the editor's live preview).
import { esc, safeJson } from './http.js';
import { FONTS, fontStack, googleFontsHref, mix, readableOn } from './themes.js';

const ICONS = {
  back: '<path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>',
  next: '<path d="M4 11h12.17l-5.59-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4v-2z"/>',
  download: '<path d="M5 20h14v-2H5v2zm14-9h-4V3H9v8H5l7 7 7-7z"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  lock: '<path d="M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 0 1 6 0v2H9V6zm3 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>',
  down: '<path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>',
};
const icon = (name, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const MONTH = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const DAY = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function dateLabel(start, end) {
  const s = start ? new Date(start) : null;
  const e = end ? new Date(end) : null;
  if (!s && !e) return '';
  if (!s || !e) return MONTH.format(s || e);
  const a = MONTH.format(s);
  const b = MONTH.format(e);
  if (a === b) {
    const month = s.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
    const [ds, de] = [s.getUTCDate(), e.getUTCDate()];
    return ds === de ? DAY.format(s) : `${ds}–${de} ${month} ${s.getUTCFullYear()}`;
  }
  if (s.getUTCFullYear() === e.getUTCFullYear()) {
    return `${s.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} – ${b}`;
  }
  return `${a} – ${b}`;
}

const countLabel = (n) => `${n.toLocaleString('en')} ${n === 1 ? 'photo' : 'photos'}`;

function metaLine(album, opts) {
  const parts = [];
  if (opts.showDates && album.dateText) parts.push(esc(album.dateText));
  if (opts.showCounts && album.count != null) parts.push(esc(countLabel(album.count)));
  return parts.join('<span class="dot" aria-hidden="true">·</span>');
}

function richText(text) {
  return String(text || '')
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => `<p>${linkify(esc(p)).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
const linkify = (escaped) =>
  escaped.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g, (url) => `<a href="${url}" rel="noopener nofollow" target="_blank">${url}</a>`);

// ---- theme ----------------------------------------------------------------------

function themeVars(cfg) {
  const t = cfg.theme;
  const h = cfg.hero;
  const headingFont = FONTS[t.heading] || FONTS.Inter;
  const heavy = (headingFont.weights || '400;700').split(';').map(Number);
  const weight = t.headingWeight === 'bold' ? Math.max(...heavy.filter((w) => w <= 800)) : Math.min(...heavy);
  const widths = { narrow: '980px', normal: '1280px', wide: '1680px' };
  const dark = readableOn(t.bg) === '#ffffff';
  const vars = {
    '--bg': t.bg,
    '--fg': t.text,
    '--accent': t.accent,
    '--on-accent': readableOn(t.accent),
    '--muted': mix(t.text, t.bg, 0.38),
    '--line': mix(t.bg, t.text, 0.14),
    '--surface': mix(t.bg, t.text, 0.05),
    '--surface-2': mix(t.bg, t.text, 0.1),
    '--font-h': fontStack(t.heading),
    '--font-b': fontStack(t.body),
    '--h-weight': String(weight),
    '--h-case': t.headingCase === 'upper' ? 'uppercase' : 'none',
    '--h-track': t.headingCase === 'upper' ? '0.01em' : weight >= 600 ? '-0.025em' : '-0.01em',
    '--radius': `${t.radius}px`,
    '--maxw': widths[cfg.layout.width],
    '--overlay': String(h.overlay / 100),
    '--hero-size': String(h.size),
    '--logo': `${h.logoSize}px`,
    '--title-scale': String(h.titleScale / 100),
    '--fx': `${h.focusX}%`,
    '--fy': `${h.focusY}%`,
  };
  return `:root{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')};color-scheme:${dark ? 'dark' : 'light'}}`;
}

function head(cfg, { title, description, image, url, noindex }) {
  const fonts = googleFontsHref([cfg.theme.heading, cfg.theme.body]);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
<meta name="theme-color" content="${esc(cfg.theme.bg)}">
<meta name="referrer" content="same-origin">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
${description ? `<meta property="og:description" content="${esc(description)}">` : ''}
${url ? `<meta property="og:url" content="${esc(url)}">` : ''}
${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : ''}
${fonts ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${esc(fonts)}">` : ''}
<link rel="stylesheet" href="/_folio/static/page.css">
<style>${themeVars(cfg)}</style>
</head>`;
}

// ---- album helpers ---------------------------------------------------------------

const imgUrl = (id) => (id ? `/_folio/img/${id}` : null);

// Combine an album entry (per-block overrides) with the album's own metadata.
function mergeAlbum(entry, meta, base) {
  if (!meta || meta.missing) return { ...entry, title: entry.title || meta?.title || 'Album unavailable', missing: true, href: '#' };
  return {
    ...meta,
    title: entry.title.trim() || meta.title,
    description: entry.description.trim() || meta.description,
    section: entry.section,
    coverUrl: entry.coverAssetId ? `${base}/m/${entry.albumId}/${entry.coverAssetId}/preview` : meta.coverUrl,
  };
}

function sortAlbums(albums, sort) {
  const time = (a) => new Date(a.end || a.start || 0).getTime();
  const list = [...albums];
  if (sort === 'newest') list.sort((a, b) => time(b) - time(a));
  if (sort === 'oldest') list.sort((a, b) => time(a) - time(b));
  if (sort === 'name') list.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  return list;
}

// Every album on the page, in display order (used for album pages and their pager).
function orderedAlbums(cfg, albums, base) {
  const seen = new Set();
  const out = [];
  for (const block of cfg.blocks.filter((b) => b.type === 'albums')) {
    const items = sortAlbums(block.albums.map((e) => mergeAlbum(e, albums.get(e.albumId), base)), block.sort);
    for (const a of items) if (!a.missing && !seen.has(a.albumId) && seen.add(a.albumId)) out.push(a);
  }
  return out;
}

function firstPhotoUrl(cfg, base) {
  for (const b of cfg.blocks) if (b.type === 'photos' && b.photos[0]) return `${base}/m/${b.id}/${b.photos[0].id}/preview`;
  return null;
}

function heroImage(cfg, albums, base) {
  if (cfg.cover) return imgUrl(cfg.cover);
  const first = orderedAlbums(cfg, albums, base).find((a) => a.coverUrl);
  return first?.coverUrl || firstPhotoUrl(cfg, base);
}

// ---- header ----------------------------------------------------------------------

function logoHtml(cfg, extra = '') {
  if (!cfg.logo) return '';
  return `<img class="logo logo-${cfg.hero.logoShape} ${extra}" src="${imgUrl(cfg.logo)}" alt="">`;
}

function hero(cfg, albums, base) {
  const { style, size, align } = cfg.hero;
  const image = style === 'minimal' ? null : heroImage(cfg, albums, base);
  const cls = `hero hero-${style} align-${align}${image ? '' : ' no-image'}`;
  const text = `
      ${logoHtml(cfg)}
      <h1 class="hero-title">${esc(cfg.title)}</h1>
      ${cfg.subtitle ? `<p class="hero-subtitle">${esc(cfg.subtitle)}</p>` : ''}`;
  const img = image ? `<img class="hero-img" src="${esc(image)}" alt="" fetchpriority="high">` : '';

  if (style === 'cover') {
    return `<header class="${cls}" data-edit="header">
    ${img}
    <div class="hero-shade"></div>
    <div class="hero-inner wrap">${text}</div>
    ${size >= 90 ? `<a class="scroll-cue" href="#content" aria-label="Scroll down">${icon('down')}</a>` : ''}
  </header>`;
  }
  if (style === 'banner') {
    return `<header class="${cls}" data-edit="header">
    ${image ? `<div class="banner hero-media">${img}</div>` : ''}
    <div class="hero-inner wrap">${text}</div>
  </header>`;
  }
  if (style === 'split') {
    return `<header class="${cls}" data-edit="header">
    <div class="split wrap">
      <div class="hero-inner">${text}</div>
      ${image ? `<div class="split-media hero-media">${img}</div>` : ''}
    </div>
  </header>`;
  }
  return `<header class="${cls}" data-edit="header"><div class="hero-inner wrap">${text}</div></header>`;
}

// ---- blocks ----------------------------------------------------------------------

const cover = (album) =>
  album.coverUrl ? `<img src="${esc(album.coverUrl)}" alt="" loading="lazy" decoding="async">` : '<div class="cover-empty"></div>';

const albumCard = (a, o) => `<a class="card" href="${esc(a.href)}">
      <div class="card-media">${cover(a)}</div>
      <div class="card-body">
        <h3 class="card-title">${esc(a.title)}</h3>
        ${metaLine(a, o) ? `<p class="meta">${metaLine(a, o)}</p>` : ''}
      </div>
    </a>`;

const albumTile = (a, o, cls = 'tile') => `<a class="${cls}" href="${esc(a.href)}">
      ${cover(a)}
      <div class="tile-shade"></div>
      <div class="tile-body">
        <h3 class="tile-title">${esc(a.title)}</h3>
        ${metaLine(a, o) ? `<p class="meta">${metaLine(a, o)}</p>` : ''}
      </div>
    </a>`;

const albumRow = (a, o) => `<a class="row" href="${esc(a.href)}">
      <div class="row-media">${cover(a)}</div>
      <div class="row-body">
        ${metaLine(a, o) ? `<p class="eyebrow">${metaLine(a, o)}</p>` : ''}
        <h3 class="row-title">${esc(a.title)}</h3>
        ${a.description ? `<div class="row-desc">${richText(a.description)}</div>` : ''}
        <span class="row-cta">View album ${icon('next')}</span>
      </div>
    </a>`;

const actions = (ref, name, allowDownload, label = 'Download') => `<div class="actions">
          <button class="btn btn-ghost" type="button" data-slideshow="${esc(ref)}">${icon('play')}<span>Slideshow</span></button>
          ${allowDownload ? `<button class="btn btn-ghost" type="button" data-download="${esc(ref)}" data-name="${esc(name)}">${icon('download')}<span>${label}</span></button>` : ''}
        </div>`;

const albumInline = (a, o, allowDownload) => `<section class="inline-album" id="album-${esc(a.albumId)}">
      <div class="inline-head">
        <div>
          <h3 class="inline-title">${esc(a.title)}</h3>
          ${metaLine(a, o) ? `<p class="meta">${metaLine(a, o)}</p>` : ''}
          ${a.description ? `<div class="inline-desc">${richText(a.description)}</div>` : ''}
        </div>
        ${actions(a.albumId, a.title, allowDownload)}
      </div>
      <div class="gallery" data-album="${esc(a.albumId)}" data-count="${a.count || 0}"></div>
    </section>`;

function groupAlbums(albums, block) {
  const sorted = sortAlbums(albums, block.sort);
  if (block.grouping === 'none') return [{ title: '', items: sorted }];
  const groups = new Map();
  for (const album of sorted) {
    const key =
      block.grouping === 'year'
        ? album.start || album.end
          ? String(new Date(album.start || album.end).getUTCFullYear())
          : 'Undated'
        : album.section || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(album);
  }
  return [...groups].map(([title, items]) => ({ title, items }));
}

const placeholder = (title, text) => `<div class="placeholder"><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
const heading = (text) => (text ? `<h2 class="block-heading">${esc(text)}</h2>` : '');

function albumsBlock(block, ctx) {
  const albums = block.albums.map((e) => mergeAlbum(e, ctx.albums.get(e.albumId), ctx.base)).filter((a) => !a.missing || ctx.preview);
  if (!albums.length) return ctx.preview ? `${heading(block.heading)}${placeholder('Albums', 'Add albums to this block in the editor.')}` : '';
  const style = block.albumStyle;
  const missingCard = (a) =>
    `<div class="missing"><b>${esc(a.title || 'Album unavailable')}</b><span>Folio can't reach this album. Open it in the editor to fix its link.</span></div>`;
  const groups = groupAlbums(albums, block)
    .map((group) => {
      const items = group.items;
      let inner;
      if (style === 'inline') inner = items.map((a) => (a.missing ? missingCard(a) : albumInline(a, block, ctx.allowDownload))).join('');
      else if (style === 'editorial') inner = `<div class="rows">${items.map((a) => (a.missing ? missingCard(a) : albumRow(a, block))).join('')}</div>`;
      else if (style === 'tiles') inner = `<div class="grid grid-tiles">${items.map((a) => (a.missing ? missingCard(a) : albumTile(a, block))).join('')}</div>`;
      else if (style === 'feature') {
        const [first, ...rest] = items;
        inner = `${first.missing ? missingCard(first) : albumTile(first, block, 'tile tile-feature')}
          ${rest.length ? `<div class="grid grid-cards">${rest.map((a) => (a.missing ? missingCard(a) : albumCard(a, block))).join('')}</div>` : ''}`;
      } else inner = `<div class="grid grid-cards">${items.map((a) => (a.missing ? missingCard(a) : albumCard(a, block))).join('')}</div>`;
      const n = items.length;
      const title = group.title
        ? `<h2 class="group-title"><span>${esc(group.title)}</span>${style !== 'inline' ? `<small>${n} ${n === 1 ? 'album' : 'albums'}</small>` : ''}</h2>`
        : '';
      return `<div class="group">${title}${inner}</div>`;
    })
    .join('');
  return `${heading(block.heading)}<div class="albums albums-${style}" style="--cols:${block.columns}">${groups}</div>`;
}

function photosBlock(block, ctx) {
  if (!block.photos.length) return ctx.preview ? `${heading(block.heading)}${placeholder('Photos', 'Pick photos for this block in the editor.')}` : '';
  const data = block.photos.map((p) => ({ id: p.id, video: p.video, ratio: p.ratio, duration: p.duration, date: p.date, caption: p.caption }));
  const name = block.heading || ctx.cfg.title;
  const head =
    block.heading || block.text
      ? `<div class="inline-head">
        <div>${heading(block.heading)}${block.text ? `<div class="inline-desc">${richText(block.text)}</div>` : ''}</div>
        ${block.photos.length > 1 ? actions(block.id, name, ctx.allowDownload) : ''}
      </div>`
      : '';
  return `${head}
    <div class="gallery" data-photos="${esc(block.id)}" data-style="${block.style}" data-density="${block.density}" data-row="${block.rowHeight}" data-cols="${block.columns}" data-count="${block.photos.length}"></div>
    <script type="application/json" id="photos-${esc(block.id)}">${safeJson(data)}</script>`;
}

function textBlock(block, ctx) {
  if (!block.heading && !block.body.trim()) return ctx.preview ? placeholder('Text', 'Write a heading or some text in the editor.') : '';
  return `<div class="text-block align-${block.align} size-${block.size}">
      ${block.heading ? `<h2 class="block-heading">${esc(block.heading)}</h2>` : ''}
      ${block.body.trim() ? `<div class="prose">${richText(block.body)}</div>` : ''}
    </div>`;
}

function quoteBlock(block, ctx) {
  if (!block.text.trim()) return ctx.preview ? placeholder('Quote', 'Type a quote in the editor.') : '';
  return `<figure class="quote align-${block.align}">
      <blockquote>${esc(block.text).replace(/\n/g, '<br>')}</blockquote>
      ${block.author ? `<figcaption>${esc(block.author)}</figcaption>` : ''}
    </figure>`;
}

const dividerBlock = (block) =>
  `<div class="divider divider-${block.style} size-${block.size}" role="separator">${block.style === 'ornament' ? '<span>✦</span><span>✦</span><span>✦</span>' : ''}</div>`;

function buttonBlock(block, ctx) {
  if (!block.url) {
    return ctx.preview ? `<div class="button-block align-${block.align}"><span class="btn btn-${block.style === 'outline' ? 'ghost' : 'accent'} is-placeholder">${esc(block.label || 'Button')} — add a link</span></div>` : '';
  }
  return `<div class="button-block align-${block.align}"><a class="btn btn-${block.style === 'outline' ? 'ghost' : 'accent'} btn-lg" href="${esc(block.url)}" rel="noopener">${esc(block.label || 'Open')}</a></div>`;
}

const RENDERERS = { albums: albumsBlock, photos: photosBlock, text: textBlock, quote: quoteBlock, divider: dividerBlock, button: buttonBlock };

function blocksHtml(cfg, ctx) {
  const out = cfg.blocks
    .map((block) => {
      const inner = RENDERERS[block.type](block, ctx);
      if (!inner) return '';
      return `<section class="block block-${block.type}" data-block="${esc(block.id)}" data-type="${block.type}"><div class="wrap">${inner}</div></section>`;
    })
    .join('');
  if (!out && ctx.preview) {
    return `<section class="block"><div class="wrap">${placeholder('Your page is empty', 'Add blocks — albums, photos, text and more — from the Content tab.')}</div></section>`;
  }
  return out;
}

function footer(cfg) {
  const f = cfg.footer;
  const parts = [];
  if (f.text.trim()) parts.push(`<div class="footer-text">${richText(f.text)}</div>`);
  if (f.contactUrl) parts.push(`<a class="btn btn-accent" href="${esc(f.contactUrl)}" rel="noopener">${esc(f.contactLabel || 'Get in touch')}</a>`);
  const powered = f.poweredBy ? `<p class="powered">Shared with <a href="https://immich.app" rel="noopener" target="_blank">Immich</a> · Folio</p>` : '';
  if (!parts.length && !powered) return '';
  return `<footer class="site-footer wrap align-${cfg.hero.align}" data-edit="footer">${parts.join('')}${powered}</footer>`;
}

function clientConfig({ base, allowDownload, cfg, preview, edit }) {
  return `<script>window.FOLIO=${safeJson({ base, allowDownload, gallery: cfg.gallery, preview: Boolean(preview), edit: Boolean(edit), hero: cfg.hero })}</script>
<script src="/_folio/static/page.js" defer></script>`;
}

// ---- full documents ---------------------------------------------------------------

export function renderIndex({ cfg, page, base, albums, origin, preview, edit }) {
  const image = heroImage(cfg, albums, base);
  const allowDownload = page.sharing.allowDownload;
  const firstText = cfg.blocks.find((b) => b.type === 'text' && b.body.trim())?.body || '';
  return `${head(cfg, {
    title: cfg.title,
    description: cfg.subtitle || firstText.slice(0, 180),
    image: image && origin ? origin + image : null,
    url: origin ? `${origin}${base}` : null,
    noindex: page.sharing.noindex || preview,
  })}
<body class="view-index${edit ? ' is-editing' : ''}">
${hero(cfg, albums, base)}
<main id="content">
${blocksHtml(cfg, { cfg, base, albums, allowDownload, preview })}
</main>
${footer(cfg)}
${clientConfig({ base, allowDownload, cfg, preview, edit })}
</body>
</html>`;
}

export function renderAlbum({ cfg, page, base, album: meta, albums, origin, preview, edit }) {
  const allowDownload = page.sharing.allowDownload;
  const ordered = orderedAlbums(cfg, albums, base);
  const i = ordered.findIndex((a) => a.albumId === meta.albumId);
  const album = ordered[i] || meta;
  const prev = i > 0 ? ordered[i - 1] : null;
  const next = i >= 0 && i < ordered.length - 1 ? ordered[i + 1] : null;
  const meta2 = metaLine(album, { showDates: true, showCounts: true });
  return `${head(cfg, {
    title: `${album.title} · ${cfg.title}`,
    description: album.description || cfg.subtitle,
    image: album.coverUrl && origin ? origin + album.coverUrl : null,
    url: origin ? `${origin}${base}/a/${album.albumId}` : null,
    noindex: page.sharing.noindex || preview,
  })}
<body class="view-album${edit ? ' is-editing' : ''}">
<nav class="topnav wrap">
  <a class="topnav-back" href="${esc(base)}">${icon('back')}<span>${esc(cfg.title)}</span></a>
  ${cfg.logo ? `<a href="${esc(base)}" class="topnav-logo">${logoHtml(cfg, 'logo-sm')}</a>` : ''}
</nav>
<header class="album-head wrap align-${cfg.hero.align}">
  ${meta2 ? `<p class="eyebrow">${meta2}</p>` : ''}
  <h1 class="album-title">${esc(album.title)}</h1>
  ${album.description ? `<div class="album-desc">${richText(album.description)}</div>` : ''}
  <div class="actions">
    <button class="btn btn-accent" type="button" data-slideshow="${esc(album.albumId)}">${icon('play')}<span>Slideshow</span></button>
    ${allowDownload ? `<button class="btn btn-ghost" type="button" data-download="${esc(album.albumId)}" data-name="${esc(album.title)}">${icon('download')}<span>Download all</span></button>` : ''}
  </div>
</header>
<main class="wrap">
  <div class="gallery" data-album="${esc(album.albumId)}" data-count="${album.count || 0}"></div>
  ${
    prev || next
      ? `<nav class="pager">
    ${prev ? `<a class="pager-link prev" href="${esc(prev.href)}">${icon('back')}<span><small>Previous</small>${esc(prev.title)}</span></a>` : '<span></span>'}
    ${next ? `<a class="pager-link next" href="${esc(next.href)}"><span><small>Next</small>${esc(next.title)}</span>${icon('next')}</a>` : ''}
  </nav>`
      : ''
  }
</main>
${footer(cfg)}
${clientConfig({ base, allowDownload, cfg, preview, edit })}
</body>
</html>`;
}

export function renderLocked({ cfg, base, error }) {
  return `${head(cfg, { title: cfg.title, noindex: true })}
<body class="view-locked">
<main class="lock">
  <form class="lock-card" method="post" action="${esc(base)}/unlock">
    ${cfg.logo ? logoHtml(cfg) : `<span class="lock-icon">${icon('lock')}</span>`}
    <h1 class="lock-title">${esc(cfg.title)}</h1>
    <p class="lock-text">This page is password protected.</p>
    <label class="sr-only" for="pw">Password</label>
    <input id="pw" name="password" type="password" placeholder="Password" autocomplete="current-password" required autofocus>
    ${error ? `<p class="lock-error" role="alert">${esc(error)}</p>` : ''}
    <button class="btn btn-accent" type="submit">View photos</button>
  </form>
</main>
</body>
</html>`;
}

export function renderMessage(title, message, status = 404) {
  const cfg = {
    theme: { bg: '#f7f5f0', text: '#1c1a17', accent: '#1c1a17', heading: 'System serif', body: 'System sans', headingCase: 'normal', headingWeight: 'regular', radius: 8 },
    layout: { width: 'normal' },
    hero: { overlay: 0, size: 50, logoSize: 88, titleScale: 100, focusX: 50, focusY: 50 },
  };
  return `${head(cfg, { title, noindex: true })}
<body class="view-locked">
<main class="lock"><div class="lock-card">
  <p class="eyebrow">${status === 410 ? 'Expired' : 'Not found'}</p>
  <h1 class="lock-title">${esc(title)}</h1>
  <p class="lock-text">${esc(message)}</p>
</div></main>
</body>
</html>`;
}
