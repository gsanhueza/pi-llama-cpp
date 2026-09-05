import { ApiClient } from "./api/client";
import {
  API_KEY_PLACEHOLDER,
  PROVIDER_NAME,
  PROVIDER_PREFIX,
} from "./constants";
import { Mode } from "./enums/mode";
import { ServerStatus } from "./enums/serverStatus";
import { HealthEndpoint } from "./interfaces/endpoints/health";
import { ModelsEndpoint } from "./interfaces/endpoints/models";
import {
  PropsEndpoint,
  PropsModelEndpoint,
} from "./interfaces/endpoints/props";
import type { LlamaSettingsManager } from "./managers/settings";
import { BaseModel } from "./models/baseModel";
import { LegacyModel } from "./models/legacyModel";
import { RouterModel } from "./models/routerModel";
import { SingleModel } from "./models/singleModel";
import { SSEManager } from "./sse/manager";

/** Identity of a llama.cpp server endpoint. */
export interface ServerOptions {
  /** Base URL of the llama.cpp server (e.g. "http://127.0.0.1:8080"). */
  baseUrl: string;
  /** Custom provider ID; falls back to a URL-based one. */
  customId?: string;
  /** Custom provider name suffix; falls back to the base URL. */
  customName?: string;
}

export class Server {
  public readonly models: BaseModel[] = [];
  private apiClient: ApiClient;
  private sse!: SSEManager;

  constructor(
    private readonly settings: LlamaSettingsManager,
    private readonly options: ServerOptions,
  ) {
    // Eager client: `isReady` may run before `initialize()` (health probing
    // in ServerManager), so no lazy fallback is needed. initialize()
    // rebuilds the client to re-resolve the API key.
    this.apiClient = new ApiClient(options.baseUrl, this.getApiKey());
  }

  /** Base URL of this server endpoint. */
  get baseUrl(): string {
    return this.options.baseUrl;
  }

  /**
   * Maximum time (ms) for server verification and SSE support probe.
   * Resolved live from the injected settings manager.
   */
  get serverTimeout(): number {
    return this.settings.resolveTimeouts().serverTimeout;
  }

  /**
   * Maximum time (ms) to wait for model loading before giving up.
   * Resolved live from the injected settings manager.
   */
  get pollingTimeout(): number {
    return this.settings.resolveTimeouts().pollingTimeout;
  }

  /**
   * Provides access to the SSE manager for direct subscriptions.
   */
  get sseManager(): SSEManager {
    return this.sse;
  }

  /**
   * Generates a unique provider ID from a server URL.
   * Uses custom ID if provided, otherwise falls back to URL-based ID.
   */
  get providerId(): string {
    return this.options.customId ?? `${PROVIDER_PREFIX}=${this.baseUrl}`;
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
   * Retrieves the API key from the config resolver.
   * Tries custom ID first, then falls back to URL-based ID.
   *
   * @returns The API key
   */
  getApiKey(): string {
    // Try custom ID first
    if (this.options.customId) {
      const key = this.settings.resolveApiKey(this.options.customId);
      if (key !== API_KEY_PLACEHOLDER) return key;
    }
    // Fall back to URL-based ID
    return this.settings.resolveApiKey(`${PROVIDER_PREFIX}=${this.baseUrl}`);
  }

  /**
   * Fetches models from the server and populates {@link models}.
   * Clears the cache first so we always fetch fresh data.
   */
  async initialize() {
    const apiKey = this.getApiKey();
    this.apiClient = new ApiClient(this.baseUrl, apiKey);
    this.sse = new SSEManager(this, apiKey);
    const { data } = await this.fetchModels();
    const mode = await this.detectServerMode(data);

    // Setup models
    const modelCtor = {
      [Mode.ROUTER]: RouterModel,
      [Mode.LEGACY]: LegacyModel,
      [Mode.SINGLE]: SingleModel,
    }[mode];

    const models: BaseModel[] = data.map((m) => new modelCtor(m, this));

    this.models.length = 0;
    this.models.push(...models);
  }

  /**
   * Detects the mode of the server from the models data already fetched by
   * {@link initialize} — no second /v1/models round-trip.
   *
   * @param data Models endpoint data fetched by initialize()
   * @returns The detected mode
   */
  private async detectServerMode(data: ModelsEndpoint["data"]): Promise<Mode> {
    const { role } = await this.fetchServerProps();

    if (role === "router") return Mode.ROUTER;
    if ("max_model_len" in data[0]) return Mode.LEGACY;
    return Mode.SINGLE;
  }

  /**
   * Checks if the server is ready, with a timeout.
   *
   * @param timeout Maximum time to wait for the health check
   * @returns The server status
   */
  async isReady(timeout: number): Promise<ServerStatus> {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeout),
      );
      const health = await Promise.race([
        this.fetchServerHealth(),
        timeoutPromise,
      ]);
      if (health.status === "ok") {
        return ServerStatus.READY;
      }
      return ServerStatus.UNREACHABLE;
    } catch (error) {
      if (error instanceof Error && error.message === "timeout") {
        return ServerStatus.TIMEOUT;
      }
      return ServerStatus.UNREACHABLE;
    }
  }

  /**
   * Retrieves the health status of the server
   *
   * @returns The health status
   */
  async fetchServerHealth(): Promise<HealthEndpoint> {
    return await this.apiClient.get<HealthEndpoint>("/health");
  }

  /**
   * Fetches models from the server
   *
   * @return The models from the server
   */
  async fetchModels(): Promise<ModelsEndpoint> {
    return await this.apiClient.get<ModelsEndpoint>("/v1/models");
  }

  /**
   * Fetches general properties of the server
   *
   * @return The properties of the server
   */
  async fetchServerProps(): Promise<PropsEndpoint> {
    return await this.apiClient.get<PropsEndpoint>("/props?autoload=false");
  }

  /**
   * Fetches properties of a specific model from the server
   *
   * @param modelId The ID of the model
   * @return The properties of the specified model
   */
  async fetchModelProps(modelId: string): Promise<PropsModelEndpoint> {
    return await this.apiClient.get<PropsModelEndpoint>(
      `/props?model=${modelId}&autoload=false`,
    );
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
}
