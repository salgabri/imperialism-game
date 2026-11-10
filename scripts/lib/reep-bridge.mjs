// The Reep identity register (CC0, https://reep.football/data) reduced to the person keys the built-in football
// squads use (docs/design/football-squad-identity.md). scripts/sync-reep-bridge.mjs reads Reep's bridges.csv from the
// ignored data-src/reep/ and writes scripts/data/reep-bridge.json: one row per Reep person that holds an EA player id of
// a committed EA snapshot or an FM unique id of the committed FM snapshot, [reepId, [eaIds], [fmIds]], keeping only
// those present ids. scripts/build-rosters.mjs then keys each player by that Reep id (scripts/lib/football-data.mjs,
// resolvePersons), so one real player can neither start twice in an XI nor for two nations.
//
// Rows of bridges.csv are reep_id, provider, namespace, external_id, entity_type, source, method, recipe, confidence,
// timestamp (no header in the cut; a header row is skipped). Only provider eafc or fm with namespace player is read:
// eafc ids are EA/SoFIFA player_ids and fm ids FM unique ids, which EFEM's ids are (Messi: rp8a503e860b7abe holds eafc
// 158023 and fm 7458500). Reep v0's key_sofifa is FIFA.com's id and is never read.
//
// Reep's own manifest for release 2026-10-18.1 reports deterministic_quality.passed: false (precision 99.79%, held-out
// recall 91.98%), so a link is checked before it can merge two records:
// - an external id on two Reep persons is dropped from both;
// - an FM id whose name shares no surname with the person's EA names, or whose age is more than a year off every EA
//   birth date, leaves the person (the EA side keeps the key). Names are folded (diacritics, ı/ł/ø, apostrophes:
//   N'Diaye = Ndiaye), particles and initials dropped, and two tokens agree when equal or one edit apart from four
//   letters, two from eight (romanisations: Al Mousa = Al-Mosa, Batagov = Batahov, Fayzullaev = Fayzullayev); one of the
//   two must be a surname form, the last token or the last two joined (MacNulty = Mac Nulty), so a shared first name
//   alone (Moussa) does not count. On release 2026-10-18.1 that rejects 3 of 4,885 links (Pote, Marezi, Massanga).
//   Rejected links are listed with their reason; scripts/data/football-identity-overrides.json restores the ones
//   verified by hand.
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import path from 'node:path';
import { ageOn, fmAgeDate, parseCsv } from './football-data.mjs';

/** The committed snapshots whose ids the bridge keeps: the built-in season's EA FC 27 and FM 26, and EA FC 26 (the
 * 2025/26 season, and the earlier edition of every FC 27 record), so a Reep person's records in any of them are known. */
export const REEP_SOURCES = {
  ea: ['scripts/data/ea-fc27.csv', 'scripts/data/ea-fc26.csv'],
  fm: ['scripts/data/fm26-players.json'],
};
/** The pair the built-in season joins (scripts/build-rosters.mjs). */
export const BUILT_IN_PAIR = { ea: 'scripts/data/ea-fc27.csv', fm: 'scripts/data/fm26-players.json' };
const COLUMNS = 10;
const PROVIDERS = { eafc: 'ea', fm: 'fm' };

// Letters NFD does not decompose.
const FOLD = { Ø: 'O', ø: 'o', Đ: 'D', đ: 'd', Ð: 'D', ð: 'd', Ł: 'L', ł: 'l', ı: 'i', ß: 'ss',
  Æ: 'AE', æ: 'ae', Œ: 'OE', œ: 'oe', Þ: 'Th', þ: 'th', Ħ: 'H', ħ: 'h' };
const PARTICLES = new Set(['al', 'el', 'bin', 'ibn', 'de', 'da', 'do', 'dos', 'das', 'di', 'du', 'del', 'la', 'le',
  'van', 'von', 'der', 'den', 'jr', 'junior']);
/** Folded name tokens: no diacritics, apostrophes or particles; initials dropped. Names EA glued together
 * ("GuangtaiTyias") split at a capital after three lower-case letters, which leaves McKenna and DeAndre whole. */
