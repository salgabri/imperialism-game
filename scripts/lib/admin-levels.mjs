// The administrative levels a country's land is split along when clubs share it (scripts/build-europe-maps.mjs; docs/
// design/domestic-campaigns.md, "The Europe maps"): for every European country, its regions, then its provinces,
// departments or counties, then its communes (municipalities, parishes, cadastral areas), as deep as the sources go.
// A club alone in a region holds all of it; two or more split it along its next level down, and so on to the communes.
// The table is checked against the geoBoundaries metadata whenever a country is loaded: a level the source has must be
// used or skipped for a stated reason. `nestLevels` makes the levels nest where the sources draw them apart.
import { kmToPolys } from './domestic-partition.mjs';

/**
 * Natural Earth admin-1's grouping of the home nations' councils (`region_sub`: England's ceremonial and metropolitan
 * counties, Scotland's old regions, Wales's four), which geoBoundaries has no level for. (Its `region` is their
 * statistical regions, which the split leaves out.)
 */
export const NE_COUNTY = 'NE:region_sub';
/** England's districts, below the counties and unitary authorities geoBoundaries stops at: the ONS's (ONS_LAD_URL). */
export const ONS_DISTRICTS = 'ONS:LAD';
const SAME_COUNCILS = 'the same councils and unitary authorities as ADM2';
const HOME_NATIONS = 'the four home nations: the part of the United Kingdom the map takes';

/**
 * Each country a club may share, by its world shape: its geoBoundaries layer (`iso3`, and the `part` of it a home
 * nation is) and its administrative `levels`, coarsest first, down to the finest the sources have. Every level is
 * geoBoundaries' (ADM1 …), but the home nations' counties, which only Natural Earth's admin-1 file groups their councils
 * into (NE_COUNTY), and England's districts (ONS_DISTRICTS). `skip` names each geoBoundaries level left out, and why.
 * `within` keeps a country's clubs on part of it (WITHIN). A country with one club needs none of this: it holds its
 * whole world shape; East Germany has no world shape, as no season with clubs predates 1990.
 */
