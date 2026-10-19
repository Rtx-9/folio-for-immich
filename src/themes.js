// Theme presets, fonts, templates, the page config schema and its sanitizer.
import crypto from 'node:crypto';

export const FONTS = {
  // sans
  Inter: { category: 'sans', weights: '400;500;600;700' },
  'Inter Tight': { category: 'sans', weights: '400;500;600;700' },
  'DM Sans': { category: 'sans', weights: '400;500;700' },
  Manrope: { category: 'sans', weights: '400;500;600;700' },
  'Work Sans': { category: 'sans', weights: '400;500;600' },
  Karla: { category: 'sans', weights: '400;500;700' },
  'Space Grotesk': { category: 'sans', weights: '400;500;700' },
  Outfit: { category: 'sans', weights: '400;500;600;700' },
  Poppins: { category: 'sans', weights: '400;500;600;700' },
  Montserrat: { category: 'sans', weights: '400;600;800' },
  Raleway: { category: 'sans', weights: '400;600;800' },
  'Josefin Sans': { category: 'sans', weights: '400;600;700' },
  Sora: { category: 'sans', weights: '400;600;700' },
  Archivo: { category: 'sans', weights: '400;600;800' },
  // display
  Syne: { category: 'display', weights: '400;600;800' },
  'Bricolage Grotesque': { category: 'display', weights: '400;600;800' },
  Unbounded: { category: 'display', weights: '400;600;800' },
  'Abril Fatface': { category: 'display', weights: '400' },
  Italiana: { category: 'display', weights: '400' },
  Gloock: { category: 'display', weights: '400' },
  // serif
  Fraunces: { category: 'serif', weights: '400;600' },
  'Playfair Display': { category: 'serif', weights: '400;600;700' },
  'DM Serif Display': { category: 'serif', weights: '400' },
  'Cormorant Garamond': { category: 'serif', weights: '400;500;600' },
  'Instrument Serif': { category: 'serif', weights: '400' },
  'Libre Baskerville': { category: 'serif', weights: '400;700' },
  Lora: { category: 'serif', weights: '400;600' },
  'EB Garamond': { category: 'serif', weights: '400;600' },
  'Bodoni Moda': { category: 'serif', weights: '400;600;700' },
  'Young Serif': { category: 'serif', weights: '400' },
  Marcellus: { category: 'serif', weights: '400' },
  // handwriting & mono
  'Dancing Script': { category: 'script', weights: '400;600' },
  Caveat: { category: 'script', weights: '400;600' },
  'Space Mono': { category: 'mono', weights: '400;700' },
  // no download
  'System sans': { category: 'sans', system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  'System serif': { category: 'serif', system: 'ui-serif, Georgia, "Times New Roman", serif' },
};

const theme = (bg, text, accent, heading, body, headingCase, headingWeight, radius) => ({ bg, text, accent, heading, body, headingCase, headingWeight, radius });

export const PRESETS = [
  { id: 'atelier', name: 'Atelier', blurb: 'Warm paper, editorial serif', theme: theme('#f7f5f0', '#1c1a17', '#1c1a17', 'Fraunces', 'Inter', 'normal', 'regular', 4) },
  { id: 'midnight', name: 'Midnight', blurb: 'Deep ink, soft blue', theme: theme('#0c0e13', '#e9eaee', '#9db8ff', 'Inter Tight', 'Inter', 'normal', 'bold', 14) },
  { id: 'darkroom', name: 'Darkroom', blurb: 'Warm black, amber light', theme: theme('#15110e', '#f1e7da', '#e3a857', 'DM Serif Display', 'DM Sans', 'normal', 'regular', 2) },
  { id: 'linen', name: 'Linen', blurb: 'Weddings, classic and calm', theme: theme('#f2ece3', '#2e2823', '#a0603f', 'Cormorant Garamond', 'Karla', 'normal', 'regular', 0) },
  { id: 'fern', name: 'Fern', blurb: 'Sage greens, outdoors', theme: theme('#edf0e8', '#1d2a20', '#3f6f4e', 'Playfair Display', 'Work Sans', 'normal', 'regular', 10) },
  { id: 'afterglow', name: 'Afterglow', blurb: 'Night-out purple and pink', theme: theme('#170b24', '#f5ecff', '#ff6fae', 'Syne', 'Space Grotesk', 'normal', 'bold', 18) },
  { id: 'poster', name: 'Poster', blurb: 'Stark white, loud orange', theme: theme('#ffffff', '#0a0a0a', '#ff4d00', 'Archivo', 'Archivo', 'upper', 'bold', 0) },
  { id: 'tide', name: 'Tide', blurb: 'Ocean teal on navy', theme: theme('#0e1c24', '#e2f0f3', '#63d2c6', 'Outfit', 'Outfit', 'normal', 'bold', 12) },
  { id: 'blush', name: 'Blush', blurb: 'Soft rose, modern serif', theme: theme('#fbf1ef', '#3b2a2a', '#c76b72', 'Instrument Serif', 'Manrope', 'normal', 'regular', 20) },
  { id: 'noir', name: 'Noir', blurb: 'Black tie, gold details', theme: theme('#08080a', '#f3efe6', '#c8a96a', 'Bodoni Moda', 'Inter', 'normal', 'regular', 0) },
  { id: 'riviera', name: 'Riviera', blurb: 'Navy and coral summer', theme: theme('#fdf6ec', '#1d2b53', '#ff6b5b', 'Abril Fatface', 'Poppins', 'normal', 'regular', 16) },
  { id: 'matcha', name: 'Matcha', blurb: 'Calm greens, soft serif', theme: theme('#f1f3e8', '#26331d', '#6f8f32', 'Young Serif', 'Sora', 'normal', 'regular', 12) },
  { id: 'lavender', name: 'Lavender', blurb: 'Airy violet, fine lines', theme: theme('#f6f2fb', '#2e2440', '#8b6fd6', 'Italiana', 'Raleway', 'upper', 'regular', 6) },
  { id: 'bloom', name: 'Bloom', blurb: 'Romantic script, blush', theme: theme('#fffaf7', '#4a3b36', '#c98b7e', 'Dancing Script', 'Lora', 'normal', 'bold', 14) },
  { id: 'sunday', name: 'Sunday', blurb: 'Handwritten, sunny', theme: theme('#fff8e7', '#3b2f1e', '#e8902a', 'Caveat', 'Josefin Sans', 'normal', 'bold', 18) },
  { id: 'terminal', name: 'Terminal', blurb: 'Green on black, mono', theme: theme('#0b0f0b', '#c9f5c9', '#39ff88', 'Space Mono', 'Space Mono', 'normal', 'bold', 0) },
  { id: 'gallery', name: 'Gallery', blurb: 'Quiet museum white', theme: theme('#fafafa', '#191919', '#191919', 'EB Garamond', 'Montserrat', 'normal', 'regular', 0) },
  { id: 'unbound', name: 'Unbound', blurb: 'Chunky, playful, bright', theme: theme('#eef1ff', '#14163a', '#3b4bff', 'Unbounded', 'DM Sans', 'normal', 'bold', 22) },
];

export const OPTIONS = {
  heroStyle: ['cover', 'banner', 'split', 'minimal'],
  align: ['left', 'center'],
  logoShape: ['round', 'square', 'plain'],
  albumStyle: ['cards', 'tiles', 'editorial', 'feature', 'inline'],
  grouping: ['none', 'year', 'sections'],
  sort: ['custom', 'newest', 'oldest', 'name'],
  width: ['narrow', 'normal', 'wide'],
  galleryStyle: ['justified', 'masonry', 'grid'],
  photoStyle: ['justified', 'masonry', 'grid', 'stack', 'carousel'],
  density: ['tight', 'normal', 'airy'],
  headingCase: ['normal', 'upper'],
  headingWeight: ['regular', 'bold'],
  blockTypes: ['albums', 'photos', 'text', 'quote', 'divider', 'button'],
  textSize: ['normal', 'large'],
  dividerStyle: ['line', 'ornament', 'space'],
  dividerSize: ['s', 'm', 'l'],
  buttonStyle: ['accent', 'outline'],
};

const blockId = () => crypto.randomBytes(8).toString('hex');

// ---- block defaults ---------------------------------------------------------------

export function newBlock(type, extra = {}) {
  const base = { id: blockId(), type };
  const defaults = {
    albums: { heading: '', albums: [], albumStyle: 'cards', columns: 3, grouping: 'none', sort: 'custom', showCounts: true, showDates: true },
    photos: { heading: '', text: '', photos: [], style: 'justified', density: 'normal', rowHeight: 280, columns: 3 },
    text: { heading: '', body: '', align: 'left', size: 'normal' },
    quote: { text: '', author: '', align: 'center' },
    divider: { style: 'line', size: 'm' },
    button: { label: 'Get in touch', url: '', style: 'accent', align: 'center' },
  };
  return { ...base, ...defaults[type], ...extra };
}

// ---- templates ------------------------------------------------------------------------

export const TEMPLATES = [
  {
    id: 'wedding',
    name: 'Wedding',
    blurb: 'Full-screen cover, galleries by section',
    preset: 'linen',
    hero: { style: 'cover', size: 100, align: 'center', overlay: 35, titleScale: 115 },
    blocks: () => [
      newBlock('text', { body: 'Thank you for letting us be part of your day. Here are your galleries — tap any photo to see it full screen.', align: 'center', size: 'large' }),
      newBlock('albums', { albumStyle: 'tiles', grouping: 'sections' }),
      newBlock('divider', { style: 'ornament' }),
      newBlock('quote', { text: 'And in the end, the love you take is equal to the love you make.', author: '' }),
    ],
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    blurb: 'Big type, best shots, then projects',
    preset: 'poster',
    hero: { style: 'minimal', size: 55, align: 'left', titleScale: 120 },
    blocks: () => [
      newBlock('photos', { heading: 'Selected work', style: 'masonry', density: 'airy' }),
      newBlock('albums', { heading: 'Projects', albumStyle: 'editorial' }),
      newBlock('button', { label: 'Work with me', align: 'left' }),
    ],
  },
  {
    id: 'event',
    name: 'Event recap',
    blurb: 'Banner, highlights, all galleries',
    preset: 'afterglow',
    hero: { style: 'banner', size: 40, align: 'center' },
    blocks: () => [
      newBlock('text', { body: 'What a night. Here are the highlights — the full galleries are below.', align: 'center' }),
      newBlock('photos', { heading: 'Highlights', style: 'carousel', rowHeight: 360 }),
      newBlock('albums', { heading: 'All galleries', albumStyle: 'cards', columns: 3 }),
    ],
  },
  {
    id: 'travel',
    name: 'Travel journal',
    blurb: 'Split header, every photo on the page',
    preset: 'tide',
    hero: { style: 'split', size: 70, align: 'left' },
    blocks: () => [
      newBlock('text', { heading: 'Where we went', body: 'A few weeks, a lot of kilometres. Notes and photos from the road.' }),
      newBlock('albums', { albumStyle: 'inline' }),
      newBlock('divider', { style: 'line' }),
      newBlock('text', { body: 'Until next time.', align: 'center', size: 'large' }),
    ],
  },
  {
    id: 'delivery',
    name: 'Client delivery',
    blurb: 'Clear instructions and downloads',
    preset: 'atelier',
    hero: { style: 'cover', size: 60, align: 'left' },
    blocks: () => [
      newBlock('text', { heading: 'Your photos are ready', body: 'Open a gallery to view everything in full screen. Use “Download all” to save a whole gallery as a ZIP file.' }),
      newBlock('albums', { albumStyle: 'cards', columns: 3 }),
      newBlock('button', { label: 'Leave a review' }),
    ],
  },
  {
    id: 'story',
    name: 'Photo story',
    blurb: 'Large photos one after another',
    preset: 'noir',
    hero: { style: 'cover', size: 100, align: 'center', overlay: 45 },
    blocks: () => [
      newBlock('text', { body: 'Some stories are better told in pictures.', align: 'center', size: 'large' }),
      newBlock('photos', { style: 'stack' }),
      newBlock('quote', { text: 'Photography is the story I fail to put into words.', author: 'Destin Sparks' }),
      newBlock('photos', { style: 'carousel' }),
    ],
  },
  {
    id: 'blank',
    name: 'Blank',
    blurb: 'Just a header — build it yourself',
    preset: 'atelier',
    hero: { style: 'minimal', size: 45, align: 'left' },
    blocks: () => [],
  },
];

export function defaultDraft(title = 'Untitled page', presetId, templateId = 'delivery') {
  const template = TEMPLATES.find((t) => t.id === templateId) || TEMPLATES.find((t) => t.id === 'delivery');
  const preset = PRESETS.find((p) => p.id === (presetId || template.preset)) || PRESETS[0];
  return {
    version: 2,
    title,
    subtitle: '',
    cover: null,
    logo: null,
    theme: { preset: preset.id, ...preset.theme },
    hero: { style: 'cover', size: 78, align: 'center', overlay: 40, logoShape: 'round', logoSize: 88, titleScale: 100, focusX: 50, focusY: 50, ...template.hero },
    blocks: template.blocks(),
    layout: { width: 'normal' },
    gallery: { style: 'justified', density: 'normal' },
    footer: { text: '', contactLabel: '', contactUrl: '', poweredBy: true },
  };
}

// ---- sanitizing ---------------------------------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;
const IMAGE_ID = /^[a-z0-9]{8,40}\.(jpg|png|webp|gif|avif)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCK_ID = /^[0-9a-f]{16}$/;
const HERO_HEIGHTS = { compact: 42, medium: 60, large: 78, full: 100 };

const str = (v, max, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
const num = (v, min, max, fallback) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : fallback);
const flag = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
const hex = (v, fallback) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);
const image = (v) => (typeof v === 'string' && IMAGE_ID.test(v) ? v : null);

