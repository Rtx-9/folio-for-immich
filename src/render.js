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

function metaLine(album, layout) {
  const parts = [];
  if (layout.showDates && album.dateText) parts.push(esc(album.dateText));
  if (layout.showCounts && album.count != null) parts.push(esc(countLabel(album.count)));
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
    '--cols': String(cfg.layout.columns),
    '--overlay': String(cfg.hero.overlay / 100),
  };
  return {
    css: `:root{${Object.entries(vars)
      .map(([k, v]) => `${k}:${v}`)
      .join(';')};color-scheme:${dark ? 'dark' : 'light'}}`,
    dark,
  };
}

function head(cfg, { title, description, image, url, noindex }) {
  const fonts = googleFontsHref([cfg.theme.heading, cfg.theme.body]);
  const { css } = themeVars(cfg);
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
<style>${css}</style>
</head>`;
}

// ---- pieces ---------------------------------------------------------------------

const imgUrl = (id) => (id ? `/_folio/img/${id}` : null);

function logoHtml(cfg, extra = '') {
  if (!cfg.logo) return '';
  return `<img class="logo logo-${cfg.hero.logoShape} ${extra}" src="${imgUrl(cfg.logo)}" alt="">`;
}

function heroImage(cfg, albums) {
  if (cfg.cover) return imgUrl(cfg.cover);
  const first = albums.find((a) => a.coverUrl);
  return first ? first.coverUrl : null;
}

function hero(cfg, albums) {
  const { style, height, align } = cfg.hero;
  const image = style === 'minimal' ? null : heroImage(cfg, albums);
  const cls = `hero hero-${style} h-${height} align-${align}${image ? '' : ' no-image'}`;
  const text = `
      ${logoHtml(cfg)}
      <h1 class="hero-title">${esc(cfg.title)}</h1>
      ${cfg.subtitle ? `<p class="hero-subtitle">${esc(cfg.subtitle)}</p>` : ''}`;

  if (style === 'cover') {
    return `<header class="${cls}">
    ${image ? `<img class="hero-img" src="${esc(image)}" alt="" fetchpriority="high">` : ''}
    <div class="hero-shade"></div>
    <div class="hero-inner wrap">${text}</div>
    ${height === 'full' ? `<a class="scroll-cue" href="#content" aria-label="Scroll to albums">${icon('down')}</a>` : ''}
  </header>`;
  }
  if (style === 'banner') {
    return `<header class="${cls}">
    ${image ? `<div class="banner"><img class="hero-img" src="${esc(image)}" alt="" fetchpriority="high"></div>` : ''}
    <div class="hero-inner wrap">${text}</div>
  </header>`;
  }
  if (style === 'split') {
    return `<header class="${cls}">
    <div class="split wrap">
      <div class="hero-inner">${text}</div>
      ${image ? `<div class="split-media"><img class="hero-img" src="${esc(image)}" alt="" fetchpriority="high"></div>` : ''}
    </div>
  </header>`;
  }
  return `<header class="${cls}"><div class="hero-inner wrap">${text}</div></header>`;
}

function intro(cfg) {
  if (!cfg.intro.trim()) return '';
  return `<section class="intro wrap align-${cfg.hero.align}">${richText(cfg.intro)}</section>`;
}

const cover = (album) =>
  album.coverUrl ? `<img src="${esc(album.coverUrl)}" alt="" loading="lazy" decoding="async">` : '<div class="cover-empty"></div>';

const albumCard = (a, layout) => `<a class="card" href="${esc(a.href)}">
      <div class="card-media">${cover(a)}</div>
      <div class="card-body">
        <h3 class="card-title">${esc(a.title)}</h3>
        ${metaLine(a, layout) ? `<p class="meta">${metaLine(a, layout)}</p>` : ''}
      </div>
    </a>`;

const albumTile = (a, layout, cls = 'tile') => `<a class="${cls}" href="${esc(a.href)}">
      ${cover(a)}
      <div class="tile-shade"></div>
      <div class="tile-body">
        <h3 class="tile-title">${esc(a.title)}</h3>
        ${metaLine(a, layout) ? `<p class="meta">${metaLine(a, layout)}</p>` : ''}
      </div>
    </a>`;

const albumRow = (a, layout) => `<a class="row" href="${esc(a.href)}">
      <div class="row-media">${cover(a)}</div>
      <div class="row-body">
        ${metaLine(a, layout) ? `<p class="eyebrow">${metaLine(a, layout)}</p>` : ''}
        <h3 class="row-title">${esc(a.title)}</h3>
        ${a.description ? `<div class="row-desc">${richText(a.description)}</div>` : ''}
        <span class="row-cta">View album ${icon('next')}</span>
      </div>
    </a>`;

const albumInline = (a, layout, allowDownload) => `<section class="inline-album" id="album-${esc(a.albumId)}">
      <div class="inline-head">
        <div>
          <h3 class="inline-title">${esc(a.title)}</h3>
          ${metaLine(a, layout) ? `<p class="meta">${metaLine(a, layout)}</p>` : ''}
          ${a.description ? `<div class="inline-desc">${richText(a.description)}</div>` : ''}
        </div>
        <div class="actions">
          <button class="btn btn-ghost" type="button" data-slideshow="${esc(a.albumId)}">${icon('play')}<span>Slideshow</span></button>
          ${allowDownload ? `<button class="btn btn-ghost" type="button" data-download="${esc(a.albumId)}" data-name="${esc(a.title)}">${icon('download')}<span>Download</span></button>` : ''}
        </div>
      </div>
      <div class="gallery" data-album="${esc(a.albumId)}" data-count="${a.count || 0}"></div>
    </section>`;

function sortAlbums(albums, sort) {
  const time = (a) => new Date(a.end || a.start || 0).getTime();
  const list = [...albums];
  if (sort === 'newest') list.sort((a, b) => time(b) - time(a));
  if (sort === 'oldest') list.sort((a, b) => time(a) - time(b));
  if (sort === 'name') list.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  return list;
}

function groupAlbums(albums, layout) {
  const sorted = sortAlbums(albums, layout.sort);
  if (layout.grouping === 'none') return [{ title: '', items: sorted }];
  const groups = new Map();
  for (const album of sorted) {
    const key =
      layout.grouping === 'year'
        ? album.start || album.end
          ? String(new Date(album.start || album.end).getUTCFullYear())
          : 'Undated'
        : album.section;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(album);
  }
  return [...groups].map(([title, items]) => ({ title, items }));
}

function albumsSection(cfg, albums, { allowDownload, preview }) {
  const visible = albums.filter((a) => !a.missing || preview);
  if (!visible.length) {
    return preview
      ? `<section class="empty wrap"><p class="empty-title">No albums yet</p><p>Add albums from the <b>Albums</b> tab and they will show up here.</p></section>`
      : '';
  }
  const { layout } = cfg;
  const groups = groupAlbums(visible, layout);
  const missingCard = (a) =>
    `<div class="missing"><b>${esc(a.title || 'Album unavailable')}</b><span>Folio can't reach this album. Open the Albums tab to fix its link.</span></div>`;

  const body = groups
    .map((group) => {
      const items = group.items;
      let inner;
      if (layout.albumStyle === 'inline') {
        inner = items.map((a) => (a.missing ? missingCard(a) : albumInline(a, layout, allowDownload))).join('');
      } else if (layout.albumStyle === 'editorial') {
        inner = `<div class="rows">${items.map((a) => (a.missing ? missingCard(a) : albumRow(a, layout))).join('')}</div>`;
      } else if (layout.albumStyle === 'tiles') {
        inner = `<div class="grid grid-tiles">${items.map((a) => (a.missing ? missingCard(a) : albumTile(a, layout))).join('')}</div>`;
      } else if (layout.albumStyle === 'feature') {
        const [first, ...rest] = items;
        inner = `${first.missing ? missingCard(first) : albumTile(first, layout, 'tile tile-feature')}
          ${rest.length ? `<div class="grid grid-cards">${rest.map((a) => (a.missing ? missingCard(a) : albumCard(a, layout))).join('')}</div>` : ''}`;
      } else {
        inner = `<div class="grid grid-cards">${items.map((a) => (a.missing ? missingCard(a) : albumCard(a, layout))).join('')}</div>`;
      }
      const count = items.length;
      const title = group.title
        ? `<h2 class="group-title"><span>${esc(group.title)}</span>${
            layout.albumStyle !== 'inline' ? `<small>${count} ${count === 1 ? 'album' : 'albums'}</small>` : ''
          }</h2>`
        : '';
      return `<div class="group">${title}${inner}</div>`;
    })
    .join('');
  return `<section class="albums albums-${layout.albumStyle} wrap" id="content">${body}</section>`;
}

