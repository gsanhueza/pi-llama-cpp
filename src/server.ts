import { PROVIDER_NAME, PROVIDER_PREFIX } from "./constants";
import { HealthEndpoint } from "./interfaces/endpoints/health";
import { ModelsEndpoint } from "./interfaces/endpoints/models";
import { PropsEndpoint } from "./interfaces/endpoints/props";
import { BaseModel } from "./models/baseModel";
import { RouterModel } from "./models/routerModel";
import { SingleModel } from "./models/singleModel";
import { ConfigResolver } from "./resolver";

export class Server {
  readonly models: BaseModel[] = [];

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
    return await new ConfigResolver().resolveApiKey(this.providerId);
  }

  /**
   * Fetches models from the server and populates {@link models}
   */
  async initialize() {
    this.models.length = 0;
    const { models, data } = await this.rpc<ModelsEndpoint>("/models");
    const { role } = await this.rpc<PropsEndpoint>("/props?autoload=false");

    if (role === "router") {
      this.models.push(
        ...data
          .map((m) => new RouterModel(m, this))
          .sort((a, b) => (a.id > b.id ? 1 : a.id === b.id ? 0 : -1)),
      );
    } else {
      this.models.push(...data.map((m) => new SingleModel(m, this)));
    }
  }

  /**
   * Detects if the server is ready
   * @returns True if it's ready to work
   */
  async isReady(): Promise<boolean> {
    try {
      const { status } = await this.rpc<HealthEndpoint>("/health");
      return status === "ok";
    } catch {
      return false;
    }
  }

  /**
   * Makes an HTTP request to the llama-server and returns the parsed JSON response
   *
   * @param endpoint The endpoint path to fetch (e.g. "/health")
   * @param body The optional request body for POST requests
   * @returns The parsed JSON response from the server
   */
  async rpc<T>(endpoint: string, body?: Record<string, unknown>): Promise<T> {
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
