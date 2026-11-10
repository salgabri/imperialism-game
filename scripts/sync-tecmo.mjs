// Snapshot the NFL seasons the Tecmo Super Bowl games rate (docs/design/american-football.md, "Tecmo seasons (data)")
// into scripts/data/tecmo/<season>.json (committed), for the earlier American football seasons to build from:
//
//   1990  Tecmo Super Bowl (NES, December 1991): TSBTool's dump of the stock cartridge, checked against Tecmo Geek
//   1992  Tecmo Super Bowl II: Special Edition (SNES), the first of the cartridge's three seasons
//   1993  Tecmo Super Bowl (SNES, December 1993), checked against the GameFAQs roster FAQ
//   1994  Tecmo Super Bowl II: Special Edition, the third of the cartridge's three seasons
//   1995  Tecmo Super Bowl III: Final Edition (SNES), checked against the NFTGL's Book of Armaments
//
// TSB II has no independent transcription: its two seasons are compared with a second dump from the same tools, which
// confirms the reading, not the values. Every player is kept with his attributes as the game rates them (by the names
// the game's screens use), his slot, the game position it maps to and an overall that is ours: the edition's position
// score (scripts/lib/tecmo.mjs) mapped by percentile onto Madden NFL 2002's overalls at the position. Names are
// nflverse's (CC-BY 4.0) where nflverse has the player on that club, else the game's spelling. The games' unlicensed
// stars, listed by position and team ('qb BILLS'), are named only where the sources make it certain, else left out;
// every decision is written into the snapshot. Punters are left out, as scripts/build-nfl.mjs leaves them out.
//
// The sources stay in the gitignored data-src/ (research80s/american-football/ and research/american-football/), each
// read only when it is the file PINS names by SHA-256.
//
// Usage: node scripts/sync-tecmo.mjs [--season=<year>] [--check]
//   --season  one season only
//   --check   rebuild the snapshots and compare them byte for byte; writes nothing
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  EDITIONS, ERA_EXCEPTIONS, FRANCHISE_OF, LINEUP, MADDEN_POSITION, NFTGL_WEIGHTS, NOT_CLUBS, POSITIONS, SEASONS, TECMO_GEEK,
  attributesOf, casedName, documentedGaps, eraOf, franchiseOfCode, genericGroups, identify, identifyGeneric, lineupGaps, nftglScore,
  overallsOf, parseCsv, parseDump, personOf, plain, readXlsx, referenceOf, slotPosition, tecmoGeekMaxima, tecmoGeekScore,
} from './lib/tecmo.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataSrc = path.join(root, 'data-src');
const outDir = path.join(root, 'scripts/data/tecmo');
const AF = 'research80s/american-football';
const DUMPS = `${AF}/github-badal-tsbtools-dumps`;
const TG = `${AF}/tecmogeek-tsb-nes`;
const NFLVERSE = `${AF}/nflverse-rosters-1980-2000`;
const MADDEN = 'research/american-football/maddenratings-net/files/madden-nfl-2002';
const ERAS_FILE = 'research/eras/nfl.json';
// How many differences a check lists by name.
const EXAMPLES = 12;
// How far from the season a source may show an unlicensed player's number.
const NUMBER_YEARS = 3;

