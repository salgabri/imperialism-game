// RugbyPass's match centre (rugbypass.com, World Rugby's own site), as rugby union's sync reads it
// (scripts/sync-rugby-union.mjs, docs/design/rugby-union.md "The source"). Its robots.txt (read 2026-11-18) disallows
// none of the paths read here, and names ClaudeBot and anthropic-ai with `Allow: /`; its llms.txt asks that match
// results, fixtures and player statistics be attributed to RugbyPass.
//
// Three kinds of reply:
// - a competition's fixtures page (`/<competition>/fixtures-results/`), whose fixtures app lists the seasons it holds;
// - the same app's season filter, a POST of `action=filter-fixtures` to that page (as the page's own script sends it),
//   which answers every game of a season as JSON;
// - a game's match centre (`/live/<path>/?g=<id>`), a page whose app data holds the game, both team sheets (each player's
//   number, position, scores, cards and substitutions), the key events (every score, by whom and when), the teams'
//   summary and each player's stats.
// The parsers keep only what the game reads (`gameOf`), so the cache holds JSON, not pages.

/** RugbyPass's address. */
export const RUGBYPASS = 'https://www.rugbypass.com';

/** The JSON value (an array or an object) that starts at `text[i]`, read to its closing bracket, strings honoured. */
export function valueAt(text, i) {
  if (text[i] !== '[' && text[i] !== '{') throw new Error(`No JSON value at ${i}: ${JSON.stringify(text.slice(i, i + 20))}`);
  let depth = 0, inString = false, escaped = false;
  for (let k = i; k < text.length; k++) {
    const c = text[k];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(i, k + 1));
    }
  }
  throw new Error(`Unbalanced JSON value from ${i}`);
}

/** The value after the first `"key":` (or `key:`, unquoted, as a script writes it) at or after `from`, or undefined. */
export function valueAfter(text, key, { from = 0, quoted = true } = {}) {
  const marker = quoted ? `"${key}":` : `${key}:`;
  const at = text.indexOf(marker, from);
  if (at < 0) return undefined;
  let i = at + marker.length;
  while (text[i] === ' ') i++;
  return valueAt(text, i);
}

/**
 * A competition's seasons from its fixtures page: `[{ season, label, years, completed, games }]`, newest first, as the
 * fixtures app lists them (`seasons:[…]`).
 */
export function seasonsOf(html) {
  const seasons = valueAfter(html, 'seasons', { quoted: false });
  if (!Array.isArray(seasons)) throw new Error('The fixtures page lists no seasons');
  return seasons.map(({ season, label, years, completed, games }) => ({ season, label, years: Object.values(years ?? {}), completed, games }));
}

/**
 * A season filter's reply (`{ currentGameDays, currentFinalGameDays }`) → its games, in the order listed: `{ id, url,
 * epoch, round, competition, status, played, home: { id, name }, away: { id, name }, homeScore, awayScore, venue }`.
 */
export function fixturesOf(reply) {
  const games = [];
  // A list, or an object keyed by day (the finals' days often come so).
  const listed = value => (Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []);
  for (const days of [listed(reply.currentGameDays), listed(reply.currentFinalGameDays)]) {
    for (const day of days) {
      for (const tournament of listed(day.tournaments)) {
        for (const game of listed(tournament.games)) {
          games.push({
            id: Number(game.id), url: game.url, epoch: game.epoch, round: game.round ?? null, competition: game.tournamentUri,
            status: game.status, played: !!game.played, postponed: !!game.postponed, canceled: !!game.canceled,
            home: { id: game.homeTeam?.id, name: game.homeTeam?.name }, away: { id: game.awayTeam?.id, name: game.awayTeam?.name },
            homeScore: game.homeScore, awayScore: game.awayScore, venue: game.venue ?? null,
          });
        }
      }
    }
  }
  return games;
}

const minuteOf = event => event.minute + (event.second ?? 0) / 60;
const teamOf = team => ({ id: team.id, rpid: team.rpid ?? null, name: team.name });
const playerOf = player => ({
  id: player.id, name: player.fname, uri: player.uri, number: player.pos_id, position: player.pos,
  events: (player.events ?? []).map(event => [event.type, Math.round(minuteOf(event) * 100) / 100]),
  subs: (player.subEvents ?? []).map(event => [event.type, Math.round(minuteOf(event) * 100) / 100]),
});
// The key events kept: the scores, each with its side, its scorer and the minute.
const SCORING = new Set(['try', 'try-conversion', 'penalty-try', 'penalty-goal', 'drop-goal']);
const keyEventOf = event => ({
  type: event.type, side: event.side, player: event.playerId ?? null, time: event.time ?? null, score: event.score ?? null,
  ...(event.conversionPlayerId != null ? { conversion: event.conversionPlayerId, conversionTime: event.conversionTime ?? null } : {}),
});

/**
 * A match centre page → the game as the sync keeps it: `{ id, competition, competitionTitle, season, date, venue,
 * round, status, home, away, homeScore, awayScore, sheets: boolean, players: { home: […], away: […] }, scoring: […],
 * summary: { title: [home, away] }, stats: { stat: { uri: total } } }`. A player: `{ id, name, uri, number, position,
 * events: [[type, minute]], subs: [['sub-on' | 'sub-off', minute]] }`. Throws when the page holds no game.
 */
export function gameOf(html) {
  // The match centre app's `game`, which opens with its competition.
  const at = html.indexOf('game:{"comp"');
  if (at < 0) throw new Error('The page holds no game');
  const game = valueAt(html, at + 'game:'.length);
  if (!game?.id) throw new Error('The page holds no game');
  const home = valueAfter(html, 'homePlayers') ?? [];
  const away = valueAfter(html, 'awayPlayers') ?? [];
  const sheets = /"hasTeamSheets":\s*true/.test(html);
  const keyEvents = valueAfter(html, 'keyEvents');
  const teamStats = valueAfter(html, 'teamStats');
  const playerStats = valueAfter(html, 'playerStats');
  const summary = {};
  for (const row of [...(teamStats?.statsSummary ?? []), ...(teamStats?.setPlays ?? [])]) summary[row.title] = [row.home, row.away];
  const stats = {};
  for (const [key, list] of Object.entries(playerStats?.stats ?? {})) {
    if (!Array.isArray(list)) continue;
    stats[key] = Object.fromEntries(list.map(row => [String(row.link ?? '').replace(/^.*\/players\/|\/$/g, ''), row.total]));
  }
  return {
    id: Number(game.id), competition: game.compUri, competitionTitle: game.compTitle, season: Number(game.season),
    date: game.date, venue: game.venue ?? null, round: game.roundTitle ?? null, status: game.dateStatus ?? null,
    home: teamOf(game.homeTeam), away: teamOf(game.awayTeam), homeScore: game.homeTeam?.score ?? null, awayScore: game.awayTeam?.score ?? null,
    sheets, players: { home: home.map(playerOf), away: away.map(playerOf) },
    scoring: (keyEvents?.eventList ?? []).filter(event => SCORING.has(event.type)).map(keyEventOf),
    summary, stats,
  };
}
