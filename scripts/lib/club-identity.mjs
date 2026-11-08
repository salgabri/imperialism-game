// What every club needs beside its players: an id's slug, a scoreboard code and a colour. Shared by the football club
// builders (scripts/build-clubs.mjs, scripts/build-womens-football.mjs).

export const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Short code for the scoreboard: initials for multi-word names, else a prefix. */
export function makeCode(name, taken) {
  const words = name.replace(/[^A-Za-zÀ-ÿ ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !/^(de|do|da|of|the|fc|cf|ac|sc|as|ss|us|club|calcio|deportivo)$/i.test(w));
  const candidates = [];
  if (words.length >= 3) candidates.push(words.slice(0, 3).map(w => w[0]).join(''));
  if (words.length >= 2) candidates.push(words[0][0] + words[1].slice(0, 2));
  if (words.length >= 2) candidates.push(words[0].slice(0, 2) + words[1][0]);
  if (words.length) candidates.push(words[0].slice(0, 3));
  candidates.push(name.replace(/[^A-Za-z]/g, '').slice(0, 3));
  for (const c of candidates) {
    const code = c.toUpperCase().padEnd(3, 'X').slice(0, 3);
    if (code.length === 3 && !taken.has(code)) { taken.add(code); return code; }
  }
  for (let i = 0; i < 999; i++) {
    const code = (name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() + i).slice(0, 3);
    if (!taken.has(code)) { taken.add(code); return code; }
  }
  return 'CLB';
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Distinct, readable colours spread around the hue wheel. */
export const colourFor = id => `oklch(0.72 0.16 ${hashStr(id) % 360})`;
