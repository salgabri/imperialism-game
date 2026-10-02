// One pausable clock owns gameplay callbacks. Tokens stay stable across pause.
export class PlaybackClock {
  constructor({ now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id) } = {}) {
    this.now = now; this.schedule = schedule; this.cancel = cancel;
    this.tasks = new Set(); this.paused = false;
  }
  after(ms, fn) {
    const token = { fn, remaining: Math.max(0, ms), id: null, due: 0 };
    this.tasks.add(token);
    if (!this.paused) this.arm(token);
    return token;
  }
  arm(token) {
    token.due = this.now() + token.remaining;
    token.id = this.schedule(() => {
      if (!this.tasks.delete(token)) return;
      token.id = null; token.fn();
    }, token.remaining);
  }
  remove(token) {
    if (!token) return;
    this.cancel(token.id); this.tasks.delete(token);
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    for (const token of this.tasks) {
      token.remaining = Math.max(0, token.due - this.now());
      this.cancel(token.id); token.id = null;
    }
  }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    for (const token of this.tasks) this.arm(token);
  }
  clear() {
    for (const token of this.tasks) this.cancel(token.id);
    this.tasks.clear(); this.paused = false;
  }
}