function footer(cfg) {
  const f = cfg.footer;
  const parts = [];
  if (f.text.trim()) parts.push(`<div class="footer-text">${richText(f.text)}</div>`);
  if (f.contactUrl) parts.push(`<a class="btn btn-accent" href="${esc(f.contactUrl)}" rel="noopener">${esc(f.contactLabel || 'Get in touch')}</a>`);
  const powered = f.poweredBy ? `<p class="powered">Shared with <a href="https://immich.app" rel="noopener" target="_blank">Immich</a> · Folio</p>` : '';
  if (!parts.length && !powered) return '';
  return `<footer class="site-footer wrap align-${cfg.hero.align}">${parts.join('')}${powered}</footer>`;
}

function clientConfig({ base, allowDownload, cfg, preview }) {
  return `<script>window.FOLIO=${safeJson({ base, allowDownload, gallery: cfg.gallery, preview: Boolean(preview) })}</script>
<script src="/_folio/static/page.js" defer></script>`;
}

// ---- full documents ---------------------------------------------------------------

export function renderIndex({ cfg, page, base, albums, origin, preview }) {
  const image = heroImage(cfg, albums);
  const allowDownload = page.sharing.allowDownload;
  return `${head(cfg, {
    title: cfg.title,
    description: cfg.subtitle || cfg.intro.slice(0, 180),
    image: image && origin ? origin + image : null,
    url: origin ? `${origin}${base}` : null,
    noindex: page.sharing.noindex || preview,
  })}
<body class="view-index">
${hero(cfg, albums)}
<main>
${intro(cfg)}
${albumsSection(cfg, albums, { allowDownload, preview })}
</main>
${footer(cfg)}
${clientConfig({ base, allowDownload, cfg, preview })}
</body>
</html>`;
}

