// Tennis's regions (docs/design/tennis.md, "Regions"; docs/design/womens-tennis.md, "Regions"): the region of a nation
// of the day, how far each region's players stand from their Elo in their matches against the rest of the world, and
// the levels a newcomer of the amateur sources starts at, by his region and his nation. No I/O:
// scripts/sync-tennis-seasons.mjs passes in the runs.
//
// The regions are continents as the IOC's continental associations group the nations (Israel, Turkey and Cyprus with
// Europe, the Middle East and Central Asia with Asia), Europe split at the Iron Curtain as its circuits were, and the
// Americas into the United States and Canada and the rest:
//   W.Europe   Western Europe, Israel and Turkey
//   E.Europe   the Soviet bloc, Yugoslavia, Albania and their successors (the Caucasus and the Baltic states among them)
//   N.America  the United States and Canada
//   L.America  Mexico, Central America, the Caribbean and South America
//   Asia       East, South, South-East and Central Asia and the Middle East
//   Oceania    Australia, New Zealand and the Pacific
//   Africa     Africa
import { rateMatches } from './tennis-elo.mjs';

export const REGIONS = Object.freeze(['W.Europe', 'E.Europe', 'N.America', 'L.America', 'Asia', 'Oceania', 'Africa']);

// Every code a nation of the day takes in the match files and the pages: the IOC's, the federations' (TCH, URS, YUG,
// FRG, CIS, FRY, SCG), the Davis Cup's old teams (BRI, the British Isles; ANZ, Australasia; CAR and ECA, the Caribbean's),
// and the ISO codes some rows use (DEU, PRY, TWN…). UNK and ITF name no country.
const REGION_CODES = {
  'W.Europe': 'AND AUT BEL BRI CYP DEN DEU ENG ESP FIN FRA FRG GBR GER GRE IRL ISL ISR ITA LIE LUX MLT MON NED NIR NOR POR SCO SMR SUI SWE TUR WAL',
  'E.Europe': 'ALB ARM AZE BGR BIH BLR BUL CIS CRO CZE EST FRY GDR GEO HUN KOS LAT LTU LVA MDA MKD MNE POL ROU RTF RUS SCG SLO SRB SVK TCH UKR URS YUG',
  'N.America': 'CAN USA',
  'L.America': 'AHO ANT ARG ARU BAH BAR BER BHS BIZ BOL BRA CAR CAY CHI CHL COL CRC CRI CUB CUW DMA DOM ECA ECU ESA GLP GRN GTM GUA GUD GUY HAI HON '
    + 'IVB ISV JAM KNA LCA MEX MRN NCA PAN PAR PER PRI PRY PUR SKN SUR TRI TTO URU VEN VIN VIR',
  Asia: 'AFG BAN BHR BRN BRU CAM CEY CHN HKG INA IND IRI IRQ JOR JPN KAZ KGZ KOR KSA KUW LAO LBN LIB MAC MAS MGL MNG MYA NEP NPL OMA PAK PHI '
    + 'PHL PLE PRK QAT RVN SAU SGP SIN SRI SYR THA TJK TKM TPE TWN UAE UZB VIE VNM YEM',
  Oceania: 'ANZ ASM AUS COK FIJ GUM HAW MHL NCL NMI NZL PLW PNG POC SAM SOL TGA VAN',
  Africa: 'ALG ANG BDI BEN BOT BUR BWA CGO CIV CMR COD COG EGY ERI ETH GAB GHA KEN LBA LES MAD MAR MDG MLI MOZ MRI MUS NAM NGA NGR NIG REU RHO '
    + 'RSA RWA SEN SLE SUD SWZ TAN TOG TUN UAR UGA ZAI ZAM ZIM ZMB ZWE',
};
const NO_COUNTRY = new Set(['UNK', 'ITF']);
const REGION_OF = new Map(Object.entries(REGION_CODES).flatMap(([region, codes]) => codes.split(' ').map(code => [code, region])));

/** A nation of the day's region (`REGIONS`), null for none (no code, UNK, ITF); throws on a code it does not know. */
export function regionOfCode(code) {
  if (code == null || NO_COUNTRY.has(code)) return null;
  const region = REGION_OF.get(code);
  if (!region) throw new Error(`No region for the code ${code}: add it to scripts/lib/tennis-regions.mjs`);
  return region;
}

