import { POLLING_INTERVAL } from "../constants";
import { Cache } from "../utils/cache";
import { Mutex } from "../utils/mutex";

/**
 * HTTP client for llama-server with caching and deduplication.
 */
export class ApiClient {
  private cache = new Cache(POLLING_INTERVAL / 2);
  private mutex = new Mutex();

  /**
   * Creates a new ApiClient.
   *
   * @param baseUrl The base URL of the llama-server
   * @param apiKey The API key for authentication
   */
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  /**
   * Makes a cached, deduplicated GET request to the llama-server.
   * Results are cached for half the polling interval and in-flight requests are deduplicated.
   *
   * @param endpoint The endpoint path to fetch (e.g. "/health")
   * @returns The parsed JSON response from the server
   */
  async get<T>(endpoint: string): Promise<T> {
    const cached = this.cache.get<T>(endpoint);
    if (cached !== undefined) return cached;

    return this.mutex.getOrCreate(endpoint, async () => {
      const data = (await this.do_get<T>(endpoint)) as T;
      this.cache.set(endpoint, data);
      return data;
    });
  }

  /**
   * Makes a cached, deduplicated POST request to the llama-server.
   * Results are cached for half the polling interval and in-flight requests are deduplicated.
   *
   * @param endpoint The endpoint path to post to
   * @param body The optional request body
   * @returns The parsed JSON response from the server
   */
  async post<T>(endpoint: string, body?: Record<string, unknown>): Promise<T> {
    const key = this.cacheKey(endpoint, body);
    const cached = this.cache.get<T>(key);
    if (cached !== undefined) return cached;

    return this.mutex.getOrCreate(key, async () => {
      const data = (await this.do_post<T>(endpoint, body)) as T;
      this.cache.set(key, data);
      return data;
    });
  }

  /**
   * Clears the entire cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Makes a raw GET request to the llama-server.
   * This bypasses caching and deduplication.
   *
   * @param endpoint The endpoint path to fetch (e.g. "/health")
   * @returns The parsed JSON response from the server
   */
  private async do_get<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    return res.json();
  }

  /**
   * Makes a raw POST request to the llama-server.
   * This bypasses caching and deduplication.
   *
   * @param endpoint The endpoint path to post to
   * @param body The optional request body
   * @returns The parsed JSON response from the server
   */
  private async do_post<T>(
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    return res.json();
  }

  /**
   * Sets a cache key
   *
   * @param endpoint The endpoint path to post to
   * @param body The optional request body
   * @returns The cache key
   */
  private cacheKey(endpoint: string, body?: Record<string, unknown>): string {
    return body ? `${endpoint}:${JSON.stringify(body)}` : endpoint;
  }
}