export const COUNTRIES = {
  // England: its ceremonial and metropolitan counties (Greater Manchester, Merseyside, Lancashire), its unitary
  // authorities, boroughs and two-tier counties, then those counties' districts (Lancashire's Preston, Burnley …). Its
  // nine regions (Natural Earth's `region`) are statistical, as Italy's groups of regions are, and would shut its
  // crowded North West and London in on themselves.
  826: { iso3: 'GBR', part: 'GB-ENG', levels: [NE_COUNTY, 'ADM2', ONS_DISTRICTS], skip: { ADM1: HOME_NATIONS, ADM3: SAME_COUNCILS } },
  // Scotland: its old regions (Strathclyde's parts, Lothian, Tayside, Grampian …), then its council areas (single-tier:
  // nothing below them). Natural Earth's `region` is its four statistical regions.
  SCO: { iso3: 'GBR', part: 'GB-SCT', levels: [NE_COUNTY, 'ADM2'], skip: { ADM1: HOME_NATIONS, ADM3: SAME_COUNCILS } },
  // Wales: North, Mid, South and West Wales, then its principal areas. (Natural Earth's `region` for Wales is the two
  // statistical regions, with their names swapped: its "East Wales" holds Swansea and Gwynedd.)
  WAL: { iso3: 'GBR', part: 'GB-WLS', levels: [NE_COUNTY, 'ADM2'], skip: { ADM1: HOME_NATIONS, ADM3: SAME_COUNCILS } },
  // Northern Ireland: its eleven districts (Natural Earth's groups are of the 26 districts before 2015).
  NIR: { iso3: 'GBR', part: 'GB-NIR', levels: ['ADM2'], skip: { ADM1: HOME_NATIONS, ADM3: SAME_COUNCILS } },
  // Communities, provinces, municipalities.
  724: { iso3: 'ESP', levels: ['ADM1', 'ADM2', 'ADM3'] },
  // Regions, provinces, comuni.
  380: { iso3: 'ITA', levels: ['ADM2', 'ADM3', 'ADM4'], skip: { ADM1: 'five statistical groups of regions (NUTS 1) above the regions' } },
  // Länder, Regierungsbezirke, Kreise (the source has no Gemeinden).
  276: { iso3: 'DEU', levels: ['ADM1', 'ADM2', 'ADM3'] },
  // Régions, départements, arrondissements, communes (Paris, Lyon and Marseille by their municipal arrondissements).
  250: { iso3: 'FRA', levels: ['ADM1', 'ADM2', 'ADM3', 'ADM5'], skip: { ADM4: 'cantons, which cross arrondissement lines (9% of the land)' } },
  // Provinces, municipalities.
  528: { iso3: 'NLD', levels: ['ADM1', 'ADM2'] },
  // Districts and autonomous regions, municipalities, parishes (freguesias); 158 of the parishes come in pieces, each its
  // own unit (`pieces`), or a parish would join land that does not join and scatter its club's land in specks.
  620: { iso3: 'PRT', levels: ['ADM1', 'ADM2', 'ADM3'], pieces: true },
  // Provinces, districts.
  792: { iso3: 'TUR', levels: ['ADM1', 'ADM2'] },
  // Regions, provinces, arrondissements, communes.
  '056': { iso3: 'BEL', levels: ['ADM1', 'ADM2', 'ADM3', 'ADM4'] },
  // Counties, municipalities, districts (the old parishes).
  752: { iso3: 'SWE', levels: ['ADM1', 'ADM2', 'ADM3'] },
  // Decentralized administrations, regions, municipalities.
  300: { iso3: 'GRC', levels: ['ADM1', 'ADM2', 'ADM3'] },
  // Regions, districts, municipalities, cadastral areas (Prague's Bubeneč, Vršovice …).
  203: { iso3: 'CZE', levels: ['ADM1', 'ADM2', 'ADM3', 'ADM4'] },
  // Regions, municipalities.
  208: { iso3: 'DNK', levels: ['ADM1', 'ADM2'] },
  // Oblasts, raions, village councils.
  804: { iso3: 'UKR', levels: ['ADM1', 'ADM2', 'ADM3'] },
  // Districts, municipalities (Belgrade is one).
  688: { iso3: 'SRB', levels: ['ADM1', 'ADM2'] },
  // Districts, subdistricts.
  376: { iso3: 'ISR', levels: ['ADM1', 'ADM2'] },
  // Federal subjects, districts; European Russia only (WITHIN).
  643: { iso3: 'RUS', levels: ['ADM1', 'ADM2'], within: 'EUROPEAN_RUSSIA' },
  // Cantons, districts, communes.
  756: { iso3: 'CHE', levels: ['ADM1', 'ADM2', 'ADM3'] },
  // Counties, municipalities.
  578: { iso3: 'NOR', levels: ['ADM1', 'ADM2'] },
  // States, districts, municipalities, their parts (Vienna's districts).
  '040': { iso3: 'AUT', levels: ['ADM1', 'ADM2', 'ADM3', 'ADM4'] },
  // Counties, municipalities.
  191: { iso3: 'HRV', levels: ['ADM1', 'ADM2'] },
  // The two statistical cohesion regions (its only level above the municipalities), municipalities.
  705: { iso3: 'SVN', levels: ['ADM1', 'ADM2'] },
  // Counties, municipalities, elderships.
  440: { iso3: 'LTU', levels: ['ADM1', 'ADM2', 'ADM3'] },
  // The rest of Europe, for the first season to put two of its clubs on a map.
  '008': { iso3: 'ALB', levels: ['ADM1', 'ADM2', 'ADM3'] },
  '051': { iso3: 'ARM', levels: ['ADM1', 'ADM2'] },
  '031': { iso3: 'AZE', levels: ['ADM1', 'ADM2'] },
  112: { iso3: 'BLR', levels: ['ADM1', 'ADM2'] },
  '070': { iso3: 'BIH', levels: ['ADM1', 'ADM2', 'ADM3'] },
  100: { iso3: 'BGR', levels: ['ADM1', 'ADM2'] },
  196: { iso3: 'CYP', levels: ['ADM1', 'ADM2'] },
  233: { iso3: 'EST', levels: ['ADM1', 'ADM2', 'ADM3'] },
  246: { iso3: 'FIN', levels: ['ADM1', 'ADM2', 'ADM3'] },
  268: { iso3: 'GEO', levels: ['ADM1', 'ADM2'] },
  348: { iso3: 'HUN', levels: ['ADM1', 'ADM2', 'ADM3'] },
  352: { iso3: 'ISL', levels: ['ADM1', 'ADM2'] },
  372: { iso3: 'IRL', levels: ['ADM1', 'ADM2'] },
  398: { iso3: 'KAZ', levels: ['ADM1', 'ADM2'] },
  KOS: { iso3: 'XKX', levels: ['ADM1', 'ADM2'] },
  428: { iso3: 'LVA', levels: ['ADM1', 'ADM2'] },
  442: { iso3: 'LUX', levels: ['ADM1', 'ADM2'], skip: { ADM3: '102 communes of another year, which do not nest in its 105 (7% of the land)' } },
  498: { iso3: 'MDA', levels: ['ADM1'] },
  499: { iso3: 'MNE', levels: ['ADM1'] },
  807: { iso3: 'MKD', levels: ['ADM1', 'ADM2'] },
  616: { iso3: 'POL', levels: ['ADM1', 'ADM2', 'ADM3'] },
  642: { iso3: 'ROU', levels: ['ADM1', 'ADM2'] },
  703: { iso3: 'SVK', levels: ['ADM1', 'ADM2', 'ADM3', 'ADM4'] },
};

