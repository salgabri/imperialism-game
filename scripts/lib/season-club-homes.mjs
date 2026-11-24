// Where the clubs of the earlier seasons' country maps stand (docs/design/domestic-campaigns.md, "Earlier seasons"),
// in this order:
//   1. a hand override (scripts/data/season-club-locations.json, keyed "<country>:<club name>"): a point, a Wikidata
//      item, a built-in country map's club (`as`: "d826-602") whose home it shares, unless the override gives the ground
//      it had then as a point of its own, or `unplaced` where the steps below would place it wrongly and its town is not
//      known. A club that moved has its earlier seasons' ground in `eras`, the season years and the point of each;
//   2. the same club on today's map of its country (scripts/data/domestic/<country>.json): its name, short name or FM
//      name folds to the season's name, or its distinctive words are the same; its home has been checked there, with
//      the overrides of scripts/data/domestic-locations.json behind it;
//   3. the club on the Europe maps (scripts/data/europe-clubs.json) under the season's own id, for a European (UEFA)
//      nation only: New Zealand's Rangers and Venezuela's Valencia share an id with Glasgow's and Valencia CF;
//   4. Wikidata's association football clubs of the country and GeoNames' towns, as the built-in maps find theirs
//      (scripts/lib/domestic-locate.mjs).
// A club none of them places starts at a populous place no other club stands in, as on the built-in maps
// (scripts/lib/domestic-partition.mjs), and its home is marked as that estimate.
import { NATIONS } from '../../src/data/teams.js';
import { locateClubs, norm } from './domestic-locate.mjs';

// The words a club's name shares with every other (FC, United, Club, City...) are no evidence that two names are one club.
const COMMON = new Set(('fc afc cf sc cd ud sd rcd ca club clube de del la el los las le du des futbol football futebol fussball '
  + 'f c esporte e do da dos das di y and of the ec fk sv vfl vfb tsv ev ac as ss us ssd asd sad cp sl gd ad cs ks nk sk bk if ik '
  + 'jk sa ltd deportivo deportiva desportivo desportiva real sporting sport sports athletic atletico united city town county '
  + 'rovers wanderers albion').split(' '));
// Abbreviations EA writes in club names ("Sheffield Wed", "Charlton Ath", "Melb. Victory", "WS Wanderers", "New York RB"),
// and spellings two sources write differently (Wien, Vienna).
const SHORT = { utd: 'united', wed: 'wednesday', ath: 'athletic', melb: 'melbourne', well: 'wellington', ws: 'western sydney',
  aleman: 'alemannia', bor: 'borussia', mgladbach: 'monchengladbach', gladbach: 'monchengladbach', nott: 'nottingham',
  qpr: 'queens park rangers', wba: 'west bromwich albion', psg: 'paris saint germain', sj: 'san jose', rb: 'red bulls',
  st: 'saint', wien: 'vienna' };
// A word's stem: Swedish and Danish genitives (Djurgårdens IF, Halmstads BK) drop their -s.
const stem = word => (word.length >= 6 && word.endsWith('s') ? word.slice(0, -1) : word);
// A bracketed part stays a word here ("Estudiantes (RC)" is not "Estudiantes"), which norm alone would drop.
const tokens = name => norm(String(name || '').replace(/[()]/g, ' ')).split(' ').flatMap(word => (SHORT[word] ?? word).split(' '))
  .filter(Boolean).map(stem);
const words = name => tokens(name).filter(word => !COMMON.has(word) && !/^\d+$/.test(word));
// A name with its brackets: "Independiente" is not "Independiente (Chivilcoy)", which norm alone would make it.
const raw = name => String(name || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}()]+/gu, ' ').trim();

/** The game's region of a country for GeoNames and Wikidata: England and Scotland are parts of the United Kingdom. */
export const LOCATE_REGIONS = Object.freeze({
  826: { wikidata: '826', a2: 'GB', admin1: 'ENG' },
  SCO: { wikidata: '826', a2: 'GB', admin1: 'SCT' },
  WAL: { wikidata: '826', a2: 'GB', admin1: 'WLS' },
  NIR: { wikidata: '826', a2: 'GB', admin1: 'NIR' },
});

// A club's legal form and the like, which two spellings of one club may differ by.
const LEGAL = new Set('fc afc cf sc cd ud sd ac as ss us fk sk bk if ik sv club clube ca atletico the de calcio sad'.split(' '));

const within = (a, b) => a.length > 0 && a.every(word => b.includes(word));
const distinctive = list => list.some(word => word.length >= 4);