// Every input, by its path under data-src/, and its SHA-256.
const PINS = {
  [`${DUMPS}/TSBData.txt`]: '123174f1b63825dd1fa239dffb972b1c8010b81d59bf9b1a6a2d1d81b9c303ff',
  [`${DUMPS}/SNES_05_TeamDefense_input.txt`]: 'ec38a8a3d9c4faa6531c58513fc119f75865b668fe0f7ec137ea8220879bd35d',
  [`${DUMPS}/TSB2Data.txt`]: '66e4089ec4fd609bca3f42767b4edc6d60fbab0324405bf067564ae28fd0f82c',
  [`${DUMPS}/tsb2_stock_rosters.txt`]: 'f7109fe8fbb0c532e5ccbcf2c836a66484ccd296d02300e5af70f6a2f896a50e',
  [`${DUMPS}/TSB3Data.txt`]: 'f47e082ef5f45c6e34b74b2d659f34dc2300948909f83c5a903ad9f63a0687a1',
  [`${TG}/about_ratings.html`]: '988f6a1e13337379488311157aa5e3c1e4e436c4572db2ccc2743cbe7c1f263f',
  [`${TG}/players_qb.html`]: '3a5b62e424a4e3b98821865a0a244b793d7392509addabe828e518c82dad7f46',
  [`${TG}/players_rushers.html`]: '2659f101b234be350ce8064dd447a5efa8681092b718fc784687ceb1bcad8594',
  [`${TG}/players_receivers.html`]: '3a778cdbc5f2771f94b2730c54f0bb0e3442d2071d5700f40d2ba4993adf033a',
  [`${TG}/players_ol.html`]: 'a768401164d5368a598e2dcba45c5a014c461cf1a224181f2edd2b6b1defe063',
  [`${TG}/players_dl.html`]: 'dc0b4bf05759f39a3d74716a56bb5dce673efa228f90b37350c790b40389311b',
  [`${TG}/players_lb.html`]: '32c7eb4c9586ec1d2f6567bf3ebfd8c50c38142ca0f8d10b288cdf5ac2bb066c',
  [`${TG}/players_cb-s.html`]: 'c638ad33661dc03f98788e4ed0057555dd9686b0080b71b860b59c381ab79af1',
  [`${TG}/players_k.html`]: 'a98e3143783cfccfa46c1dc315f3bf92988da3bd2ba4e76685ee55ff71e19f1f',
  [`${TG}/players_p.html`]: '2055a4f038411195fa15d44ea46b493f917fd0e21893b9332190838ade27c556',
  [`${AF}/gamefaqs-tsb-snes-roster-faq/faq41237.txt`]: 'dc6692d11e3b11a1babac3dbd8a5ebe8155b94012164566594bf8256e3197ef7',
  [`${AF}/gsheet-tsb3-book-of-armaments/book-of-armaments.xlsx`]: 'bc992abc75f39eaf3f4a559ec7ac181e1e7a69e95aef816e7390a98e1f41d5df',
  [`${NFLVERSE}/roster_1980.csv`]: 'c86c416d233c32fd3c7658a2b6a9796bafe7c3a6db8b1d1528627f27460f35c9',
  [`${NFLVERSE}/roster_1981.csv`]: '1d300e64acc265b4e5287ce3abe4fd419fa4280a2a6f91ca01397709385bec97',
  [`${NFLVERSE}/roster_1982.csv`]: '7de1fa974c73a3e9327bd19ddcaf5e9463b29a95524ab909c485d8c99ba4d9d8',
  [`${NFLVERSE}/roster_1983.csv`]: '6a4d971747e930952ddbdedd25b2fdfe86f140a45ab62f7800be813051d02cbc',
  [`${NFLVERSE}/roster_1984.csv`]: 'f17749882a0aa9fed298a4f152cf0ba986087738c97435b82240dc5721bb2ec4',
  [`${NFLVERSE}/roster_1985.csv`]: '1ae8dbc14cc7ffcf501a60a2088f0c2c11f343591c42628d40c3474ee3dd4b4c',
  [`${NFLVERSE}/roster_1986.csv`]: '791d42d2a0ead43a5f073f8b83eb1efca13d3e97b23d8b7b4fa73cfc19d5bea4',
  [`${NFLVERSE}/roster_1987.csv`]: 'a1cd5492a96aac8a52edc620e3ee5a3f34e5cb9a6d508d6353e515d12a202d95',
  [`${NFLVERSE}/roster_1988.csv`]: 'bb38b518fd4c99dba5745b3a688b6a3f42c9ed0e9bdb2234fa360afadeb34809',
  [`${NFLVERSE}/roster_1989.csv`]: '3baa3ab1511b16f263dd885feb72953e8e31c5a0b0aadbbbbb0053328cd9cc16',
  [`${NFLVERSE}/roster_1990.csv`]: 'a439c6cd0b5445db96f0983ce158a891197083d0cf13f37ee72b480f08e40d0d',
  [`${NFLVERSE}/roster_1991.csv`]: '94e28a9ef197753091a962ac577907104add06d5502b2c0dbc4eb3ebe9851a47',
  [`${NFLVERSE}/roster_1992.csv`]: '3b5045805fa784f45f7cd0b48ff2cff2b6bf138090d1f02ac89bfd1c464a3dcf',
  [`${NFLVERSE}/roster_1993.csv`]: 'cd9c971f387941b86f3e7c84f21fd2f56ccec42ae56e93b5593450824dcf484f',
  [`${NFLVERSE}/roster_1994.csv`]: '8790de4a4af28ad2ff8a12b52078b33df8e8eae676c1e4e11a4a24352ddcc22b',
  [`${NFLVERSE}/roster_1995.csv`]: '8d0d626e25c996d7dbdf654780a4ff2412feb527e921d8bc31381b0929044a08',
  [`${NFLVERSE}/roster_1996.csv`]: 'e768b19e1304b34c5ff366dc132aa89aac8c4b9d0be6112c63c4e5ceff7e0c44',
  [`${NFLVERSE}/roster_1997.csv`]: '9c871ccfdb768cf70fc77342ee0c79d0b4d09170a0bb9e25ebee7e08756955d7',
  [`${NFLVERSE}/roster_1998.csv`]: '48438400ab6f2f6dc26bfa584e9626533a99dbd8d1359973761fd65beb8f90d4',
  [`${NFLVERSE}/roster_1999.csv`]: 'cf3901dbb06360826e17295fb053a1247d88a73de52fbe8e056fa66005c454d5',
  [`${NFLVERSE}/roster_2000.csv`]: 'c4b205ea7b5506c72ba38f246b7e812ffedc9612e320a4099f5c57ec26d0e30f',
  [`${MADDEN}/arizona_cardinals__madden_nfl_2002_.xlsx`]: 'f21c635ae94990cba68596be9df0b0890c76a838d1d0104afd2417dc10821824',
  [`${MADDEN}/atlanta_falcons__madden_nfl_2002_.xlsx`]: '178777a66910389000a5a41f8ff883de57b1aa1901af388ce30dbec2a8bafa94',
  [`${MADDEN}/baltimore_ravens__madden_nfl_2002_.xlsx`]: '88ade8fd7af8c9f6ed0b7a67fb4cb104884c79a956ee7bebaf7cd58b2bcd2f9a',
  [`${MADDEN}/buffalo_bills__madden_nfl_2002_.xlsx`]: '6d0ad19b31d1d988c926d7d76d16172e179392e26f46ec9a74c4d27882753bfa',
  [`${MADDEN}/carolina_panthers__madden_nfl_2002_.xlsx`]: '34087d0383a0e76f160f0b74ee499e1afa8f2a3ec330f60bfe3b3946d0076312',
  [`${MADDEN}/chicago_bears__madden_nfl_2002_.xlsx`]: '3bb265b18db2eac0dc11e04c4cba4e492faeb1b97c3abbd1491691ff9ebc41eb',
  [`${MADDEN}/cincinnati_bengals__madden_nfl_2002_.xlsx`]: 'ff79d6d6334ad606e8b49cc3a206c40373f8b73f5798ba76bebb0cc19d2def6c',
  [`${MADDEN}/cleveland_browns__madden_nfl_2002_.xlsx`]: 'b89c54f68894449a7b0b7a9877e53e51229e262b542956b39fed5c2fbcc3d12a',
  [`${MADDEN}/dallas_cowboys__madden_nfl_2002_.xlsx`]: '36e52e500cb6960f611e7c370b8272e7bccc8a70806756683c8df2d9be104662',
  [`${MADDEN}/denver_broncos__madden_nfl_2002_.xlsx`]: '39e47363a88dca2f5df72813e157c4cf0f73696e160c32de167cea6ed63311a1',
  [`${MADDEN}/detroit_lions__madden_nfl_2002_.xlsx`]: '3e271e9d4e77aacef279e34a044020a7beee6032a467b26c7d990ab1244a319b',
  [`${MADDEN}/green_bay_packers__madden_nfl_2002_.xlsx`]: 'd5dfa8191a9d8dd2d4203408155bb2bd8f0983146656664787369ed38c928c3b',
  [`${MADDEN}/indianapolis_colts__madden_nfl_2002_.xlsx`]: 'b74635a45e48c3a3d43d354bdb8ecd5cb1eebbad414f10d2b72f0c846aa4b4df',
  [`${MADDEN}/jacksonville_jaguars__madden_nfl_2002_.xlsx`]: '4ed6f10b0ffeb54162c595efb5748a16e0aaaf5fcd217d7a5b64a155485c93c1',
  [`${MADDEN}/kansas_city_chiefs__madden_nfl_2002_.xlsx`]: '0ab83669138965060db4d76ffc77446ddcc6307bbe8412f1d02bf5b71a5332e4',
  [`${MADDEN}/miami_dolphins__madden_nfl_2002_.xlsx`]: '74660fda1f6c29ddb0400b2b3a971415e65cc56ca6f5cd678732b782052e14ce',
  [`${MADDEN}/minnesota_vikings__madden_nfl_2002_.xlsx`]: '6e9a6a19dc8b83c99c7a58ed9b9d9d9042824c18eb1611a51ac0bf84349d4357',
  [`${MADDEN}/new_england_patriots__madden_nfl_2002_.xlsx`]: '2084603c6677692e41984aad577ffc6dc4a7932352c0b7ebe33aa73a51658c61',
  [`${MADDEN}/new_orleans_saints__madden_nfl_2002_.xlsx`]: '6e37d8f4d972370a0dfa58d30dea342f14ff58d66da5cf66e59bcf98b75f8653',
  [`${MADDEN}/new_york_giants__madden_nfl_2002_.xlsx`]: '6b58c3bd98a7b64784dee51954abdbd7a424729d068f7ce644f0963e3ca954f0',
  [`${MADDEN}/new_york_jets__madden_nfl_2002_.xlsx`]: 'bc2042ec26bb695014b2943d055c19220dec46190b0970da645e621a440adc0f',
  [`${MADDEN}/oakland_raiders__madden_nfl_2002_.xlsx`]: 'd4b35c2760d39b7146b95fb81713c6bebb3c29b9c2e4eec03cdede5049f44e65',
  [`${MADDEN}/philadelphia_eagles__madden_nfl_2002_.xlsx`]: 'f7419e7386cbeee4acc42cb8a744998de62489dab97a22e39c718ec427151ae7',
  [`${MADDEN}/pittsburgh_steelers__madden_nfl_2002_.xlsx`]: 'da4cb9e135a5f967926fec54928bdd542d6c375a0218aad4da2f1844e177850f',
  [`${MADDEN}/san_diego_chargers__madden_nfl_2002_.xlsx`]: 'cd5c2746809f314da0ae8923beda0710dd636f8c6e9e5a3d83efce1297018ae7',
  [`${MADDEN}/san_francisco_49ers__madden_nfl_2002_.xlsx`]: '2697d52a212e8feb8e3ca2bf9d85d21fc058ed4d9559d6cd6149bd24c4d7326d',
  [`${MADDEN}/seattle_seahawks__madden_nfl_2002_.xlsx`]: '9d842609a18dc7daf77639407a4784d8dbba128d6963847574fe88f78f27cc24',
  [`${MADDEN}/st._louis_rams__madden_nfl_2002_.xlsx`]: 'db615a4228538e539caf4fdb652ae3aeb859824db2d9d599591bfbf40e5f0854',
  [`${MADDEN}/tampa_bay_buccaneers__madden_nfl_2002_.xlsx`]: 'c412a5b0095fea82973c0595fae5685fb6e71a5e067c1f55ee2057d39bd5a3f1',
  [`${MADDEN}/tennessee_titans__madden_nfl_2002_.xlsx`]: 'f72b8841fef3c67e1b799a4a98948733e11b848ef0f1932ff57b48c2fcdf63ca',
  [`${MADDEN}/washington_redskins__madden_nfl_2002_.xlsx`]: '393d231e29192057aaec6bfd694d8245fcc3b9b9fd918a79428a44ca7403d91a',
};
const MADDEN_FILES = Object.keys(PINS).filter(file => file.startsWith(`${MADDEN}/`));
const NFLVERSE_FILES = Object.keys(PINS).filter(file => file.startsWith(`${NFLVERSE}/`));
const TG_PAGES = ['qb', 'rushers', 'receivers', 'ol', 'dl', 'lb', 'cb-s', 'k', 'p'];