// A major's host: its nation's players are at home there.
const MAJOR_HOSTS = [[/Australian/, 'AUS'], [/Roland Garros|French/, 'FRA'], [/Wimbledon/, 'GBR'], [/US Open|U\.S\. National|US Championships/, 'USA']];
/**
 * Where a match may be a home match for one nation: a major's (its host's players) or a cup tie's (its first-named side:
 * the Davis Cup's files name a tie's host first, and its first side wins 55 to 95 Elo more than Elo expects from 1968 to
 * 2015, 8 to 12 in the Finals at neutral venues from 2019; the Federation Cup of one venue to 1994 has no host side, and
 * its first side's edge comes out near nothing). → { kind: 'major' | 'cup', code } or null.
 */
export function hostOf({ level, eventName }) {
  if (level === 'G') {
    const host = MAJOR_HOSTS.find(([pattern]) => pattern.test(eventName));
    return host ? { kind: 'major', code: host[1] } : null;
  }
  if (level === 'D') {
    const sides = String(eventName).match(/:\s*([A-Z]{3})\s+vs\s+([A-Z]{3})\s*$/);
    if (sides) return { kind: 'cup', code: sides[1] };
  }
  return null;
}

const SLOPE = Math.LN10 / 400;
const logistic = x => 1 / (1 + Math.exp(-x));

