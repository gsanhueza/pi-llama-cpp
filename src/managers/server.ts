import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { ApiError } from "../api/client";
import { API_TYPE, PROVIDER_NAME } from "../constants";
import { ServerStatus } from "../enums/serverStatus";
import type { SortBy } from "../interfaces/sortBy";
import { BaseModel } from "../models/baseModel";
import { Server } from "../server";
import type { LlamaSettingsManager } from "./settings";

/** Model-list comparator: negative if a sorts first, positive if b does. */
type ModelComparator = (a: BaseModel, b: BaseModel) => number;

export class ServerManager {
  constructor(private readonly settings: LlamaSettingsManager) {}
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
    const { serverTimeout } = await this.settings.resolveTimeouts();
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
    this.warnings.length = 0;

    // Surface warnings from strict URL parsing (dropped invalid entries)
    this.warnings.push(...this.settings.takeWarnings());

    // Re-derive the server list from settings so `/models servers` edits
    // (add / remove / URL / id / name) apply on the next scan
    const fresh: Server[] = [];
    const seen = new Set<string>(); // dedupe repeated URLs (same providerId)
    for (const server of await this.settings.resolveServers()) {
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
      await this.registerProvider(server, pi);
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
   * Initializes the server and creates a Pi provider.
   * Handles auth errors by registering with an empty model list so the user
   * can still configure the API key via `/login` or `auth.json`.
   *
   * @param server The server
   * @param pi The Pi API
   */
  private async registerProvider(server: Server, pi: ExtensionAPI) {
    const { apiBaseUrl, apiKey, baseUrl, models, providerId, providerName } =
      server;
    let modelConfigs: ProviderModelConfig[] = [];

    try {
      await server.initialize();
      modelConfigs = await Promise.all(models.map((m) => m.toProviderConfig()));
    } catch (err) {
      if (err instanceof ApiError && err.type === "authentication") {
        // Don't add to `failedUrls` — the server IS reachable, auth just
        // isn't configured yet, so the health indicator should stay green.
        const message = [
          "[pi-llama-cpp]",
          `Server at '${baseUrl}' requires a valid API key.`,
          `Configure the key via '/login ${providerId}' or in '${getAgentDir()}/auth.json'.`,
        ].join("\n");

        this.warnings.push(message);
      } else {
        this.failedUrls.push(baseUrl);
        return;
      }
    }

    pi.registerProvider(providerId, {
      name: providerName,
      baseUrl: apiBaseUrl,
      api: API_TYPE,
      apiKey,
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
   * Servers maintain their order from `llamaSettings`; sorting only applies
   * to models within each server.
   *
   * @returns Flat array of all models across all servers
   */
  async getAllModels(): Promise<BaseModel[]> {
    const sortBy = await this.settings.resolveSortBy();

    if (sortBy === "api") {
      return this.servers.flatMap((s) => s.models);
    }

    const sorter = ServerManager.SORTERS[sortBy];
    return this.servers.flatMap((s) => [...s.models].sort(sorter));
  }

  private static sortByIdAsc(a: BaseModel, b: BaseModel): number {
    return a.id.localeCompare(b.id);
  }

  private static sortByIdDesc(a: BaseModel, b: BaseModel): number {
    return b.id.localeCompare(a.id);
  }

  /** Name ascending, with ID as tiebreaker. */
  private static sortByNameAsc(a: BaseModel, b: BaseModel): number {
    const cmp = a.name.localeCompare(b.name);
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  }

  /** Name descending, with ID as tiebreaker. */
  private static sortByNameDesc(a: BaseModel, b: BaseModel): number {
    const cmp = b.name.localeCompare(a.name);
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  }

  /**
   * Comparators for sorting models within each server.
   */
  private static readonly SORTERS: Record<
    Exclude<SortBy, "api">,
    ModelComparator
  > = {
    asc: ServerManager.sortByIdAsc,
    desc: ServerManager.sortByIdDesc,
    "asc-name": ServerManager.sortByNameAsc,
    "desc-name": ServerManager.sortByNameDesc,
  };
}
