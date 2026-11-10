// Claimed land (docs/design/claimed-land.md): the empty land of the campaign on screen, and the claims made at
// kick-off, at each kick-off of a match (the land its line of attack crosses) and at each conquest. Plain function
// declarations called as `fn.apply(this, args)` from App's one-line delegates, like the other method modules. None of
// them touches the campaign RNG or the route caches a seeded draw reads: claims never change the game.
import { DEPENDENCIES, EXCLUDED_SHAPES, NATIONS, SCOPES } from '../data/teams.js';
import { createLand, crossedLand, encloseClaims, settleClaims } from '../engine/claims.js';
import { domesticLand } from '../engine/domestic.js';
import { chosenRoute, snapshotBoard } from '../engine/duelDraw.js';
import { drawnPaths } from '../engine/geo.js';

const NO_CLAIMS = Object.freeze({});
// World land per routing paths (one fit), then per set of claimable ids (one theatre of one campaign).
const worldLands = new WeakMap();
const WORLD_LANDS_KEPT = 4;

/**
 * A world theatre's land as a test of shape ids: a confederation's theatre is its own nations and their dependencies,
 * so its neighbours' land stays outside (it borders nobody); the world, the elite and clubs on the world take every
 * country (null).
 */
function worldTheatre(settings) {
  if (!settings || settings.layer === 'clubs') return null;
  const scope = SCOPES.find(item => item.id === settings.scope);
  if (!scope?.filter || scope.id === 'world') return null;
  return id => {
    const nation = NATIONS[id] || NATIONS[DEPENDENCIES[id]?.of];
    return !!nation && scope.filter({ conf: nation[2] });
  };
}

function worldLand(app, st) {
  const theatre = worldTheatre(st.settings);
  const routing = app.displayGeo ? drawnPaths(app.displayGeo.paths, app.geo.countries) : app.geo.paths;
  // Land the theatre takes in that no team holds: own's keys are fixed for a whole campaign (land only changes hands).
  const ids = app.geo.countries.map(country => country.id)
    .filter(id => st.own[id] == null && !EXCLUDED_SHAPES.has(id) && routing[id] && (!theatre || theatre(id)));
  let byIds = worldLands.get(routing);
  if (!byIds) worldLands.set(routing, byIds = new Map());
  const key = ids.join(',');
  if (!byIds.has(key)) {
    const names = new Map(app.geo.countries.map(country => [country.id, country.name]));
    // Border lengths come from the rules geometry's topology (geo.js arcBorders); a test atlas without them gives ids only.
    const { borders, edges } = app.geo;
    byIds.set(key, createLand({ ids, paths: routing,
      neighbours: id => (borders ? borders[id] || new Map() : app.geo.adj[id] || []),
      edge: id => (edges ? edges[id] || 0 : null),
      names: id => NATIONS[id]?.[0] ?? DEPENDENCIES[id]?.name ?? names.get(id) ?? null }));
    while (byIds.size > WORLD_LANDS_KEPT) byIds.delete(byIds.keys().next().value);
  }
  return byIds.get(key);
}

/**
 * The land `st` can claim on the map on screen (engine/claims.js createLand), or null: a country map's empty land or
 * Europe's countries without a club (engine/domestic.js domesticLand), else the world theatre's countries no team
 * holds. Built once per map, fit and theatre.
 */
export function claimLand(st = this.state) {
  if (!this.geo?.paths || !st?.own) return null;
  const domestic = this.domesticMap();
  if (domestic) return domesticLand(domestic, this.surroundings(domestic));
  return worldLand(this, st);
}

/**
 * The claims a campaign starts or resumes with: enclosure on its holdings, keeping `claims` (a save's) where they
 * still fit the map. `st` needs `own` and `settings`.
 */
export function openingClaims(st, claims = NO_CLAIMS) {
  const land = this.claimLand(st);
  return land ? encloseClaims(land, st.own, claims || NO_CLAIMS) : {};
}

/**
 * The empty land a match's line of attack crosses, in travel order: the drawn route (`route.routePoints`, a duel's
 * draw), else the route this attacker would take to this defender (blitz, chaos and the final series draw none),
 * worked out on the isolated route cache as a chosen target's is. [] without empty land.
 */
export function matchCrossings(st, attackerId, defenderId, route = null) {
  const land = this.claimLand(st);
  if (!land?.index) return [];
  let points = Array.isArray(route?.routePoints) && route.routePoints.length >= 2 ? route.routePoints : null;
  if (!points) {
    try {
      const target = chosenRoute(snapshotBoard(this.board(st)), attackerId, defenderId);
      const cp = target?.cp;
      points = target?.routePoints || (cp ? [[cp.ax, cp.ay], [cp.bx, cp.by]] : null);
    } catch {
      points = null;
    }
  }
  return points ? crossedLand(land, points) : [];
}

/**
 * Claims after a conquest: `own` is the ownership after it; the loser's claims and the land the match crossed
 * (`m.crossed`) go to the winner, then enclosure runs. `st` is the state the match was played in.
 */
export function conquestClaims(st, own, winnerId, loserId) {
  const land = this.claimLand({ ...st, own });
  return land ? settleClaims(land, { own, claims: st.claims || NO_CLAIMS, winnerId, loserId, crossedIds: st.match?.crossed }) : {};
}
