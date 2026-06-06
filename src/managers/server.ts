import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { API_TYPE } from "../constants";
import { BaseModel } from "../models/baseModel";
import { Server } from "../server";

export class ServerManager {
  readonly failedUrls: string[] = [];

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly servers: Server[],
  ) {}

  /**
   * Registers one provider per server in Pi with their model configurations.
   * Call this after the servers have been initialized.
   * The manual awaiting per-server is deliberate (we want them in order)
   */
  async registerAllProviders() {
    this.failedUrls.length = 0;

    for (const server of this.servers) {
      await this.registerProvider(server);
    }
  }

  /**
   * Creates a Pi provider for the given server
   *
   * @param server The server
   */
  private async registerProvider(server: Server) {
    try {
      await server.initialize();
    } catch {
      this.failedUrls.push(server.baseUrl);
      return;
    }

    // Setup the Pi registration
    const { baseUrl, models, providerId, providerName } = server;
    const apiKey = await server.getApiKey();
    const modelConfigs = await Promise.all(
      models.map((m) => m.toProviderConfig()),
    );

    this.pi.registerProvider(providerId, {
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