/**
 * The land a country's clubs may hold where it is not the whole country (`within` in COUNTRIES): its ADM1 regions by ISO
 * code. Russia's clubs hold European Russia only, the federal subjects of its Central, Northwestern, Southern, North
 * Caucasian and Volga federal districts, west of the Urals; the rest of Russia lies beneath the map, grey, like a
 * country with no club. Its whole would put a club's land on the Pacific and frame Eurasia.
 */
export const WITHIN = {
  EUROPEAN_RUSSIA: [
    'RU-BEL', 'RU-BRY', 'RU-VLA', 'RU-VOR', 'RU-IVA', 'RU-KLU', 'RU-KOS', 'RU-KRS', 'RU-LIP', 'RU-MOS', 'RU-MOW', 'RU-ORL', 'RU-RYA',
    'RU-SMO', 'RU-TAM', 'RU-TVE', 'RU-TUL', 'RU-YAR',
    'RU-KR', 'RU-KO', 'RU-ARK', 'RU-NEN', 'RU-VLG', 'RU-KGD', 'RU-LEN', 'RU-SPE', 'RU-MUR', 'RU-NGR', 'RU-PSK',
    'RU-AD', 'RU-KL', 'RU-KDA', 'RU-AST', 'RU-VGG', 'RU-ROS',
    'RU-DA', 'RU-IN', 'RU-KB', 'RU-KC', 'RU-SE', 'RU-CE', 'RU-STA',
    'RU-BA', 'RU-ME', 'RU-MO', 'RU-TA', 'RU-UD', 'RU-CU', 'RU-PER', 'RU-KIR', 'RU-NIZ', 'RU-ORE', 'RU-PNZ', 'RU-SAM', 'RU-SAR', 'RU-ULY',
  ],
};

