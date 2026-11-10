export type DetailReadCacheQueueSnapshot = {
  cache: string; active: number; queued: number; oldestActiveMs: number;
};

/** Fixed operational metadata only. Never retain a lookup key, value or visitor. */
export class DetailReadCacheQueueError extends Error {
  constructor(message: 'detail_cache_queue_timeout' | 'detail_cache_queue_full', public queue: DetailReadCacheQueueSnapshot) {
    super(message);
  }
}

/** Recognize both named queues and errors from an older reader in this process. */
export function isDetailReadCacheQueueError(error: unknown): error is Error {
  return error instanceof DetailReadCacheQueueError || error instanceof Error
    && (error.message === 'detail_cache_queue_timeout' || error.message === 'detail_cache_queue_full');
}

/** Keep complete detail blocks within a byte budget, including on crawler traffic. */
export class DetailReadCache<T> {
  private entries = new Map<string, { value: T; bytes: number; expiresAt: number }>();
  private pending = new Map<string, Promise<T>>();
  private bytes = 0;
  private active = 0;
  private activeStarted = new Map<symbol, number>();
  private waiters: Array<{canStart: () => boolean; run: () => void}> = [];
  private activeGroups = new Map<string, number>();
  private epoch = 0;

  constructor(private readonly options: {
    maxEntries: number; maxBytes: number; ttlMs: number; concurrency: number;
    /** A fixed code identifier for diagnostics, never a lookup key or user input. */
    name?: string;
    now?: () => number;
    maxQueued?: number; queueTimeoutMs?: number;
    /** Reserve shared capacity for other work without raising total concurrency. */
    groupConcurrency?: Record<string, number>;
    /** A serialized slow group may wait for its predecessor within a bounded deadline. */
    groupQueueTimeoutMs?: Record<string, number>;
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

  /** Inspect only a still-fresh entry without joining an I/O admission queue. */
  peekFresh(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= (this.options.now || Date.now)()) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  private queueSnapshot(): DetailReadCacheQueueSnapshot {
    const now = (this.options.now || Date.now)();
    let oldestActiveMs = 0;
    for (const started of this.activeStarted.values()) oldestActiveMs = Math.max(oldestActiveMs, now - started);
    return {
      cache: this.options.name && /^[a-z][a-z0-9_]{0,63}$/.test(this.options.name) ? this.options.name : 'unnamed',
      active: this.active, queued: this.waiters.length, oldestActiveMs: Math.max(0, Math.floor(oldestActiveMs)),
    };
  }

  private queueError(message: 'detail_cache_queue_timeout' | 'detail_cache_queue_full') {
    const error = new DetailReadCacheQueueError(message, this.queueSnapshot());
    // Capture the caller while it is still on the stack. Creating this error
    // inside the timer loses the responsible cache and leaves only timer frames.
    Error.captureStackTrace?.(error, this.get);
    return error;
  }

  get(key: string, load: () => Promise<T>, pendingKey = key, admissionGroup = ''): Promise<T> {
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
    const canStart = () => this.active < this.options.concurrency && (
      !admissionGroup || (this.activeGroups.get(admissionGroup) || 0) <
        (this.options.groupConcurrency?.[admissionGroup] ?? this.options.concurrency)
    );
    let activeSlot: symbol;
    const reserve = () => {
      this.active++;
      activeSlot = Symbol();
      this.activeStarted.set(activeSlot, now());
      if (admissionGroup) this.activeGroups.set(admissionGroup, (this.activeGroups.get(admissionGroup) || 0) + 1);
    };
    if (!canStart() && this.waiters.length >= (this.options.maxQueued ?? 256)) {
      return cached ? Promise.resolve(cached.value) : Promise.reject(this.queueError("detail_cache_queue_full"));
    }
    const epoch = this.epoch;
    const promise = (async () => {
      // Reserve a slot before any I/O; simultaneous card/price lookups must not
      // parse dozens of multi-megabyte blocks at once.
      if (!canStart()) {
        const timeoutError = this.queueError("detail_cache_queue_timeout");
        await new Promise<void>((resolve,reject) => {
          const next={canStart,run:()=>{clearTimeout(timer);reserve();resolve();}};
          const timer=setTimeout(()=>{
            timeoutError.queue = this.queueSnapshot();
            const position=this.waiters.indexOf(next);
            if(position>=0)this.waiters.splice(position,1);
            reject(timeoutError);
          },this.options.groupQueueTimeoutMs?.[admissionGroup] ?? this.options.queueTimeoutMs ?? 5_000);
          this.waiters.push(next);
        });
      } else reserve();
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
        this.active--;
        this.activeStarted.delete(activeSlot!);
        if (admissionGroup) {
          const left = (this.activeGroups.get(admissionGroup) || 1) - 1;
          if (left) this.activeGroups.set(admissionGroup, left);
          else this.activeGroups.delete(admissionGroup);
        }
        // A waiting detail must not prevent an eligible list from using the
        // reserved capacity. Admission reserves synchronously before resuming.
        while (this.active < this.options.concurrency) {
          const position = this.waiters.findIndex(waiter => waiter.canStart());
          if (position < 0) break;
          this.waiters.splice(position,1)[0].run();
        }
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