/** Solve A x = b (Gaussian elimination with partial pivoting); A and b are copied. */
export function solve(A, b) {
  const n = b.length;
  const M = A.map(row => row.slice()), v = b.slice();
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    [v[c], v[p]] = [v[p], v[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k < n; k++) M[r][k] -= f * M[c][k];
      v[r] -= f * v[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = v[r];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

const round = (x, digits = 1) => Math.round(x * 10 ** digits) / 10 ** digits;

/**
 * How far each region's players stand from their Elo against the other regions' players: the offsets (Elo) that make
 * Elo's odds fit their results, fitted at once with a home edge at the majors and one in the cup ties, each match by the
 * two players' ratings before it (one step ahead). `rows`: `{ level, eventName, we, le, wc, lc }`, the winner's and
 * loser's Elo and nation of the day. A region's offset is measured from the others' mean, weighted by their matches
 * against other regions: −50 says its players won as though they were 50 Elo (two rating points) weaker than their Elo.
 * A region with fewer than `least` matches against the others says too little to measure, and is left out with them.
 * → `{ regions: { [region]: { n, elo, se, points } }, home: { major: { n, elo, se }, cup: { n, elo, se } } }`, `n` its
 * matches against other regions.
 */
export function regionOffsets(rows, { regions: all = REGIONS, least = 20 } = {}) {
  const between = Object.fromEntries(all.map(region => [region, 0]));
  for (const row of rows) {
    const wr = regionOfCode(row.wc), lr = regionOfCode(row.lc);
    if (wr && lr && wr !== lr) { between[wr]++; between[lr]++; }
  }
  const regions = all.filter(region => between[region] >= least);
  const ref = regions[0];
  const free = regions.slice(1);
  const P = free.length + 2, MAJOR = free.length, CUP = free.length + 1;
  const counts = Object.fromEntries(regions.map(region => [region, 0])), homes = { major: 0, cup: 0 };
  const data = [];
  for (const row of rows) {
    const wr = regionOfCode(row.wc), lr = regionOfCode(row.lc);
    if (!regions.includes(wr) || !regions.includes(lr)) continue;
    const x = new Array(P).fill(0);
    if (wr !== lr) {
      if (wr !== ref) x[free.indexOf(wr)] += 1;
      if (lr !== ref) x[free.indexOf(lr)] -= 1;
      counts[wr]++;
      counts[lr]++;
    }
    const host = hostOf(row);
    if (host && (row.wc === host.code) !== (row.lc === host.code)) {
      x[host.kind === 'major' ? MAJOR : CUP] = row.wc === host.code ? 1 : -1;
      homes[host.kind]++;
    }
    if (x.some(value => value)) data.push({ x, gap: (row.we - row.le) * SLOPE });
  }
  // Newton's method on the winners' log-likelihood: each feature in Elo (× slope), the Elo gap a fixed offset.
  const beta = new Array(P).fill(0);
  let info;
  for (let iteration = 0; iteration < 50; iteration++) {
    const grad = new Array(P).fill(0);
    info = Array.from({ length: P }, () => new Array(P).fill(0));
    for (const { x, gap } of data) {
      let z = gap;
      for (let i = 0; i < P; i++) z += beta[i] * x[i] * SLOPE;
      const p = logistic(z), w = p * (1 - p);
      for (let i = 0; i < P; i++) {
        if (!x[i]) continue;
        grad[i] += (1 - p) * x[i] * SLOPE;
        for (let j = 0; j < P; j++) if (x[j]) info[i][j] += w * x[i] * x[j] * SLOPE * SLOPE;
      }
    }
    for (let i = 0; i < P; i++) info[i][i] += 1e-9;
    const step = solve(info, grad);
    let largest = 0;
    for (let i = 0; i < P; i++) { beta[i] += step[i]; largest = Math.max(largest, Math.abs(step[i])); }
    if (largest < 1e-6) break;
  }
  const covariance = info.map((_, i) => solve(info, info.map((__, j) => (i === j ? 1 : 0))));
  const total = regions.reduce((s, region) => s + counts[region], 0);
  const weights = regions.map(region => counts[region] / total);
  const level = regions.map(region => (region === ref ? 0 : beta[free.indexOf(region)]));
  const mean = level.reduce((s, x, i) => s + x * weights[i], 0);
  const out = {};
  regions.forEach((region, i) => {
    if (!counts[region]) return;
    // The offset less the weighted mean, a linear combination c of the parameters: its variance cᵀ Σ c.
    const c = new Array(P).fill(0);
    regions.forEach((other, j) => { if (other !== ref) c[free.indexOf(other)] -= weights[j]; });
    if (region !== ref) c[free.indexOf(region)] += 1;
    let variance = 0;
    for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) variance += c[a] * covariance[a][b] * c[b];
    const elo = level[i] - mean;
    out[region] = { n: counts[region], elo: round(elo), se: round(Math.sqrt(variance)), points: round(elo / 25, 2) };
  });
  const home = kind => ({ n: homes[kind], elo: round(beta[kind === 'major' ? MAJOR : CUP]), se: round(Math.sqrt(covariance[kind === 'major' ? MAJOR : CUP][kind === 'major' ? MAJOR : CUP])) });
  return { regions: out, home: { major: home('major'), cup: home('cup') } };
}

/**
 * The newcomers' levels that best predict every match `score` picks, each by the ratings before it: the run of
 * `matches` by `method` (whose `start.regions` says which newcomers start at their region's and nation's level),
 * maximising its log-likelihood in the levels by Gauss-Newton on their derivatives (rateMatches' `likelihood`), with a
 * normal prior of spread `sigma` on a region's level and `tau` on a nation's (around its region's), the levels
 * averaging zero over the newcomers so that the base start keeps the run's level. `originOf(id, m)` → `{ region, nation }`.
 * → `{ region: { [region]: Elo }, nation: { [code]: Elo }, se: { [key]: Elo }, newcomers, n, ll }`.
 */
export function fitLevels(matches, method, { levelOf, originOf, score, regions = REGIONS, nations, sigma = 150, tau = 100, iterations = 8 }) {
  const keys = [...regions, ...nations.map(code => `nation:${code}`)];
  const P = keys.length;
  const prior = keys.map(key => (key.startsWith('nation:') ? 1 / tau ** 2 : 1 / sigma ** 2));
  let theta = new Array(P).fill(0);
  let result;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const levels = { ...method.start.regions, region: Object.fromEntries(regions.map((region, i) => [region, theta[i]])),
      nation: Object.fromEntries(nations.map((code, i) => [code, theta[regions.length + i]])) };
    const run = rateMatches(matches, { ...method, start: { ...method.start, regions: levels } },
      { levelOf, originOf, likelihood: { regions, nations, score } });
    const { grad, info, newcomers, n, ll } = run.likelihood;
    const counts = keys.map(key => newcomers[key] ?? 0);
    // Newton's step under the constraint Σ newcomers × level = 0: [H c; cᵀ 0] [Δ; μ] = [g; −cᵀθ].
    const A = Array.from({ length: P + 1 }, () => new Array(P + 1).fill(0));
    const b = new Array(P + 1).fill(0);
    for (let i = 0; i < P; i++) {
      for (let j = 0; j < P; j++) A[i][j] = info[i][j] + (i === j ? prior[i] : 0);
      A[i][P] = counts[i];
      A[P][i] = counts[i];
      b[i] = grad[i] - prior[i] * theta[i];
    }
    b[P] = -counts.reduce((s, count, i) => s + count * theta[i], 0);
    const step = solve(A, b);
    let largest = 0;
    for (let i = 0; i < P; i++) {
      const d = Math.max(-150, Math.min(150, step[i]));
      theta[i] += d;
      largest = Math.max(largest, Math.abs(d));
    }
    result = { n, ll, newcomers: Object.fromEntries(keys.map((key, i) => [key, counts[i]])),
      se: Object.fromEntries(keys.map((key, i) => [key, 1 / Math.sqrt(info[i][i] + prior[i])])) };
    if (largest < 0.5) break;
  }
  return { region: Object.fromEntries(regions.map((region, i) => [region, theta[i]])),
    nation: Object.fromEntries(nations.map((code, i) => [code, theta[regions.length + i]])), ...result };
}
