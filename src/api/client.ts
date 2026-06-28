import { POLLING_INTERVAL } from "../constants";
import { Cache } from "../utils/cache";
import { Mutex } from "../utils/mutex";

export class ApiClient {
  private cache = new Cache(POLLING_INTERVAL / 2);
  private mutex = new Mutex();

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async rpc<T>(endpoint: string, body?: Record<string, unknown>): Promise<T> {
    const key = this.cacheKey(endpoint, body);
    const cached = this.cache.get<T>(key);
    if (cached !== undefined) return cached;

    return this.mutex.getOrCreate<T>(key, async () => {
      const data = (await this.fetch(endpoint, body)) as T;
      this.cache.set(key, data);
      return data;
    });
  }

  async fetch<T>(endpoint: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    return res.json();
  }

  /**
   * Clears the entire cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  private cacheKey(endpoint: string, body?: Record<string, unknown>): string {
    return body ? `${endpoint}:${JSON.stringify(body)}` : endpoint;
  }
}
