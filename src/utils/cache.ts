/**
 * Generic TTL cache.
 * Entries expire after `ttl` milliseconds from the time they were set.
 */
export class Cache {
  private entries = new Map<string, { data: unknown; timestamp: number }>();

  /**
   * @param ttl Time-to-live in milliseconds
   */
  constructor(private readonly ttl: number) {}

  /**
   * Gets a cached value by key. Returns `undefined` if missing or expired.
   */
  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  /**
   * Stores a value in the cache with the current timestamp.
   */
  set(key: string, data: unknown): void {
    this.entries.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Clears all cached entries.
   */
  clear(): void {
    this.entries.clear();
  }
}
