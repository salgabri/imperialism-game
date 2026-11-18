// Whether two spellings can name one person, shared by FIFA 05 and FIFA 06's nationalities (scripts/lib/ea-early-seasons.mjs)
// and the computed fills (scripts/lib/football-fills.mjs).

// Letters that have no decomposition to a base letter.
const FOLDED = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/** A name's words, in lower case without accents: "Raúl M. Sørensen-Ruiz" → ['raul', 'm', 'sorensen', 'ruiz']. */
export function nameWords(name) {
  return String(name).toLowerCase().replace(/[øæœßłđðþı]/g, letter => FOLDED[letter]).normalize('NFD').replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** The same word, its initial ("r" for "raul") or a shortening of at least three letters ("josh" for "joshua"). */
export const wordsAgree = (a, b) => a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))
  || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));

/**
 * Whether two spellings can name one person: each word of the shorter agrees with its own word of the longer. "D. Brivio"
 * and "Pierluigi Brivio" do not, though they share a surname, and that is the point: EA gave that id to another Brivio.
 */
export function namesAgree(a, b) {
  const [fewer, more] = [nameWords(a), nameWords(b)].sort((x, y) => x.length - y.length);
  if (!fewer.length) return false;
  const left = [...more];
  return fewer.every(word => {
    const at = left.findIndex(other => wordsAgree(word, other));
    if (at < 0) return false;
    left.splice(at, 1);
    return true;
  });
}
