import { POLLING_INTERVAL } from "../constants";

/**
 * How long GET responses stay cached: half the polling interval, so a poll
 * tick always reaches the server while multiple reads within one tick
 * (fan-outs like `toProviderConfig`, concurrent model polls) do not.
 */
const CACHE_TTL = POLLING_INTERVAL / 2;

/**
 * HTTP client for llama-server with GET caching and request deduplication.
 *
 * Two complementary mechanisms keep repeated reads from reaching the server:
 * - the TTL cache absorbs time-spaced repeats (poll loops, sequential reads);
 * - the in-flight map absorbs simultaneous bursts: concurrent callers for the
 *   same key share one request's promise.
 *
 * POST requests are deduplicated but never cached — they are not idempotent
 * reads, and the only caller (`Server.postRequest()`) clears the cache around
 * them. The dedup matters: independent load triggers (command, auto-load,
 * model-select) can race, and merging their duplicate `POST /models/load`
 * into one server call avoids load-state glitches.
 */
export class ApiClient {
  private cache = new Map<string, { data: unknown; timestamp: number }>();
  private inflight = new Map<string, Promise<unknown>>();

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
   *
   * @param endpoint The endpoint path to fetch (e.g. "/health")
   * @returns The parsed JSON response from the server
   */
  async get<T>(endpoint: string): Promise<T> {
    const cached = this.cacheGet<T>(endpoint);
    if (cached !== undefined) return cached;

    return this.dedupe(endpoint, async () => {
      const data = await this.do_get<T>(endpoint);
      this.cacheSet(endpoint, data);
      return data;
    });
  }

  /**
   * Makes a deduplicated POST request to the llama-server.
   * Concurrent duplicate requests share one server call; responses are
   * never cached.
   *
   * @param endpoint The endpoint path to post to
   * @param body The optional request body
   * @returns The parsed JSON response from the server
   */
  async post<T>(endpoint: string, body?: Record<string, unknown>): Promise<T> {
    return this.dedupe(this.cacheKey(endpoint, body), async () =>
      this.do_post<T>(endpoint, body),
    );
  }

  /**
   * Clears the entire cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Runs `fn` for the given key, or returns an existing in-flight promise.
   * Concurrent callers for the same key share the same promise.
   */
  private dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Gets a cached GET response. Returns `undefined` if missing or expired.
   */
  private cacheGet<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  /**
   * Stores a GET response in the cache with the current timestamp.
   */
  private cacheSet(key: string, data: unknown): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Builds the dedup key for a POST request.
   *
   * @param endpoint The endpoint path to post to
   * @param body The optional request body
   */
  private cacheKey(endpoint: string, body?: Record<string, unknown>): string {
    return body ? `${endpoint}:${JSON.stringify(body)}` : endpoint;
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
}
