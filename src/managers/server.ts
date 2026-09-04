import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { API_TYPE, PROVIDER_NAME } from "../constants";
import { ServerStatus } from "../enums/serverStatus";
import { BaseModel } from "../models/baseModel";
import { Server } from "../server";
import { settings } from "./settings";

export class ServerManager {
  readonly failedUrls: string[] = [];
  private readonly warnings: string[] = [];
  private readonly serverList: Server[] = [];

  /**
   * Live view of the server list. `update()` re-derives the list from
   * settings on every scan (in place), so `/models servers` edits apply
   * without a restart.
   */
  get servers(): readonly Server[] {
    return this.serverList;
  }

  /**
   * Verifies reachability of servers and registers the providers
   *
   * @param pi The Pi extension API
   */
  async initialize(pi: ExtensionAPI) {
    // Register the providers with the configured server timeout
    const { serverTimeout } = settings.resolveTimeouts();
    await this.update(pi, serverTimeout);
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

    // Re-derive the server list from settings so `/models servers` edits
    // (add / remove / URL / id / name) apply on the next scan
    const fresh: Server[] = [];
    const seen = new Set<string>(); // dedupe repeated URLs (same providerId)
    for (const server of settings.resolveServers()) {
      if (seen.has(server.providerId)) continue;
      seen.add(server.providerId);
      fresh.push(server);
    }

    // Unregister providers that disappeared (removed or edited away);
    // no-op for providers that were never registered
    for (const old of this.servers) {
      if (fresh.some((f) => f.providerId === old.providerId)) continue;
      pi.unregisterProvider(old.providerId);
      // Optional chain is intentional despite the non-optional type: `sse`
      // is undefined until initialize() runs (async-constructor hack — see Server)
      old.sseManager?.disconnect();
    }

    // Replace in place so the live `servers` view stays valid (D1)
    this.serverList.length = 0;
    this.serverList.push(...fresh);

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
          `${PROVIDER_NAME} server initialization for '${server.baseUrl}' took more than ${timeout} ms, so it has been skipped.`,
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
    const apiKey = server.getApiKey();
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
   * @returns The server containing the model, or `undefined` when no
   * current server matches (e.g. removed while a model was loading)
   */
  getServer(model: BaseModel): Server | undefined {
    return this.servers.find((s) => s.baseUrl === model.serverUrl);
  }

  /**
   * Returns all models from all servers, sorted by the configured sort mode.
   *
   * @returns Flat array of all models across all servers
   */
  getAllModels(): BaseModel[] {
    const sortBy = settings.resolveSortBy();
    const allModels = this.flattenModels();

    if (sortBy === "api") return allModels;

    const sorters = {
      asc: this.sortByIdAsc,
      desc: this.sortByIdDesc,
      "asc-name": this.sortByNameAsc,
      "desc-name": this.sortByNameDesc,
    };

    return allModels.sort(sorters[sortBy]);
  }

  /**
   * Flattens all models from all servers into a single array.
   *
   * @returns Flat array of all models across all servers
   */
  private flattenModels(): BaseModel[] {
    const response: BaseModel[] = [];

    for (const { models } of this.servers) {
      for (const model of models) {
        response.push(model);
      }
    }

    return response;
  }

  /**
   * Sorts models by ID in ascending order.
   *
   * @returns Negative if a < b, zero if equal, positive if a > b
   */
  private sortByIdAsc = (a: BaseModel, b: BaseModel): number =>
    a.id.localeCompare(b.id);

  /**
   * Sorts models by ID in descending order.
   *
   * @returns Negative if a > b, zero if equal, positive if a < b
   */
  private sortByIdDesc = (a: BaseModel, b: BaseModel): number =>
    b.id.localeCompare(a.id);

  /**
   * Sorts models by name in ascending order, with ID as tiebreaker.
   *
   * @returns Negative if a < b, zero if equal, positive if a > b
   */
  private sortByNameAsc = (a: BaseModel, b: BaseModel): number => {
    const cmp = a.name.localeCompare(b.name);
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  };

  /**
   * Sorts models by name in descending order, with ID as tiebreaker.
   *
   * @returns Negative if a > b, zero if equal, positive if a < b
   */
  private sortByNameDesc = (a: BaseModel, b: BaseModel): number => {
    const cmp = b.name.localeCompare(a.name);
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  };
}