/** Natural Earth's name for each home nation (`geonunit`). */
export const NE_PARTS = { 'GB-ENG': 'England', 'GB-SCT': 'Scotland', 'GB-WLS': 'Wales', 'GB-NIR': 'Northern Ireland' };
/** Natural Earth puts Wigan, one of Greater Manchester's ten boroughs, in Merseyside. */
export const NE_FIXES = { 'GB-WGN': { region_sub: 'Greater Manchester' } };

/** A level's place from coarse to fine: Natural Earth's groups first, then ADM1 …, England's districts last. */
export const levelRank = level => (level.startsWith('NE:') ? 0 : level === ONS_DISTRICTS ? 9 : Number(level.slice(3)));

/**
 * The levels of `spec` checked against the geoBoundaries rows of its country (`boundaryType` ADM0, ADM1 …): each of its
 * levels must exist, coarsest first, and each level the rows hold must be used or skipped. A home nation's `part` and
 * Russia's `within` read ADM1 for that and need not use it. Throws, naming the country, at the first problem.
 */
export function checkLevels(shapeId, spec, rows) {
  const have = new Set(rows.map(row => row.boundaryType));
  const name = `${shapeId} (${spec.iso3})`;
  if (!spec.levels?.length) throw new Error(`${name}: no levels`);
  spec.levels.forEach((level, i) => {
    if (level === ONS_DISTRICTS && spec.iso3 !== 'GBR') throw new Error(`${name}: the ONS's districts are the United Kingdom's`);
    if (/^ADM\d$/.test(level) && !have.has(level)) throw new Error(`${name}: geoBoundaries has no ${level} layer`);
    if (!/^ADM\d$/.test(level) && !level.startsWith('NE:') && level !== ONS_DISTRICTS) throw new Error(`${name}: no source has a level ${level}`);
    if (i && levelRank(level) <= levelRank(spec.levels[i - 1]) && !(level.startsWith('NE:') && spec.levels[i - 1].startsWith('NE:'))) {
      throw new Error(`${name}: ${level} comes after ${spec.levels[i - 1]}, so the levels are not coarsest first`);
    }
  });
  if (spec.levels.at(-1).startsWith('NE:')) throw new Error(`${name}: the finest level must be geoBoundaries' or the ONS's`);
  for (const level of Object.keys(spec.skip ?? {})) {
    if (spec.levels.includes(level)) throw new Error(`${name}: ${level} is both used and skipped`);
  }
  const unused = [...have].filter(level => level !== 'ADM0' && !spec.levels.includes(level) && !spec.skip?.[level]
    && !(level === 'ADM1' && (spec.part || spec.within)));
  if (unused.length) throw new Error(`${name}: geoBoundaries has ${unused.join(', ')}, which COUNTRIES neither uses nor skips`);
}

/**
 * Natural Earth admin-1 features grouped by one field (`region`, `region_sub`) for a home nation: `[{ id, name, polys }]`,
 * in the order the field's values first appear. `polysOf` turns a feature's geometry into polygons.
 */
export function naturalEarthGroups(features, spec, field, polysOf) {
  const nation = NE_PARTS[spec.part];
  if (!nation) throw new Error(`${spec.iso3}: Natural Earth levels are for the home nations, not ${spec.part ?? 'the whole country'}`);
  const groups = new Map();
  for (const f of features) {
    if (f.properties.adm0_a3 !== spec.iso3 || f.properties.geonunit !== nation) continue;
    const props = { ...f.properties, ...NE_FIXES[f.properties.iso_3166_2] };
    const name = props[field];
    if (!name) throw new Error(`Natural Earth ${f.properties.name} (${nation}) has no ${field}`);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(...polysOf(f.geometry));
  }
  if (!groups.size) throw new Error(`Natural Earth has no ${nation}`);
  return [...groups].map(([name, polys], i) => ({ id: `${field}-${i}`, name, polys }));
}