/**
 * How surely a season's club name names one of today's: 5 its name as written, 4 folded, 3 every word of the season's
 * name in today's ("New York City" in New York City FC), 2.5 every word of today's in the season's ("New York", the Red
 * Bulls' short name, in "New York City"), 2 the same distinctive words (those left when the words every club shares are
 * gone, FC, United, City...), 1 one's distinctive words among the other's; 0 none.
 */
function evidence(name, theirs) {
  let best = 0;
  const mineTokens = tokens(name), mineWords = words(name);
  for (const other of theirs) {
    if (raw(name) === raw(other)) return 5;
    if (norm(name) === norm(other) && raw(other).replace(/\([^)]*\)/g, '').trim() === raw(other)) { best = Math.max(best, 4); continue; }
    const otherTokens = tokens(other), otherWords = words(other);
    const both = distinctive(mineWords) && distinctive(otherWords);
    if (both && within(mineTokens, otherTokens)) best = Math.max(best, 3);
    else if (both && within(otherTokens, mineTokens)) best = Math.max(best, 2.5);
    else if (mineWords.length && mineWords.join(' ') === otherWords.join(' ') && distinctive(mineWords)) best = Math.max(best, 2);
    else if (distinctive(mineWords) && (within(mineWords, otherWords) || (within(otherWords, mineWords) && distinctive(otherWords)))) best = Math.max(best, 1);
  }
  return best;
}

/**
 * Today's clubs of one country (a built-in snapshot's `clubs`) by the names a season may give them (name, short and
 * FM's own): → (name) → the one club the name names most surely, or null when none does or two do equally. With
 * `exact`, only a name one of today's names equals (as written or folded) counts: a short name ("KaPa", "Apollon")
 * inside a longer one names the wrong club too often.
 */
export function snapshotMatcher(snapshotClubs = [], { exact = false } = {}) {
  const named = snapshotClubs.map(club => ({ club, names: [club.name, club.short, club.fmName, club.fmShort].filter(Boolean) }));
  return name => {
    let best = 0, hits = [];
    for (const { club, names } of named) {
      const score = evidence(name, names);
      if (exact && score < 4) continue;
      if (score > best) { best = score; hits = [club]; } else if (score && score === best) hits.push(club);
    }
    return hits.length === 1 ? hits[0] : null;
  };
}

/** The point a hand override gives (`lon`, `lat` and a `note` saying where it is and why), as a home, or null for none. */
const overridePoint = ({ lon, lat, note }) => (Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat, source: 'override', label: note || '' } : null);

/**
 * The seasons a hand override gives another ground (`eras`: `[{ from, through, lon, lat, note }]`, season years, the first
 * and last included), as a home's `{ eras: [{ from, through, lon, lat, source, label }] }`, or {} for none. Throws unless
 * each has its years and point and they follow one another in time.
 */
function overrideEras({ eras = [] }, label) {
  let last = -Infinity;
  const out = eras.map(era => {
    const point = overridePoint(era);
    if (!point || !Number.isInteger(era.from) || !Number.isInteger(era.through) || era.from > era.through || era.from <= last) {
      throw new Error(`${label}: each era of an override has its point and its years, from and through, after the era before it (${JSON.stringify(eras)})`);
    }
    last = era.through;
    return { from: era.from, through: era.through, ...point };
  });
  return out.length ? { eras: out } : {};
}

/**
 * A club's home in season year `year`, from its entry of scripts/data/season-club-homes.json: the ground of that season
 * where its `eras` name one, else its home; null for none.
 */
export function homeInSeason(home, year) {
  if (!home) return null;
  const { eras = [], ...rest } = home;
  const era = eras.find(({ from, through }) => from <= year && year <= through);
  return era ? { ...rest, lon: era.lon, lat: era.lat, source: era.source, label: era.label } : rest;
}

/**
 * Homes for one country's season clubs. `clubs` are `[{ name, short? }]`, one per name, strongest first; `snapshot` the
 * country's built-in snapshot or null; `europe` the Europe maps' clubs by id with `idOf(name)` the season's id for a
 * name; `overrides` the hand overrides of this country by name; `locate` scripts/lib/domestic-locate.mjs's tools
 * (`{ wikidata, geoFiles }`) and `nation` `{ id, name }`. Returns Map(name → { lon, lat, source, label?, twin?, eras? }):
 * `source` "override", "map:<built-in club id>", "europe:<season id>", "wikidata:Q…" or "geonames:<id>"; `twin` the
 * built-in country map's club it is; `eras` the seasons an override gives another ground (homeInSeason).
 */
