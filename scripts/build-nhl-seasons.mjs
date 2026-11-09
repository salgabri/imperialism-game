// Build ice hockey's built-in earlier seasons (docs/design/hockey.md, "Earlier seasons", "NHL 08 and NHL 09",
// "Computed seasons").
//
//   node scripts/build-nhl-seasons.mjs           writes public/hockey/nhl-<year>.json, public/hockey/ATTRIBUTION.txt,
//                                                src/data/hockeySeasons.js and docs/design/hockey-seasons-audit.json
//   node scripts/build-nhl-seasons.mjs --check   builds every file and compares it byte for byte, writes nothing
//
// Each season is built from its committed snapshot (scripts/data/nhl-seasons/<id>.json, node
// scripts/sync-nhl-seasons.mjs): an EA edition's ratings, an edition's attributes converted onto NHL 07's overalls
// (`method` 'converted'), or the players' statistics, rated by the computed rule (`method` 'computed',
// scripts/lib/nhl-computed.mjs). Its NHL clubs are named by the NHL's codes of that season (scripts/data/nhl-seasons.json
// `teams`, else `eras`), its nations by birth country or nationality. The lineups, depth and nations follow the built-in
// season's rules (scripts/lib/nhl.mjs), except that nothing is estimated: a player the source does not have is not
// there, and a club short of a lineup fields what it has. Each season names the era map its clubs play on, which
// node scripts/build-club-maps.mjs --league=nhl builds from the same manifest; the computed rule's calibration against
// the full editions (scripts/data/nhl-seasons/calibration.json) goes into the audit.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HOME_NATIONS, fieldsRealSide, selectLineup } from '../src/data/teams.js';
import { CLUBS } from '../src/data/clubs.hockey.js';
import { contentHash, serializeFootballSet } from '../src/data/footballSetBuild.js';
import { setHasNations } from '../src/engine/footballSets.js';
import { hockey } from '../src/sports/hockey.js';
import { colourFor } from './lib/club-identity.mjs';
import { nationsOf, nationStrength } from './lib/nhl.mjs';
import { clubSquadOf, mapOf, nationOf, quantileRescale, ratingsOf, teamsOf } from './lib/nhl-seasons.mjs';
import {
  RULE, attributeMean, calibrationOf, groupOf, groupRatings, ratingsOfHistogram, scoreOf, stepRating, windowOf,
} from './lib/nhl-computed.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public/hockey');
const listingFile = path.join(root, 'src/data/hockeySeasons.js');
const auditFile = path.join(root, 'docs/design/hockey-seasons-audit.json');

