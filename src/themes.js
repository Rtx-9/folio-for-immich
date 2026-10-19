// Theme presets, fonts, the page config schema and its sanitizer.

export const FONTS = {
  Inter: { category: 'sans', weights: '400;500;600;700' },
  'Inter Tight': { category: 'sans', weights: '400;500;600;700' },
  'DM Sans': { category: 'sans', weights: '400;500;700' },
  Manrope: { category: 'sans', weights: '400;500;600;700' },
  'Work Sans': { category: 'sans', weights: '400;500;600' },
  Karla: { category: 'sans', weights: '400;500;700' },
  'Space Grotesk': { category: 'sans', weights: '400;500;700' },
  Outfit: { category: 'sans', weights: '400;500;600;700' },
  Archivo: { category: 'sans', weights: '400;600;800' },
  Syne: { category: 'sans', weights: '400;600;800' },
  'Bricolage Grotesque': { category: 'sans', weights: '400;600;800' },
  Fraunces: { category: 'serif', weights: '400;600' },
  'Playfair Display': { category: 'serif', weights: '400;600;700' },
  'DM Serif Display': { category: 'serif', weights: '400' },
  'Cormorant Garamond': { category: 'serif', weights: '400;500;600' },
  'Instrument Serif': { category: 'serif', weights: '400' },
  'Libre Baskerville': { category: 'serif', weights: '400;700' },
  'System sans': { category: 'sans', system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  'System serif': { category: 'serif', system: 'ui-serif, Georgia, "Times New Roman", serif' },
};

export const PRESETS = [
  {
    id: 'atelier',
    name: 'Atelier',
    blurb: 'Warm paper, editorial serif',
    theme: { bg: '#f7f5f0', text: '#1c1a17', accent: '#1c1a17', heading: 'Fraunces', body: 'Inter', headingCase: 'normal', headingWeight: 'regular', radius: 4 },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    blurb: 'Deep ink, soft blue',
    theme: { bg: '#0c0e13', text: '#e9eaee', accent: '#9db8ff', heading: 'Inter Tight', body: 'Inter', headingCase: 'normal', headingWeight: 'bold', radius: 14 },
  },
  {
    id: 'darkroom',
    name: 'Darkroom',
    blurb: 'Warm black, amber light',
    theme: { bg: '#15110e', text: '#f1e7da', accent: '#e3a857', heading: 'DM Serif Display', body: 'DM Sans', headingCase: 'normal', headingWeight: 'regular', radius: 2 },
  },
  {
    id: 'linen',
    name: 'Linen',
    blurb: 'Weddings, classic and calm',
    theme: { bg: '#f2ece3', text: '#2e2823', accent: '#a0603f', heading: 'Cormorant Garamond', body: 'Karla', headingCase: 'normal', headingWeight: 'regular', radius: 0 },
  },
  {
    id: 'fern',
    name: 'Fern',
    blurb: 'Sage greens, outdoors',
    theme: { bg: '#edf0e8', text: '#1d2a20', accent: '#3f6f4e', heading: 'Playfair Display', body: 'Work Sans', headingCase: 'normal', headingWeight: 'regular', radius: 10 },
  },
  {
    id: 'afterglow',
    name: 'Afterglow',
    blurb: 'Night-out purple and pink',
    theme: { bg: '#170b24', text: '#f5ecff', accent: '#ff6fae', heading: 'Syne', body: 'Space Grotesk', headingCase: 'normal', headingWeight: 'bold', radius: 18 },
  },
  {
    id: 'poster',
    name: 'Poster',
    blurb: 'Stark white, loud orange',
    theme: { bg: '#ffffff', text: '#0a0a0a', accent: '#ff4d00', heading: 'Archivo', body: 'Archivo', headingCase: 'upper', headingWeight: 'bold', radius: 0 },
  },
  {
    id: 'tide',
    name: 'Tide',
    blurb: 'Ocean teal on navy',
    theme: { bg: '#0e1c24', text: '#e2f0f3', accent: '#63d2c6', heading: 'Outfit', body: 'Outfit', headingCase: 'normal', headingWeight: 'bold', radius: 12 },
  },
  {
    id: 'blush',
    name: 'Blush',
    blurb: 'Soft rose, modern serif',
    theme: { bg: '#fbf1ef', text: '#3b2a2a', accent: '#c76b72', heading: 'Instrument Serif', body: 'Manrope', headingCase: 'normal', headingWeight: 'regular', radius: 20 },
  },
];

export const OPTIONS = {
  heroStyle: ['cover', 'banner', 'split', 'minimal'],
  heroHeight: ['compact', 'medium', 'large', 'full'],
  align: ['left', 'center'],
  logoShape: ['round', 'square', 'plain'],
  albumStyle: ['cards', 'tiles', 'editorial', 'feature', 'inline'],
  grouping: ['none', 'year', 'sections'],
  sort: ['custom', 'newest', 'oldest', 'name'],
  width: ['narrow', 'normal', 'wide'],
  galleryStyle: ['justified', 'masonry', 'grid'],
  density: ['tight', 'normal', 'airy'],
  headingCase: ['normal', 'upper'],
  headingWeight: ['regular', 'bold'],
};

export function defaultDraft(title = 'Untitled page', presetId = 'atelier') {
  const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[0];
  return {
    title,
    subtitle: '',
    intro: '',
    cover: null,
    logo: null,
    theme: { preset: preset.id, ...preset.theme },
    hero: { style: 'cover', height: 'large', align: 'center', overlay: 40, logoShape: 'round' },
    layout: { albumStyle: 'cards', columns: 3, grouping: 'none', sort: 'custom', showCounts: true, showDates: true, width: 'normal' },
    gallery: { style: 'justified', density: 'normal' },
    albums: [],
    footer: { text: '', contactLabel: '', contactUrl: '', poweredBy: true },
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
const IMAGE_ID = /^[a-z0-9]{8,40}\.(jpg|png|webp|gif|avif)$/;
const UUID = /^[0-9a-f-]{8,64}$/i;

const str = (v, max, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
const num = (v, min, max, fallback) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : fallback);
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
    // Allow bare emails and domains for convenience.
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value)) return `https://${value}`;
    return '';
  }
}

