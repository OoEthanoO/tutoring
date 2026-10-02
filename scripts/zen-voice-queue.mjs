/** Coalesce bursts, but retain an update arriving while its member is in flight. */
export class ZenVoiceQueue {
  constructor(deliver, onError = () => {}) {
    this.deliver = deliver;
    this.onError = onError;
    this.pending = new Set();
    this.running = false;
    this.stopped = false;
    this.retryDelay = 250;
    this.timer = null;
  }
  add(id) {
    if (this.stopped) return;
    this.pending.add(id);
    if (!this.running && !this.timer) void this.drain();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.pending.clear();
  }
  async drain() {
    this.running = true;
    while (!this.stopped && this.pending.size) {
      const ids = [...this.pending].slice(0, 20);
      ids.forEach(id => this.pending.delete(id));
      try {
        await this.deliver(ids);
        this.retryDelay = 250;
      } catch (error) {
        ids.forEach(id => this.pending.add(id));
        this.onError(error);
        this.timer = setTimeout(() => {
          this.timer = null;
          if (!this.stopped) void this.drain();
        }, this.retryDelay);
        this.retryDelay = Math.min(10000, this.retryDelay * 2);
        break;
      }
    }
    this.running = false;
  }
}
