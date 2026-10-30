// SaiPa's games from Liiga's public game feed (the same data liiga.fi uses).
// Seasons are named by the year they end in: autumn 2025 – spring 2026 is 2026.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const API = process.env.LIIGA_API || 'https://liiga.fi/api/v2';
const TOURNAMENTS = [
  ['runkosarja', 'Regular season'],
  ['playoffs', 'Playoffs'],
  ['valmistavat_ottelut', 'Preseason'],
];
const dir = path.join(config.dataDir, 'saipa');
const memory = new Map();
const inflight = new Map();

export const seasonOf = (wallClock) => {
  const [y, m] = wallClock.slice(0, 7).split('-').map(Number);
  return m >= 7 ? y + 1 : y;
};

function compact(g, season, tournament, label) {
  // gameStartDateTime is local Finnish time with its offset, e.g. 2025-09-09T18:30:00+03:00.
  const local = (g.homeTeam?.gameStartDateTime || '').slice(0, 16);
  // Goal events also include reviews that ended in no goal (VT0) and missed
  // penalty shots (RL0); keep real goals and their tags (YV power play, AV short-handed,
  // TM empty net, RL penalty shot, VL shootout winner).
  const scorers = [...(g.homeTeam?.goalEvents || []), ...(g.awayTeam?.goalEvents || [])]
    .filter((e) => e.scorerPlayer && !(e.goalTypes || []).some((t) => /0$/.test(t)))
    .sort((a, b) => a.gameTime - b.gameTime)
    .map((e) => ({
      time: e.gameTime,
      name: [e.scorerPlayer.firstName, e.scorerPlayer.lastName].filter(Boolean).join(' '),
      score: `${e.homeTeamScore}–${e.awayTeamScore}`,
      tags: (e.goalTypes || []).filter((t) => ['YV', 'YV2', 'AV', 'TM', 'RL', 'VL'].includes(t)),
    }));
  return {
    id: `${season}-${tournament}-${g.id}`,
    season,
    tournament,
    serie: label,
    start: g.start,
    local: local || null,
    home: { id: g.homeTeam?.teamId?.split(':').pop(), name: g.homeTeam?.teamName, goals: g.homeTeam?.goals ?? null },
    away: { id: g.awayTeam?.teamId?.split(':').pop(), name: g.awayTeam?.teamName, goals: g.awayTeam?.goals ?? null },
    started: Boolean(g.started),
    ended: Boolean(g.ended),
    finishedType: g.finishedType || null,
    arena: g.iceRink?.name || null,
    city: g.iceRink?.city || null,
    spectators: g.spectators ?? null,
    scorers,
  };
}

async function download(season, team) {
  const games = [];
  for (const [tournament, label] of TOURNAMENTS) {
    const res = await fetch(`${API}/games?tournament=${tournament}&season=${season}`, {
      headers: { accept: 'application/json', 'user-agent': 'Folio for Immich' },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404 || res.status === 403) continue;
    if (!res.ok) throw new Error(`Liiga responded ${res.status}`);
    const list = await res.json();
    for (const g of Array.isArray(list) ? list : []) {
      const ids = [g.homeTeam?.teamId, g.awayTeam?.teamId].map((t) => String(t || '').split(':').pop());
      if (ids.includes(team)) games.push(compact(g, season, tournament, label));
    }
  }
  return games.filter((g) => g.local).sort((a, b) => a.local.localeCompare(b.local));
}

// Games for one season, cached on disk. A finished season never changes; the
// current one is refreshed every few hours (and soon after a game should have ended).
export async function seasonGames(season, team = 'saipa') {
  const key = `${team}-${season}`;
  const file = path.join(dir, `games-${key}.json`);
  let cached = memory.get(key);
  if (!cached) {
    try {
      cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      memory.set(key, cached);
    } catch {}
  }
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;
  const finished = cached?.games.length && cached.games.every((g) => g.ended);
  // A game from the last two days that should be over but has no final result yet.
  const pendingResult = cached?.games.some((g) => {
    const t = Date.parse(g.start);
    return !g.ended && t < Date.now() - 2.5 * 3600e3 && t > Date.now() - 2 * 86400e3;
  });
  const fresh = finished ? true : age < (pendingResult ? 15 * 60e3 : 3 * 3600e3);
  if (cached && fresh) return cached.games;

  if (!inflight.has(key)) {
    inflight.set(
      key,
      download(season, team)
        .then((games) => {
          const value = { fetchedAt: Date.now(), games };
          memory.set(key, value);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(file, JSON.stringify(value));
          return games;
        })
        .finally(() => inflight.delete(key)),
    );
  }
  try {
    return await inflight.get(key);
  } catch (err) {
    if (cached) return cached.games; // offline: use what we have
    console.warn(`Could not load ${season} games from Liiga: ${err.message}`);
    return [];
  }
}