export const foldTokens = name => name.replace(/^\p{L}\.\s+/u, '').replace(/(\p{Ll}{3})(\p{Lu})/gu, '$1 $2')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ØøĐđÐðŁłıßÆæŒœÞþĦħ]/g, c => FOLD[c]).toLowerCase()
  .replace(/['’`ʻ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
  .filter(token => token.length >= 2 && !PARTICLES.has(token));
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
/** Equal, or a romanisation apart: one edit for tokens of four to seven letters (Mosa/Mousa, Michail/Michael,
 * Batahov/Batagov), two from eight (Shanqiti/Shanqeeti). Shorter tokens must be equal. */
export const similar = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && editDistance(a, b) <= (Math.min(a.length, b.length) >= 8 ? 2 : 1));
// A name's tokens plus its last two joined (FM "Mac Nulty" = EA "MacNulty"); tokens from index length - 1 on are its
// surname forms.
const surnameForms = tokens => (tokens.length >= 2 ? [...tokens, tokens.slice(-2).join('')] : tokens);
/** True when an FM name shares a surname with any EA name form (short, long, legal): a token similar to an EA token,
 * where one of the two is a surname form (the last token, or the last two joined). */
export function namesAgree(eaNames, fmName) {
  const fmTokens = foldTokens(fmName), fm = surnameForms(fmTokens);
  const forms = eaNames.map(foldTokens).filter(tokens => tokens.length).map(tokens => [surnameForms(tokens), tokens.length - 1]);
  return fm.some((token, i) => forms.some(([form, last]) => form.some((other, j) =>
    similar(token, other) && (i >= fmTokens.length - 1 || j >= last))));
}

/** Every EA and FM record of the REEP_SOURCES files under `root`, by bare id, with each file's ids. */
export async function loadSourceRecords(root, sources = REEP_SOURCES) {
  const ea = new Map(), fm = new Map(), files = [];
  for (const file of sources.ea) {
    const [header, ...rows] = parseCsv(await readFile(path.join(root, file), 'utf8'));
    const col = Object.fromEntries(header.map((name, i) => [name, i]));
    const ids = new Set();
    for (const row of rows) {
      const id = Number(row[col.player_id]);
      if (!Number.isInteger(id) || id <= 0) throw new Error(`${file}: invalid player_id ${row[col.player_id]}`);
      const record = ea.get(id) || { names: new Set(), dobs: new Set() };
      for (const name of [row[col.short_name], row[col.long_name], col.reference_long_name === undefined ? '' : row[col.reference_long_name]]) {
        if (name?.trim()) record.names.add(name.trim());
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(row[col.dob] || '')) record.dobs.add(row[col.dob]);
      ea.set(id, record);
      ids.add(id);
    }
    files.push({ file, kind: 'ea', ids });
  }
  for (const file of sources.fm) {
    const snapshot = JSON.parse(await readFile(path.join(root, file), 'utf8'));
    const ageDate = fmAgeDate(snapshot.source.databaseDate), ids = new Set();
    for (const player of snapshot.players) {
      const known = fm.get(player.id);
      if (known && (known.name !== player.name || known.age !== player.age || known.ageDate !== ageDate)) throw new Error(`FM ${player.id} differs between snapshots`);
      fm.set(player.id, { name: player.name, age: player.age, ageDate });
      ids.add(player.id);
    }
    files.push({ file, kind: 'fm', ids });
  }
  return { ea, fm, files };
}

/** Reep player bridges of eafc and fm from bridges.csv (or .csv.gz): Map reepId -> { ea: Set, fm: Set }. */
export async function readReepBridges(file) {
  let input = createReadStream(file);
  if (file.endsWith('.gz')) input = input.pipe(createGunzip());
  const persons = new Map();
  let rows = 0, kept = 0;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line) continue;
    const fields = line.includes('"') ? parseCsv(line)[0] : line.split(',');
    if (fields[0] === 'reep_id') continue;
    rows++;
    if (fields.length !== COLUMNS) throw new Error(`${file}: row ${rows} has ${fields.length} fields; expected ${COLUMNS}`);
    const [reepId, provider, namespace, externalId] = fields;
    if (!PROVIDERS[provider] || namespace !== 'player') continue;
    if (!/^rp[0-9a-f]{14}$/.test(reepId) || !/^\d+$/.test(externalId)) throw new Error(`${file}: row ${rows} is not a Reep player bridge: ${line}`);
    const person = persons.get(reepId) || { ea: new Set(), fm: new Set() };
    person[PROVIDERS[provider]].add(Number(externalId));
    persons.set(reepId, person);
    kept++;
  }
  if (!kept) throw new Error(`${file}: no eafc or fm player bridges`);
  return { persons, rows, kept };
}

const percent = (part, whole) => Math.round(part / whole * 1000) / 10;

/** The reduced bridge: present ids only, checked links, deterministic order. `input` describes the bridges file read
 * (file, sha256, bytes, cut) and is recorded beside the release. */
