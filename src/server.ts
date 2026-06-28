import { ApiClient } from "./api/client";
import { PROVIDER_NAME, PROVIDER_PREFIX } from "./constants";
import { Mode } from "./enums/mode";
import { ServerStatus } from "./enums/serverStatus";
import { HealthEndpoint } from "./interfaces/endpoints/health";
import { ModelsEndpoint } from "./interfaces/endpoints/models";
import {
  PropsEndpoint,
  PropsModelEndpoint,
} from "./interfaces/endpoints/props";
import { BaseModel } from "./models/baseModel";
import { LegacyModel } from "./models/legacyModel";
import { RouterModel } from "./models/routerModel";
import { SingleModel } from "./models/singleModel";
import { ConfigResolver } from "./resolver";
import { SSEManager } from "./sse/manager";

export class Server {
  public readonly models: BaseModel[] = [];
  private configResolver = new ConfigResolver();
  private apiClient!: ApiClient;
  private sse!: SSEManager;

  constructor(readonly baseUrl: string) {}

  /**
   * Provides access to the SSE manager for direct subscriptions.
   */
  get sseManager(): SSEManager {
    return this.sse;
  }

  /**
   * Generates a unique provider ID from a server URL.
   */
  get providerId(): string {
    return `${PROVIDER_PREFIX}=${this.baseUrl}`;
  }

  /**
   * Generates a human-readable provider name from a server URL.
   */
  get providerName(): string {
    return `${PROVIDER_NAME} (${this.baseUrl})`;
  }

  /**
   * Retrieves the API key from the resolver
   * @returns The API key
   */
  async getApiKey(): Promise<string> {
    return await this.configResolver.resolveApiKey(this.providerId);
  }

  /**
   * Fetches models from the server and populates {@link models}.
   * Clears the cache first so we always fetch fresh data.
   */
  async initialize() {
    const apiKey = await this.getApiKey();
    this.apiClient = new ApiClient(this.baseUrl, apiKey);
    this.sse = new SSEManager(this.baseUrl, apiKey);
    const { data } = await this.fetchModels();
    const mode = await this.detectServerMode();

    // Setup models
    const modelCtor = {
      [Mode.ROUTER]: RouterModel,
      [Mode.LEGACY]: LegacyModel,
      [Mode.SINGLE]: SingleModel,
    }[mode];

    const models: BaseModel[] = data
      .map((m) => new modelCtor(m, this))
      .sort((a, b) => (a.id > b.id ? 1 : a.id === b.id ? 0 : -1));

    this.models.length = 0;
    this.models.push(...models);
  }

  /**
   * Detects the mode of the server
   *
   * @returns The detected mode
   */
  private async detectServerMode(): Promise<Mode> {
    const { role } = await this.fetchServerProps();
    const { data } = await this.fetchModels();

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
    this.apiClient ??= new ApiClient(this.baseUrl, await this.getApiKey());

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
