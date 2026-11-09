// Which clubs of a CM 01/02-format database stood in East Germany (docs/design/football-years.md, "The fan-made
// databases"): Simon Treanor's 1989/90 database files East Germans as 'Germany', and in 1989/90 a German at an East
// German club was East German, of a federation with no shape on the map, so he plays for no nation. A club is East
// German when its stadium's city (the database's own stadium and city records) lies in East Germany: every German
// place of that name in GeoNames' cities1000 (CC BY 4.0) is in one of the five eastern states (admin1 11 to 15), or the
// club is listed by hand below (East Berlin's, and the towns the gazetteer leaves open). A club neither places in the
// east counts as West German. No I/O here: tests and scripts read the files.

/** GeoNames' admin1 codes of the five eastern states: Brandenburg, Mecklenburg-Vorpommern, Saxony, Saxony-Anhalt, Thuringia. */
export const EASTERN_STATES = Object.freeze(['11', '12', '13', '14', '15']);

/** East German clubs the gazetteer does not settle: Berlin's (state 16) and towns it names twice or not at all. */
export const EAST_GERMAN_BY_HAND = Object.freeze({
  'FC Dynamo Berlin': 'Hohenschönhausen, East Berlin',
  '1.FC Union Berlin': 'Köpenick, East Berlin',
  'KWO Berlin': 'Oberschöneweide, East Berlin',
  'BSG Rotation Berlin': 'East Berlin',
  'SG Bergmann-Borsig': 'Wilhelmsruh, East Berlin',
  'Hallescher FC': 'Halle (Saale), Saxony-Anhalt (the gazetteer also has a Halle in Lower Saxony and one in North Rhine-Westphalia)',
  'FC Union Mühlhausen': 'Mühlhausen, Thuringia (the gazetteer also has Mühlhausens in Baden-Württemberg and Bavaria)',
  'Schwarz-Rot Neustadt/Dosse': 'Neustadt (Dosse), Brandenburg (the gazetteer has no "Neustadt/Dosse")',
  'TSG Markkleeberg': 'Markkleeberg, Saxony (the database gives the club no stadium)',
});

const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
const latin1 = (bytes, at, length) => {
  let end = at;
  while (end < at + length && bytes[end] !== 0) end++;
  return Buffer.from(bytes.subarray(at, end)).toString('latin1').trim();
};
const fileNamed = (files, name) => files[Object.keys(files).find(key => key.toLowerCase() === name)];

/** A table of fixed-size records whose first field is the record's own row (CM 01/02's layout), checked. */
function records(bytes, size, label) {
  if (!bytes || bytes.length % size) throw new Error(`${label} is not whole records of ${size} bytes`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length / size;
  for (let row = 0; row < count; row++) if (view.getInt32(row * size, true) !== row) throw new Error(`${label} record ${row} is not row ${row}`);
  return { view, count };
}

/**
 * Each club's stadium city, by club row: `Map(row → city name or null)`. The club record (581 bytes) links its stadium
 * at byte 105; a stadium record (78 bytes) links its city at byte 56; a city record (56 bytes) has its name at byte 4.
 */
export function clubCities(files, clubs) {
  const club = fileNamed(files, 'club.dat'), stadium = fileNamed(files, 'stadium.dat'), city = fileNamed(files, 'city.dat');
  const clubTable = records(club, 581, 'club.dat'), stadiums = records(stadium, 78, 'stadium.dat'), cities = records(city, 56, 'city.dat');
  const out = new Map();
  for (const { row } of clubs) {
    const at = clubTable.view.getInt32(row * 581 + 105, true);
    const cityRow = at >= 0 && at < stadiums.count ? stadiums.view.getInt32(at * 78 + 56, true) : -1;
    out.set(row, cityRow >= 0 && cityRow < cities.count ? latin1(city, cityRow * 56 + 4, 51) : null);
  }
  return out;
}

/** German places of GeoNames' cities1000.txt: `Map(folded name → Set of admin1 codes)`, by name, ASCII name and alternate names. */
export function germanPlaces(text) {
  const places = new Map();
  for (const line of text.split('\n')) {
    const field = line.split('\t');
    if (field[8] !== 'DE') continue;
    for (const name of new Set([field[1], field[2], ...(field[3] ? field[3].split(',') : [])].map(fold))) {
      (places.get(name) || places.set(name, new Set()).get(name)).add(field[10]);
    }
  }
  return places;
}

/**
 * The East German clubs among `clubs` (the database's clubs of nation `germany`, `{ row, name }`), sorted by name, and
 * how each club was placed: `{ east: [name], placed: [{ name, city, by: 'gazetteer' | 'hand' | null }] }`.
 */
export function eastGermanClubs({ files, clubs, places, byHand = EAST_GERMAN_BY_HAND }) {
  const cities = clubCities(files, clubs);
  const east = new Set(), placed = [];
  for (const club of clubs) {
    const city = cities.get(club.row);
    const states = city ? places.get(fold(city)) : null;
    const gazetteer = !!states?.size && [...states].every(state => EASTERN_STATES.includes(state));
    const hand = Object.hasOwn(byHand, club.name);
    if (gazetteer || hand) east.add(club.name);
    placed.push({ name: club.name, city, by: gazetteer ? 'gazetteer' : hand ? 'hand' : null });
  }
  for (const name of Object.keys(byHand)) if (!clubs.some(club => club.name === name)) throw new Error(`EAST_GERMAN_BY_HAND names ${name}, which is no club given`);
  return { east: [...east].sort(), placed };
}