export function reduceBridges(reep, sources, { release, input }) {
  const owners = { ea: new Map(), fm: new Map() };
  for (const [reepId, person] of reep.persons) {
    for (const kind of ['ea', 'fm']) {
      for (const id of person[kind]) owners[kind].set(id, [...(owners[kind].get(id) || []), reepId]);
    }
  }
  const rejected = [], persons = [];
  for (const reepId of [...reep.persons.keys()].sort()) {
    const person = reep.persons.get(reepId);
    const present = kind => [...person[kind]].filter(id => sources[kind].has(id)).sort((a, b) => a - b);
    let ea = present('ea'), fm = present('fm');
    if (!ea.length && !fm.length) continue;
    for (const kind of ['ea', 'fm']) {
      const shared = (kind === 'ea' ? ea : fm).filter(id => owners[kind].get(id).length > 1);
      if (!shared.length) continue;
      rejected.push({ reep: reepId, ea: kind === 'ea' ? shared : [], fm: kind === 'fm' ? shared : [],
        reason: `${kind.toUpperCase()} id on ${owners[kind].get(shared[0]).length} Reep persons` });
      if (kind === 'ea') ea = ea.filter(id => !shared.includes(id)); else fm = fm.filter(id => !shared.includes(id));
    }
    if (ea.length > 1 || fm.length > 1) {
      // None in release 2026-10-18.1; a person with two records of one source would field once, so look at it before
      // trusting it.
      throw new Error(`Reep person ${reepId} links ${ea.length} EA and ${fm.length} FM ids of the snapshots; review it`);
    }
    if (ea.length && fm.length) {
      const record = sources.ea.get(ea[0]), player = sources.fm.get(fm[0]);
      const names = [...record.names];
      const ages = [...record.dobs].map(dob => ageOn(dob, player.ageDate));
      const reason = !namesAgree(names, player.name) ? `names share no surname: EA ${names.map(name => JSON.stringify(name)).join(' / ')}, FM ${JSON.stringify(player.name)}`
        : !ages.some(age => Math.abs(age - player.age) <= 1) ? `ages differ: EA born ${[...record.dobs].join(', ')} (${ages.join(', ')} on ${player.ageDate}), FM ${player.age}`
          : null;
      if (reason) {
        rejected.push({ reep: reepId, ea, fm, reason });
        fm = [];
      }
    }
    if (ea.length || fm.length) persons.push([reepId, ea, fm]);
  }
  const linked = { ea: new Set(persons.flatMap(person => person[1])), fm: new Set(persons.flatMap(person => person[2])) };
  const coverage = Object.fromEntries(sources.files.map(({ file, kind, ids }) => {
    const count = [...ids].filter(id => linked[kind].has(id)).length;
    return [path.basename(file), { records: ids.size, linked: count, percent: percent(count, ids.size) }];
  }));
  const idsOf = file => sources.files.find(row => row.file === file).ids;
  const [pairEa, pairFm] = [idsOf(BUILT_IN_PAIR.ea), idsOf(BUILT_IN_PAIR.fm)];
  coverage.builtInPairs = persons.filter(([, eaIds, fmIds]) => eaIds.some(id => pairEa.has(id)) && fmIds.some(id => pairFm.has(id))).length;
  return {
    source: { provider: 'Reep', release, license: 'CC0-1.0', url: 'https://reep.football/data', input,
      note: 'Reep v1 bridges.csv, eafc and fm player bridges only. eafc ids are EA/SoFIFA player_ids, fm ids FM unique ids (EFEM ids). '
        + 'Only ids present in a committed EA CSV or FM snapshot of REEP_SOURCES (scripts/lib/reep-bridge.mjs) are kept; re-run npm run sync:reep-bridge when a snapshot changes. '
        + 'The release manifest reports deterministic_quality.passed: false, so each EA–FM link is checked for a shared surname and an FM age within a year of the EA birth date; failures are listed under rejected and their FM id leaves the person. '
        + 'Reep withholds people under 18. CC0 covers Reep\'s compilation, not the third-party source data.' },
    generator: 'npm run sync:reep-bridge',
    columns: ['reepId', 'eaIds', 'fmIds'],
    counts: { persons: persons.length, eaIds: linked.ea.size, fmIds: linked.fm.size,
      pairs: persons.filter(([, ea, fm]) => ea.length && fm.length).length, rejected: rejected.length,
      bridgeRows: reep.rows, playerBridges: reep.kept },
    coverage,
    rejected,
    persons,
  };
}

/** Compact, line-per-person JSON. */
export function serializeBridge(bridge) {
  const { persons, ...head } = bridge;
  const text = JSON.stringify(head, null, 2);
  return `${text.slice(0, -2)},\n  "persons": [\n${persons.map(person => `    ${JSON.stringify(person)}`).join(',\n')}\n  ]\n}\n`;
}
