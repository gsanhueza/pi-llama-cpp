import { ApiClient, ApiError, RequestPolicy } from "../api/client";
import {
  API_KEY_PLACEHOLDER,
  ENDPOINT_PREFIX,
  PROVIDER_NAME,
} from "../constants";
import { Mode } from "../enums/mode";
import { ServerStatus } from "../enums/serverStatus";
import { Status } from "../enums/status";
import { ModelsEndpoint } from "../interfaces/endpoints/models";
import {
  LlamaSwapPropsError,
  PropsEndpoint,
  PropsModelEndpoint,
} from "../interfaces/endpoints/props";
import type {
  ServerOptions,
  ServerSettingsResolver,
} from "../interfaces/server";
import type { ModelOverride } from "../interfaces/settings";
import { Model } from "../models/model";
import { SSEManager } from "../sse/manager";
import { detectMode } from "../utils/detectMode";
import { ServerIds } from "../utils/serverIds";

/**
 * Base server class holding the HTTP client, settings resolver, SSE
 * support, and common orchestration.  Mode-specific resolution logic
 * is delegated to subclasses.
 */
export abstract class Server {
  readonly models: Model[] = [];
  sse?: SSEManager;

  constructor(
    protected readonly resolver: ServerSettingsResolver,
    protected readonly options: ServerOptions,
    protected readonly apiClient: ApiClient,
  ) {}

  /** The detected mode of this server. */
  abstract mode: Mode;

  /** Base URL of this server endpoint. */
  get baseUrl(): string {
    return this.options.baseUrl;
  }

  /**
   * Base URL of the OpenAI-compatible API: {@link baseUrl} joined with
   * {@link ENDPOINT_PREFIX}. Idempotent — a baseUrl that already ends with
   * the prefix is returned untouched, so proxied setups exposing the API
   * under a /v1 path don't double up.
   */
  get apiBaseUrl(): string {
    const { baseUrl } = this.options;
    return baseUrl.endsWith(ENDPOINT_PREFIX)
      ? baseUrl
      : `${baseUrl}${ENDPOINT_PREFIX}`;
  }

  /**
   * Provides access to the SSE manager for direct subscriptions.
   * Only available after {@link initialize} has been called.
   */
  get sseManager():
    | {
        probeSSE(): Promise<boolean>;
        disconnect(): void;
        subscribeToStatus(
          modelId: string,
        ): Promise<{ status: string; exit_code?: number }>;
        subscribeToProgress(
          modelId: string,
          onProgress: (percentage: number, stage?: string) => void,
        ): () => void;
      }
    | undefined {
    return this.sse;
  }

  /**
   * Generates a unique provider ID from a server URL.
   * Uses custom ID if provided, otherwise falls back to URL-based ID.
   */
  get providerId(): string {
    return ServerIds.resolve(this.baseUrl, this.options.customId);
  }

  /**
   * Generates a human-readable provider name from a server URL.
   * Uses custom name as suffix if provided.
   */
  get providerName(): string {
    if (this.options.customName) {
      return `${PROVIDER_NAME} (${this.options.customName})`;
    }
    return `${PROVIDER_NAME} (${this.baseUrl})`;
  }

  /**
   * Retrieves the API key from the injected settings resolver.
   * Tries custom ID first, then falls back to URL-based ID.
   */
  get apiKey(): string {
    // Try custom ID first
    if (this.options.customId) {
      const key = this.resolver.resolveApiKey(this.options.customId);
      if (key !== API_KEY_PLACEHOLDER) return key;
    }
    // Fall back to URL-based ID
    return this.resolver.resolveApiKey(ServerIds.fromUrl(this.baseUrl));
  }

  /**
   * Resolves the server's custom headers (`llamaSettings.servers[].headers`)
   * through the injected settings resolver. `undefined` when none are set.
   */
  get headers(): Record<string, string> | undefined {
    return this.resolver.resolveHeaders(this.providerId, this.options.headers);
  }