export async function locateSeasonClubs({ nation, clubs, snapshot, europe = {}, idOf = () => null, overrides = {}, locate }) {
  const out = new Map();
  const twinOf = snapshotMatcher(snapshot?.clubs), exactTwinOf = snapshotMatcher(snapshot?.clubs, { exact: true });
  const byFm = new Map((snapshot?.clubs || []).map(club => [`d${nation.id}-${club.fm}`, club]));
  const rest = [];
  for (const club of clubs) {
    const override = overrides[club.name];
    if (override?.unplaced) continue;
    const point = override ? overridePoint(override) : null;
    if (override?.as) {
      const twin = byFm.get(override.as);
      if (!twin?.location) throw new Error(`${nation.name}: the override of ${club.name} names ${override.as}, no located club of today's map`);
      out.set(club.name, { ...(point ?? { lon: twin.location.lon, lat: twin.location.lat, source: `map:${override.as}`, label: twin.name }),
        twin: override.as, ...overrideEras(override, `${nation.name}: ${club.name}`) });
      continue;
    }
    if (point) {
      out.set(club.name, { ...point, ...overrideEras(override, `${nation.name}: ${club.name}`) });
      continue;
    }
    if (override?.eras) throw new Error(`${nation.name}: the override of ${club.name} has eras but no home of its own (as, or lon and lat)`);
    if (override?.qid) { rest.push(club); continue; }
    // Its full name first, then a short name its source gives it ("HJK", "Ferencváros"), where one of today's names is it.
    const twin = twinOf(club.name) ?? (club.short ? exactTwinOf(club.short) : null);
    if (twin?.location) {
      const id = `d${nation.id}-${twin.fm}`;
      out.set(club.name, { lon: twin.location.lon, lat: twin.location.lat, source: `map:${id}`, label: twin.name, twin: id });
      continue;
    }
    const seasonId = idOf(club.name), home = seasonId && NATIONS[nation.id]?.[2] === 'UEFA' ? europe[seasonId] : null;
    if (home?.home) {
      out.set(club.name, { lon: home.home[0], lat: home.home[1], source: `europe:${seasonId}`, label: home.city,
        ...(/^d[0-9A-Z]+-\d+$/.test(home.source) ? { twin: home.source } : {}) });
      continue;
    }
    rest.push(club);
  }
  // One club written two ways in two seasons ("St. Johnstone", "St Johnstone FC", "Sarmiento", "Club Atlético Sarmiento")
  // is located once, by its fullest spelling: Wikidata gives each item to one name only, so a second spelling would take
  // a namesake (Johnstone, not Perth). Only legal forms are left out here: "Dundee" is not "Dundee United".
  const spellings = new Map();
  for (const club of rest) {
    const k = tokens(club.name).filter(word => !LEGAL.has(word)).join(' ');
    const group = k && distinctive(k.split(' ')) ? k : `\u0000${club.name}`;
    (spellings.get(group) || spellings.set(group, []).get(group)).push(club);
  }
  const fullest = list => list.reduce((best, club) => (tokens(club.name).length > tokens(best.name).length ? club : best));
  const firsts = [...spellings.values()].map(fullest);
  const sameAs = new Map([...spellings.values()].flatMap(list => list.filter(club => club !== fullest(list)).map(club => [club.name, fullest(list).name])));
  rest.length = 0;
  rest.push(...firsts);
  if (rest.length && locate) {
    const region = LOCATE_REGIONS[nation.id];
    const qidOverrides = Object.fromEntries(rest.filter(club => overrides[club.name]?.qid).map(club => [club.name, { qid: overrides[club.name].qid }]));
    const located = await locateClubs({
      nation: { id: region?.wikidata ?? nation.id, name: nation.name, fmName: nation.name },
      clubs: rest.map(club => ({ clubId: club.name, name: club.name, shortName: club.name })),
      overrides: qidOverrides, wikidata: locate.wikidata, geoFiles: locate.geoFiles,
      region: region ? { a2: region.a2, admin1: region.admin1 } : undefined,
    });
    for (const club of rest) {
      const found = located.locations.get(club.name);
      if (found) out.set(club.name, { lon: found.lon, lat: found.lat, source: found.source, label: found.label });
    }
  }
  for (const [name, first] of sameAs) if (out.has(first)) out.set(name, out.get(first));
  return out;
}
