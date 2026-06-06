import { HealthEndpoint } from "./interfaces/endpoints/health";
import { ModelsEndpoint } from "./interfaces/endpoints/models";
import { BaseModel } from "./models/baseModel";
import { RouterModel } from "./models/routerModel";
import { SingleModel } from "./models/singleModel";

export class Server {
  readonly models: BaseModel[] = [];

  constructor(
    readonly baseUrl: string,
    readonly apiKey?: string,
  ) {}

  /**
   * Instantiates a list of models available to this server
   */
  async initialize() {
    this.models.length = 0;
    const { models, data } = await this.rpc<ModelsEndpoint>("/models");

    if (models) {
      this.models.push(...data.map((m) => new SingleModel(m, this)));
    } else {
      this.models.push(
        ...data
          .map((m) => new RouterModel(m, this))
          .sort((a, b) => (a.id > b.id ? 1 : a.id === b.id ? 0 : -1)),
      );
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

    const data = {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    };

    const res = await fetch(url, {
      ...data,
      headers: {
        ...data.headers,
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
    });

    const response: T = await res.json();
    return response;
  }
}
