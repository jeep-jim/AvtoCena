/** No disk/Object Storage writes. All bounds apply per running container. */
export class PhotoMemoryCache {
  private entries = new Map<string, {data: Buffer; type: string; at: number}>();
  private bytes = 0;
  private pending = new Map<string, Promise<{data: Buffer; type: string}>>();
  private active = 0;
  private hosts = new Map<string, {next: number; blocked: number; active: number}>();
  constructor(private maxBytes = 64 * 1024 * 1024, private ttl = 6 * 3600_000) {}
  get size() { return this.bytes; }
  prune(now = Date.now()) { for (const [key, value] of this.entries) if (now - value.at >= this.ttl) { this.entries.delete(key); this.bytes -= value.data.length; } }
  async read(url: string, fetcher: () => Promise<{data: Buffer; type: string}>) {
    this.prune();
    const cached = this.entries.get(url);
    if (cached) { this.entries.delete(url); this.entries.set(url, cached); return cached; }
    const existing = this.pending.get(url); if (existing) return existing;
    const host = new URL(url).hostname;
    const state = this.hosts.get(host) || {next: 0, blocked: 0, active: 0};
    this.hosts.set(host, state);
    if (state.blocked > Date.now() || this.pending.size >= 48) throw new Error("photo_busy");
    const deadline = Date.now() + 12_000;
    const task = (async () => {
      let acquired = false;
      try {
        while (state.active >= 2 || this.active >= 6 || state.next > Date.now()) {
          if (state.blocked > Date.now() || Date.now() > deadline) throw new Error("photo_busy");
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (state.blocked > Date.now()) throw new Error("photo_busy");
        state.active++; this.active++; acquired = true; state.next = Date.now() + 400;
        const result = await Promise.resolve().then(fetcher);
        if (result.data.length > 2 * 1024 * 1024 || result.data.length > this.maxBytes) throw new Error("photo_size");
        while (this.bytes + result.data.length > this.maxBytes && this.entries.size) {
          const first = this.entries.keys().next().value!; this.bytes -= this.entries.get(first)!.data.length; this.entries.delete(first);
        }
        this.entries.set(url, {...result, at: Date.now()}); this.bytes += result.data.length;
        return result;
      } catch (error) {
        if (!(error instanceof Error && error.message === "photo_busy")) state.blocked = Date.now() + (error instanceof Error && error.message === "photo_blocked" ? 30 * 60_000 : 10_000);
        throw error;
      } finally { if (acquired) { state.active--; this.active--; } this.pending.delete(url); }
    })();
    this.pending.set(url, task); return task;
  }
}
