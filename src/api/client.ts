// layering trade-off: api client depends on settings/items to get the shared
// polling interval default — avoids duplicating the value across modules.
import { PollingIntervalSettingsItem } from "../settings/items/pollingInterval";

/**
 * Error thrown by the API client when the server rejects a request.
 */
export class ApiError extends Error {
  constructor(
    public readonly type: "authentication" | "server" | "unknown",
    public readonly statusCode: number,
  ) {
    super(`API error (${statusCode})`);
    this.name = "ApiError";
  }
}

/**
 * Policy that controls caching, deduplication, and parsing for a request.
 *
 * - **Cached**: JSON parse + cache (TTL: ratio × polling interval) + dedup.
 *   Default for `get` and `post`.
 * - **Status**: HTTP status code + cache + dedup. Used by health/auth probes.
 * - **Raw**: no parse, no cache, no dedup. For raw text/stream responses.
 */
export enum RequestPolicy {
  /** JSON parse + cache + dedup */
  Cached = "cached",
  /** HTTP status code + cache + dedup */
  Status = "status",
  /** No parse, no cache, no dedup */
  Raw = "raw",
}

/**
 * Options for constructing an {@link ApiClient}.
 */
export interface ApiClientOptions {
  /** Base URL of the llama-server */
  baseUrl: string;
  /** Fraction of polling interval used as cache TTL (default: 0.8). */
  ttlRatio?: number;
  /** Resolves the API key for authentication at request time */
  getApiKey: () => string;
  /** Resolves extra headers at request time. */
  getHeaders: () => Record<string, string> | undefined;
  /** Resolves the current polling interval for cache TTL derivation. */
  getPollingInterval?: () => Promise<number>;
  /** Custom fetch implementation (for testing). */
  fetchFn?: typeof globalThis.fetch;
}

/**
 * Internal options passed to {@link ApiClient.execute}.
 */
interface ExecuteOptions {
  endpoint: string;
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  timeout?: number;
  policy: RequestPolicy;
}

/**
 * HTTP client for llama-server with caching and request deduplication.
 *
 * GETs and POSTs are cached (TTL: ratio × polling interval) and
 * concurrent duplicates share one in-flight promise. Raw requests bypass
 * both. Probes return the HTTP status code and are also cached/deduped.
 */
export class ApiClient {
  private cache = new Map<string, { data: unknown; expiresAt: number }>();
  private inflight = new Map<string, Promise<unknown>>();

  /**
   * Creates a new ApiClient.
   *
   * The key is resolved per request via `getApiKey`, so a client built once
   * picks up key changes (settings edits) without being rebuilt.
   *
   * @param options Configuration options for the client
   */
  constructor(private readonly options: ApiClientOptions) {}

  /** Base URL of the llama-server */
  private get baseUrl(): string {
    return this.options.baseUrl;
  }

  /** Fraction of polling interval used as cache TTL */
  private get ttlRatio(): number {
    return this.options.ttlRatio ?? 0.8;
  }

  /** Resolves the API key for authentication at request time */
  private get getApiKey(): () => string {
    return this.options.getApiKey;
  }

  /** Resolves extra headers at request time */
  private get getHeaders(): () => Record<string, string> | undefined {
    return this.options.getHeaders;
  }

  /** Resolves the current polling interval for cache TTL derivation */
  private get getPollingInterval(): () => Promise<number> {
    return (
      this.options.getPollingInterval ??
      (() => Promise.resolve(PollingIntervalSettingsItem.defaultValue))
    );
  }

  /** Custom fetch implementation */
  private get fetchFn(): typeof globalThis.fetch {
    return this.options.fetchFn ?? fetch;
  }

