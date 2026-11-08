// Import the Live series of MLB The Show 18, 19 and 20 from ShowZone's card database (docs/design/baseball.md,
// "Earlier seasons"). Sony's own API hosts for those editions are gone; ShowZone (https://showzone.gg), a fan-run site
// that is not the publisher, keeps each edition's Live cards at its last roster update. Its public data API was read
// once (scripts/data/mlb-seasons.json `showzone`): the answers are cached in the ignored data-src/showzone/ and pinned
// there by SHA-256. This script never fetches: it checks the pins, reduces each card to the row the Sony snapshots hold
// and writes scripts/data/mlb-the-show-<nn>.json, which npm run build:mlb-seasons reads.
//
//   npm run import:mlb-showzone             writes scripts/data/mlb-the-show-18.json, -19.json and -20.json
//   npm run import:mlb-showzone -- --check  rebuilds them from the cache and compares byte for byte, writes nothing
//
// MLB The Show 21 is read too, as a control: ShowZone's copy must equal Sony's own (scripts/data/mlb-the-show-21.json)
// card for card, uuid, name, team, position, overall and birthplace, and it is where ShowZone's team ids are matched to
// The Show's codes. Rows are [uuid, name, team, position, secondary positions, overall, born] as the Sony snapshots
// hold them; ShowZone lists a card's positions primary first, so its secondary positions are the rest. A card with no
// birthplace (every one of MLB The Show 18's) has "" for born.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { byCardOrder, editionOf, FREE_AGENTS, snapshotText } from './lib/mlb.mjs';
import { pinnedShowzone, showzoneCards } from './lib/showzone.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const snapshotFile = year => path.join(root, `scripts/data/mlb-the-show-${editionOf(year)}.json`);

/** A ShowZone card as a snapshot row, its team `code`. */
const rowOf = (card, code) => [card.tsnId, card.name, code, card.position, card.allPositions.slice(1).join(','), card.overall, card.born ?? ''];

/**
 * ShowZone's team ids as The Show's codes, from the control edition: every card of Sony's own snapshot is ShowZone's
 * too, with the same name, position, overall and birthplace, and each team id stands for one code.
 */
function controlCodes(cards, sony) {
  const rows = new Map(sony.players.map(row => [row[0], row]));
  if (cards.length !== rows.size) throw new Error(`Control: ShowZone lists ${cards.length} cards of ${sony.source.edition}, Sony's API ${rows.size}`);
  const codes = new Map();
  for (const card of cards) {
    const row = rows.get(card.tsnId);
    if (!row) throw new Error(`Control: ${card.name} (${card.tsnId}) is not a card of Sony's ${sony.source.edition}`);
    const [, name, code, position, , overall, born] = row;
    if (name !== card.name || position !== card.position || overall !== card.overall || born !== (card.born ?? '')) {
      throw new Error(`Control: ${name} is ${JSON.stringify(rowOf(card, code))} at ShowZone, ${JSON.stringify(row)} in Sony's API`);
    }
    if (codes.has(card.team) && codes.get(card.team) !== code) throw new Error(`Control: ShowZone team ${card.team} is both ${codes.get(card.team)} and ${code}`);
    codes.set(card.team, code);
  }
  if (new Set(codes.values()).size !== codes.size || codes.size !== Object.keys(sony.teams).length) throw new Error('Control: the teams do not match one to one');
  return codes;
}

/** The snapshot of the edition of `year`: its cards, its teams named as the control's, its source and provenance. */
function snapshotOf(showzone, year, cards, codes, labels) {
  const edition = showzone.editions[year];
  const name = `MLB The Show ${editionOf(year)}`;
  const players = cards.map(card => {
    if (!codes.has(card.team)) throw new Error(`${name}: ${card.name} plays for ShowZone team ${card.team}, which the control does not list`);
    return rowOf(card, codes.get(card.team));
  }).sort(byCardOrder);
  const teams = Object.fromEntries([...new Set(players.map(row => row[2]))].sort().map(code => [code, labels[code]]));
  const missing = Object.keys(labels).filter(code => !teams[code]);
  if (missing.length) throw new Error(`${name}: no cards for ${missing.join(', ')}`);
  const born = players.filter(row => row[6]).length;
  return {
    note: `Every Live series card of ${name} (the roster of each MLB club at the edition's last roster update) as ShowZone keeps it, as [uuid, name, team, position, secondary positions, overall, born]. "born" is a US state or a country, "" where ShowZone names none (${players.length - born} cards). Written by npm run import:mlb-showzone from ShowZone's cached answers; read by npm run build:mlb-seasons.`,
    source: {
      name: `${name} Live series`, edition: name, season: String(year), url: showzone.api, compiler: showzone.compiler, compilerUrl: showzone.site,
      query: `where[game][equals]=${edition.game}&where[series][equals]=Live`, rosterUpdate: edition.rosterUpdate, retrieved: showzone.retrieved,
      cards: players.length, provenance: `${showzone.provenance} ${edition.checks}`,
    },
    teams,
    players,
  };
}

async function main() {
  const check = process.argv.includes('--check');
  const unknown = process.argv.slice(2).filter(arg => arg !== '--check');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const { showzone } = JSON.parse(await readFile(path.join(root, 'scripts/data/mlb-seasons.json'), 'utf8'));
  const games = (await pinnedShowzone(root, showzone, 'games.json')).docs;
  await pinnedShowzone(root, showzone, 'teams.json');
  for (const [year, { game }] of Object.entries(showzone.editions)) {
    const listed = games.find(entry => entry.id === game);
    if (!listed || listed.year !== Number(year) || listed.name !== `MLB The Show ${editionOf(Number(year))}`) throw new Error(`ShowZone game ${game} is not MLB The Show ${editionOf(Number(year))}`);
  }
  const sony = JSON.parse(await readFile(snapshotFile(showzone.control), 'utf8'));
  const codes = controlCodes(await showzoneCards(root, showzone, showzone.control), sony);
  console.log(`Control: ShowZone's ${sony.source.edition} is Sony's, all ${sony.players.length} cards.`);
  const outputs = [];
  for (const year of Object.keys(showzone.editions).map(Number).filter(year => year !== showzone.control)) {
    const snapshot = snapshotOf(showzone, year, await showzoneCards(root, showzone, year), codes, sony.teams);
    const count = test => snapshot.players.filter(test).length;
    console.log(`${snapshot.source.edition}: ${snapshot.players.length} cards (${count(row => row[2] === FREE_AGENTS)} free agents), roster update `
      + `${snapshot.source.rosterUpdate.id} (${snapshot.source.rosterUpdate.name}), ${count(row => row[4])} with secondary positions, ${count(row => row[6])} with a birthplace`);
    outputs.push([snapshotFile(year), snapshotText(snapshot)]);
  }
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified the ${outputs.length} ShowZone snapshots byte for byte.`);
    return;
  }
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${outputs.map(([file]) => path.relative(root, file)).join(', ')}`);
}

main().catch(error => {
  console.error(`import-mlb-showzone: ${error.message}`);
  process.exitCode = 1;
});