// Each dump as BAD-AL/tsbtools keeps it on GitHub: its path there and git blob id, which the copy must have.
const REPO = 'https://github.com/BAD-AL/tsbtools';
const DUMP_SOURCES = {
  nes: { file: `${DUMPS}/TSBData.txt`, path: 'TSBProjects/Java/TSBToolSupreme_netbeans/TSBData.txt',
    blob: '204213538452e9f2562d832e42a1432847fb3889', about: 'TSBTool Supreme\'s data file of the stock NES cartridge (28 clubs, 30 players each).' },
  snes: { file: `${DUMPS}/SNES_05_TeamDefense_input.txt`, path: 'TSBProjects/TSBTool/TSBTool_Test/SimTests/inputs/SNES_05_TeamDefense_input.txt',
    blob: 'd99592bf295c12a5acafce2f7c72a0192d30be11',
    about: 'TSBTool\'s dump of the stock SNES cartridge (28 clubs, 32 players each) as a simulation test\'s input: names, numbers and attributes stock, only the simulation values changed.' },
  tsb2: { file: `${DUMPS}/TSB2Data.txt`, path: 'TSBProjects/TSBTool2/TextData/TSB2Data.txt', blob: '6f069c4ffc93aa0e23d46314d189139e39fc9037',
    about: 'TSBTool2\'s data file of the stock SNES cartridge: its three seasons (1992, 1993, 1994) as SEASON 1–3, 28 clubs of 37 players each.' },
  tsb3: { file: `${DUMPS}/TSB3Data.txt`, path: 'TSBProjects/TSBTool2/TextData/TSB3Data.txt', blob: 'bd23dd667df2a60790ca588eca4c1374ec2ef906',
    about: 'TSBTool2\'s data file of the stock SNES cartridge: 30 clubs of 37 players each, the free agents and an all-time team.' },
};
const EDITION_LABEL = { nes: 'NES Tecmo Super Bowl', snes: 'SNES Tecmo Super Bowl', tsb2: 'Tecmo Super Bowl II', tsb3: 'Tecmo Super Bowl III' };
// Every roster an edition rates, as [edition, block, season]: TSB II's second season (1993) is read only as evidence.
const ROSTERS = [['nes', 1, 1990], ['tsb2', 1, 1992], ['tsb2', 2, 1993], ['snes', 1, 1993], ['tsb2', 3, 1994], ['tsb3', 1, 1995]];
const rosterKey = (edition, block, season) => `${edition}|${season}${edition === 'tsb2' && block === 2 ? '|evidence' : ''}`;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lastWord = name => plain(String(name).trim().split(/\s+/).at(-1));
const OWN_POSITION = { RB: 'RB', WR: 'WR', TE: 'TE' };

const cache = new Map();
/** A pinned input's bytes; throws when it is missing or not the pinned file. */
async function pinned(file) {
  if (cache.has(file)) return cache.get(file);
  if (!(file in PINS)) throw new Error(`${file} is not a pinned input`);
  const full = path.join(dataSrc, file);
  if (!existsSync(full)) throw new Error(`data-src/${file} is missing`);
  const bytes = await readFile(full);
  const actual = sha256(bytes);
  if (actual !== PINS[file]) throw new Error(`data-src/${file} is not the pinned file (SHA-256 ${actual})`);
  cache.set(file, bytes);
  return bytes;
}
const text = async file => (await pinned(file)).toString('utf8');

// ---------- nflverse ----------

/** nflverse's rosters, 1980–2000: `rowsOf(season, franchise)` and every row, each with its franchise. */
async function loadNflverse() {
  const bySeasonTeam = new Map();
  const all = [];
  for (const file of NFLVERSE_FILES) {
    const [header, ...rows] = parseCsv(await text(file));
    for (const cells of rows) {
      const row = Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']));
      row.season = Number(row.season);
      row.franchise = franchiseOfCode(row.team, row.season);
      if (!row.franchise) continue;
      all.push(row);
      const key = `${row.season}|${row.franchise}`;
      if (!bySeasonTeam.has(key)) bySeasonTeam.set(key, []);
      bySeasonTeam.get(key).push(row);
    }
  }
  return { rowsOf: (season, franchise) => bySeasonTeam.get(`${season}|${franchise}`) ?? [], all };
}

// ---------- the editions' rosters ----------

/**
 * One edition's roster of one season: each player with his franchise, attributes and nflverse identity (`row`, by his
 * club's roster that season, else the season before or after: the games were made between seasons).
 */
