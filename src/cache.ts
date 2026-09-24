// Small in-memory TTL cache with a size cap. Map keeps insertion order, and
// entries are re-inserted on read, so the first key is the least recently used.
export class TtlCache<T> {
  private entries = new Map<string, { value: T; expires: number }>();

  constructor(private ttlMs: number, private maxEntries: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    this.entries.delete(key);
    if (entry.expires <= Date.now()) return undefined;

    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.ttlMs <= 0 || this.maxEntries <= 0) return;

    this.entries.delete(key);
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

const envNumber = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return process.env[name] && Number.isFinite(value) ? value : fallback;
};

// Bible text doesn't change, so chapters can be kept for a long time.
// VERSE_CACHE_TTL=0 disables caching.
export const createPassageCache = <T>() =>
  new TtlCache<T>(
    envNumber("VERSE_CACHE_TTL", 7 * 24 * 60 * 60) * 1000,
    envNumber("VERSE_CACHE_MAX_ENTRIES", 2000)
  );
