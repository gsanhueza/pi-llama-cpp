import { PROVIDER_NAME, PROVIDER_PREFIX } from "./constants";
import { Mode } from "./enums/mode";
import { ServerStatus } from "./enums/serverStatus";
import { HealthEndpoint } from "./interfaces/endpoints/health";
import { ModelsEndpoint } from "./interfaces/endpoints/models";
import { PropsEndpoint } from "./interfaces/endpoints/props";
import { BaseModel } from "./models/baseModel";
import { LegacyModel } from "./models/legacyModel";
import { RouterModel } from "./models/routerModel";
import { SingleModel } from "./models/singleModel";
import { ConfigResolver } from "./resolver";

export class Server {
  public readonly models: BaseModel[] = [];
  private configResolver = new ConfigResolver();

  constructor(readonly baseUrl: string) {}

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
   * Fetches models from the server and populates {@link models}
   */
  async initialize() {
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
    return await this.rpc<HealthEndpoint>("/health");
  }

  /**
   * Fetches models from the server
   *
   * @return The models from the server
   */
  async fetchModels(): Promise<ModelsEndpoint> {
    return await this.rpc<ModelsEndpoint>("/v1/models");
  }

  /**
   * Fetches general properties of the server
   *
   * @return The properties of the server
   */
  async fetchServerProps(): Promise<PropsEndpoint> {
    return await this.rpc<PropsEndpoint>("/props?autoload=false");
  }

  /**
   * Fetches properties of a specific model from the server
   *
   * @param modelId The ID of the model
   * @return The properties of the specified model
   */
  async fetchModelProps(modelId: string): Promise<PropsEndpoint> {
    return await this.rpc<PropsEndpoint>(
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
    return await this.rpc<ModelsEndpoint>(`/models/${resource}`, { model });
  }

  /**
   * Makes an HTTP request to the llama-server and returns the parsed JSON response
   *
   * @param endpoint The endpoint path to fetch (e.g. "/health")
   * @param body The optional request body for POST requests
   * @returns The parsed JSON response from the server
   */
  private async rpc<T>(
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const apiKey = await this.getApiKey();

    const data = {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    };

    const res = await fetch(url, {
      ...data,
      headers: {
        ...data.headers,
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    });

    const response: T = await res.json();
    return response;
  }
}
