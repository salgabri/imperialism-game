// Every club's land holds its ground (scripts/lib/domestic-partition.mjs; docs/design/domestic-campaigns.md, "Grounds"),
// on synthetic grids of square units near the equator, about 1.1 km a side: clubs sharing a ground each hold land at
// it and about their share of their team's land, and a strip leading away from the ground is split along its length.
import assert from 'node:assert/strict';
import test from 'node:test';
import { bboxOf, GROUND_SLACK_KM, groundProblem, partitionCountry, SHARED_SLACK_KM } from './lib/domestic-partition.mjs';

const STEP = 0.01;
const BALANCE = { room: 0.25, beta: 0.3 };

/** Square units at grid cells [x, y] (outer rings anticlockwise). */
const squares = cells => cells.map(([x, y], i) => {
  const [x0, y0, x1, y1] = [x * STEP, y * STEP, (x + 1) * STEP, (y + 1) * STEP];
  return { id: String(i), name: `cell ${x},${y}`, polys: [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]] };
});
const block = (x0, y0, w, h) => Array.from({ length: w * h }, (_, i) => [x0 + (i % w), y0 + Math.floor(i / w)]);
const at = (x, y) => [(x + 0.5) * STEP, (y + 0.5) * STEP];

/** Each club's land (its units' polygons) and area, from the partition's owner (one section per club). */
function lands(result, n) {
  const own = Array.from({ length: n }, () => []);
  const area = new Array(n).fill(0);
  result.owner.forEach((c, u) => { own[c].push(...result.units[u].polys); area[c] += result.units[u].area; });
  return { lands: own.map(polys => ({ polys, box: bboxOf(polys) })), area };
}

test('clubs sharing a ground each hold land at it and about half their team\'s land; every other club holds its own', () => {
  const units = squares(block(0, 0, 30, 30));
  // Clubs 0 and 1 share a ground (one stadium); 2, 3 and 4 have their own.
  const homes = [at(12.2, 12.2), at(12.2, 12.2), at(26, 26), at(4, 25), at(25, 4)];
  const result = partitionCountry(units, homes, { sections: homes.length, balance: BALANCE });
  const { lands: land, area } = lands(result, homes.length);
  homes.forEach((home, c) => {
    const shared = c < 2;
    assert.equal(groundProblem(home, c, land, shared ? SHARED_SLACK_KM : GROUND_SLACK_KM), null, `club ${c} holds its ground`);
  });
  assert.ok(Math.min(area[0], area[1]) / Math.max(area[0], area[1]) > 0.5, `the two split their land fairly: ${area[0].toFixed(0)} and ${area[1].toFixed(0)} km²`);
});

test('a strip leading away from a shared ground is split along its length, so both clubs reach the land past it', () => {
  // A 3-cell-wide strip from the ground's block runs east 20 cells to a block of land no other club is near.
  const cells = [...block(0, 0, 6, 6), ...block(6, 2, 20, 3), ...block(26, 0, 14, 14)];
  const units = squares(cells);
  const homes = [at(2.5, 2.5), at(2.5, 2.5), at(0, 0)];
  const result = partitionCountry(units, homes, { sections: homes.length, balance: BALANCE });
  const { lands: land, area } = lands(result, homes.length);
  for (const c of [0, 1]) assert.equal(groundProblem(homes[c], c, land, SHARED_SLACK_KM), null, `club ${c} holds land at the ground`);
  // Both clubs of the shared ground hold land in the far block, through the strip.
  const far = c => result.owner.some((o, u) => o === c && result.units[u].centroid[0] > 26 * STEP);
  assert.ok(far(0) && far(1), 'both reach the far block');
  assert.ok(Math.min(area[0], area[1]) / Math.max(area[0], area[1]) > 0.5, `fair: ${area[0].toFixed(0)} and ${area[1].toFixed(0)} km²`);
});

test('three clubs sharing a ground split it by halves, each holding land at it', () => {
  const units = squares(block(0, 0, 24, 24));
  const homes = [at(12, 12), at(12, 12), at(12, 12), at(2, 2), at(21, 21)];
  const result = partitionCountry(units, homes, { sections: homes.length, balance: BALANCE });
  const { lands: land, area } = lands(result, homes.length);
  for (const c of [0, 1, 2]) {
    assert.equal(groundProblem(homes[c], c, land, SHARED_SLACK_KM), null, `club ${c} holds land at the ground`);
    assert.ok(area[c] > 0.25 * (area[0] + area[1] + area[2]) / 3, `club ${c} holds ${area[c].toFixed(0)} km²`);
  }
});

test('the ground rule: within the slack of the club\'s land, else not held; a ground on no land is no one\'s to miss', () => {
  const units = squares([[0, 0], [1, 0], [3, 0]]);
  const land = units.map(u => ({ polys: u.polys, box: bboxOf(u.polys) }));
  assert.equal(groundProblem(at(0, 0), 0, land), null, 'inside its own land');
  assert.ok(groundProblem(at(1, 0), 0, land), 'inside another club\'s land');
  assert.equal(groundProblem([0.0102, 0.005], 0, land), null, 'just across the border, within the slack');
  // Off all land (the gap at x = 2): no other club's land nearer it than the club's own by more than the slack.
  assert.equal(groundProblem(at(2, 0), 1, land), null, 'off the land, its club the nearest');
  assert.ok(groundProblem([0.0255, 0.005], 0, land), 'off the land, far nearer another club');
});
