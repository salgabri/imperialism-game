// Today's football club layer by results (scripts/build-clubs.mjs, docs/design/domestic-campaigns.md "Today's field by
// results"): Europe's TOP_CLUBS strongest clubs by the newest season scripts/data/club-strength.json ranks, as the
// earlier seasons' fields are (scripts/lib/europe-field.mjs), each with its EA FC 27 XI, or, in a country whose first
// division EA does not rate whole, the XI of the FM 26 squad today's country map gives the club (public/domestic/<id>.json).
//
// FM 26's ratings stay as the country maps play them: over the clubs both rate, FM 26's XI means sit on EA FC 27's
// scale (EA = -1.02 + 1.022 x FM, r 0.96, 196 clubs, 23 November 2026), as the built-in nations take them.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { NATIONS } from '../../src/data/teams.js';
import { TOP_CLUBS } from '../../src/data/scopes.js';
import { firstDivisionOf } from '../../src/data/footballLeagues.js';
import { expandFmTuple } from '../../src/data/fmPlayers.js';
import { pickFootballSquad } from '../../src/data/footballSquad.js';
import { strengthField } from './europe-field.mjs';

/** The tag of today's Europe maps (eu124b2027), the built-in season's field by results: scripts/build-europe-maps.mjs. */
export const todayMapTag = year => `b${year}`;

/** EA rates a country's first division whole where it lists at least this many of its clubs (else a few, as Rest of World). */
export const WHOLE_LEAGUE = 8;

const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;

/**
 * Every club of today's country maps of Europe (UEFA's nations) with a full XI: `{ id, name, country, league, exact,
 * squad }`, its XI picked from its FM 26 squad as the game expands it (src/data/fmPlayers.js expandFmTuple), `tuples`
 * those players' roster tuples, exactly as a country map's campaign plays them.
 */
export function countryMapClubs(root) {
  const dir = path.join(root, 'public/domestic');
  const clubs = [];
  for (const file of readdirSync(dir).filter(name => /^[0-9A-Z]{3}\.json$/.test(name)).sort()) {
    const country = file.slice(0, -'.json'.length);
    if (NATIONS[country]?.[2] !== 'UEFA') continue;
    const map = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    for (const club of map.clubs ?? []) {
      if (!Array.isArray(club.squad)) continue;
      const pool = club.squad.map(tuple => {
        const expanded = expandFmTuple(tuple, map.source, club.name);
        const [name, pos, rating, sourceInfo] = expanded;
        return { name, pos, rating, positions: sourceInfo.positions, sourceInfo, tuple: expanded };
      });
      const squad = pickFootballSquad(pool);
      if (squad.length < 11) continue;
      clubs.push({ id: club.id, name: club.name, country, league: club.league ?? null, exact: mean(squad.map(p => p.rating)), squad });
    }
  }
  return clubs;
}

/**
 * Today's field: the `count` strongest clubs of `strengths` (the newest season's list, strongest first) that EA FC 27
 * (`ea`, scripts/lib/first-divisions.mjs firstDivisionClubs) or, in a country whose first division EA does not rate
 * whole (WHOLE_LEAGUE), today's country maps (`maps`, countryMapClubs) give an XI. A club of a country EA rates whole
 * that EA lists in no first division has left it since the results (relegated): it is passed over. Each kept club
 * comes back `{ ...club, rank, source: 'ea' | 'fm', ident }`; `passed` and `matches` as strengthField gives them,
 * `whole` the countries EA rates whole.
 */
export function todayField({ strengths, names = {}, ea, maps, count = TOP_CLUBS }) {
  const counts = new Map();
  for (const club of ea) counts.set(club.country, (counts.get(club.country) || 0) + 1);
  const whole = new Set([...counts].filter(([, n]) => n >= WHOLE_LEAGUE).map(([country]) => country));
  const fill = maps.filter(club => !whole.has(club.country));
  const { kept, passed, matches } = strengthField(strengths, [ea, fill], { names, count });
  return {
    clubs: kept.map(({ source, leagueShape, strength, ...club }) => ({ ...club, source: source === 0 ? 'ea' : 'fm' })),
    passed, matches, whole: [...whole].sort(),
  };
}

/**
 * The rows of clubs.football.js: today's field by results, strongest first (`rank`), then every club of a built-in
 * Europe map of before that the field no longer holds (`kept`: their ids), unranked, so that map still decodes for the
 * campaigns saved on it. Ids: EA's clubs `f-<name>` as before, a country map's club its map's id (d688-1955), so it
 * wears that club's crest and colours. `codes` keeps each club's code of the list before (Map id → code); `makeCode`,
 * `colourFor` and `squadTuples` are build-clubs' (scripts/lib/club-identity.mjs, first-divisions.mjs).
 */
export function clubRows({ field, ea, kept = [], codes = new Map(), makeCode, colourFor, squadTuples, year }) {
  const byId = new Map(ea.map(club => [club.id, club]));
  const used = new Set(codes.values());
  const row = (club, rank) => {
    const fm = club.source === 'fm';
    const id = club.id;
    let code = codes.get(id);
    if (!code) { code = makeCode(club.name, used); used.add(code); }
    return {
      id, name: club.name, code, league: fm ? firstDivisionOf(club.country, year) ?? club.league : club.league, country: club.country,
      col: colourFor(id), str: Math.round(club.exact), ...(rank != null ? { rank } : {}),
      squad: fm ? club.squad.map(player => player.tuple) : squadTuples(club.squad),
    };
  };
  const ranked = field.map((club, i) => row(club, i + 1));
  const inField = new Set(ranked.map(club => club.id));
  const before = kept.filter(id => !inField.has(id)).map(id => {
    const club = byId.get(id);
    if (!club) throw new Error(`${id}, a club of a built-in Europe map of before, is in no first division of EA's snapshot`);
    return row(club, null);
  });
  return [...ranked, ...before];
}
