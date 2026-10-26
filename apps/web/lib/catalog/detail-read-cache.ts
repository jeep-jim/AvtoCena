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
    maxQueued?: number; queueTimeoutMs?: number;
    /** Display-only data. Never enable for prices, permissions or source admission. */
    staleWhileRevalidateMs?: number;
    sizeOf?: (value: T) => number | undefined | Promise<number | undefined>;
    shouldCache?: (value: T) => boolean;
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

  get(key: string, load: () => Promise<T>, pendingKey = key): Promise<T> {
    const now = this.options.now || Date.now;
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt + (this.options.staleWhileRevalidateMs || 0) <= now()) this.remove(id);
    }
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > now()) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return Promise.resolve(cached.value);
    }
    const pending = this.pending.get(pendingKey);
    if (pending) return cached ? Promise.resolve(cached.value) : pending;
    if (this.active >= this.options.concurrency && this.waiters.length >= (this.options.maxQueued ?? 256)) {
      return cached ? Promise.resolve(cached.value) : Promise.reject(new Error("detail_cache_queue_full"));
    }
    const epoch = this.epoch;
    const promise = (async () => {
      // Reserve a slot before any I/O; simultaneous card/price lookups must not
      // parse dozens of multi-megabyte blocks at once.
      if (this.active >= this.options.concurrency) {
        await new Promise<void>((resolve,reject) => {
          const next=()=>{clearTimeout(timer);resolve();};
          const timer=setTimeout(()=>{
            const position=this.waiters.indexOf(next);
            if(position>=0)this.waiters.splice(position,1);
            reject(new Error("detail_cache_queue_timeout"));
          },this.options.queueTimeoutMs ?? 5_000);
          this.waiters.push(next);
        });
      } else {
        this.active++;
      }
      try {
        const value = await load();
        if (epoch !== this.epoch || this.options.shouldCache?.(value) === false) return value;
        // Serialized bytes are a storage budget, not an exact JS heap measure.
        // Leave substantial heap headroom for parsed objects and request work.
        let bytes: number;
        try {
          const measured = this.options.sizeOf ? await this.options.sizeOf(value) : undefined;
          bytes = measured !== undefined && Number.isFinite(measured) && measured >= 0
            ? measured : Buffer.byteLength(JSON.stringify(value), 'utf8');
        }
        catch (error) {
          // A successful read must not fail just because an oversized value
          // cannot be serialized again to measure an optional cache entry.
          if (error instanceof RangeError && error.message === 'Invalid string length') return value;
          throw error;
        }
        if (epoch !== this.epoch) return value;
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
    this.pending.set(pendingKey, promise);
    void promise.then(() => {
      if (this.pending.get(pendingKey) === promise) this.pending.delete(pendingKey);
    }, () => {
      if (this.pending.get(pendingKey) === promise) this.pending.delete(pendingKey);
    });
    return cached ? Promise.resolve(cached.value) : promise;
  }
}
