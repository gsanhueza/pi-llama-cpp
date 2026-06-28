import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { API_TYPE, PROVIDER_NAME, SERVER_TIMEOUT } from "../constants";
import { ServerStatus } from "../enums/serverStatus";
import { BaseModel } from "../models/baseModel";
import { Server } from "../server";

export class ServerManager {
  readonly failedUrls: string[] = [];
  private readonly warnings: string[] = [];

  constructor(private readonly servers: Server[]) {}

  /**
   * Verifies reachability of servers and registers the providers
   *
   * @param pi The Pi extension API
   */
  async initialize(pi: ExtensionAPI) {
    // Register the providers with a timeout first
    await this.update(pi, SERVER_TIMEOUT);
  }

  /**
   * Registers one provider per server in Pi with their model configurations.
   * The manual awaiting per-server is deliberate (we want them in order)
   *
   * @param pi The Pi extension API
   * @param timeout (Optional) Timeout before assuming server has failed
   */
  async update(pi: ExtensionAPI, timeout?: number) {
    this.failedUrls.length = 0;

    const registrableServers = timeout
      ? await this.findRegistrableServers(timeout)
      : this.servers;

    // Initialization and registration
    for (const server of registrableServers) {
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
   * Runs concurrent health checks and returns only healthy servers.
   *
   * @param timeout Maximum time to wait for each server
   * @returns Array of servers that passed the health check
   */
  private async findRegistrableServers(timeout: number): Promise<Server[]> {
    const healthResults = await Promise.all(
      this.servers.map(async (server) => {
        const status = await server.isReady(timeout);
        return { server, status };
      }),
    );

    const response: Server[] = [];
    for (const { server, status } of healthResults) {
      if (status === ServerStatus.READY) {
        response.push(server);
      } else if (status === ServerStatus.TIMEOUT) {
        const message = [
          "[pi-llama-cpp]",
          `${PROVIDER_NAME} server initialization for '${server.baseUrl}' took more than ${SERVER_TIMEOUT} ms, so it has been skipped.`,
          "Run `/models` to retry without timeout and see all models.",
        ].join("\n");
        this.warnings.push(message);
        this.failedUrls.push(server.baseUrl);
      } else {
        const message = [
          "[pi-llama-cpp]",
          `${PROVIDER_NAME} server at '${server.baseUrl}' is unreachable.`,
          "Check the URL and try again. Run `/models` to retry.",
        ].join("\n");
        this.warnings.push(message);
        this.failedUrls.push(server.baseUrl);
      }
    }

    return response;
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
   * Returns warnings collected during initialization.
   */
  getWarnings(): string[] {
    const warnings = [...this.warnings];
    this.warnings.length = 0;

    return warnings;
  }

  /**
   * Returns the server for a given model.
   *
   * @param model - The model to find the server for
   * @returns The server containing the model
   */
  getServer(model: BaseModel): Server {
    return this.servers.find((s) => s.baseUrl === model.serverUrl)!;
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
