// The world map as it stood in a season's year (docs/design/historic-maps.md). Both atlases keep today's shapes in
// `countries` and the shapes of earlier years in `historic` (scripts/lib/historic-shapes.mjs): each historic geometry
// replaces today's shape of its id, or joins the map after the one before it, for the seasons up to its last year
// (`properties.through`, a season-end year). Today's map is the atlas itself, untouched, so a campaign of today's
// season decodes exactly as before. A season's year is its `dataYear` (1974 for 1973/74, 1990 for the 1990 Davis Cup);
// the built-in current season has none and plays today's map.

import { CAPITALS } from '../data/capitals.js';

const historicOf = atlas => (atlas?.objects?.historic?.type === 'GeometryCollection' ? atlas.objects.historic.geometries || [] : []);
const covers = (geometry, year) => year != null && year <= Number(geometry.properties?.through)
  && !(year < Number(geometry.properties?.from));

/**
 * Which of the atlas's historic shapes stand in `year`, as a key: '' for today's map (none do, or no year), else
 * 'historic:' and their places in the historic collection. Two years with the same key draw the same map.
 */
export function mapEraOf(atlas, year) {
  const standing = historicOf(atlas).flatMap((geometry, i) => (covers(geometry, year) ? [i] : []));
  return standing.length ? `historic:${standing.join(',')}` : '';
}

const derived = new WeakMap();

/**
 * The atlas as the map stood in `year` (a TopoJSON topology; the 110m rules map or the 50m atlas): today's atlas,
 * the same object, when no historic shape stands then; else a copy whose `countries` read each standing historic
 * shape in place of today's shape of its id, a new id after the shape before it. One copy per atlas and era.
 */
export function atlasOfYear(atlas, year) {
  const era = mapEraOf(atlas, year);
  if (!era) return atlas;
  let eras = derived.get(atlas);
  if (!eras) derived.set(atlas, eras = new Map());
  if (!eras.has(era)) {
    const name = atlas.objects.countries ? 'countries' : Object.keys(atlas.objects).find(key => atlas.objects[key]?.type === 'GeometryCollection');
    const geometries = [...atlas.objects[name].geometries];
    let after = -1;
    for (const geometry of historicOf(atlas)) {
      if (!covers(geometry, year)) continue;
      const id = String(geometry.id);
      const at = geometries.findIndex(g => g?.id != null && String(g.id) === id);
      if (at >= 0) {
        geometries[at] = geometry;
        after = at;
      } else {
        after = after >= 0 ? after + 1 : geometries.length;
        geometries.splice(after, 0, geometry);
      }
    }
    eras.set(era, { ...atlas, objects: { ...atlas.objects, [name]: { ...atlas.objects[name], geometries } } });
  }
  return eras.get(era);
}

/**
 * Capitals that moved with the map: West Germany's seat of government was Bonn until reunification, so in a year
 * when East Germany stands (and holds Berlin) West Germany is anchored on Bonn. Each holds while the shape it goes
 * with stands: `with` names that shape.
 */
export const CAPITALS_OF_THE_DAY = Object.freeze([
  Object.freeze({ id: '276', with: '278', at: Object.freeze([7.10, 50.73]), name: 'Bonn' }),
]);

/** The capitals the map of `atlas` in `year` anchors its shapes on: today's, with those of the day where they hold. */
export function capitalsOfYear(atlas, year) {
  if (!mapEraOf(atlas, year)) return CAPITALS;
  const standing = new Set(historicOf(atlas).filter(geometry => covers(geometry, year)).map(geometry => String(geometry.id)));
  const moved = CAPITALS_OF_THE_DAY.filter(capital => standing.has(capital.with));
  return moved.length ? { ...CAPITALS, ...Object.fromEntries(moved.map(capital => [capital.id, capital.at])) } : CAPITALS;
}
