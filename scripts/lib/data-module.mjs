// Writers for the generated football data modules (src/data/rosters.js, src/data/clubs.football.js). Player tuples
// go through src/data/sourceTable.js, and every line's data is a JSON string the module parses at load: JSON.parse
// reads data several times faster than the same object literals cost to compile, and the shared metadata shapes keep
// key names and common values out of every player. One nation or club per line keeps the files reviewable.
import { createTupleTable } from '../../src/data/sourceTable.js';

/** A single-quoted JS string literal holding `value` as JSON (the data as JSON would write it, undefined dropped). */
export const jsonLiteral = value => `'${JSON.stringify(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const asJson = value => JSON.parse(JSON.stringify(value));

/** rosters.js: `rosters` maps a nation id to [strength, pool size, player tuples]; `names` gives each line's comment. */
export function rostersModule(rosters, names, header) {
  const data = asJson(rosters);
  const table = createTupleTable(Object.values(data).flatMap(roster => roster[2]));
  const lines = Object.entries(data).map(([id, [strength, pool, squad]]) =>
    `  '${id}': roster(${jsonLiteral([strength, pool, squad.map(table.pack)])}), // ${names[id]}`);
  return `${header}
import { unpackTuples } from './sourceTable.js';

// Player metadata shapes (keys in order, and the values all of a shape's players share) for the rows below.
const SHAPES = JSON.parse(${jsonLiteral(table.shapes)});
const roster = text => {
  const [strength, pool, rows] = JSON.parse(text);
  return [strength, pool, unpackTuples(rows, SHAPES)];
};

export const ROSTERS = {
${lines.join('\n')}
};
`;
}

/** clubs.football.js: `clubs` are { id, name, code, league, country, col, str, squad: player tuples }, in that key order. */
export function clubsModule(clubs, header) {
  const data = asJson(clubs.map(({ id, name, code, league, country, col, str, squad }) => ({ id, name, code, league, country, col, str, squad })));
  const table = createTupleTable(data.flatMap(club => club.squad));
  const lines = data.map(club => `  club(${jsonLiteral({ ...club, squad: club.squad.map(table.pack) })}),`);
  return `${header}
import { unpackTuples } from './sourceTable.js';

// Player metadata shapes (keys in order, and the values all of a shape's players share) for the rows below.
const SHAPES = JSON.parse(${jsonLiteral(table.shapes)});
const club = text => {
  const data = JSON.parse(text);
  return { ...data, squad: unpackTuples(data.squad, SHAPES) };
};

export const CLUBS = [
${lines.join('\n')}
];
`;
}
