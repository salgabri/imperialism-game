// The CM 01/02 Update Team's database of an EA season's season (scripts/data/cm0102-updates.json, its tables in
// <cmDir>/cm0102/<release>/Data/, scripts/sync-cm0102-updates.mjs): what an EA season's country maps fill the countries
// EA rates too few clubs of from (scripts/build-season-countries.mjs), and what its field of Europe's strongest clubs
// takes a club EA lacks from (scripts/lib/europe-field.mjs resultsField `fill`). Each table must have its pinned size and
// SHA-256. Shipped by the user's choice of 2026-11-17, credited to the Update Team.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { buildFootballSet } from '../../src/data/footballSetBuild.js';
import { firstDivisionOf } from '../../src/data/footballLeagues.js';
import { TOP_CLUBS } from '../../src/data/scopes.js';

const CLUB_SIZE = 11;

/** The release of `label` (as 2009/10) in the updates manifest, or null where the Update Team made none. */
export const updateTeamRelease = (updates, label) => updates.releases.find(entry => entry.season === label) ?? null;

/**
 * The database of `release`, read with every club (buildFootballSet's `allClubs`), its source credited to the Update
 * Team as the season's country maps credit it.
 */
export async function readUpdateTeam(updates, release, cmDir) {
  const files = {};
  for (const file of release.files) {
    const at = path.join(cmDir, 'cm0102', release.id, 'Data', file.name);
    if (!existsSync(at)) throw new Error(`${at} is missing: node scripts/sync-cm0102-updates.mjs fetches it (or --zip=<the release you downloaded>)`);
    const bytes = await readFile(at);
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`${at} is not the pinned ${release.id} table`);
    files[file.name] = new Uint8Array(bytes);
  }
  const result = buildFootballSet(files, { local: false, everyClub: true, topClubs: TOP_CLUBS,
    sourceExtra: { compiler: 'CM 01/02 Update Team', provenance: release.zip.item ?? 'the champman0102.co.uk forum, downloaded by the user',
      retrieved: release.retrieved ?? updates.retrieved } });
  if (result.doc.season !== release.season) throw new Error(`${release.id} is the database of ${result.doc.season}, not ${release.season}`);
  return result;
}

const xiMean = squad => squad.reduce((sum, player) => sum + player.rating, 0) / squad.length;

/**
 * Of `clubs` (`{ country, division, squad }`), those in their country's top division: the division most of the
 * country's eight strongest XIs play in (the strongest's, if two tie), so a namesake lower down (Zenit Penza, Zenit
 * Izhevsk) is never taken for a club the database lacks. A database that plays no league of a country files its clubs in
 * no division (null): where its strongest are so filed, those are its top division.
 */
export function topDivisionClubs(clubs) {
  const byCountry = new Map();
  for (const club of clubs) (byCountry.get(club.country) || byCountry.set(club.country, []).get(club.country)).push(club);
  const top = new Map();
  for (const [country, list] of byCountry) {
    const strongest = list.slice().sort((a, b) => xiMean(b.squad) - xiMean(a.squad)).slice(0, 8);
    const counts = new Map();
    for (const club of strongest) counts.set(club.division ?? null, (counts.get(club.division ?? null) || 0) + 1);
    const most = Math.max(...counts.values());
    top.set(country, strongest.find(club => counts.get(club.division ?? null) === most).division ?? null);
  }
  return clubs.filter(club => top.get(club.country) === (club.division ?? null));
}

/**
 * A field's fill from the database (`readUpdateTeam`'s result) for the season ending in `year`: `{ candidates, source }`,
 * every club of its country's top division (topDivisionClubs) in a European country with a first division the game
 * names that fields eleven players, as the season builders give theirs (`{ name, league, country, str, squad }`, each
 * player with its CM tuple).
 */
export function updateTeamFill(result, year) {
  const eligible = result.allClubs.filter(club => club.country && firstDivisionOf(club.country, year) && club.squad.length >= CLUB_SIZE)
    .map(club => ({ ...club, division: club.league }));
  const candidates = topDivisionClubs(eligible).map(club => ({ name: club.name, league: firstDivisionOf(club.country, year), country: club.country,
    str: Math.round(xiMean(club.squad)), squad: club.squad }));
  return { candidates, source: result.doc.source };
}
