// Rosters, player codes and caption templates. Shared by the browser (live
// preview) and the server (export and Immich sync), so both say the same thing.

export const DEFAULT_TEMPLATE = '{players} during the {league} game between {home} and {away} at {venue}, {city}, on {date}.';
export const TOKENS = ['players', 'names', 'home_players', 'away_players', 'home', 'away', 'league', 'venue', 'city', 'country', 'date', 'byline'];

// "23 Matti Virtanen", "#23 Matti Virtanen", "23. Matti Virtanen", "Matti Virtanen 23",
// "23<TAB>Matti Virtanen" or "23,Matti Virtanen" — one player per line.
export function parseRoster(text) {
  const players = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    let m = /^#?(\d{1,3})[.,;:)\-\s]+(.+)$/.exec(line);
    if (m) players.push({ num: String(Number(m[1])), name: m[2].replace(/^[,;\-\s]+/, '').trim() });
    else if ((m = /^(.+?)[,;\s]+#?(\d{1,3})$/.exec(line))) players.push({ num: String(Number(m[2])), name: m[1].trim() });
  }
  return players;
}

export const rosterText = (players = []) => players.map((p) => `${p.num} ${p.name}`).join('\n');

const lookup = (roster, num) => roster?.find((p) => p.num === String(Number(num)))?.name;

// "23 a12 h7" → home #23, away #12, home #7. Unknown numbers stay as "#23".
export function parsePlayers(code, game = {}, rosters = {}) {
  const out = [];
  // Player tagging switched off for this game: no names anywhere.
  if (game.tagPlayers === 'off') return out;
  for (const tok of String(code || '').split(/[\s,;+]+/)) {
    const m = /^([ha])?#?(\d{1,3})$/i.exec(tok);
    if (!m) continue;
    const side = m[1]?.toLowerCase() === 'a' ? 'away' : 'home';
    const team = game[side] || '';
    const name = lookup(rosters[team], m[2]);
    if (!out.some((p) => p.side === side && p.num === String(Number(m[2])))) out.push({ side, num: String(Number(m[2])), team, name: name || `#${Number(m[2])}`, known: Boolean(name) });
  }
  return out;
}

const AND = { en: 'and', fi: 'ja' };
export function joinList(items, lang = 'en') {
  if (items.length < 2) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} ${AND[lang] || AND.en} ${items.at(-1)}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// `t` is camera wall-clock time stored as if it were UTC.
export function formatDate(t, style = 'en-US') {
  if (t === undefined || t === null || !Number.isFinite(t)) return '';
  const d = new Date(t);
  const [y, mo, day] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
  if (style === 'fi') return `${day}.${mo + 1}.${y}`;
  if (style === 'en-GB') return `${day} ${MONTHS[mo]} ${y}`;
  if (style === 'iso') return isoDate(t);
  return `${MONTHS[mo]} ${day}, ${y}`;
}
export const isoDate = (t) => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '');

// Photo Mechanic style codes in free text: \23\ (home), \h23\, \a12\ (away).
export function expandCodes(text, game = {}, rosters = {}) {
  return String(text || '').replace(/\\([ha]?)(\d{1,3})\\/gi, (all, side, num) => {
    const team = side.toLowerCase() === 'a' ? game.away : game.home;
    return lookup(rosters[team], num) || all;
  });
}

const EMPTY = '\u0000';
const CONNECTOR = '(?:at|on|in|of|during|by|between|and|vs\\.?|ja|&|–|-)';

// Fill a template and tidy up around empty fields:
// "… between {home} and {away} at {venue}, {city}, on {date}." with no venue and
// no date becomes "… between HIFK and Tappara, Helsinki."
export function fillTemplate(template, fields) {
  let s = String(template || '').replace(/\{(\w+)\}/g, (all, key) => {
    if (!(key in fields)) return all;
    const v = String(fields[key] ?? '').trim();
    return v || EMPTY;
  });
  if (s.includes(EMPTY)) {
    const before = new RegExp(`(^|[\\s,(])${CONNECTOR}\\s*${EMPTY}`, 'gi');
    const after = new RegExp(`${EMPTY}\\s*(?:and|ja|&|vs\\.?)(?=\\s|$)`, 'gi');
    let prev;
    do {
      prev = s;
      s = s.replace(before, `$1${EMPTY}`).replace(after, EMPTY);
    } while (s !== prev);
    s = s.replace(new RegExp(`\\s*${EMPTY}+\\s*`, 'g'), ' ');
  }
  s = s
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.;:!?)])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/[,;:]\s*([.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.;:–-]+/, '')
    .replace(/[\s,;:–-]+$/, '')
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Everything a caption can use, for one frame.
export function fieldsFor(frame, game = {}, rosters = {}) {
  const players = parsePlayers(frame.players, game, rosters);
  const lang = game.dateStyle === 'fi' ? 'fi' : 'en';
  const withTeam = (p) => (p.team ? `${p.name} (${p.team})` : p.name);
  return {
    players: joinList(players.map(withTeam), lang),
    names: joinList(players.map((p) => p.name), lang),
    home_players: joinList(players.filter((p) => p.side === 'home').map((p) => p.name), lang),
    away_players: joinList(players.filter((p) => p.side === 'away').map((p) => p.name), lang),
    home: game.home,
    away: game.away,
    league: game.league,
    venue: game.venue,
    city: game.city,
    country: game.country,
    date: formatDate(frame.t, game.dateStyle),
    byline: game.byline,
  };
}

export function captionFor(frame, game = {}, rosters = {}) {
  const fields = fieldsFor(frame, game, rosters);
  if (frame.caption) return fillTemplate(expandCodes(frame.caption, game, rosters), fields);
  return fillTemplate(game.template || DEFAULT_TEMPLATE, fields);
}

export function headlineFor(game = {}) {
  return [game.home, game.away].filter(Boolean).join(' – ');
}

// Keywords: the game's own, then league, teams and the players in the photo.
export function keywordsFor(frame, game = {}, rosters = {}) {
  const players = parsePlayers(frame.players, game, rosters).filter((p) => p.known);
  const words = [...String(game.keywords || '').split(/[,;\n]/), game.league, game.home, game.away, ...players.map((p) => p.name)];
  const seen = new Set();
  return words
    .map((w) => String(w || '').trim())
    .filter((w) => w && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()));
}

// Name of the game, used for albums and export folders: "2026-10-29 HIFK vs Tappara".
export function gameTitle(game = {}, t) {
  const teams = [game.home, game.away].filter(Boolean).join(' vs ');
  return [isoDate(game.date ? Date.parse(game.date) : t), teams || 'Hockey'].filter(Boolean).join(' ');
}

// Safe ASCII for file names: "Kärpät" → "Karpat".
export function slug(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

export function fileName(pattern, frame, game = {}, seq = 1, camera = '') {
  const d = new Date(frame.t);
  const pad = (n, k = 2) => String(n).padStart(k, '0');
  const fields = {
    date: isoDate(frame.t),
    time: Number.isFinite(frame.t) ? `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}` : '',
    home: slug(game.home),
    away: slug(game.away),
    league: slug(game.league),
    seq: pad(seq, 3),
    name: slug(frame.name),
    camera: slug(camera),
  };
  const name = String(pattern || '{date}_{home}-{away}_{seq}')
    .replace(/\{(\w+)\}/g, (all, k) => (k in fields ? fields[k] : ''))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/([_-])[_-]+/g, '$1')
    .replace(/^[_\-.\s]+|[_\-.\s]+$/g, '');
  return name || `photo_${fields.seq}`;
}