async function rosterOf(edition, block, season, nflverse) {
  const bytes = await pinned(DUMP_SOURCES[edition].file);
  if (gitBlob(bytes) !== DUMP_SOURCES[edition].blob) throw new Error(`${DUMP_SOURCES[edition].file} is not tsbtools' blob ${DUMP_SOURCES[edition].blob}`);
  return parseDump(bytes.toString('utf8')).filter(p => p.block === block && !NOT_CLUBS.has(p.team)).map(entry => {
    const franchise = FRANCHISE_OF[entry.team];
    if (!franchise) throw new Error(`${edition}: unknown team ${entry.team}`);
    const generic = genericGroups(entry.rom, entry.team);
    let row = null;
    if (!generic) {
      for (const year of [season, season - 1, season + 1]) {
        row = identify(entry.rom, nflverse.rowsOf(year, franchise));
        if (row) break;
      }
    }
    return { ...entry, edition, season, franchise, attributes: attributesOf(edition, entry.slot, entry.values), generic, row };
  });
}

// ---------- the independent copies ----------

const decode = s => s.replace(/&#x([0-9a-f]+);/gi, (w, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (w, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const TG_METRIC = { running_speed: 'RS', rushing_power: 'RP', maximum_speed: 'MS', hitting_power: 'HP', passing_speed: 'PS', pass_control: 'PC',
  avoid_pass_block: 'AR', ball_control: 'BC', receptions: 'REC', pass_interceptions: 'PI', kicking_ability: 'KA' };
const TG_PAGE = { QB: 'qb', RB: 'rushers', WR: 'receivers', TE: 'receivers', OL: 'ol', DL: 'dl', LB: 'lb', CB: 'cb-s', S: 'cb-s', K: 'k', P: 'p' };

/** Tecmo Geek's players, merged over its list pages: by `${team}|${number}` the entries `{ name, label, metrics, ratings }`. */
async function tecmoGeek() {
  const byNumber = new Map();
  for (const page of TG_PAGES) {
    const html = await text(`${TG}/players_${page}.html`);
    for (const chunk of html.split('data-testid="leaderboard-row"').slice(1)) {
      const team = /href="\/teams\/([^/"]+)\/"/.exec(chunk)?.[1];
      const name = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(chunk)?.[1];
      const id = /<h4[^>]*>([A-Z0-9]+)<!-- --> <!-- -->#(\d+)<\/h4>/.exec(chunk);
      const rating = /tabular-nums">(\d+)%<\/div>/.exec(chunk)?.[1];
      if (!team || !name || !id || !rating) throw new Error(`Tecmo Geek ${page}: a row it cannot read`);
      const key = `${team}|${id[2]}`;
      if (!byNumber.has(key)) byNumber.set(key, []);
      let entry = byNumber.get(key).find(e => e.name === decode(name).trim());
      if (!entry) byNumber.get(key).push(entry = { name: decode(name).trim(), label: id[1], metrics: {}, ratings: {} });
      for (const [, metric, value] of chunk.matchAll(/data-metric-key="([a-z_]+)" aria-label="[^"]*?: (\d+)"/g)) {
        if (!TG_METRIC[metric]) throw new Error(`Tecmo Geek ${page}: unknown metric ${metric}`);
        entry.metrics[TG_METRIC[metric]] = Number(value);
      }
      entry.ratings[page] = Number(rating);
    }
  }
  return byNumber;
}

// The FAQ's misspelt club headers.
const FAQ_TEAM = { cheifs: 'chiefs', seahawk: 'seahawks' };
/** The GameFAQs SNES roster FAQ's players: `[{ team, number, name, values }]`, the team by its dump key. */
async function gameFaqs() {
  const rows = [];
  let team = null;
  for (const line of (await text(`${AF}/gamefaqs-tsb-snes-roster-faq/faq41237.txt`)).split(/\r?\n/)) {
    const header = /^#\s{3,}([A-Za-z0-9. ]+?)\s{3,}#$/.exec(line);
    if (header) { const word = header[1].split(' ').at(-1).toLowerCase(); team = FAQ_TEAM[word] ?? word; continue; }
    // '#12 QB Chris Miller   25  69 ...'; a few rows have no position ('#3 Mark Royals ...').
    const m = /^\s*#(\d+)\s+(?:[A-Z]{1,4}\s+)?(.*?)\s+((?:\d+\s+)*\d+)\s*$/.exec(line);
    if (team && m && FRANCHISE_OF[team]) rows.push({ team, number: Number(m[1]), name: m[2], values: m[3].split(/\s+/).map(Number) });
  }
  return rows;
}

/**
 * A copy's entry for a dump player: by club, number and surname; else by club and surname, or club and number, when
 * only one entry has it (the copies misprint a few numbers and names).
 */
function entryFor(entries, player) {
  const club = entries.filter(e => e.team === player.team);
  const word = lastWord(player.rom);
  const exact = club.filter(e => e.number === player.number && lastWord(e.name) === word);
  if (exact.length === 1) return exact[0];
  const byName = club.filter(e => lastWord(e.name) === word);
  if (byName.length === 1) return byName[0];
  const byNumber = club.filter(e => e.number === player.number);
  return byNumber.length === 1 ? byNumber[0] : null;
}

// The Book of Armaments' column names as the screen's (its RS and RP are TSBM 2000's: the screen's RP and RS), its
// weights' labels as ours, its positions as the game's and its clubs as the dump's.
const BOOK_VALUES = { RS: 'RP', RP: 'RS', MS: 'MS', HP: 'HP', BB: 'BB', AG: 'AG', BC: 'BC', Rec: 'REC', REC: 'REC', PS: 'PS', PC: 'PC', PA: 'PA',
  AR: 'AR', Cool: 'CO', KP: 'KP', KA: 'KA', AKB: 'AKB', Int: 'PI', Qui: 'QU' };
const BOOK_LABELS = { ...BOOK_VALUES, RS: 'RS', RP: 'RP' };
const BOOK_POSITION = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', C: 'OL', G: 'OL', T: 'OL', K: 'K', P: 'P', DL: 'DL', LB: 'LB', CB: 'CB', S: 'S' };
const WEIGHT_ROWS = new Set(['QB', 'RB', 'WR', 'TE', 'OL', 'K', 'P', 'DL', 'LB', 'CB', 'S']);
// The Book's club sheets by the dump's team keys.
const BOOK_SHEETS = { Buf: 'bills', Mia: 'dolphins', NE: 'patriots', Ind: 'colts', NYJ: 'jets', Pit: 'steelers', Cin: 'bengals', Cle: 'browns',
  Hou: 'oilers', Jac: 'jaguars', Den: 'broncos', Sea: 'seahawks', Oak: 'raiders', SD: 'chargers', KC: 'chiefs', Dal: 'cowboys', Phi: 'eagles',
  NYG: 'giants', Was: 'redskins', Ari: 'cardinals', Min: 'vikings', GB: 'packers', Det: 'lions', Chi: 'bears', TB: 'buccaneers', Atl: 'falcons',
  StL: 'rams', NO: 'saints', Car: 'panthers', SF: '49ers' };
