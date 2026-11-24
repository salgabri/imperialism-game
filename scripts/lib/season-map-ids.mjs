// The club ids an earlier season's own country maps already give (public/domestic/<country>y<year>.json,
// scripts/build-season-countries.mjs): a season file keeps them for the same clubs (scripts/lib/europe-field.mjs `ids`),
// and the maps keep them across rebuilds, so a club's id never moves when the season's field of Europe's strongest
// changes, and a campaign saved on either still fits it.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { slug } from './club-identity.mjs';

const SEASON_MAP = /^(\d{3}|[A-Z]{3})y(\d{4})\.json$/;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The season maps of the season ending in `year` (a country has one at most); with `kind`, only those of that source. */
async function* seasonMaps(root, year, kind = null) {
  const dir = path.join(root, 'public/domestic');
  if (!existsSync(dir)) return;
  for (const file of await readdir(dir)) {
    const match = SEASON_MAP.exec(file);
    if (!match || Number(match[2]) !== year) continue;
    const doc = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    if (!kind || doc.kind === kind) yield doc;
  }
}

/**
 * Every season map's club ids of the season ending in `year`: Map('<country>:<club name>' → id); with `kind`, only the maps
 * of that source (an EA season's own maps are 'ea', those its Update Team database fills 'cm0102'), as a club of one
 * source may share its name with another's (EA's AEK Athens and the Update Team's). What the season builders read: of
 * two clubs of one name on one map it has the last one's id only (seasonMapIdLists has both).
 */
export async function seasonMapIds(root, year, { kind = null } = {}) {
  const ids = new Map();
  for await (const doc of seasonMaps(root, year, kind)) {
    for (const club of doc.clubs) ids.set(`${doc.country}:${club.name}`, club.id);
  }
  return ids;
}

/**
 * Every season map's club ids of the season ending in `year`, all those of a name: Map('<country>:<club name>' → its clubs'
 * ids, in the map's order, strongest first). A season's source may rate two clubs of one name in one country (the 2002/03
 * database two CSKA Kievs, in the Premier Division and below it), which the country's map then both holds.
 */
export async function seasonMapIdLists(root, year) {
  const lists = new Map();
  for await (const doc of seasonMaps(root, year)) {
    for (const club of doc.clubs) {
      const key = `${doc.country}:${club.name}`;
      (lists.get(key) || lists.set(key, []).get(key)).push(club.id);
    }
  }
  return lists;
}

/**
 * Gives every club of a season's country fields (`fields`, countryFields' Map(country → clubs, strongest first) in
 * scripts/lib/season-country-clubs.mjs) its id, `club.id`, and returns every id the season's clubs then have:
 * - a club the season file has (`file`, its clubs, the Europe maps') keeps its id there;
 * - every other one keeps the id its map already gives it (`committed`, seasonMapIdLists), so neither a rebuild nor a
 *   change to the season file's field moves a club's id. Of several clubs of one name on one map, the k-th strongest
 *   keeps the k-th id the map gives that name;
 * - a club new to its map takes `f-<slug of its name>`, with a number after it when another club of the season has that
 *   id already (as the season builders do), strongest first across the season (ties by country and name), so the
 *   strongest takes the plain id.
 * A fill (updateTeamFills in scripts/build-season-countries.mjs) numbers its ids after its EA season's own, `primary`
 * (this function's answer for them).
 */
export function giveClubIds(fields, { file, committed, primary = null }) {
  // A fill's players are another source's, so none of its clubs takes a season file club's id, but those the season
  // file takes from the fill itself (`fill`: Europe's strongest that EA lacks, scripts/lib/europe-field.mjs) keep theirs.
  // The season's own clubs take no id of the fill's.
  const own = file.filter(club => !!club.fill === !!primary);
  const known = new Map(own.map(club => [`${club.country}:${club.name}`, club.id]));
  const taken = new Set([...file.filter(club => !club.fill).map(club => club.id), ...(primary ? own.map(club => club.id) : []), ...(primary ?? [])]);
  const rest = [];
  for (const [country, clubs] of fields) {
    const byName = new Map();
    for (const club of clubs) (byName.get(club.name) || byName.set(club.name, []).get(club.name)).push(club);
    for (const [name, same] of byName) {
      const key = `${country}:${name}`, ids = committed.get(key) ?? [];
      // The season file's club of the name is the one whose id on the map is its id there, else the strongest.
      const at = known.has(key) ? Math.min(Math.max(ids.indexOf(known.get(key)), 0), same.length - 1) : -1;
      same.forEach((club, k) => {
        if (k === at) club.id = known.get(key);
        else if (ids[k] && !taken.has(ids[k])) { taken.add(ids[k]); club.id = ids[k]; } else rest.push(club);
      });
    }
  }
  rest.sort((a, b) => b.str - a.str || byText(a.country, b.country) || byText(a.name, b.name));
  for (const club of rest) {
    const base = `f-${slug(club.name)}`.slice(0, 60);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    club.id = id;
  }
  return [...taken];
}

/**
 * A map's clubs as `<id> <name>`, sorted, to compare two builds of it: the second and later clubs of a name carry their
 * place among them (`(2)`), strongest first as a map and a field list them, so two of one name swapping ids shows.
 */
export function clubIdLines(clubs) {
  const met = new Map();
  return clubs.map(club => {
    const place = (met.get(club.name) ?? 0) + 1;
    met.set(club.name, place);
    return `${club.id} ${club.name}${place > 1 ? ` (${place})` : ''}`;
  }).sort();
}