export function safeUrl(v) {
  if (typeof v !== 'string' || !v.trim()) return '';
  const value = v.trim().slice(0, 500);
  if (/^mailto:[^\s]+$/i.test(value) || /^tel:[+\d\s()-]+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value)) return `https://${value}`;
    return '';
  }
}

function sanitizeAlbums(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter((a) => a && typeof a.albumId === 'string' && UUID.test(a.albumId) && !seen.has(a.albumId) && seen.add(a.albumId))
    .slice(0, 200)
    .map((a) => ({
      albumId: a.albumId,
      title: str(a.title, 160),
      description: str(a.description, 2000),
      section: str(a.section, 80).trim(),
      coverAssetId: typeof a.coverAssetId === 'string' && UUID.test(a.coverAssetId) ? a.coverAssetId : null,
    }));
}

function sanitizePhotos(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter((p) => p && typeof p.id === 'string' && UUID.test(p.id) && !seen.has(p.id) && seen.add(p.id))
    .slice(0, 1000)
    .map((p) => ({
      id: p.id,
      ratio: Math.round(Math.min(5, Math.max(0.2, Number(p.ratio) || 1.5)) * 1000) / 1000,
      video: Boolean(p.video),
      duration: Number.isFinite(Number(p.duration)) && p.duration !== null ? Math.round(Number(p.duration)) : null,
      date: typeof p.date === 'string' && !Number.isNaN(Date.parse(p.date)) ? p.date.slice(0, 40) : null,
      caption: str(p.caption, 300),
    }));
}

