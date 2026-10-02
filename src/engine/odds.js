// Display estimates use their own seeded generator and never advance campaign RNG.
import { hashStr, makeRng, selectLineup } from '../data/teams.js';
import { getSport } from '../sports/index.js';

export const UNCERTAINTY_PRESETS = Object.freeze({
  predictable: Object.freeze({ id: 'predictable', name: 'Predictable', label: 'Predictable', drama: 0,
    description: 'Less match-day variation. Scoring and tie-breaks still allow upsets.' }),
  balanced: Object.freeze({ id: 'balanced', name: 'Balanced', label: 'Balanced', drama: 6,
    description: 'A balance of team quality and match-day surprises.' }),
  wild: Object.freeze({ id: 'wild', name: 'Wild', label: 'Wild', drama: 12,
    description: 'More match-day variation and more chances for underdogs.' }),
});

const DEFAULT_SAMPLES = 1024;
const CACHE_LIMIT = 120;
const estimates = new Map();
const modelIdentities = new WeakMap();
let nextModelIdentity = 1;

export function estimateWinProbability({ sport, attacker, defender, preset = 'balanced', drama, samples = DEFAULT_SAMPLES }) {
  const model = typeof sport === 'string' ? getSport(sport) : sport;
  if (!model?.simulate || !attacker || !defender) throw new TypeError('Odds need a sport and both teams.');
  const selectedPreset = UNCERTAINTY_PRESETS[preset] || UNCERTAINTY_PRESETS.balanced;
  const variation = Number.isFinite(drama) ? Math.max(0, Math.min(12, drama)) : selectedPreset.drama;
  const count = Number.isFinite(samples) ? Math.max(128, Math.min(20000, Math.round(samples))) : DEFAULT_SAMPLES;
  const a = { ...attacker, id: 'estimate-attacker' };
  const d = { ...defender, id: 'estimate-defender' };
  const fast = typeof model.prepareMatch === 'function' && typeof model.sampleResult === 'function';
  const prepared = fast ? model.prepareMatch(a, d) : null;
  const lineupA = prepared?.lineupA || selectLineup(a);
  const lineupD = prepared?.lineupD || selectLineup(d);
  const lineupSignature = lineup => lineup.slots.map(slot => `${slot.position}:${slot.effectiveRating}:${slot.player ? 1 : 0}`).join(',');
  const effA = lineupA.rating;
  const effD = lineupD.rating;
  const modelKey = `${model.id}|${model.simulationVersion || 1}|${variation}|${count}|${effA}|${effD}|${lineupSignature(lineupA)}|${lineupSignature(lineupD)}`;
  // Two custom sport objects may share an ID but supply different models.
  // Keep their caches separate without changing reproducible sample seeds.
  if (!modelIdentities.has(model)) modelIdentities.set(model, nextModelIdentity++);
  const key = `${modelIdentities.get(model)}|${selectedPreset.id}|${modelKey}`;
  if (estimates.has(key)) {
    const cached = estimates.get(key);
    estimates.delete(key);
    estimates.set(key, cached);
    return cached;
  }
  const rng = makeRng(hashStr(modelKey));
  let wins = 0;
  for (let i = 0; i < count; i++) {
    // Full timelines and repeated lineup assignment have no bearing on odds.
    // Both paths use the sport's actual score/tie-break model, never a second
    // approximation of its win probabilities.
    const result = fast ? model.sampleResult(rng, prepared, variation) : model.simulate(rng, a, d, variation, effA, effD);
    wins += result.winner === a.id ? 1 : 0;
  }
  const probability = wins / count;
  const result = Object.freeze({
    attacker: probability,
    defender: 1 - probability,
    samples: count,
    drama: variation,
    preset: selectedPreset.id,
    margin95: 1.96 * Math.sqrt(probability * (1 - probability) / count),
  });
  estimates.set(key, result);
  if (estimates.size > CACHE_LIMIT) estimates.delete(estimates.keys().next().value);
  return result;
}