/**
 * Makes each unit's regions nest. `assign[k][u]` is unit u's region at level k (coarsest first; found by the unit's
 * interior point), `levels[k][r].polys` region r's shape, `points[u]` the unit's interior point and `areas[u]` its area.
 * The sources draw the levels apart (Portugal's municipalities are a few dozen points each, its parishes thousands), so
 * a unit can fall in a region whose land lies mostly in another parent than the unit's own. Top-down, each region
 * belongs to the parent holding most of its land, and a unit whose region belongs to another parent moves to the
 * nearest region of its own parent; where that parent has none at this level, the unit keeps its region, which then
 * also stands under that parent. With the units' `adjacency`, a region is then made one piece where land joins it: a
 * part cut off from the rest of its region (by area) that borders other regions of the same parent joins the one it
 * borders most, as a parish the crude municipal layer put in the next municipality does; a part across the water stays.
 * Changes `assign` in place and returns the number of units moved.
 */
export function nestLevels(levels, assign, points, areas, adjacency = null) {
  let moved = 0;
  for (let k = 0; k < levels.length; k++) {
    if (k) moved += nestLevel(levels, assign, points, areas, k);
    if (adjacency) moved += joinCutOff(assign, areas, adjacency, k);
  }
  return moved;
}

/** Level k's regions in one piece where land joins them (nestLevels). */
function joinCutOff(assign, areas, adjacency, k) {
  const n = areas.length;
  const keyOf = u => `${k ? assign[k - 1][u] : 0}|${assign[k][u]}`;
  const seen = new Uint8Array(n);
  const byRegion = new Map();
  for (let u = 0; u < n; u++) {
    if (seen[u]) continue;
    const key = keyOf(u), part = [u];
    seen[u] = 1;
    for (let i = 0; i < part.length; i++) for (const v of adjacency[part[i]]) if (!seen[v] && keyOf(v) === key) { seen[v] = 1; part.push(v); }
    if (!byRegion.has(key)) byRegion.set(key, []);
    byRegion.get(key).push({ part, area: part.reduce((sum, v) => sum + areas[v], 0) });
  }
  let moved = 0;
  for (const parts of byRegion.values()) {
    if (parts.length < 2) continue;
    parts.sort((a, b) => b.area - a.area || a.part[0] - b.part[0]);
    for (const { part } of parts.slice(1)) {
      const parent = k ? assign[k - 1][part[0]] : 0, own = assign[k][part[0]], inPart = new Set(part);
      const touching = new Map();
      for (const u of part) for (const v of adjacency[u]) {
        if (inPart.has(v) || (k && assign[k - 1][v] !== parent) || assign[k][v] === own) continue;
        touching.set(assign[k][v], (touching.get(assign[k][v]) || 0) + 1);
      }
      if (!touching.size) continue;
      const [to] = [...touching].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      for (const u of part) assign[k][u] = to;
      moved += part.length;
    }
  }
  return moved;
}

/** Level k's regions made to nest in level k - 1's (nestLevels). */
function nestLevel(levels, assign, points, areas, k) {
  let moved = 0;
  const tally = new Map();
  assign[k].forEach((r, u) => {
    if (!tally.has(r)) tally.set(r, new Map());
    const byParent = tally.get(r), p = assign[k - 1][u];
    byParent.set(p, (byParent.get(p) || 0) + areas[u]);
  });
  const parentOf = new Map(), childrenOf = new Map();
  for (const [r, byParent] of [...tally].sort((a, b) => a[0] - b[0])) {
    const [p] = [...byParent].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    parentOf.set(r, p);
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(r);
  }
  assign[k].forEach((r, u) => {
    const p = assign[k - 1][u];
    if (parentOf.get(r) === p || !childrenOf.has(p)) return;
    let best = -1, bestKm = Infinity;
    for (const c of childrenOf.get(p)) {
      const km = kmToPolys(points[u], levels[k][c].polys);
      if (km < bestKm) { bestKm = km; best = c; }
    }
    assign[k][u] = best;
    moved++;
  });
  return moved;
}