export function sanitizeBlock(b) {
  if (!b || !OPTIONS.blockTypes.includes(b.type)) return null;
  const d = newBlock(b.type);
  const out = { id: typeof b.id === 'string' && BLOCK_ID.test(b.id) ? b.id : d.id, type: b.type };
  switch (b.type) {
    case 'albums':
      return {
        ...out,
        heading: str(b.heading, 160),
        albums: sanitizeAlbums(b.albums),
        albumStyle: pick(b.albumStyle, OPTIONS.albumStyle, d.albumStyle),
        columns: num(b.columns, 2, 4, d.columns),
        grouping: pick(b.grouping, OPTIONS.grouping, d.grouping),
        sort: pick(b.sort, OPTIONS.sort, d.sort),
        showCounts: flag(b.showCounts, true),
        showDates: flag(b.showDates, true),
      };
    case 'photos':
      return {
        ...out,
        heading: str(b.heading, 160),
        text: str(b.text, 2000),
        photos: sanitizePhotos(b.photos),
        style: pick(b.style, OPTIONS.photoStyle, d.style),
        density: pick(b.density, OPTIONS.density, d.density),
        rowHeight: num(b.rowHeight, 140, 560, d.rowHeight),
        columns: num(b.columns, 2, 5, d.columns),
      };
    case 'text':
      return { ...out, heading: str(b.heading, 200), body: str(b.body, 6000), align: pick(b.align, OPTIONS.align, 'left'), size: pick(b.size, OPTIONS.textSize, 'normal') };
    case 'quote':
      return { ...out, text: str(b.text, 1000), author: str(b.author, 160), align: pick(b.align, OPTIONS.align, 'center') };
    case 'divider':
      return { ...out, style: pick(b.style, OPTIONS.dividerStyle, 'line'), size: pick(b.size, OPTIONS.dividerSize, 'm') };
    case 'button':
      return { ...out, label: str(b.label, 80), url: safeUrl(b.url), style: pick(b.style, OPTIONS.buttonStyle, 'accent'), align: pick(b.align, OPTIONS.align, 'center') };
  }
  return null;
}