// Coerce any user-supplied draft into a valid one. Unknown keys are dropped.
export function sanitizeDraft(input = {}) {
  const d = defaultDraft();
  const t = input.theme || {};
  const h = input.hero || {};
  const l = input.layout || {};
  const g = input.gallery || {};
  const f = input.footer || {};
  const seen = new Set();
  return {
    title: str(input.title, 120, 'Untitled page').trim() || 'Untitled page',
    subtitle: str(input.subtitle, 240),
    intro: str(input.intro, 4000),
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
      style: pick(h.style, OPTIONS.heroStyle, d.hero.style),
      height: pick(h.height, OPTIONS.heroHeight, d.hero.height),
      align: pick(h.align, OPTIONS.align, d.hero.align),
      overlay: num(h.overlay, 0, 90, d.hero.overlay),
      logoShape: pick(h.logoShape, OPTIONS.logoShape, d.hero.logoShape),
    },
    layout: {
      albumStyle: pick(l.albumStyle, OPTIONS.albumStyle, d.layout.albumStyle),
      columns: num(l.columns, 2, 4, d.layout.columns),
      grouping: pick(l.grouping, OPTIONS.grouping, d.layout.grouping),
      sort: pick(l.sort, OPTIONS.sort, d.layout.sort),
      showCounts: flag(l.showCounts, true),
      showDates: flag(l.showDates, true),
      width: pick(l.width, OPTIONS.width, d.layout.width),
    },
    gallery: {
      style: pick(g.style, OPTIONS.galleryStyle, d.gallery.style),
      density: pick(g.density, OPTIONS.density, d.gallery.density),
    },
    albums: (Array.isArray(input.albums) ? input.albums : [])
      .filter((a) => a && typeof a.albumId === 'string' && UUID.test(a.albumId) && !seen.has(a.albumId) && seen.add(a.albumId))
      .slice(0, 200)
      .map((a) => ({
        albumId: a.albumId,
        title: str(a.title, 160),
        description: str(a.description, 2000),
        section: str(a.section, 80).trim(),
        coverAssetId: typeof a.coverAssetId === 'string' && UUID.test(a.coverAssetId) ? a.coverAssetId : null,
      })),
    footer: {
      text: str(f.text, 600),
      contactLabel: str(f.contactLabel, 60),
      contactUrl: safeUrl(f.contactUrl),
      poweredBy: flag(f.poweredBy, true),
    },
  };
}

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

export function fontStack(name) {
  const font = FONTS[name] || FONTS.Inter;
  if (font.system) return font.system;
  return `"${name}", ${font.category === 'serif' ? 'ui-serif, Georgia, serif' : 'ui-sans-serif, system-ui, sans-serif'}`;
}

export function googleFontsHref(names) {
  const families = [...new Set(names)]
    .filter((n) => FONTS[n] && !FONTS[n].system)
    .map((n) => `family=${n.replace(/ /g, '+')}:wght@${FONTS[n].weights}`);
  return families.length ? `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap` : null;
}
