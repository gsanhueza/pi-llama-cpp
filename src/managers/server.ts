import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { API_TYPE } from "../constants";
import { BaseModel } from "../models/baseModel";
import { Server } from "../server";

export class ServerManager {
  readonly failedUrls: string[] = [];

  constructor(private readonly servers: Server[]) {}

  /**
   * Registers one provider per server in Pi with their model configurations.
   * The manual awaiting per-server is deliberate (we want them in order)
   *
   * @param pi The Pi extension
   */
  async initialize(pi: ExtensionAPI) {
    this.failedUrls.length = 0;

    for (const server of this.servers) {
      try {
        await server.initialize();
        await this.registerProvider(server, pi);
      } catch {
        this.failedUrls.push(server.baseUrl);
        continue;
      }
    }
  }

  /**
   * Creates a Pi provider for the given server
   *
   * @param server The server
   */
  private async registerProvider(server: Server, pi: ExtensionAPI) {
    const { baseUrl, models, providerId, providerName } = server;
    const apiKey = await server.getApiKey();
    const modelConfigs = await Promise.all(
      models.map((m) => m.toProviderConfig()),
    );

    pi.registerProvider(providerId, {
      name: providerName,
      baseUrl: baseUrl,
      api: API_TYPE,
      apiKey: apiKey,
      models: modelConfigs,
    });
  }

  /**
   * Returns all models from all servers.
   *
   * @returns Flat array of all models across all servers
   */
  getAllModels(): BaseModel[] {
    const response = [];

    for (const { models } of this.servers) {
      for (const model of models) {
        response.push(model);
      }
    }

    return response;
  }
}