export function renderAlbum({ cfg, page, base, album, albums, origin, preview }) {
  const allowDownload = page.sharing.allowDownload;
  const ordered = sortAlbums(albums.filter((a) => !a.missing), cfg.layout.sort);
  const i = ordered.findIndex((a) => a.albumId === album.albumId);
  const prev = i > 0 ? ordered[i - 1] : null;
  const next = i >= 0 && i < ordered.length - 1 ? ordered[i + 1] : null;
  const meta = metaLine(album, { showDates: true, showCounts: true });
  return `${head(cfg, {
    title: `${album.title} · ${cfg.title}`,
    description: album.description || cfg.subtitle,
    image: album.coverUrl && origin ? origin + album.coverUrl : null,
    url: origin ? `${origin}${base}/a/${album.albumId}` : null,
    noindex: page.sharing.noindex || preview,
  })}
<body class="view-album">
<nav class="topnav wrap">
  <a class="topnav-back" href="${esc(base)}">${icon('back')}<span>${esc(cfg.title)}</span></a>
  ${cfg.logo ? `<a href="${esc(base)}" class="topnav-logo">${logoHtml(cfg, 'logo-sm')}</a>` : ''}
</nav>
<header class="album-head wrap align-${cfg.hero.align}">
  ${meta ? `<p class="eyebrow">${meta}</p>` : ''}
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
${clientConfig({ base, allowDownload, cfg, preview })}
</body>
</html>`;
}

export function renderLocked({ cfg, page, base, error }) {
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
    layout: { width: 'normal', columns: 3 },
    hero: { overlay: 0 },
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
