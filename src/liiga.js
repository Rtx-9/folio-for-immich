// Liiga data for RinkSide: games by date (teams, arena, city), each game's
// lineups with jersey numbers and player photos, and full season rosters.
// Fetched by Folio (liiga.fi doesn't allow browsers to call it directly) and
// cached in FOLIO_DATA/rinkside/liiga.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './http.js';

const API = (process.env.LIIGA_URL || 'https://liiga.fi/api/v2').replace(/\/+$/, '');
// Player photos are only fetched from Liiga's own storage.
const PHOTO_PREFIXES = ['https://liiga-backend-prod.s3.eu-north-1.amazonaws.com/', ...(process.env.LIIGA_PHOTO_PREFIX ? [process.env.LIIGA_PHOTO_PREFIX] : [])];
const CACHE = path.join(config.dataDir, 'rinkside', 'liiga');
const TOURNAMENTS = ['valmistavat_ottelut', 'runkosarja', 'playoffs'];
const mem = new Map();

// Liiga seasons are named by the year they end in: autumn 2026 is season 2027.
export const seasonOf = (date) => {
  const [y, m] = date.split('-').map(Number);
  return m >= 7 ? y + 1 : y;
};

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new HttpError(502, `liiga.fi:hin ei saada yhteyttä (${err.cause?.code || err.name}). Voit silti kirjoittaa joukkueet ja kokoonpanot itse.`);
  }
  if (!res.ok) throw new HttpError(502, `liiga.fi vastasi ${res.status}`);
  return res.json();
}

// Cached JSON: memory first, then disk; `fresh` decides whether a cached copy is still good.
async function cached(key, ttlMs, load) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const file = path.join(CACHE, `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`);
  try {
    const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - disk.at < ttlMs) {
      mem.set(key, disk);
      return disk.data;
    }
  } catch {
    // not cached yet
  }
  try {
    const data = await load();
    const entry = { at: Date.now(), data };
    mem.set(key, entry);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entry));
    return data;
  } catch (err) {
    // Offline: an old copy is better than nothing.
    const stale = mem.get(key) || (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')));
    if (stale) return stale.data;
    throw err;
  }
}

const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

async function seasonGames(season) {
  return cached(`games-${season}`, 3 * 3600e3, async () => {
    const out = [];
    for (const t of TOURNAMENTS) {
      try {
        const list = await getJson(`${API}/games?tournament=${t}&season=${season}`);
        for (const g of Array.isArray(list) ? list : []) {
          out.push({
            id: g.id,
            season: g.season || season,
            start: g.homeTeam?.gameStartDateTime || g.start,
            home: g.homeTeam?.teamName || '',
            away: g.awayTeam?.teamName || '',
            homeLogo: g.homeTeam?.logos?.darkBg || null,
            awayLogo: g.awayTeam?.logos?.darkBg || null,
            arena: String(g.iceRink?.name || '').replace(/\s+(I|Oy)$/, ''),
            city: titleCase(g.iceRink?.city),
            serie: t,
            ended: Boolean(g.ended),
          });
        }
      } catch (err) {
        if (t === 'runkosarja') throw err;
      }
    }
    return out;
  });
}

// Games on a day (YYYY-MM-DD, local time of the game).
export async function gamesOn(date) {
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) throw new HttpError(400, 'Päivämäärän pitää olla muotoa VVVV-KK-PP');
  const games = await seasonGames(seasonOf(date));
  return games.filter((g) => String(g.start).slice(0, 10) === date).sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.home.localeCompare(b.home, 'fi'));
}

export async function teams(season) {
  const games = await seasonGames(season);
  const byName = new Map();
  for (const g of games) {
    if (g.home) byName.set(g.home, g.homeLogo);
    if (g.away) byName.set(g.away, g.awayLogo);
  }
  return [...byName].map(([name, logo]) => ({ name, logo })).sort((a, b) => a.name.localeCompare(b.name, 'fi'));
}

const player = (p) => ({
  num: String(p.jersey ?? ''),
  name: [p.firstName, p.lastName].filter(Boolean).join(' '),
  photo: p.pictureUrl || null,
  pos: p.roleCode || p.role || '',
});
const byNumber = (a, b) => Number(a.num) - Number(b.num) || a.name.localeCompare(b.name, 'fi');

// A game's lineups. Before a lineup is published, the season roster is used.
export async function lineup(season, id) {
  const games = await seasonGames(season);
  const g = games.find((x) => String(x.id) === String(id));
  if (!g) throw new HttpError(404, 'Ottelua ei löytynyt liiga.fi:stä');
  const detail = await cached(`game-${season}-${id}`, g.ended ? 30 * 86400e3 : 10 * 60e3, () => getJson(`${API}/games/${season}/${id}`));
  const side = async (list, team) => {
    const players = (list || []).filter((p) => !p.removed && p.jersey !== undefined && p.jersey !== null).map(player).sort(byNumber);
    return players.length ? { team, players, source: 'lineup' } : { team, players: await roster(season, team), source: 'season' };
  };
  return { game: g, home: await side(detail.homeTeamPlayers, g.home), away: await side(detail.awayTeamPlayers, g.away) };
}

export async function roster(season, team) {
  const all = await cached(`players-${season}`, 6 * 3600e3, async () => {
    const list = await getJson(`${API}/players/stats/summed/${season}/${season}/runkosarja/true?dataType=basicStats`);
    return (Array.isArray(list) ? list : []).map((p) => ({ team: p.teamName, ...player(p) }));
  });
  const seen = new Set();
  return all
    .filter((p) => p.team === team && p.num && !seen.has(p.num) && seen.add(p.num))
    .map(({ team: _t, ...p }) => p)
    .sort(byNumber);
}

// Player photos, cached on disk (they rarely change and are ~0.5 MB each).
export async function photo(url) {
  if (!PHOTO_PREFIXES.some((p) => String(url).startsWith(p))) throw new HttpError(400, 'Ei Liigan pelaajakuva');
  const file = path.join(CACHE, 'photos', crypto.createHash('sha1').update(url).digest('hex'));
  if (fs.existsSync(file)) return fs.readFileSync(file);
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  } catch {
    throw new HttpError(502, 'Kuva ei saatavilla');
  }
  if (!res.ok) throw new HttpError(404, 'Kuvaa ei löytynyt');
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf;
}