  /**
   * Fetches models from the server and populates {@link models}.
   */
  async initialize(): Promise<void> {
    this.sse?.disconnect();
    this.sse = new SSEManager(this, this.resolver, this.apiClient);

    const { data } = await this.fetchModels();
    const props = await this.fetchServerProps().catch(
      () => ({}) as PropsEndpoint,
    );
    this.mode = detectMode(props, data);

    // Setup models
    const models: Model[] = data.map((m) => new Model(m, this));

    this.models.length = 0;
    this.models.push(...models);
  }

  /**
   * Stateless health check for callers without a `Server` instance (editor
   * UIs probing draft URLs). Classifies health (`/health`) and auth
   * (`/v1/models`) concurrently.
   *
   * - Health fails (timeout)  → `TIMEOUT`
   * - Health fails (other)    → `UNREACHABLE`
   * - Health 200 + auth 401   → `UNAUTHORIZED`
   * - Health 200 + auth fails → `TIMEOUT` / `UNREACHABLE`
   * - Both OK                 → `READY`
   *
   * @param client ApiClient configured with the server URL and auth key
   * @param timeout Maximum time (ms) for both probes
   * @returns The classified server status
   */
  static async check(
    client: ApiClient,
    timeout: number,
  ): Promise<ServerStatus> {
    const [health, auth] = await Promise.allSettled([
      client.get<number>("/health", timeout, RequestPolicy.Status),
      client.get(`${ENDPOINT_PREFIX}/models`, timeout),
    ]);

    const classify = (reason: unknown): ServerStatus => {
      if (reason instanceof ApiError && reason.type === "authentication")
        return ServerStatus.UNAUTHORIZED;
      return Server.isTimeout(reason)
        ? ServerStatus.TIMEOUT
        : ServerStatus.UNREACHABLE;
    };

    if (health.status === "rejected") return classify(health.reason);
    if (health.value !== 200) return ServerStatus.UNREACHABLE;
    if (auth.status === "rejected") return classify(auth.reason);

    return ServerStatus.READY;
  }

  /**
   * Resolves the status of a model by querying `/props?model=<id>`.
   *
   * @param modelId — The model ID to check.
   * @returns The resolved status.
   */
  async getModelStatus(modelId: string): Promise<Status> {
    try {
      const { is_sleeping, error } = await this.fetchModelProps(modelId);
      if (is_sleeping) return Status.SLEEPING;
      if (!error) return Status.LOADED;
      if (error.code === 503) return Status.LOADING;
      if (error.code === 400 && error.message === "model is not loaded")
        return Status.UNLOADED;
      return Status.FAILED;
    } catch {
      return Status.FAILED;
    }
  }

  /**
   * Resolves the capabilities of a model by querying `/props?model=<id>`,
   * falling back to `/v1/models` if props is unavailable.
   *
   * @param modelId — The model ID to check.
   * @returns The resolved capabilities.
   */
  async getCapabilities(modelId: string): Promise<("text" | "image")[]> {
    const overridden = this.findOverrideForModel(modelId)?.capabilities;
    if (overridden) return overridden;

    try {
      const { modalities } = await this.fetchModelProps(modelId);
      return modalities.vision ? ["text", "image"] : ["text"];
    } catch {
      const { data } = await this.fetchModels();
      const model = data.find((d) => d.id === modelId);
      if (!model) return ["text"];
      const input_modalities = model.architecture?.input_modalities ?? ["text"];
      return input_modalities.filter(
        (mod): mod is "text" | "image" => mod === "text" || mod === "image",
      );
    }
  }

  /**
   * Mode-aware context size resolution. Implemented by subclasses.
   */
  abstract getContextSize(modelId: string): Promise<number>;

  /**
   * Mode-aware max tokens resolution.
   *
   * @param modelId — The model ID.
   * @param contextSize — The fallback context size.
   * @returns The resolved max tokens.
   */
  getMaxTokens(modelId: string, contextSize: number): number {
    const overridden = this.findOverrideForModel(modelId)?.maxTokens;
    return overridden && overridden > 0 ? overridden : contextSize;
  }

  /**
   * Resolves the display name for a model, using the first alias or the model ID.
   *
   * @param modelId — The model ID.
   * @returns The model display name.
   */
  async getModelName(modelId: string): Promise<string> {
    const { data } = await this.fetchModels();
    const mm = data.find((m) => m.id === modelId);
    return mm?.aliases?.[0] ?? modelId;
  }

