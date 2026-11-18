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
// the full editions (scripts/data/nhl-seasons/calibration.json) goes into the audit. Each season's listing entry carries
// the credit its sources ask for (creditOf), which setup shows under the Season choice; the season files do not.
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
import { clubSquadOf, federationLands, federationOf, mapOf, nationOf, quantileRescale, ratingsOf, teamsOf } from './lib/nhl-seasons.mjs';
import {
  BLEND, attributeMean, calibrationOf, groupOf, groupRatings, lagWindowOf, ratingsOfHistogram, scoreOf, seasonBefore, seasonValues,
  stepRating, windowOf,
} from './lib/nhl-computed.mjs';
import { reconcileClubs } from './lib/nhl-reconcile.mjs';
import { spearman, variance } from './lib/computed-ratings.mjs';
import { NHL_LEAGUE_AVERAGES } from '../src/data/nhlLeagueAverages.js';

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
    return { name, team, pos, rating, game: rating, nation: federationOf(nationOf(born), year), nhlId };
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
    ? nationsOf(players, year).map(n => { const squad = rated(n.squad).sort(byPlace); return { ...n, ...nationStrength(squad), squad }; })
      .sort((a, b) => b.str - a.str || a.name.localeCompare(b.name))
    : nationsOf(players, year);
  const doc = {
    format: 1, kind: 'nhl', id, version: '', year, season: seasonLabel(year), label: entry.label, local: false,
    source: { provider: entry.provider, edition: entry.edition, compiler: entry.compiler, url: entry.url, retrieved: entry.retrieved,
      rawScale: entry.rawScale, overall: entry.overall, ...(scale ? { conversion: conversionOf(entry, manifest, players.length) } : {}),
      nation: entry.nation ?? "the NHL's birth country" },
    map: mapOf(manifest, year),
    nations: Object.fromEntries(nations.map(n => [n.id, [n.str, n.squad.length, n.squad.map(tupleOf)]])),
    clubs: clubs.map(c => ({ id: c.id, name: c.name, code: c.code, league: 'NHL', country: c.country, col: c.col, str: c.str,
      squad: c.squad.slice().sort(byPlace).map(tupleOf) })),
    territory: territoryOf(year, nations),
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

const label = year => `${year - 1}/${String(year % 100).padStart(2, '0')}`;
const fixed = (value, digits) => Number(value.toFixed(digits));
const sd = list => Math.sqrt(variance(list));

/** A computed season's rule, its constants and its form, as its source states it (source.conversion). */
function computedConversion(entry, snapshot, manifest, counts, values, reconciled) {
  const { form } = snapshot;
  const window = windowOf(entry.year);
  const group = (g, noun) => {
    const v = values.groups[g];
    return `${noun} ${fixed(1 - v.production, 2)}:${fixed(v.production, 2)} (prior ${fixed(v.prior, g === 'G' && form.goalies === 'saves' ? 0 : 1)}, `
      + `replacement ${fixed(v.replacement, g === 'G' ? 4 : 3)}, ${v.regulars} regulars of ${v.players})`;
  };
  const { strength, perPoint, scoring } = reconciled;
  const results = strength.kind === 'srs'
    ? `the Simple Rating System of its ${strength.games} games' scores from MoneyPuck.com's game files (margins by least squares with a home edge of ${fixed(strength.homeEdge, 2)}, a shoot-out's goal left out)`
    : snapshot.results.games
      ? `each club's goal differential a game over its ${strength.games} games from MoneyPuck.com's game files, which met only within their divisions (a shoot-out's goal left out; × (n − 1) ÷ n, n − 1 the clubs a club met)`
      : 'each club\'s goal differential a game from the Hockey Databank\'s Teams.csv (a shoot-out\'s goal taken off both sides; × (n − 1) ÷ n, a club meeting the other n − 1), its reliability from Poisson goals';
  return `computed from each player's regular seasons ${window.map(label).join(', ')} (weighted ${BLEND.weights.join(':')}; docs/design/computed-ratings.md, steps 3 to 5): `
    + `a player's value is selection and production as z-scores over the season's regulars (a quarter of the window's games), weighted selection:production `
    + `${group('F', 'forwards')}, ${group('D', 'defencemen')}, ${group('G', 'goalies')}, tuned once on EA's NHLPA 93, NHL 94, NHL 95, NHL 07 and NHL 22. `
    + `Selection is his share of the club's ${form.skaters === 'minutes' ? 'ice time a game' : 'games'} (a goalie's: of its minutes) over the seasons of the window he played. `
    + 'Production is points a game for skaters and, for goalies, '
    + `${form.goalies === 'saves' ? 'saves above the league\'s save percentage a shot' : 'goals against under the league\'s an hour (no shots against were kept for the whole window)'}, `
    + 'pooled over the window and shrunk toward replacement (the pooled rate of the quarter of the group with the least exposure) by the prior, the noise per unit of exposure over the regulars\' talent variance, '
    + 'on each record\'s effective exposure (Σw·e)²/Σw²·e. A player plays for the club he played most games for (a tie: the later one). '
    + `Each club's squad is picked by provisional ratings (each value's mid-rank in its group over the season's ${counts.players} players); then every squad player's rating is his value's mid-rank in his group `
    + `over the season's ${counts.squad} squad players, read off NHL 27's squads in that group (scripts/data/nhl-seasons.json computed.histograms: forwards ${counts.reference.F}, defenders ${counts.reference.D}, goalies ${counts.reference.G}); `
    + 'ties stay ties and nobody passes anybody in a group. A player outside the squads takes the rating of the highest squad value in his group not above his. '
    + `Then every club is moved toward its real results: S is ${results}, reliability r ${fixed(strength.reliability, 3)}; `
    + `m, the match model's margin a game per point of a lineup's played strength (the mean of its attack and defence) under the season's rules, is ${fixed(perPoint, 4)} goals `
    + `(at scoring ${fixed(scoring, 4)}); each club's target is the clubs' mean before the move + √r × S ÷ m, and every player of the club moves by one whole number, its best few one point more, `
    + 'whichever brings its lineup nearest the target (no player passes one rated above him in his club). '
    + `Every player's lines and the season's results are in scripts/data/nhl-seasons/${entry.id}.json.`;
}

/** The computed season `entry` of the manifest: its data set document and its audit row. */
function buildComputed(entry, snapshot, manifest) {
  const { id, year } = entry;
  if (snapshot.source.id !== id || snapshot.source.method !== 'computed') throw new Error(`scripts/data/nhl-seasons/${id}.json is not ${id}'s computed snapshot`);
  const src = manifest.computed.sources[entry.source.kind];
  const histograms = manifest.computed.histograms;
  const players = snapshot.players.map(([key, name, team, pos, born, lines]) => ({ key, name, team, pos, born, lines, nation: federationOf(nationOf(born), year) }));
  // Step 3: each player's value (the field `score` here, as the rating steps read it).
  const values = seasonValues(players, year, snapshot.leagues, snapshot.form);
  for (const p of players) p.score = values.values.get(p);
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
  const unmoved = new Map(players.map(p => [p, finalOf.get(p) ?? stepRating(p, rated)]));
  // Step 5: every club moved toward its real results, each of its players by the club's move.
  const entryOf = p => ({ name: p.name, pos: p.pos, rating: unmoved.get(p), value: p.score, player: p });
  const reconciled = reconcileClubs({
    clubs: picked.map(({ team, pool, squad }) => ({ id: team.id, code: team.code, squad: squad.map(entryOf).sort(byPlace),
      others: pool.filter(p => !squad.includes(p)).map(entryOf) })),
    results: snapshot.results, year, goals: NHL_LEAGUE_AVERAGES[label(year)].goals, seed: `nhl-move|${id}`,
  });
  const movedOf = new Map(reconciled.clubs.flatMap(club => [...club.squad, ...club.others].map(p => [p.player, p.rating])));
  const all = players.map(p => ({ ...p, provisional: p.rating, unmoved: unmoved.get(p), rating: movedOf.get(p) }));
  const ratingOf = new Map(players.map((p, i) => [p, all[i]]));
  const moveOf = new Map(reconciled.clubs.map(club => [club.code, club]));
  const clubs = picked.map(({ team, pool, squad }) => {
    const listed = squad.map(p => ratingOf.get(p));
    const lineup = selectLineup({ sport: 'hockey', squad: listed });
    const before = selectLineup({ sport: 'hockey', squad: listed.map(p => ({ ...p, rating: p.unmoved })) }).rating;
    return { id: team.id, name: team.name, code: team.code, country: team.country, col: colours.get(team.id) ?? colourFor(team.id),
      str: lineup.rating, before, move: moveOf.get(team.code), squad: listed, players: pool.length,
      open: lineup.slots.filter(slot => !slot.player || slot.penalty > 4).map(slot => slot.position) };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
  const nations = nationsOf(all, year);
  const realSides = realSidesOf(nations);
  const hasNations = setHasNations(id);
  const counts = { players: players.length, squad: squadPlayers.length,
    reference: Object.fromEntries(['F', 'D', 'G'].map(g => [g, ratingsOfHistogram(histograms[g]).length])) };
  const doc = {
    format: 1, kind: 'nhl', id, version: '', year, season: seasonLabel(year), label: entry.label, local: false,
    source: { provider: src.provider, edition: src.edition, compiler: src.compiler, url: src.url, retrieved: entry.retrieved, method: 'computed',
      rawScale: 'value', conversion: computedConversion(entry, snapshot, manifest, counts, values, reconciled), licence: src.licence, attribution: src.attribution, nation: src.nation },
    map: mapOf(manifest, year),
    // Before 1977/78 fewer than three nations field a real side: clubs only (src/engine/footballSets.js clubsOnly).
    nations: hasNations ? Object.fromEntries(nations.map(n => [n.id, [n.str, n.squad.length, n.squad.map(tupleOf)]])) : {},
    clubs: clubs.map(c => ({ id: c.id, name: c.name, code: c.code, league: 'NHL', country: c.country, col: c.col, str: c.str,
      squad: c.squad.slice().sort(byPlace).map(tupleOf) })),
    territory: territoryOf(year, hasNations ? nations : []),
    coverage: { players: players.length, clubs: clubs.length, nations: hasNations ? nations.length : 0, left: snapshot.left.length },
  };
  doc.version = `${id}-${contentHash(doc)}`;
  const range = list => { const s = list.slice().sort((a, b) => a - b); return { lowest: s[0], median: s[s.length >> 1], highest: s.at(-1) }; };
  const top = group => all.filter(p => groupOf(p.pos) === group)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 3).map(p => `${p.name} (${p.team}) ${p.rating}`);
  // Step 5's figures: the results strength, the move of every club, and how the clubs' strengths spread and follow the
  // results before the move and after it.
  const { strength } = reconciled;
  const real = clubs.map(c => strength.ratings[c.code]);
  const signed = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
  const moveText = ({ shift, plus }) => `${shift >= 0 ? '+' : '−'}${Math.abs(shift)}${plus ? `, ${plus} of them +1 more` : ''}`;
  const audit = {
    id, version: doc.version, season: doc.season, label: entry.label, method: 'computed', source: entry.source.kind, map: doc.map, form: snapshot.form,
    players: players.length, squads: squadPlayers.length, ratings: range(clubs.flatMap(c => c.squad.map(p => p.rating))),
    values: Object.fromEntries(Object.entries(values.groups).map(([g, v]) => [g, { players: v.players, regulars: v.regulars,
      prior: fixed(v.prior, g === 'G' && snapshot.form.goalies === 'saves' ? 0 : 2), replacement: fixed(v.replacement, 4), production: v.production }])),
    best: { forwards: top('F'), defenders: top('D'), goalies: top('G') },
    results: {
      kind: strength.kind, games: strength.games, reliability: fixed(strength.reliability, 3),
      ...(strength.kind === 'srs' ? { homeEdge: fixed(strength.homeEdge, 3), sigma: fixed(strength.sigma, 3) } : {}),
      ...(snapshot.results.games ? { homeMended: snapshot.results.homeMended, oneSided: snapshot.results.oneSided } : {}),
      perPoint: fixed(reconciled.perPoint, 4), scoring: reconciled.scoring, mean: fixed(reconciled.mean, 2),
      // The clubs' strengths' spread and their Spearman correlation with S: as shown (the lineup's mean) and as played.
      spread: { before: fixed(sd(clubs.map(c => c.before)), 2), after: fixed(sd(clubs.map(c => c.str)), 2),
        playedBefore: fixed(sd(clubs.map(c => c.move.before)), 2), playedAfter: fixed(sd(clubs.map(c => c.move.after)), 2),
        target: fixed(sd(clubs.map(c => c.move.target)), 2) },
      agreement: { before: fixed(spearman(clubs.map(c => c.before), real), 3), after: fixed(spearman(clubs.map(c => c.str), real), 3),
        playedBefore: fixed(spearman(clubs.map(c => c.move.before), real), 3), playedAfter: fixed(spearman(clubs.map(c => c.move.after), real), 3) },
      moves: clubs.map(c => `${c.name}: S ${signed(strength.ratings[c.code])}, played ${c.move.before.toFixed(2)} → ${c.move.after.toFixed(2)} `
        + `(target ${c.move.target.toFixed(2)}), ${moveText(c.move)}`),
    },
    clubs: clubs.map(c => `${c.name} ${c.str} (${c.before} before the move; ${c.players} players${c.open.length ? `; the game fills ${c.open.join(' ')}` : ''})`),
    nations: hasNations ? nations.map(n => `${n.name} ${n.str} (${n.squad.length}${n.open.length ? `; the game fills ${n.open.join(' ')}` : ''})`) : 'clubs only',
    realSides,
    noNation: players.filter(p => p.nation === null).map(p => `${p.name} (${p.team})`),
    left: snapshot.left.map(row => row.join(' | ')),
    notes: snapshot.notes,
  };
  return { doc, text: serializeFootballSet(doc), audit, realSides, hasNations };
}

/** The nations that would field a real side (src/data/teams.js fieldsRealSide), strongest first. */
function realSideNations(nations) {
  const rosters = Object.fromEntries(nations.map(n => [n.id, [n.str, n.squad.length, n.squad.map(tupleOf)]]));
  const sport = { ...hockey, rosters, territory: { merged: {}, inactive: [] } };
  return nations.filter(n => fieldsRealSide(n.id, sport));
}

/** Their names, as the audit lists them. */
const realSidesOf = nations => realSideNations(nations).map(n => n.name);

/**
 * A season's territory: the home nations in the United Kingdom's empire (Great Britain plays as one, as in the built-in
 * season), and a federation of the day's other members in its holder's where it fields a real side (federationLands:
 * Slovakia in Czechoslovakia's to 1991/92, the other republics in the Soviet Union's to 1990/91 and the CIS's in
 * 1991/92), as tennis's seasons give them.
 */
function territoryOf(year, nations) {
  const fielded = new Set(realSideNations(nations).map(n => n.id));
  return { merged: { ...Object.fromEntries(HOME_NATIONS.map(home => [home, '826'])), ...federationLands(year, fielded) }, inactive: [] };
}

/** The converted season `entry` (NHL 08, NHL 09): its data set document and its audit row. */
function buildConverted(entry, snapshot, manifest) {
  const { id, year } = entry;
  if (snapshot.source.id !== id || snapshot.source.method !== 'converted') throw new Error(`scripts/data/nhl-seasons/${id}.json is not ${id}'s converted snapshot`);
  const histograms = manifest.converted.histograms;
  const players = snapshot.players.map(([name, team, pos, born, values]) => {
    const score = attributeMean(values);
    if (score === null) throw new Error(`${id}: ${name} has an attribute outside 0-99`);
    return { name, team, pos, born, nation: federationOf(nationOf(born), year), score };
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
  const nations = nationsOf(players, year);
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
    territory: territoryOf(year, nations),
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

/**
 * The computed rule's values against an edition's overalls, Spearman's correlation within each group: the values of the
 * season ending in `year` (seasonValues, its window's lines only) over the edition's players with a line in that window.
 * `form`: the edition's, its goalies by save percentage where every season of the window kept shots against unless told.
 */
export function blendAgreement(edition, year, form) {
  const window = windowOf(year);
  const players = edition.players.map(([name, team, pos, overall, lines]) => ({ name, pos, overall, lines: lines.filter(l => window.includes(l[0])) }))
    .filter(p => p.lines.length);
  const goalies = form.goalies ?? (window.every(season => edition.leagues[season].savePct != null) ? 'saves' : 'goals');
  const { values } = seasonValues(players, year, edition.leagues, { skaters: form.skaters, goalies });
  return Object.fromEntries(['F', 'D', 'G'].map(g => {
    const members = players.filter(p => groupOf(p.pos) === g);
    return [g, { rho: fixed(spearman(members.map(p => values.get(p)), members.map(p => p.overall)), 3), players: members.length }];
  }));
}

/**
 * The computed rule against the full editions (scripts/data/nhl-seasons/calibration.json), as the audit records it: the
 * blend against each edition in the window of the season before its own (`lagWindowOf`: the seasons EA saw before the
 * edition came out) and in its own season's, with its goalies by goals against too (the databank's editions) and its
 * skaters by games too (NHL 22, which MoneyPuck times); and the superseded rule of 2026-11-09 (`superseded`) as it was
 * measured, in the season's own window.
 */
function calibrationAudit(manifest, fixture) {
  return fixture.editions.map(e => {
    const before = seasonBefore(e.year);
    const variants = [
      ['lag', before, e.form], ['own', e.year, e.form],
      e.kind === 'hdb' ? ['lag, goalies by goals against', before, { ...e.form, goalies: 'goals' }] : ['lag, skaters by games', before, { ...e.form, skaters: 'points' }],
    ];
    const forms = [e.form, ...(e.kind === 'hdb' ? [{ ...e.form, goalies: 'goals' }] : [{ ...e.form, skaters: 'points' }])];
    return {
      id: e.id, source: e.kind, unmatched: e.unmatched.length, lagWindow: lagWindowOf(e.year),
      blend: variants.map(([frame, year, form]) => ({ frame, window: windowOf(year), ...blendAgreement(e, year, form) })),
      superseded: forms.map(form => {
        const players = e.players.map(([name, team, pos, overall, lines]) => ({ name, team, pos, overall,
          score: lines.some(l => windowOf(e.year).includes(l[0])) ? scoreOf({ pos, lines }, e.year, e.leagues, form) : null }));
        return { form, ...calibrationOf(players, manifest.computed.histograms) };
      }),
    };
  });
}

/** The whole rule from the edition's numbers to a rescaled season's ratings, as its source states it. */
function conversionOf(entry, manifest, count) {
  const rescale = `rescaled onto NHL 27's ratings rank for rank: each overall takes the rating at its mid-rank among the season's ${count} rated players `
    + `in ${manifest.rescale.reference}; ties stay ties and nobody passes anybody (the game's own overall of every player is in `
    + `scripts/data/nhl-seasons/${entry.id}.json)`;
  return entry.source.kind === 'nhlpa93' ? `${entry.overall}, 99 at most; then ${rescale}` : `the game's overall, ${rescale}`;
}

// ---------- the credits ----------

/**
 * Whether season `entry` takes anything from the Hockey Databank, by its snapshot: an EA edition's season takes nothing
 * (its positions and birth countries are the NHL's rosters'); a season computed from the databank takes every line; NHL
 * 09 takes its skaters' positions from the databank's rosters, and both converted seasons the birth country of a player
 * EA's Country does not place (NHL 08's notes record each); a MoneyPuck season takes a birth country where MoneyPuck's
 * lookup gives no nationality (`notes.birthFromDatabank`).
 */
function usesDatabank(entry, snapshot) {
  if (entry.method === 'computed') return entry.source.kind === 'hdb' || snapshot.notes.birthFromDatabank.length > 0;
  if (entry.method === 'converted') {
    return entry.source.kind === 'nhl09' || snapshot.notes.country.some(note => /the Hockey Databank's birth country [A-Z]{3}$/.test(note));
  }
  return false;
}

/**
 * Season `entry`'s credit, the plain text the Season choice shows under it (docs/design/hockey.md, "Credits"), as
 * `{ name, text }`, or null for an EA edition's season: "Data: MoneyPuck.com" on a season computed from MoneyPuck's data,
 * then the Hockey Databank's statement, whole and word for word as its readme asks (the sync checks the readme still
 * does), on every season that takes anything from the databank. `name` is the listing's constant for it.
 */
function creditOf(entry, snapshot, manifest) {
  const { hdb, moneypuck } = manifest.computed.sources;
  const parts = [
    entry.method === 'computed' && entry.source.kind === 'moneypuck' && ['MONEYPUCK', `Data: ${moneypuck.provider}`],
    usesDatabank(entry, snapshot) && ['DATABANK', hdb.attribution],
  ].filter(Boolean);
  return parts.length ? { name: `CREDIT_${parts.map(([key]) => key).join('_')}`, text: parts.map(([, text]) => text).join('. ') } : null;
}

const quoted = text => `'${text.replace(/[\\']/g, '\\$&')}'`;

/** src/data/hockeySeasons.js: every season's listing entry, each credit written once as a constant its seasons name. */
function listingModule(docs, credits) {
  const constants = new Map();
  for (const credit of docs.map(doc => credits.get(doc.id)).filter(Boolean)) {
    if (constants.has(credit.name) && constants.get(credit.name) !== credit.text) throw new Error(`two credits named ${credit.name}`);
    constants.set(credit.name, credit.text);
  }
  const rows = docs.map(doc => `  Object.freeze({ id: '${doc.id}', version: '${doc.version}', year: ${doc.year}, season: '${doc.season}', label: '${doc.label}', map: '${doc.map}'`
    + `${credits.get(doc.id) ? `, credit: ${credits.get(doc.id).name}` : ''} }),`);
  return `// GENERATED by npm run build:nhl-seasons; do not edit.
// The built-in earlier ice hockey seasons, newest first: an EA NHL edition's ratings, an edition's attributes converted,
// or ratings computed from the season's statistics (docs/design/hockey.md). Each is public/hockey/<id>.json, loaded when a
// setup chooses it (src/engine/footballSets.js), and its clubs play on their era's map (\`map\`, public/domestic/<map>.json).
// A season's \`credit\` is the plain text its sources ask to be shown with it, which setup shows under the Season choice:
// the Hockey Databank's statement in full on every season that takes anything from it, and "Data: MoneyPuck.com" on those
// computed from MoneyPuck.com's data (docs/design/hockey.md, "Credits").
${[...constants].map(([name, text]) => `const ${name} = ${quoted(text)};`).join('\n')}
export const BUILT_IN_HOCKEY_SEASONS = Object.freeze([
${rows.join('\n')}
]);
`;
}

/**
 * public/hockey/ATTRIBUTION.txt: where each season's ratings come from, the statements the sources ask for, and which
 * seasons show them in the game (`credits`, creditOf's by season id).
 */
function attributionText(manifest, docs, credits) {
  const { hdb, moneypuck } = manifest.computed.sources;
  const seasons = method => docs.filter(doc => (doc.source.method ?? 'game') === method);
  const list = docs => docs.map(doc => doc.season).sort().join(', ');
  const computed = (kind, test = () => true) => manifest.seasons.filter(s => s.method === 'computed' && s.source.kind === kind && test(s))
    .map(s => seasonLabel(s.year));
  const databank = s => !!credits.get(s.id)?.text.includes(hdb.attribution);
  const credited = [...credits.values()].filter(Boolean);
  return [
    'Ice hockey seasons (public/hockey/nhl-<year>.json): sources, terms and attribution',
    '=========================================================================',
    '',
    `EA's own ratings of a season (${list(seasons('game'))}): each file's source names the edition and who compiled it (docs/design/hockey.md, "Earlier seasons").`,
    '',
    `Converted from EA's attributes (${list(seasons('converted'))}): EA's NHL 08 and NHL 09 attributes as IGN's team pages published them`,
    "(the Wayback Machine's captures, pinned in scripts/data/nhl-seasons-sources.json); the overall is this project's conversion, not EA's",
    '(docs/design/hockey.md, "NHL 08 and NHL 09"). NHL 09\'s skaters take their positions from the Hockey Databank\'s rosters (2008/09\'s,',
    'else the seasons beside it, else NHL 08\'s pages), and a player EA\'s Country does not place takes the Hockey Databank\'s birth',
    'country, under its terms and statement below.',
    '',
    `Computed from the players' season statistics by this project's rule (docs/design/hockey.md, "Computed seasons"). These are not any game's ratings.`,
    '',
    `- ${computed('hdb').join(', ')}: ${hdb.compiler}.`,
    `  Terms: ${hdb.licence}. The statement it asks for:`,
    '',
    `  "${hdb.attribution}"`,
    '',
    `- ${computed('moneypuck').join(', ')}: ${moneypuck.compiler}.`,
    `  Terms: ${moneypuck.licence}. Credit: MoneyPuck.com (https://moneypuck.com).`,
    '  Non-commercial: these files may not be used for commercial purposes without MoneyPuck.com\'s leave.',
    '  Where MoneyPuck\'s player lookup gives no nationality, a season takes the Hockey Databank\'s birth country, under its',
    `  terms and statement above (${computed('moneypuck', databank).join(', ')}).`,
    '',
    'In the game, setup shows the chosen season\'s credit under the Season choice (docs/design/hockey.md, "Credits"): the Hockey',
    `Databank's statement above, in full, on the ${credited.filter(c => c.text.includes(hdb.attribution)).length} seasons that take anything from the databank, `
      + `and "Data: ${moneypuck.provider}" on the ${credited.filter(c => c.text.startsWith(`Data: ${moneypuck.provider}`)).length} computed from its data.`,
    '',
  ].join('\n');
}

async function main() {
  const check = process.argv.includes('--check');
  const unknown = process.argv.slice(2).filter(arg => arg !== '--check');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/nhl-seasons.json'), 'utf8'));
  const results = [];
  const credits = new Map();
  for (const entry of manifest.seasons) {
    const file = path.join(root, `scripts/data/nhl-seasons/${entry.id}.json`);
    if (!existsSync(file)) throw new Error(`No snapshot for ${entry.id}: run node scripts/sync-nhl-seasons.mjs --season=${entry.id}`);
    const snapshot = JSON.parse(await readFile(file, 'utf8'));
    const build = entry.method === 'computed' ? buildComputed : entry.method === 'converted' ? buildConverted : buildSeason;
    results.push(build(entry, snapshot, manifest));
    credits.set(entry.id, creditOf(entry, snapshot, manifest));
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
    for (const b of e.blend) console.log(`calibration ${e.id}, blend (${b.frame}, ${b.window.join('-')}): F ${b.F.rho} D ${b.D.rho} G ${b.G.rho}`);
    const f = e.superseded[0];
    console.log(`calibration ${e.id}, superseded rule (${f.form.skaters}, ${f.form.goalies}): F ${f.F.rho} D ${f.D.rho} G ${f.G.rho}`);
  }
  const computedSeasons = results.filter(r => r.audit.results);
  const median = list => { const s = list.slice().sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const medianOf = (part, key) => fixed(median(computedSeasons.map(r => r.audit.results[part][key])), 3);
  console.log(`results: clubs against S, median Spearman as shown ${medianOf('agreement', 'before')} before the move, ${medianOf('agreement', 'after')} after, `
    + `as played ${medianOf('agreement', 'playedBefore')} → ${medianOf('agreement', 'playedAfter')}; club SD median as shown ${medianOf('spread', 'before')} → `
    + `${medianOf('spread', 'after')}, as played ${medianOf('spread', 'playedBefore')} → ${medianOf('spread', 'playedAfter')}`);
  const outputs = [
    ...results.map(({ doc, text }) => [path.join(outDir, `${doc.id}.json`), text]),
    [path.join(outDir, 'ATTRIBUTION.txt'), attributionText(manifest, results.map(r => r.doc), credits)],
    [listingFile, listingModule(results.map(result => result.doc), credits)],
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