const seasonLabel = year => `${year - 1}/${String(year % 100).padStart(2, '0')}`;
const tupleOf = p => [p.name, p.pos, p.rating];
const POSITIONS = ['C', 'LW', 'RW', 'D', 'G'];
// A squad as the files list it: by position, then rating; within a rating, the game's own order, then the name.
const byPlace = (a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || b.rating - a.rating || b.game - a.game || a.name.localeCompare(b.name);

/** Season `entry` of the manifest: its data set document and its audit row. */
function buildSeason(entry, snapshot, manifest) {
  const { id, year } = entry;
  if (snapshot.source.id !== id) throw new Error(`scripts/data/nhl-seasons/${id}.json is ${snapshot.source.id}'s snapshot`);
  const players = snapshot.players.map(([name, team, pos, rating, born, nhlId]) => {
    if (!Number.isInteger(rating) || rating < 1 || rating > 99) throw new Error(`${id}: ${name} has the rating ${rating}`);
    return { name, team, pos, rating, game: rating, nation: nationOf(born), nhlId };
  });
  // A classic season's overalls, rescaled onto NHL 27's (the player's choice, scripts/data/nhl-seasons.json `rescale`):
  // its squads are picked by the game's own overalls, then every rating is rescaled and the strengths taken from those.
  const scale = entry.rescale ? quantileRescale(players.map(p => p.game), ratingsOf(manifest.rescale.histogram)) : null;
  const rated = list => (scale ? list.map(p => ({ ...p, rating: scale.get(p.game) })) : list);
  // A club that kept today's id keeps its colour; one of another era takes its own.
  const colours = new Map(CLUBS.map(club => [club.id, club.col]));
  const clubs = teamsOf(manifest, year).map(team => {
    const pool = players.filter(player => player.team === team.code);
    if (pool.length < 12) throw new Error(`${id}: ${team.name} has ${pool.length} players`);
    const { squad, lineup } = clubSquadOf(pool);
    // Places its own forwards, defenders and goalies cannot fill: the lineup picker moves another player there.
    const count = test => pool.filter(test).length;
    const short = [[12, 'forward', p => ['C', 'LW', 'RW'].includes(p.pos)], [6, 'defender', p => p.pos === 'D'], [1, 'goalie', p => p.pos === 'G']]
      .map(([needed, noun, test]) => [needed - count(test), noun]).filter(([missing]) => missing > 0).map(([missing, noun]) => `${missing} ${noun}${missing > 1 ? 's' : ''}`);
    const listed = rated(squad);
    return { id: team.id, name: team.name, code: team.code, country: team.country, col: colours.get(team.id) ?? colourFor(team.id),
      str: scale ? selectLineup({ sport: 'hockey', squad: listed }).rating : lineup.rating, squad: listed, short, players: pool.length };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
  const nations = scale
    ? nationsOf(players).map(n => { const squad = rated(n.squad).sort(byPlace); return { ...n, ...nationStrength(squad), squad }; })
      .sort((a, b) => b.str - a.str || a.name.localeCompare(b.name))
    : nationsOf(players);
  const doc = {
    format: 1, kind: 'nhl', id, version: '', year, season: seasonLabel(year), label: entry.label, local: false,
    source: { provider: entry.provider, edition: entry.edition, compiler: entry.compiler, url: entry.url, retrieved: entry.retrieved,
      rawScale: entry.rawScale, overall: entry.overall, ...(scale ? { conversion: conversionOf(entry, manifest, players.length) } : {}),
      nation: entry.nation ?? "the NHL's birth country" },
    map: mapOf(manifest, year),
    nations: Object.fromEntries(nations.map(n => [n.id, [n.str, n.squad.length, n.squad.map(tupleOf)]])),
    clubs: clubs.map(c => ({ id: c.id, name: c.name, code: c.code, league: 'NHL', country: c.country, col: c.col, str: c.str,
      squad: c.squad.slice().sort(byPlace).map(tupleOf) })),
    // Great Britain plays as one, as in the built-in season: the home nations start in the United Kingdom's empire.
    territory: { merged: Object.fromEntries(HOME_NATIONS.map(home => [home, '826'])), inactive: [] },
    coverage: { players: players.length, clubs: clubs.length, nations: nations.length, left: snapshot.left.length },
  };
  doc.version = `${id}-${contentHash(doc)}`;
  const ratings = players.map(p => p.game).sort((a, b) => a - b);
  const range = list => ({ lowest: list[0], median: list[list.length >> 1], highest: list.at(-1) });
  const audit = {
    id, version: doc.version, season: doc.season, edition: entry.edition, label: entry.label, map: doc.map, players: players.length,
    ratings: range(ratings),
    // The games' own overalls stay here: each one and the rating it became.
    ...(scale ? { rescaled: { ratings: range(ratings.map(v => scale.get(v))), reference: manifest.rescale.reference,
      mapping: Object.fromEntries([...scale].sort((a, b) => a[0] - b[0])) } } : {}),
    clubs: clubs.map(c => `${c.name} ${c.str} (${c.players} players${c.short.length ? `; short of ${c.short.join(', ')}` : ''})`),
    nations: nations.map(n => `${n.name} ${n.str} (${n.squad.length}${n.open.length ? `; the game fills ${n.open.join(' ')}` : ''})`),
    noNation: players.filter(p => p.nation === null).map(p => `${p.name} (${p.team})`),
    left: snapshot.left.map(row => row.join(' | ')),
    notes: snapshot.notes,
  };
  return { doc, text: serializeFootballSet(doc), audit };
}

// ---------- the computed and converted seasons ----------

const histogramText = histogram => Object.entries(histogram).map(([r, n]) => `${r}×${n}`).join(' ');

/** A computed season's rule, its constants and its form, as its source states it (source.conversion). */
function computedConversion(entry, snapshot, manifest, counts) {
  const { form } = snapshot;
  const [year, before, beforeThat] = windowOf(entry.year);
  const skater = form.skaters === 'minutes'
    ? `a forward's value is minutes a game + ${RULE.pointWeight.F} × points a game, a defender's minutes a game + ${RULE.pointWeight.D} × points a game`
    : `a forward's value is ${RULE.pointWeight.F} × points a game, a defender's ${RULE.pointWeight.D} × points a game (the source keeps no time on ice)`;
  const goalie = form.goalies === 'saves'
    ? `a goalie's is 1000 × (his save percentage − the league's), his line starting from ${RULE.goalie.shots} shots at ${RULE.goalie.below} under the league's`
    : `a goalie's is 1000 × (the league's goals against per 60 minutes − his) / ${RULE.goals.shotsPer60} (no shots against were kept), his line starting from ${RULE.goals.minutes} minutes at ${RULE.goals.above} goals a game over the league's`;
  return `computed from each player's regular seasons ${year - 1}/${String(year % 100).padStart(2, '0')}, `
    + `${before - 1}/${String(before % 100).padStart(2, '0')} and ${beforeThat - 1}/${String(beforeThat % 100).padStart(2, '0')} (weighted ${RULE.weights.join(':')}, over the seasons he played): `
    + `${skater}, every line starting from a replacement player's ${RULE.prior.games} games at ${RULE.prior.points} points${form.skaters === 'minutes' ? ` and ${RULE.prior.minutes} minutes` : ''} a game; `
    + `${goalie}, plus ${RULE.goalie.workload} × his share of the season's games (at most 1). A player plays for the club he played most games for (a tie: the later one). `
    + `Each club's squad is picked by provisional ratings (each score's mid-rank in its group over the season's ${counts.players} players); then every squad player's rating is his score's mid-rank in his group `
    + `over the season's ${counts.squad} squad players, read off NHL 27's squads in that group (scripts/data/nhl-seasons.json computed.histograms: forwards ${counts.reference.F}, defenders ${counts.reference.D}, goalies ${counts.reference.G}); `
    + 'ties stay ties and nobody passes anybody in a group. A player outside the squads takes the rating of the highest squad score in his group not above his. '
    + `Every player's lines are in scripts/data/nhl-seasons/${entry.id}.json.`;
}

/** The computed season `entry` of the manifest: its data set document and its audit row. */
function buildComputed(entry, snapshot, manifest) {
  const { id, year } = entry;
  if (snapshot.source.id !== id || snapshot.source.method !== 'computed') throw new Error(`scripts/data/nhl-seasons/${id}.json is not ${id}'s computed snapshot`);
  const src = manifest.computed.sources[entry.source.kind];
  const histograms = manifest.computed.histograms;
  const players = snapshot.players.map(([key, name, team, pos, born, lines]) => ({ key, name, team, pos, born, lines, nation: nationOf(born),
    score: scoreOf({ pos, lines }, year, snapshot.leagues, snapshot.form) }));
  if (players.some(p => p.score === null)) throw new Error(`${id}: a player without a line of the season`);
  // Provisional ratings over every player of the season pick each club's squad (the game's own lineup picker); the final
  // ratings rank the squads' players only, so every club's depth reads off NHL 27's squads as theirs do.
  const provisional = groupRatings(players, 'score', histograms);
  for (const p of players) p.rating = provisional.get(p);
  const colours = new Map(CLUBS.map(club => [club.id, club.col]));
  const picked = teamsOf(manifest, year).map(team => {
    const pool = players.filter(player => player.team === team.code);
    if (pool.length < 12) throw new Error(`${id}: ${team.name} has ${pool.length} players`);
    return { team, pool, squad: clubSquadOf(pool).squad };
  });
  const squadPlayers = picked.flatMap(c => c.squad);
  const final = groupRatings(squadPlayers, 'score', histograms);
  const finalOf = new Map(squadPlayers.map(p => [p, final.get(p)]));
  const rated = squadPlayers.map(p => ({ pos: p.pos, score: p.score, rating: finalOf.get(p) }));
  const all = players.map(p => ({ ...p, provisional: p.rating, rating: finalOf.get(p) ?? stepRating(p, rated) }));
  const ratingOf = new Map(players.map((p, i) => [p, all[i]]));
  const clubs = picked.map(({ team, pool, squad }) => {
    const listed = squad.map(p => ratingOf.get(p));
    const lineup = selectLineup({ sport: 'hockey', squad: listed });
    return { id: team.id, name: team.name, code: team.code, country: team.country, col: colours.get(team.id) ?? colourFor(team.id),
      str: lineup.rating, squad: listed, players: pool.length, open: lineup.slots.filter(slot => !slot.player || slot.penalty > 4).map(slot => slot.position) };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
  const nations = nationsOf(all);
  const realSides = realSidesOf(nations);
  const hasNations = setHasNations(id);
  const counts = { players: players.length, squad: squadPlayers.length,
    reference: Object.fromEntries(['F', 'D', 'G'].map(g => [g, ratingsOfHistogram(histograms[g]).length])) };
  const doc = {
    format: 1, kind: 'nhl', id, version: '', year, season: seasonLabel(year), label: entry.label, local: false,
    source: { provider: src.provider, edition: src.edition, compiler: src.compiler, url: src.url, retrieved: entry.retrieved, method: 'computed',
      rawScale: 'value', conversion: computedConversion(entry, snapshot, manifest, counts), licence: src.licence, attribution: src.attribution, nation: src.nation },
    map: mapOf(manifest, year),
    // Before 1977/78 fewer than three nations field a real side: clubs only (src/engine/footballSets.js clubsOnly).
    nations: hasNations ? Object.fromEntries(nations.map(n => [n.id, [n.str, n.squad.length, n.squad.map(tupleOf)]])) : {},
    clubs: clubs.map(c => ({ id: c.id, name: c.name, code: c.code, league: 'NHL', country: c.country, col: c.col, str: c.str,
      squad: c.squad.slice().sort(byPlace).map(tupleOf) })),
    territory: { merged: Object.fromEntries(HOME_NATIONS.map(home => [home, '826'])), inactive: [] },
    coverage: { players: players.length, clubs: clubs.length, nations: hasNations ? nations.length : 0, left: snapshot.left.length },
  };
  doc.version = `${id}-${contentHash(doc)}`;
  const range = list => { const s = list.slice().sort((a, b) => a - b); return { lowest: s[0], median: s[s.length >> 1], highest: s.at(-1) }; };
  const top = group => all.filter(p => groupOf(p.pos) === group)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 3).map(p => `${p.name} (${p.team}) ${p.rating}`);
  const audit = {
    id, version: doc.version, season: doc.season, label: entry.label, method: 'computed', source: entry.source.kind, map: doc.map, form: snapshot.form,
    players: players.length, squads: squadPlayers.length, ratings: range(clubs.flatMap(c => c.squad.map(p => p.rating))),
    best: { forwards: top('F'), defenders: top('D'), goalies: top('G') },
    clubs: clubs.map(c => `${c.name} ${c.str} (${c.players} players${c.open.length ? `; the game fills ${c.open.join(' ')}` : ''})`),
    nations: hasNations ? nations.map(n => `${n.name} ${n.str} (${n.squad.length}${n.open.length ? `; the game fills ${n.open.join(' ')}` : ''})`) : 'clubs only',
    realSides,
    noNation: players.filter(p => p.nation === null).map(p => `${p.name} (${p.team})`),
    left: snapshot.left.map(row => row.join(' | ')),
    notes: snapshot.notes,
  };
  return { doc, text: serializeFootballSet(doc), audit, realSides, hasNations };
}

/** The nations that would field a real side (src/data/teams.js fieldsRealSide), strongest first. */
function realSidesOf(nations) {
  const rosters = Object.fromEntries(nations.map(n => [n.id, [n.str, n.squad.length, n.squad.map(tupleOf)]]));
  const sport = { ...hockey, rosters, territory: { merged: {}, inactive: [] } };
  return nations.filter(n => fieldsRealSide(n.id, sport)).map(n => n.name);
}

/** The converted season `entry` (NHL 08, NHL 09): its data set document and its audit row. */
function buildConverted(entry, snapshot, manifest) {
  const { id, year } = entry;
  if (snapshot.source.id !== id || snapshot.source.method !== 'converted') throw new Error(`scripts/data/nhl-seasons/${id}.json is not ${id}'s converted snapshot`);
  const histograms = manifest.converted.histograms;
  const players = snapshot.players.map(([name, team, pos, born, values]) => {
    const score = attributeMean(values);
    if (score === null) throw new Error(`${id}: ${name} has an attribute outside 0-99`);
    return { name, team, pos, born, nation: nationOf(born), score };
  });
  const ratings = groupRatings(players, 'score', histograms);
  for (const p of players) p.rating = ratings.get(p);
  const colours = new Map(CLUBS.map(club => [club.id, club.col]));
  const clubs = teamsOf(manifest, year).map(team => {
    const pool = players.filter(player => player.team === team.code);
    if (pool.length < 12) throw new Error(`${id}: ${team.name} has ${pool.length} players`);
    const { squad, lineup } = clubSquadOf(pool);
    return { id: team.id, name: team.name, code: team.code, country: team.country, col: colours.get(team.id) ?? colourFor(team.id),
      str: lineup.rating, squad, players: pool.length, open: lineup.slots.filter(slot => !slot.player || slot.penalty > 4).map(slot => slot.position) };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
  const nations = nationsOf(players);
  const counts = Object.fromEntries(['F', 'D', 'G'].map(g => [g, players.filter(p => groupOf(p.pos) === g).length]));
  const reference = Object.fromEntries(['F', 'D', 'G'].map(g => [g, ratingsOfHistogram(histograms[g]).length]));
  const attributes = snapshot.attributes;
  const conversion = `the plain mean of each player's skill attributes on IGN's pages (skaters: ${attributes.skater.join(', ')}; goalies: ${attributes.goalie.join(', ')}; `
    + 'a player with a value outside 0-99, EA\'s unset 255, is left out), ranked within his group over the edition\'s '
    + `${counts.F} forwards, ${counts.D} defenders and ${counts.G} goalies on club pages, each mean taking the rating at its mid-rank among them in NHL 07's EA overalls of that group `
    + `(scripts/data/nhl-seasons.json converted.histograms: ${reference.F} forwards, ${reference.D} defenders, ${reference.G} goalies); ties stay ties and nobody passes anybody in a group. `
    + `Every player's attributes are in scripts/data/nhl-seasons/${id}.json.`;
  const doc = {
    format: 1, kind: 'nhl', id, version: '', year, season: seasonLabel(year), label: entry.label, local: false,
    source: { provider: entry.provider, edition: entry.edition, compiler: entry.compiler, url: entry.url, retrieved: entry.retrieved, method: 'converted',
      rawScale: entry.rawScale, overall: entry.overall, conversion, nation: entry.nation },
    map: mapOf(manifest, year),
    nations: Object.fromEntries(nations.map(n => [n.id, [n.str, n.squad.length, n.squad.map(tupleOf)]])),
    clubs: clubs.map(c => ({ id: c.id, name: c.name, code: c.code, league: 'NHL', country: c.country, col: c.col, str: c.str,
      squad: c.squad.slice().sort(byPlace).map(tupleOf) })),
    territory: { merged: Object.fromEntries(HOME_NATIONS.map(home => [home, '826'])), inactive: [] },
    coverage: { players: players.length, clubs: clubs.length, nations: nations.length, left: snapshot.left.length },
  };
  doc.version = `${id}-${contentHash(doc)}`;
  const range = list => { const s = list.slice().sort((a, b) => a - b); return { lowest: s[0], median: s[s.length >> 1], highest: s.at(-1) }; };
  const audit = {
    id, version: doc.version, season: doc.season, edition: entry.edition, label: entry.label, method: 'converted', map: doc.map, players: players.length,
    ratings: range(players.map(p => p.rating)),
    best: Object.fromEntries([['forwards', 'F'], ['defenders', 'D'], ['goalies', 'G']].map(([word, g]) => [word, players.filter(p => groupOf(p.pos) === g)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 3).map(p => `${p.name} (${p.team}) ${p.rating}`)])),
    clubs: clubs.map(c => `${c.name} ${c.str} (${c.players} players${c.open.length ? `; the game fills ${c.open.join(' ')}` : ''})`),
    nations: nations.map(n => `${n.name} ${n.str} (${n.squad.length}${n.open.length ? `; the game fills ${n.open.join(' ')}` : ''})`),
    realSides: realSidesOf(nations),
    noNation: players.filter(p => p.nation === null).map(p => `${p.name} (${p.team})`),
    left: snapshot.left.map(row => row.join(' | ')),
    notes: snapshot.notes,
  };
  return { doc, text: serializeFootballSet(doc), audit };
}

/** The computed rule against the full editions (scripts/data/nhl-seasons/calibration.json), as the audit records it. */
function calibrationAudit(manifest, fixture) {
  return fixture.editions.map(e => {
    const forms = [e.form, ...(e.kind === 'hdb' ? [{ ...e.form, goalies: 'goals' }] : [{ ...e.form, skaters: 'points' }])];
    return { id: e.id, source: e.kind, unmatched: e.unmatched.length, forms: forms.map(form => {
      const players = e.players.map(([name, team, pos, overall, lines]) => ({ name, team, pos, overall,
        score: lines.length ? scoreOf({ pos, lines }, e.year, e.leagues, form) : null }));
      return { form, ...calibrationOf(players, manifest.computed.histograms) };
    }) };
  });
}

/** The whole rule from the edition's numbers to a rescaled season's ratings, as its source states it. */
function conversionOf(entry, manifest, count) {
  const rescale = `rescaled onto NHL 27's ratings rank for rank: each overall takes the rating at its mid-rank among the season's ${count} rated players `
    + `in ${manifest.rescale.reference}; ties stay ties and nobody passes anybody (the game's own overall of every player is in `
    + `scripts/data/nhl-seasons/${entry.id}.json)`;
  return entry.source.kind === 'nhlpa93' ? `${entry.overall}, 99 at most; then ${rescale}` : `the game's overall, ${rescale}`;
}

function listingModule(docs) {
  const rows = docs.map(doc => `  Object.freeze({ id: '${doc.id}', version: '${doc.version}', year: ${doc.year}, season: '${doc.season}', label: '${doc.label}', map: '${doc.map}' }),`);
  return `// GENERATED by npm run build:nhl-seasons; do not edit.
// The built-in earlier ice hockey seasons, newest first: an EA NHL edition's ratings, an edition's attributes converted,
// or ratings computed from the season's statistics (docs/design/hockey.md). Each is public/hockey/<id>.json, loaded when a
// setup chooses it (src/engine/footballSets.js), and its clubs play on their era's map (\`map\`, public/domestic/<map>.json).
export const BUILT_IN_HOCKEY_SEASONS = Object.freeze([
${rows.join('\n')}
]);
`;
}

/** public/hockey/ATTRIBUTION.txt: where each season's ratings come from, and the statements the sources ask for. */
function attributionText(manifest, docs) {
  const seasons = method => docs.filter(doc => (doc.source.method ?? 'game') === method);
  const list = docs => docs.map(doc => doc.season).sort().join(', ');
  const byKind = kind => manifest.seasons.filter(s => s.method === 'computed' && s.source.kind === kind).map(s => seasonLabel(s.year)).join(', ');
  const { hdb, moneypuck } = manifest.computed.sources;
  return [
    'Ice hockey seasons (public/hockey/nhl-<year>.json): sources, terms and attribution',
    '=========================================================================',
    '',
    `EA's own ratings of a season (${list(seasons('game'))}): each file's source names the edition and who compiled it (docs/design/hockey.md, "Earlier seasons").`,
    '',
    `Converted from EA's attributes (${list(seasons('converted'))}): EA's NHL 08 and NHL 09 attributes as IGN's team pages published them`,
    "(the Wayback Machine's captures, pinned in scripts/data/nhl-seasons-sources.json); the overall is this project's conversion, not EA's",
    '(docs/design/hockey.md, "NHL 08 and NHL 09").',
    '',
    `Computed from the players' season statistics by this project's rule (docs/design/hockey.md, "Computed seasons"). These are not any game's ratings.`,
    '',
    `- ${byKind('hdb')}: ${hdb.compiler}.`,
    `  Terms: ${hdb.licence}. The statement it asks for:`,
    '',
    `  "${hdb.attribution}"`,
    '',
    `- ${byKind('moneypuck')}: ${moneypuck.compiler}.`,
    `  Terms: ${moneypuck.licence}. Credit: MoneyPuck.com (https://moneypuck.com).`,
    '  Non-commercial: these files may not be used for commercial purposes without MoneyPuck.com\'s leave.',
    '  Where MoneyPuck\'s player lookup gives no nationality, these seasons take the Hockey Databank\'s birth country, under',
    '  its terms and statement above.',
    '',
  ].join('\n');
}

async function main() {
  const check = process.argv.includes('--check');
  const unknown = process.argv.slice(2).filter(arg => arg !== '--check');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/nhl-seasons.json'), 'utf8'));
  const results = [];
  for (const entry of manifest.seasons) {
    const file = path.join(root, `scripts/data/nhl-seasons/${entry.id}.json`);
    if (!existsSync(file)) throw new Error(`No snapshot for ${entry.id}: run node scripts/sync-nhl-seasons.mjs --season=${entry.id}`);
    const snapshot = JSON.parse(await readFile(file, 'utf8'));
    const build = entry.method === 'computed' ? buildComputed : entry.method === 'converted' ? buildConverted : buildSeason;
    results.push(build(entry, snapshot, manifest));
  }
  // Nations only from the first computed season with three real sides (src/engine/footballSets.js clubsOnly): the loader's
  // id test must agree with the seasons.
  const computed = results.filter(r => r.realSides).sort((a, b) => a.doc.year - b.doc.year);
  const first = computed.find(r => r.realSides.length >= 3)?.doc.year;
  const disagree = computed.filter(r => r.hasNations !== (r.doc.year >= first)).map(r => `${r.doc.id} (${r.realSides.join(', ')})`);
  if (disagree.length) throw new Error(`The loader's clubsOnly test disagrees with the first season with three real sides (${first}): ${disagree.join('; ')}`);
  results.sort((a, b) => b.doc.year - a.doc.year);
  for (const { doc, text, audit } of results) {
    const nations = Array.isArray(audit.nations) ? `${audit.nations.length} nations` : audit.nations;
    console.log(`${doc.id} ${doc.season} ${doc.label} on ${doc.map}: ${doc.clubs.length} clubs, ${nations}, ${audit.players} players `
      + `(${audit.ratings.lowest}-${audit.ratings.highest}, median ${audit.ratings.median}), ${Math.round(Buffer.byteLength(text) / 1024)} KB; `
      + `strongest ${audit.clubs.slice(0, 2).join(', ')}${Array.isArray(audit.nations) ? `; ${audit.nations.slice(0, 2).join(', ')}` : ''}`
      + `${audit.realSides ? `; real sides ${audit.realSides.join(' ')}` : ''}`);
  }
  const fixture = JSON.parse(await readFile(path.join(root, 'scripts/data/nhl-seasons/calibration.json'), 'utf8'));
  const calibration = calibrationAudit(manifest, fixture);
  for (const e of calibration) {
    for (const f of e.forms) {
      console.log(`calibration ${e.id} (${f.form.skaters}, ${f.form.goalies}): F ${f.F.rho} D ${f.D.rho} G ${f.G.rho}, players ${f.playerGap} apart; `
        + `clubs ${f.clubs.rho}, ${f.clubs.gap} apart`);
    }
  }
  const outputs = [
    ...results.map(({ doc, text }) => [path.join(outDir, `${doc.id}.json`), text]),
    [path.join(outDir, 'ATTRIBUTION.txt'), attributionText(manifest, results.map(r => r.doc))],
    [listingFile, listingModule(results.map(result => result.doc))],
    [auditFile, `${JSON.stringify({ generatedBy: 'scripts/build-nhl-seasons.mjs', firstSeasonWithNations: seasonLabel(first), calibration,
      seasons: results.map(r => r.audit) }, null, 2)}\n`],
  ];
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified the ${results.length} hockey seasons, their listing and audit byte for byte.`);
    return;
  }
  await mkdir(outDir, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${results.length} seasons to public/hockey/, src/data/hockeySeasons.js and docs/design/hockey-seasons-audit.json`);
}

main().catch(error => {
  console.error(`build-nhl-seasons: ${error.message}`);
  process.exitCode = 1;
});