const DEFENDERS = new Set(['DL', 'LB', 'CB', 'S']);
/**
 * A Book sheet's players, each read by its header row: a club sheet puts one above its offence and one above its
 * defence; All Players states both at the top and mixes its players, a defender's row read by the second.
 */
function bookRows(rows) {
  const out = [];
  const headers = [];
  for (const row of rows) {
    if (row[0] === 'Player Name') { headers.push(row); continue; }
    const position = headers.length && row[headers[0].indexOf('Position')];
    if (!row[0] || !position) continue;
    const mixed = headers.length === 2 && rows[1] === headers[1];
    const header = mixed ? headers[DEFENDERS.has(position) ? 1 : 0] : headers.at(-1);
    const cells = Object.fromEntries(header.map((name, i) => [name, row[i]]).filter(([name, value]) => name && value !== '' && value !== undefined));
    out.push({ name: row[0], pos: position, number: Number(cells['Jersey #']), points: Number(cells['Man Pt Value']), cells });
  }
  return out;
}

/**
 * The Book of Armaments: its club sheets' players (by dump team key), its All Players sheet (the point values without
 * the bonus terms, which the club sheets add) and its weights (the Weighting sheet, by the Book's labels).
 */
async function armaments() {
  const sheets = readXlsx(await pinned(`${AF}/gsheet-tsb3-book-of-armaments/book-of-armaments.xlsx`));
  const clubs = Object.entries(BOOK_SHEETS).flatMap(([sheet, team]) => bookRows(sheets[sheet]).map(row => ({ ...row, team })));
  const players = bookRows(sheets['All Players']);
  const weights = {};
  let columns = null;
  for (const row of sheets.Weighting) {
    if (row[0] === 'Team Weighting') break;
    if (row[0] === '' && row[1] === 'RS') { columns = row.slice(1).filter(Boolean); continue; }
    if (columns && WEIGHT_ROWS.has(row[0])) {
      weights[row[0]] = Object.fromEntries(columns.map((name, i) => [name, Number(row[i + 1])]).filter(([, w]) => Number.isFinite(w) && w > 0));
    }
  }
  return { clubs, players, weights };
}

const counted = (diffs, total) => ({ compared: total, identical: total - diffs.length, differences: diffs.slice(0, EXAMPLES) });