  /**
   * Orchestrate model loading (HTTP call + polling wait).
   */
  async loadModel(modelId: string): Promise<void> {
    const status = await this.getModelStatus(modelId);
    if (status === Status.LOADED || status === Status.SLEEPING) return;

    await this.postRequest("load", modelId);
    await this.pollModelStatus(modelId, Status.LOADED);
  }

  /**
   * Orchestrate model unloading (HTTP call + polling wait).
   */
  async unloadModel(modelId: string): Promise<void> {
    await this.postRequest("unload", modelId);
    await this.pollModelStatus(modelId, Status.UNLOADED);
  }

  /**
   * Polls the model status until it matches the expected state or times out.
   *
   * @param modelId — The model ID to poll.
   * @param expected — The expected status to wait for.
   * @throws When the model fails to reach the expected status within the timeout.
   */
  protected async pollModelStatus(
    modelId: string,
    expected: Status,
  ): Promise<void> {
    const startTime = this.now();
    const timeout = await this.resolver.resolvePollingTimeout();
    const interval = await this.resolver.resolvePollingInterval();

    let current: Status;
    do {
      await new Promise((r) => setTimeout(r, interval));
      current = await this.getModelStatus(modelId);

      if (expected === Status.LOADED && current === Status.UNLOADED) {
        throw new Error(`Model loading failed: ${modelId}`);
      }

      if (this.now() - startTime > timeout) {
        throw new Error(
          `Model ${expected} timed out after ${timeout} ms: ${modelId}`,
        );
      }
    } while (current !== expected);
  }

  /**
   * Fetches models from the server
   *
   * @return The models from the server
   */
  async fetchModels(): Promise<ModelsEndpoint> {
    return await this.apiClient.get<ModelsEndpoint>(
      `${ENDPOINT_PREFIX}/models`,
    );
  }

  /**
   * Fetches general properties of the server.
   * llama-server returns {@link PropsEndpoint}; llama-swap returns
   * {@link LlamaSwapPropsError} (an error response with a `src` discriminator).
   *
   * @return The server properties
   */
  async fetchServerProps(): Promise<PropsEndpoint | LlamaSwapPropsError> {
    return await this.apiClient.get<PropsEndpoint | LlamaSwapPropsError>(
      "/props?autoload=false",
    );
  }

  /**
   * Fetches properties of a specific model from the server
   *
   * @param modelId The ID of the specified model
   * @return The properties of the specified model
   */
  async fetchModelProps(modelId: string): Promise<PropsModelEndpoint> {
    return await this.apiClient.get<PropsModelEndpoint>(
      `/props?model=${modelId}&autoload=false`,
    );
  }

  /**
   * Resolves the override for a given model ID using prefix matching.
   *
   * Keys in the overrides map are treated as prefix filters — a model ID
   * matches if it starts with the key. When multiple keys match, the
   * longest (most specific) key wins. Empty keys are ignored.
   *
   * @param modelId — The model ID to look up.
   * @returns The matching override, or `undefined` if no key matches.
   */
  findOverrideForModel(modelId: string): ModelOverride | undefined {
    const overrides = this.options.overrides ?? {};
    let best: ModelOverride | undefined;
    let bestLen = 0;

    for (const [key, override] of Object.entries(overrides)) {
      if (!key) continue;
      if (modelId.startsWith(key) && key.length > bestLen) {
        best = override;
        bestLen = key.length;
      }
    }

    return best;
  }

  /**
   * Sends a request associated to a specific model from the server
   *
   * @param resource The specified resource ("load" | "unload")
   * @param model The targeted model
   */
  async postRequest(
    resource: "load" | "unload",
    model: string,
  ): Promise<ModelsEndpoint> {
    this.apiClient.clearCache();
    return await this.apiClient.post<ModelsEndpoint>(`/models/${resource}`, {
      model,
    });
  }

  /** Current time — overridable for testing. */
  protected now(): number {
    return Date.now();
  }

  /** True when the error is a fetch timeout (either AbortSignal error name). */
  static isTimeout(err: unknown): boolean {
    return (
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError")
    );
  }
}
