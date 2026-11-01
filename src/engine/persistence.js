// Browsers may clear a site's storage, saved campaigns included: any of them when the disk runs low, and Safari after
// seven days of use without a visit unless the game runs from the Home Screen. A granted persist() keeps this
// origin's storage until the player clears it. Chrome decides by engagement or installation without asking, Firefox
// asks the player, Safari 17+ grants Home Screen apps. Asked once per page, after the first checkpoint it writes.
let request = null;

/**
 * Ask the browser to keep this site's storage (`storage` stands in for navigator.storage in tests). Resolves to
 * whether it will, and never rejects; later calls share the first answer.
 */
export function keepSaves(storage) {
  request ||= (async () => {
    try {
      const manager = storage ?? globalThis.navigator?.storage;
      if (typeof manager?.persist !== 'function') return false;
      return (await manager.persisted?.()) === true || (await manager.persist()) === true;
    } catch {
      return false;
    }
  })();
  return request;
}

/** Ask again on the next save (tests). */
export function resetKeepSaves() {
  request = null;
}
