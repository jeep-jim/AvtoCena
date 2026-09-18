/** Keep complete detail blocks within a byte budget, including on crawler traffic. */
export class DetailReadCache<T> {
  private entries = new Map<string, { value: T; bytes: number; expiresAt: number }>();
  private pending = new Map<string, Promise<T>>();
  private bytes = 0;
  private active = 0;
  private waiters: Array<() => void> = [];
  private epoch = 0;

  constructor(private readonly options: {
    maxEntries: number; maxBytes: number; ttlMs: number; concurrency: number;
    now?: () => number;
  }) {}

  clear() {
    this.epoch++;
    this.entries.clear();
    this.pending.clear();
    this.bytes = 0;
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  get(key: string, load: () => Promise<T>): Promise<T> {
    const now = this.options.now || Date.now;
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now()) this.remove(id);
    }
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return Promise.resolve(cached.value);
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const epoch = this.epoch;
    const promise = (async () => {
      // Reserve a slot before any I/O; simultaneous card/price lookups must not
      // parse dozens of multi-megabyte blocks at once.
      if (this.active >= this.options.concurrency) {
        await new Promise<void>(resolve => this.waiters.push(resolve));
      } else {
        this.active++;
      }
      try {
        const value = await load();
        if (epoch !== this.epoch) return value;
        // Serialized bytes are a storage budget, not an exact JS heap measure.
        // Leave substantial heap headroom for parsed objects and request work.
        const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
        if (bytes <= this.options.maxBytes) {
          while (this.entries.size >= this.options.maxEntries || this.bytes + bytes > this.options.maxBytes) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.remove(oldest);
          }
          this.entries.set(key, { value, bytes, expiresAt: now() + this.options.ttlMs });
          this.bytes += bytes;
        }
        return value;
      } finally {
        const next = this.waiters.shift();
        if (next) next();
        else this.active--;
      }
    })();
    this.pending.set(key, promise);
    void promise.then(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    }, () => {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    });
    return promise;
  }
}