  /**
   * Opens a raw GET at the given endpoint with auth headers.
   * Returns the full Response so callers can inspect headers
   * (probe) or consume the body (SSE stream).
   *
   * @param endpoint Path relative to the base URL
   * @param signal Optional abort signal
   * @returns the Response object
   * @throws if the response is not OK
   */
  async stream(endpoint: string, signal?: AbortSignal): Promise<Response> {
    // Accept full URLs so callers (SSEClient, probe) don't need to know
    // the base — just pass whatever URL they already have.
    const url = endpoint.startsWith("http")
      ? endpoint
      : `${this.baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
    const response = await this.fetchFn(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.getApiKey()}`,
        ...this.getHeaders(),
      },
      signal,
    });

    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Stream failed: HTTP ${response.status}`);
    }

    return response;
  }

  /**
   * Makes a GET request with the given policy.
   *
   * Defaults to {@link RequestPolicy.Cached} (JSON parse + cache + dedup).
   * Override with {@link RequestPolicy.Status} or {@link RequestPolicy.Raw}.
   *
   * @param endpoint The endpoint path to fetch (e.g. "/v1/models")
   * @param timeout Maximum time (ms) to wait for the response
   * @param policy Request policy (default: Cached)
   * @returns The parsed JSON response from the server
   */
  async get<T>(
    endpoint: string,
    timeout?: number,
    policy: RequestPolicy = RequestPolicy.Cached,
  ): Promise<T> {
    return this.execute<T>({ endpoint, method: "GET", timeout, policy });
  }

  /**
   * Makes a POST request with the given policy.
   *
   * Defaults to {@link RequestPolicy.Cached} (JSON parse + cache + dedup).
   * Override with {@link RequestPolicy.Status} or {@link RequestPolicy.Raw}.
   *
   * @param endpoint The endpoint path to post to
   * @param body The optional request body
   * @param timeout Maximum time (ms) to wait for the response
   * @param policy Request policy (default: Cached)
   * @returns The parsed JSON response from the server
   */
  async post<T>(
    endpoint: string,
    body?: Record<string, unknown>,
    timeout?: number,
    policy: RequestPolicy = RequestPolicy.Cached,
  ): Promise<T> {
    return this.execute<T>({ endpoint, method: "POST", body, timeout, policy });
  }

  /**
   * Clears the entire cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Executes a request with the given policy, routing to the appropriate
   * cache/dedup/parse strategy.
   *
   * @param opts Request options including endpoint, method, body, timeout, and policy
   * @returns The parsed response
   */
  private async execute<T>(opts: ExecuteOptions): Promise<T> {
    const { endpoint, method, body, timeout, policy } = opts;

    switch (policy) {
      case RequestPolicy.Cached:
        return this.cachedDeduped<T>(
          body ? `${endpoint}:${JSON.stringify(body)}` : endpoint,
          async () => this.parseJson<T>(method, endpoint, body, timeout),
        );

      case RequestPolicy.Status:
        return this.cachedDeduped<number>(endpoint, async () =>
          this.parseStatus(method, endpoint, body, timeout),
        ) as T;

      case RequestPolicy.Raw:
        const response = await this.fetchResponse(
          method,
          endpoint,
          body,
          timeout,
        );
        return response as unknown as T;
    }
  }

  // --- Cache + dedup ---

  /**
   * Checks cache first, then deduplicates in-flight requests,
   * and stores the result back in the cache with TTL.
   *
   * @param key The cache/dedup key
   * @param fn The async function to execute if cache miss
   * @returns The cached or freshly fetched value
   */
  private async cachedDeduped<T>(
    key: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const cached = this.cacheGet<T>(key);
    if (cached !== undefined) return cached;

    return this.dedupe(key, async () => {
      const ttl = (await this.getPollingInterval()) * this.ttlRatio; // getter resolves default if unset
      const data = await fn();
      this.cacheSet(key, data, ttl);
      return data;
    });
  }

  // --- Fetch + parse ---

  /**
   * Fetches JSON from the server and parses it.
   * Throws {@link ApiError} with type "authentication" on 401.
   *
   * @param method The HTTP method
   * @param endpoint The endpoint path
   * @param body The optional request body
   * @param timeout Maximum time (ms) to wait for the response
   * @returns The parsed JSON response
   */
  private async parseJson<T>(
    method: "GET" | "POST",
    endpoint: string,
    body?: Record<string, unknown>,
    timeout?: number,
  ): Promise<T> {
    const res = await this.fetchResponse(method, endpoint, body, timeout);
    if (res.status === 401) {
      throw new ApiError("authentication", res.status);
    }
    return (await res.json()) as T;
  }

  /**
   * Fetches the HTTP status code from the server.
   * Throws {@link ApiError} with type "authentication" on 401.
   *
   * @param method The HTTP method
   * @param endpoint The endpoint path
   * @param body The optional request body
   * @param timeout Maximum time (ms) to wait for the response
   * @returns The HTTP status code
   */
  private async parseStatus(
    method: "GET" | "POST",
    endpoint: string,
    body?: Record<string, unknown>,
    timeout?: number,
  ): Promise<number> {
    const res = await this.fetchResponse(method, endpoint, body, timeout);
    if (res.status === 401) {
      throw new ApiError("authentication", res.status);
    }
    return res.status;
  }

  /**
   * Runs `fn` for the given key, or returns an existing in-flight promise.
   *
   * @param key The dedup key
   * @param fn The request to run
   * @returns The shared promise for the key
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
   * Gets a cached response, or `undefined` if missing or expired.
   *
   * @param key The cache key
   * @returns The cached data, or `undefined`
   */
  private cacheGet<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  /**
   * Stores a response in the cache with a per-entry expiry.
   *
   * @param key The cache key
   * @param data The response data
   * @param ttl How long the entry stays fresh, in ms
   */
  private cacheSet(key: string, data: unknown, ttl: number): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttl });
  }

  /**
   * Performs the raw HTTP fetch for a request.
   *
   * @param method The HTTP method
   * @param endpoint The endpoint path
   * @param body The optional request body
   * @param timeout Maximum time (ms) to wait for the response
   * @returns The raw HTTP response
   */
  private fetchResponse(
    method: "GET" | "POST",
    endpoint: string,
    body?: Record<string, unknown>,
    timeout?: number,
  ): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;
    const signal = timeout ? AbortSignal.timeout(timeout) : undefined;

    return this.fetchFn(url, {
      signal,
      method,
      headers: {
        ...(method === "POST"
          ? { "Content-Type": "application/json" }
          : undefined),
        Authorization: `Bearer ${this.getApiKey()}`,
        ...this.getHeaders(),
      },
      ...(body ? { body: JSON.stringify(body) } : undefined),
    });
  }
}