// Version-1 pages had a fixed intro + album list; turn those into blocks.
// The ids are fixed so a migrated draft and its live copy stay identical.
function migrateV1(input) {
  const blocks = [];
  if (typeof input.intro === 'string' && input.intro.trim()) {
    blocks.push({ id: '0000000000000001', type: 'text', body: input.intro, align: input.hero?.align || 'left' });
  }
  const l = input.layout || {};
  blocks.push({ id: '0000000000000002', type: 'albums', albums: input.albums || [], ...l });
  return blocks;
}

// Coerce any user-supplied draft into a valid one. Unknown keys are dropped.
export function sanitizeDraft(input = {}) {
  const d = defaultDraft();
  const t = input.theme || {};
  const h = input.hero || {};
  const g = input.gallery || {};
  const f = input.footer || {};
  const rawBlocks = Array.isArray(input.blocks) ? input.blocks : input.version === 2 ? [] : migrateV1(input);
  const ids = new Set();
  const blocks = rawBlocks
    .map(sanitizeBlock)
    .filter((b) => b && !ids.has(b.id) && ids.add(b.id))
    .slice(0, 60);
  return {
    version: 2,
    title: str(input.title, 120, 'Untitled page').trim() || 'Untitled page',
    subtitle: str(input.subtitle, 240),
    cover: image(input.cover),
    logo: image(input.logo),
    theme: {
      preset: typeof t.preset === 'string' ? t.preset.slice(0, 40) : 'custom',
      bg: hex(t.bg, d.theme.bg),
      text: hex(t.text, d.theme.text),
      accent: hex(t.accent, d.theme.accent),
      heading: FONTS[t.heading] ? t.heading : d.theme.heading,
      body: FONTS[t.body] ? t.body : d.theme.body,
      headingCase: pick(t.headingCase, OPTIONS.headingCase, 'normal'),
      headingWeight: pick(t.headingWeight, OPTIONS.headingWeight, 'regular'),
      radius: num(t.radius, 0, 32, d.theme.radius),
    },
    hero: {
      style: pick(h.style, OPTIONS.heroStyle, 'cover'),
      size: num(typeof h.size === 'number' ? h.size : HERO_HEIGHTS[h.height] ?? h.size, 20, 100, 78),
      align: pick(h.align, OPTIONS.align, 'center'),
      overlay: num(h.overlay, 0, 90, 40),
      logoShape: pick(h.logoShape, OPTIONS.logoShape, 'round'),
      logoSize: num(h.logoSize, 32, 260, 88),
      titleScale: num(h.titleScale, 50, 180, 100),
      focusX: num(h.focusX, 0, 100, 50),
      focusY: num(h.focusY, 0, 100, 50),
    },
    blocks,
    layout: { width: pick(input.layout?.width, OPTIONS.width, 'normal') },
    gallery: {
      style: pick(g.style, OPTIONS.galleryStyle, 'justified'),
      density: pick(g.density, OPTIONS.density, 'normal'),
    },
    footer: {
      text: str(f.text, 600),
      contactLabel: str(f.contactLabel, 60),
      contactUrl: safeUrl(f.contactUrl),
      poweredBy: flag(f.poweredBy, true),
    },
  };
}

// Helpers used across server and renderer.
export const albumEntries = (cfg) => cfg.blocks.filter((b) => b.type === 'albums').flatMap((b) => b.albums);
export const photoBlocks = (cfg) => cfg.blocks.filter((b) => b.type === 'photos');

// ---- color helpers -------------------------------------------------------

const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
export const mix = (a, b, amount) => {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex(x.map((c, i) => c + (y[i] - c) * amount));
};
export function luminance(h) {
  const [r, g, b] = toRgb(h).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
export const readableOn = (bg) => (contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111');

const FALLBACK = {
  sans: 'ui-sans-serif, system-ui, sans-serif',
  display: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  script: 'cursive',
  mono: 'ui-monospace, SFMono-Regular, Consolas, monospace',
};
export function fontStack(name) {
  const font = FONTS[name] || FONTS.Inter;
  if (font.system) return font.system;
  return `"${name}", ${FALLBACK[font.category] || FALLBACK.sans}`;
}

export function googleFontsHref(names) {
  const families = [...new Set(names)]
    .filter((n) => FONTS[n] && !FONTS[n].system)
    .map((n) => `family=${n.replace(/ /g, '+')}:wght@${FONTS[n].weights}`);
  return families.length ? `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap` : null;
}