/** A season's check against its independent copy (and, for NES, Tecmo Geek's labels and ratings on the players). */
async function checkOf(season, roster, inputs) {
  if (season.check === 'tecmogeek') {
    const listed = await tecmoGeek();
    for (const page of TG_PAGES) inputs.add(`${TG}/players_${page}.html`);
    inputs.add(`${TG}/about_ratings.html`);
    await pinned(`${TG}/about_ratings.html`);
    const diffs = [];
    for (const player of roster) {
      const entries = listed.get(`${player.team}|${player.number}`) ?? [];
      const tg = entries.length === 1 ? entries[0] : entries.find(e => lastWord(e.name) === lastWord(player.rom));
      if (!tg) throw new Error(`Tecmo Geek does not list ${player.team} ${player.slot} ${player.rom}`);
      player.tecmoGeek = tg;
      const changed = Object.entries(tg.metrics).filter(([name, value]) => player.attributes[name] !== value);
      if (changed.length) diffs.push(`${tg.name} (${player.team} ${player.slot}): ${changed.map(([name, value]) => `${name} ${player.attributes[name]} in the dump, ${value} at Tecmo Geek`).join(', ')}`);
    }
    return { name: 'Tecmo Geek', url: 'https://www.tecmogeek.com/', retrieved: '2026-11-08',
      about: 'Tecmo Geek\'s list of every NES player: the attributes it shows (those that differ between players and that the game uses), its position labels and its ratings.',
      ...counted(diffs, roster.length) };
  }
  if (season.check === 'gamefaqs') {
    const rows = await gameFaqs();
    inputs.add(`${AF}/gamefaqs-tsb-snes-roster-faq/faq41237.txt`);
    const diffs = [], unlisted = [];
    for (const player of roster) {
      const row = entryFor(rows, player);
      if (!row) { unlisted.push(`${casedName(player.rom)} (${player.team} ${player.slot} #${player.number})`); continue; }
      if (!same(row.values, player.values)) diffs.push(`${casedName(player.rom)} (${player.team} ${player.slot}): ${player.values.join(' ')} in the dump, ${row.values.join(' ')} in the FAQ`);
    }
    return { name: 'GameFAQs: Tecmo Super Bowl (SNES) roster FAQ, faq 41237', url: 'https://gamefaqs.gamespot.com/snes/588737-tecmo-super-bowl/faqs/41237',
      about: 'A transcription of the SNES game\'s rosters, player by player with his attributes, in the screen\'s order.',
      rows: rows.length, unlisted: unlisted.length, unlistedExamples: unlisted.slice(0, EXAMPLES), ...counted(diffs, roster.length - unlisted.length) };
  }
  if (season.check === 'tsb2-copy') {
    const file = `${DUMPS}/tsb2_stock_rosters.txt`;
    inputs.add(file);
    const bytes = await pinned(file);
    if (gitBlob(bytes) !== '3289c9959af9462bc8d61eb63b2ddad53ad76fac') throw new Error(`${file} is not tsbtools' blob`);
    const copy = new Map(parseDump(bytes.toString('utf8')).filter(p => p.block === season.block && !NOT_CLUBS.has(p.team)).map(p => [`${p.team}|${p.slot}`, p]));
    const diffs = [];
    for (const player of roster) {
      const other = copy.get(`${player.team}|${player.slot}`);
      if (!other || other.rom !== player.rom || other.number !== player.number || !same(other.values, player.values)) {
        diffs.push(`${player.team} ${player.slot} ${player.rom}: ${other ? `${other.rom} #${other.number} ${other.values.join(' ')}` : 'missing'} in the copy`);
      }
    }
    return { name: 'tsbtools: tsb2_stock_rosters.txt', url: REPO, path: 'TSBProjects/TSBTool/TSBTool_Test/TSB2SimModel/tsb2_stock_rosters.txt',
      blob: '3289c9959af9462bc8d61eb63b2ddad53ad76fac',
      about: 'A second dump of the stock TSB II cartridge by the same tools (its simulation values differ). It confirms the reading, not the values: no independent transcription of TSB II exists.',
      ...counted(diffs, roster.length) };
  }
  if (season.check === 'armaments') {
    const book = await armaments();
    inputs.add(`${AF}/gsheet-tsb3-book-of-armaments/book-of-armaments.xlsx`);
    const diffs = [], unlisted = [];
    for (const player of roster) {
      const row = entryFor(book.clubs, player);
      if (!row) { unlisted.push(`${casedName(player.rom)} (${player.team} ${player.slot} #${player.number})`); continue; }
      const listed = Object.fromEntries(Object.entries(row.cells).filter(([name]) => BOOK_VALUES[name]).map(([name, value]) => [BOOK_VALUES[name], Number(value)]));
      const changed = Object.entries(player.attributes).filter(([name, value]) => listed[name] !== value);
      if (changed.length) diffs.push(`${casedName(player.rom)} (${player.team} ${player.slot}): ${changed.map(([name, value]) => `${name} ${value} in the dump, ${listed[name]} in the Book`).join(', ')}`);
    }
    // The weights as the Book states them, and its own point values, which apply them to its columns as it labels them.
    const stated = Object.fromEntries(Object.entries(book.weights).map(([pos, weights]) => [BOOK_POSITION[pos] ?? pos,
      Object.fromEntries(Object.entries(weights).map(([label, w]) => [BOOK_LABELS[label], w]))]));
    const mismatched = Object.keys(NFTGL_WEIGHTS).filter(pos => !same(stated[pos], NFTGL_WEIGHTS[pos]));
    if (mismatched.length) throw new Error(`The NFTGL weights differ from the Book's for ${mismatched.join(', ')}`);
    const sumOf = (row, weights) => Object.entries(weights).reduce((total, [label, w]) => total + w * Number(row.cells[label] ?? 0), 0);
    let atListed = 0, atOther = 0, scored = 0;
    for (const row of book.players) {
      const weights = book.weights[row.pos] ?? book.weights[BOOK_POSITION[row.pos]];
      if (!weights) continue;
      scored++;
      if (Math.abs(sumOf(row, weights) - row.points) < 1e-6) atListed++;
      else if (['RB', 'WR', 'TE'].some(pos => Math.abs(sumOf(row, book.weights[pos]) - row.points) < 1e-6)) atOther++;
    }
    return { name: 'NFTGL: The Book of Armaments, 2017 update', url: 'https://tecmobowl.org/forums/topic/72212-tsb-iii-player-attributesrankings-the-book-of-armaments/',
      about: 'The No Frills Tough Guy League\'s workbook of every TSB III player\'s attributes, club by club, and its weighting. Like the dump it lists RP before RS (TSBM 2000\'s order).',
      rows: book.clubs.length, unlisted: unlisted.length, unlistedExamples: unlisted.slice(0, EXAMPLES), ...counted(diffs, roster.length - unlisted.length),
      weights: { sameAsTheSheet: true, pointValues: scored, reproducedAtListedPosition: atListed, reproducedAtAnotherSkillPosition: atOther,
        about: 'The All Players sheet\'s point values (Man Pt Value) are the weights times its columns as it labels them, without the bonus terms (the club sheets add them). A few backs and receivers, most in one-back clubs\' slots, are valued at another skill position than the one the sheet lists. Ours apply each weight to the attribute the screen names so.' } };
  }
  throw new Error(`Unknown check ${season.check}`);
}

// ---------- Madden NFL 2002 ----------

/** Madden NFL 2002's rostered players (its 31 team spreadsheets): `[{ team, position, overall, name }]`, punters left out. */
async function loadMadden() {
  const players = [];
  for (const file of MADDEN_FILES) {
    const [rows] = Object.values(readXlsx(await pinned(file)));
    const [header, ...body] = rows;
    const col = name => { const i = header.indexOf(name); if (i < 0) throw new Error(`${file} has no ${name}`); return i; };
    for (const row of body.filter(r => r[col('Team')])) {
      const listed = row[col('Position')];
      if (listed === 'P') continue;
      const position = MADDEN_POSITION[listed];
      if (!position) throw new Error(`Madden NFL 2002: unknown position ${listed}`);
      players.push({ team: path.basename(file), position, overall: Number(row[col('Overall')]), name: `${row[col('First Name')]} ${row[col('Last Name')]}` });
    }
  }
  return players;
}

// ---------- the eras ----------

/** The era table's differences from data-src/research/eras/nfl.json, when that file is there. */
async function erasDiffer() {
  const file = path.join(dataSrc, ERAS_FILE);
  if (!existsSync(file)) return [];
  const eras = JSON.parse(await readFile(file, 'utf8')).franchises;
  const out = [];
  for (const { season } of SEASONS) {
    for (const franchise of new Set(Object.values(FRANCHISE_OF))) {
      const era = eras[franchise]?.find(e => e.from <= season && season <= e.to);
      if (!era) continue;
      const ours = eraOf(franchise, season);
      const expected = ERA_EXCEPTIONS[franchise] ? { ...ours, era: ERA_EXCEPTIONS[franchise].id, name: ERA_EXCEPTIONS[franchise].name } : ours;
      const theirs = { era: era.id ?? franchise, name: era.name, code: era.code };
      if (!same(expected, theirs)) out.push(`${season} ${franchise}: ${JSON.stringify(theirs)} in the eras file`);
    }
  }
  return out;
}

// ---------- a season ----------

async function snapshotOf(season, context) {
  const edition = EDITIONS[season.edition];
  const roster = context.rosters.get(rosterKey(season.edition, season.block, season.season));
  const inputs = new Set([DUMP_SOURCES[season.edition].file, ...context.common]);
  const check = await checkOf(season, roster, inputs);

  // The unlicensed stars: named where certain, else left out.
  const named = new Set(roster.filter(p => p.row).map(p => personOf(p.row)));
  const placeholders = [];
  for (const player of roster.filter(p => p.generic)) {
    const decision = identifyGeneric({
      groups: player.generic, number: player.number, slot: player.slot, rows: context.nflverse.rowsOf(season.season, player.franchise), named,
      numbers: row => context.numbersOf(player.franchise, player.number, personOf(row), season.season),
      sameSeason: slot => context.sameSeason(season, player.franchise, slot),
    });
    if (decision.named) { player.row = decision.named; named.add(personOf(decision.named)); }
    placeholders.push({ rom: player.rom, franchise: player.franchise, slot: player.slot, number: player.number,
      named: decision.named?.full_name ?? null, ...(decision.named?.gsis_id ? { id: decision.named.gsis_id } : {}), rule: decision.rule,
      candidates: decision.candidates, ...(decision.evidence.length ? { evidence: decision.evidence } : {}) });
  }

  // Positions: the slot's, but backs, receivers and tight ends play their own (Tecmo Geek's label on NES, nflverse's
  // position elsewhere): the games put receivers in one-back clubs' back and tight-end slots.
  let relabelled = 0;
  for (const player of roster) {
    const fromSlot = slotPosition(season.edition, player.slot);
    player.position = fromSlot;
    if (OWN_POSITION[fromSlot]) {
      player.position = season.edition === 'nes' ? slotPosition('nes', player.tecmoGeek.label) : OWN_POSITION[player.row?.position] ?? fromSlot;
      if (player.position !== fromSlot) relabelled++;
    }
  }
  // What the players in the nickel and dime slots played in the NFL (nflverse: CB, a safety, or just DB).
  const DB_KIND = { CB: 'CB', FS: 'S', SS: 'S', S: 'S', SAF: 'S', DB: 'DB' };
  const nickelAndDime = Object.fromEntries(Object.keys(edition.db).map(slot => {
    const held = { CB: 0, S: 0, DB: 0 };
    for (const p of roster.filter(q => q.slot === slot && q.row && DB_KIND[q.row.depth_chart_position])) held[DB_KIND[p.row.depth_chart_position]]++;
    return [slot, held];
  }));

  // Scores by the edition's formula, over every player it rates at a game position (punters have none).
  const rated = roster.filter(p => p.position !== 'P');
  const maxima = edition.formula === 'tecmogeek' ? tecmoGeekMaxima(rated) : null;
  for (const player of rated) {
    player.score = edition.formula === 'tecmogeek' ? tecmoGeekScore(player.position, player.attributes, maxima) : nftglScore(player.position, player.attributes);
  }
  if (season.check === 'tecmogeek') {
    let agree = 0, total = 0;
    const off = [];
    for (const player of rated) {
      const published = player.tecmoGeek.ratings[TG_PAGE[player.position]];
      if (published === undefined) continue;
      total++;
      if (Math.round(player.score) === published) agree++;
      else off.push(`${player.tecmoGeek.name} (${player.team} ${player.slot}): ${player.score.toFixed(2)}%, Tecmo Geek ${published}%`);
    }
    check.ratings = { reproduced: `${agree}/${total}`, differences: off.slice(0, EXAMPLES) };
  }

  // The season's players: the named ones at a game position. The overall: each position's scores by percentile on
  // Madden NFL 2002, as many of each Madden team's best as the season carries per club.
  const kept = rated.filter(p => !p.generic || p.row);
  const clubs = [...new Set(roster.map(p => p.franchise))].sort();
  const reference = {};
  for (const position of POSITIONS) {
    const players = kept.filter(p => p.position === position);
    const madden = referenceOf(context.madden, position, players.length / clubs.length);
    const overall = overallsOf(players.map(p => p.score), madden);
    for (const player of players) player.overall = overall.get(player.score);
    reference[position] = { players: players.length, perClub: Math.round(players.length / clubs.length * 100) / 100, madden };
  }

  // The clubs as they were that season, and the places they leave empty in the game's lineup.
  const teams = Object.fromEntries(clubs.map(franchise => [franchise, eraOf(franchise, season.season)]));
  const gaps = {};
  for (const franchise of clubs) {
    const found = lineupGaps(kept.filter(p => p.franchise === franchise).map(p => p.position));
    const documented = documentedGaps(season.season, franchise);
    if (!same(Object.entries(found).sort(), Object.entries(documented).sort())) {
      throw new Error(`${season.season} ${franchise}: the lineup lacks ${JSON.stringify(found)}, scripts/lib/tecmo.mjs documents ${JSON.stringify(documented)}`);
    }
    if (Object.keys(found).length) gaps[franchise] = found;
  }

  const order = new Map(clubs.map((franchise, i) => [franchise, i]));
  kept.sort((a, b) => order.get(a.franchise) - order.get(b.franchise) || POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position)
    || b.overall - a.overall || b.score - a.score || a.slot.localeCompare(b.slot));
  const rowOf = p => [p.row ? p.row.full_name : casedName(p.rom), p.franchise, p.slot, p.position, p.overall,
    { rom: p.rom, no: p.number, ...p.attributes, ...(p.row?.gsis_id ? { id: p.row.gsis_id } : {}) }];

  const isTsbm = ['tsb2', 'tsb3'].includes(season.edition);
  const source = {
    game: edition.game, platform: edition.platform, released: edition.released, season: season.season,
    ...(season.edition === 'tsb2' ? { cartridgeSeason: season.block } : {}),
    dump: { repo: REPO, path: DUMP_SOURCES[season.edition].path, blob: DUMP_SOURCES[season.edition].blob, about: DUMP_SOURCES[season.edition].about },
    files: Object.fromEntries([...inputs].sort().map(file => [file, PINS[file]])),
    checks: [check],
    names: { source: 'nflverse rosters, 1980–2000 (CC-BY 4.0): https://github.com/nflverse/nflverse-data',
      nflverse: kept.filter(p => p.row).length,
      gameSpelling: kept.filter(p => !p.row).map(p => `${casedName(p.rom)} (${teams[p.franchise].code} ${p.slot})`),
      about: 'A player takes nflverse\'s name when he is on his club\'s nflverse roster that season (or the one before or after) under the game\'s name: last names equal, cut short or a letter apart (two in a long name), first names equal, his given name, an initial, a short form or a letter or two apart, never both approximate. Else the game\'s spelling in ordinary capitals (gameSpelling). nflverse has no gsis id for some of the players it names.' },
    ...(season.edition === 'tsb2' ? { limit: 'TSB II\'s attributes rest on one extraction: the second dump comes from the same tools, and no independent transcription of TSB II exists. Its rosters fit the real seasons (about 90%) and its decoding checks out against SNES Tecmo Super Bowl.' } : {}),
    ...(season.edition === 'tsb3' ? { leftOut: 'The cartridge\'s free agents (Deion Sanders among them) and its all-time team are no club of the season.' } : {}),
    ...(season.notes ? { notes: season.notes } : {}),
  };
  const conversion = {
    overall: `Ours, not the game's: Tecmo rates no overall. Each player's ${edition.formula === 'tecmogeek' ? 'Tecmo Geek' : 'NFTGL'} score at his game position is ranked among the season's players at that position (mid-rank percentile, ties sharing one) and read off Madden NFL 2002's overalls at that position (the 2001 season: maddenratings.net's 31 team spreadsheets, punters left out), as many of each Madden team's best as the season carries per club, by linear interpolation; rounded and held to 1–99.`,
    formula: edition.formula === 'tecmogeek'
      ? { id: season.edition === 'nes' ? 'tecmogeek-nes' : 'tecmogeek-nes-weights',
        about: season.edition === 'nes'
          ? 'Tecmo Geek\'s player ratings (https://www.tecmogeek.com/about/ratings/): per position, each attribute scored against the best value at the position (hitting power by bands), weighted to 100. Backs are rated as rushers, receivers and tight ends as receivers.'
          : 'No formula for SNES Tecmo Super Bowl is agreed. Its attributes are NES Tecmo Super Bowl\'s, so Tecmo Geek\'s NES weights and bands apply to them, each attribute scored against the best SNES value at the position.',
        weights: TECMO_GEEK.weights, bands: TECMO_GEEK.bands, groups: TECMO_GEEK.groups, maxima }
      : { id: season.edition === 'tsb3' ? 'nftgl-2017' : 'nftgl-2017-without-agility',
        about: season.edition === 'tsb3'
          ? 'The NFTGL\'s weighting (The Book of Armaments, 2017 update; the league has revised its weighting over the years): per position, each attribute times its weight, summed, as the sheet\'s Man Pt Value. Its weights apply to the attributes the screen names so; the sheet\'s own sums give its RS weight to its first column, the screen\'s RP. Its bonus terms (50 or 100 points over thresholds of speed, rushing power, interceptions or hitting power) are no part of that value and are left out.'
          : 'No formula for TSB II is agreed. TSB III is TSB II\'s engine with Agility added, so the NFTGL\'s TSB III weighting (The Book of Armaments, 2017 update) applies to TSB II\'s attributes by the screen\'s names, Agility\'s weight dropping out; its bonus terms are left out, as for TSB III.',
        weights: Object.fromEntries(POSITIONS.map(pos => [pos, Object.fromEntries(Object.entries(NFTGL_WEIGHTS[pos]).filter(([name]) => season.edition === 'tsb3' || name !== 'AG'))])) },
    attributes: `By the game's screen names, on its 16-step scale (6, 13 ... 100): RS running speed, RP rushing power, MS maximum speed, HP hitting power, BB body balance, AG agility, PS passing speed, PC pass control, PA passing accuracy, AR avoid rush (Tecmo Geek: avoid pass block), CO coolness, BC ball control, REC receptions, PI pass interceptions, QU quickness, KP kicking power, KA kicking ability, AKB avoid kick block.${isTsbm ? ' The dump lists RP before RS (TSBM 2000\'s order): they are swapped back.' : ''}`,
    positions: {
      slots: `QB QB; RB RB; WR WR; TE TE; C, LG, RG, LT, RT OL; RE, NT, LE${isTsbm ? ' (RE2, NT2, LE2)' : ''} DL; ROLB, RILB, LILB, LOLB${isTsbm ? ' (LB5)' : ''} LB; RCB, LCB CB; FS, SS S; K K; P left out.${Object.keys(edition.db).length ? ` The nickel and dime slots: ${Object.entries(edition.db).map(([slot, pos]) => `${slot} ${pos}`).join(', ')}, the position most of their players held (nflverse).` : ''}`,
      ...(Object.keys(nickelAndDime).length ? { nickelAndDime } : {}),
      skill: season.edition === 'nes'
        ? 'Backs, receivers and tight ends play the position Tecmo Geek labels them with. It reads the one-back clubs\' second back\'s slot as a receiver\'s and their third receiver\'s as a back\'s (Phoenix and Washington), and the run-and-shoot clubs\' tight ends\' slots as receivers\' too (Atlanta, Detroit and Houston: six receivers, four backs, no tight end).'
        : 'Backs, receivers and tight ends play their own position (nflverse\'s RB, FB, WR or TE) where nflverse names them, else their slot\'s: the game puts receivers in one-back clubs\' back and tight-end slots and backs in their receiver slots.',
      relabelled,
      defence: 'Defenders play their slot\'s position, as the game has them (a tackle at inside linebacker is a linebacker).',
    },
    reference: { game: 'Madden NFL 2002', season: 2001, positions: reference },
  };
  const head = {
    note: `${edition.game} (${edition.platform}) rates the ${season.season} NFL season. Every player of its ${clubs.length} clubs but the punters as [name, franchise (scripts/data/nfl-teams.json), Tecmo slot, game position, overall, { rom: the game's spelling, no: jersey, attributes, id: nflverse gsis id }], written by scripts/sync-tecmo.mjs. The overall is ours, not the game's (conversion).`,
    source, conversion, teams, lineup: { needs: LINEUP, gaps },
  };
  const lines = Object.entries(head).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const list = (key, items) => `  ${JSON.stringify(key)}: [${items.length ? `\n${items.map(item => `    ${JSON.stringify(item)}`).join(',\n')}\n  ` : ''}]`;
  return { text: `{\n${[...lines, list('placeholders', placeholders), list('players', kept.map(rowOf))].join(',\n')}\n}\n`, kept, placeholders, check };
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const only = args.find(arg => arg.startsWith('--season='))?.slice('--season='.length);
  const unknown = args.filter(arg => arg !== '--check' && !arg.startsWith('--season='));
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const seasons = only ? SEASONS.filter(s => String(s.season) === only) : SEASONS;
  if (!seasons.length) throw new Error(`No Tecmo season ${only}`);

  const eras = await erasDiffer();
  if (eras.length) throw new Error(`The era table (scripts/lib/tecmo.mjs) differs from data-src/${ERAS_FILE}:\n${eras.join('\n')}`);

  const nflverse = await loadNflverse();
  const rosters = new Map();
  for (const [edition, block, year] of ROSTERS) rosters.set(rosterKey(edition, block, year), await rosterOf(edition, block, year, nflverse));
  // Who wore which number for which franchise, and when: nflverse's entries and every edition's named players.
  const worn = new Map();
  const wear = (franchise, number, person, label, season) => {
    if (!(number > 0)) return;
    const key = `${franchise}|${number}|${person}`;
    if (!worn.has(key)) worn.set(key, new Map());
    worn.get(key).set(label, season);
  };
  for (const row of nflverse.all) wear(row.franchise, Number(row.jersey_number), personOf(row), `nflverse ${row.season}`, row.season);
  for (const roster of rosters.values()) {
    for (const p of roster.filter(q => q.row)) wear(p.franchise, p.number, personOf(p.row), `${EDITION_LABEL[p.edition]} ${p.season}`, p.season);
  }
  const context = {
    nflverse, rosters, madden: await loadMadden(),
    // Every season reads the other dumps (numbers), all of nflverse (names and numbers) and Madden NFL 2002 (overalls).
    common: [...Object.values(DUMP_SOURCES).map(d => d.file), ...NFLVERSE_FILES, ...MADDEN_FILES],
    // The sources that show a person in a number for a franchise within three seasons of `season`.
    numbersOf: (franchise, number, person, season) => [...(worn.get(`${franchise}|${number}|${person}`) ?? new Map())]
      .filter(([, when]) => Math.abs(when - season) <= NUMBER_YEARS).map(([label]) => label).sort((a, b) => a.localeCompare(b)),
    // Another edition rating the same season: TSB II's second season beside SNES Tecmo Super Bowl (1993).
    sameSeason: (season, franchise, slot) => {
      if (season.season !== 1993 || season.edition !== 'snes') return null;
      const other = rosters.get(rosterKey('tsb2', 2, 1993)).find(p => p.franchise === franchise && p.slot === slot);
      return other?.row ? { row: other.row, source: `${EDITION_LABEL.tsb2}'s 1993 season (cartridge season 2) has ${other.rom} #${other.number} in that slot` } : null;
    },
  };

  const differs = [];
  for (const season of seasons) {
    const { text: out, kept, placeholders, check } = await snapshotOf(season, context);
    const file = path.join(outDir, `${season.season}.json`);
    const left = placeholders.filter(d => !d.named).length;
    console.log(`${season.season} ${EDITIONS[season.edition].game} (${EDITIONS[season.edition].platform}): ${kept.length} players of `
      + `${new Set(kept.map(p => p.franchise)).size} clubs; unlicensed players ${placeholders.length - left} named, ${left} left out; `
      + `${check.name}: ${check.identical}/${check.compared} identical${check.ratings ? `, ratings ${check.ratings.reproduced}` : ''}`);
    if (checkOnly) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== out) differs.push(path.relative(root, file));
    } else {
      await mkdir(outDir, { recursive: true });
      await writeFile(file, out);
    }
  }
  if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
  console.log(checkOnly ? `Verified ${seasons.length} Tecmo snapshots byte for byte.` : `Wrote ${seasons.length} Tecmo snapshots to ${path.relative(root, outDir)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
}
