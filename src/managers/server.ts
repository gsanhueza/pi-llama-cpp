import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { ENDPOINT_PREFIX, API_TYPE, PROVIDER_NAME } from "../constants";
import { ServerStatus } from "../enums/serverStatus";
import type { ServerOptions } from "../interfaces/server";
import type { SortBy } from "../interfaces/sortBy";
import { Model } from "../models/model";
import {
  authRequiredMessage,
  duplicateUrlWarning,
  timeoutMessage,
  providerUnreachable,
} from "../ui/notifyMessages";
import { ServerFactory } from "../servers/serverFactory";
import type { SettingsService } from "../settings/settings";
import type { Server } from "../servers/server";
import { ServerIds } from "../utils/serverIds";

/** Model-list comparator: negative if a sorts first, positive if b does. */
type ModelComparator = (a: Model, b: Model) => number;

export class ServerManager {
  constructor(
    private readonly settings: SettingsService,
    private readonly serverFactory: ServerFactory,
  ) {}
  private readonly errors: string[] = [];
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
    this.errors.length = 0;
    this.warnings.length = 0;

    // Snapshot the old list before replacing it — the unregister loop
    // below iterates `this.servers` (a getter over serverList), so we
    // need the pre-replacement values.
    const oldServers = [...this.servers];

    // Surface warnings from strict URL parsing (dropped invalid entries)
    this.warnings.push(...this.settings.takeWarnings());

    // Discover, initialize, and filter out failures
    const { fresh, seenIds } = await this.initializeServers(pi, timeout);

    // Register only initialized servers
    const registered: Server[] = [];
    for (const server of fresh) {
      await this.registerProvider(server, pi);
      registered.push(server);
    }

    // Swap the final list so the live `servers` view stays valid
    this.serverList.length = 0;
    this.serverList.push(...registered);

    // Unregister providers that disappeared (removed or edited away)
    this.unregisterStaleProviders(pi, oldServers, seenIds);
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
   * Returns errors collected during initialization.
   */
  getErrors(): string[] {
    const errors = [...this.errors];
    this.errors.length = 0;

    return errors;
  }

  /**
   * Returns the server for a given model.
   *
   * @param model - The model to find the server for
   * @returns The server containing the model, or `undefined` when no
   * current server matches (e.g. removed while a model was loading)
   */
  getServer(model: Model): Server | undefined {
    return this.servers.find((s) => s.baseUrl === model.serverUrl);
  }

  /**
   * Initializes the server and registers the corresponding Pi provider.
   *
   * @param server The server
   * @param pi The Pi API
   */
  private async registerProvider(server: Server, pi: ExtensionAPI) {
    const modelConfigs: ProviderModelConfig[] = await Promise.all(
      server.models.map((m) => m.toProviderConfig()),
    );
    pi.registerProvider(server.providerId, {
      name: server.providerName,
      baseUrl: server.apiBaseUrl,
      api: API_TYPE,
      apiKey: server.apiKey,
      headers: server.headers,
      models: modelConfigs,
    });
  }

  /**
   * Registers an empty provider for an unauthorized server so the user
   * can authenticate via `/login`. The next scan will pick up models
   * once the key is set.
   *
   * @param baseUrl The server base URL
   * @param options Server configuration (customId, customName)
   * @param pi The Pi extension API
   */
  private registerEmptyProvider(
    baseUrl: string,
    options: ServerOptions,
    pi: ExtensionAPI,
  ): void {
    const providerId = ServerIds.resolve(baseUrl, options.customId);

    pi.registerProvider(providerId, {
      name: options.customName
        ? `${PROVIDER_NAME} (${options.customName})`
        : `${PROVIDER_NAME} (${baseUrl})`,
      baseUrl: `${baseUrl}${ENDPOINT_PREFIX}`,
      api: API_TYPE,
      apiKey: this.settings.resolveApiKey(providerId),
      models: [],
    });
  }

  /**
   * Discovers servers from settings, initializes them, and handles
   * not-ready statuses (TIMEOUT, UNREACHABLE, UNAUTHORIZED).
   * Returns only servers that initialized successfully.
   *
   * @param pi The Pi extension API
   * @param timeout Server timeout for factory creation
   * @returns Initialized server list and the set of seen provider IDs
   */
  private async initializeServers(
    pi: ExtensionAPI,
    timeout?: number,
  ): Promise<{ fresh: Server[]; seenIds: Set<string> }> {
    const fresh: Server[] = [];
    const seenIds = new Set<string>(); // dedupe repeated providerIds

    // Create all servers in parallel
    const serverOptions = await this.findServerOptions();
    const results = await Promise.all(
      serverOptions.map(async (opt) => ({
        options: opt,
        ...(await this.serverFactory.create(this.settings, opt, timeout)),
      })),
    );

    // Process results sequentially
    const candidates: Server[] = [];
    for (const { options, server, status } of results) {
      if (!server) {
        const { baseUrl } = options;

        if (status === ServerStatus.TIMEOUT) {
          this.warnings.push(timeoutMessage(baseUrl, timeout!));
        } else if (status === ServerStatus.UNREACHABLE) {
          this.errors.push(providerUnreachable(baseUrl));
        } else if (status === ServerStatus.UNAUTHORIZED) {
          // Register a provider with no models, so that it appears in `/login`.
          const providerId = ServerIds.resolve(baseUrl, options.customId);
          this.registerEmptyProvider(baseUrl, options, pi);

          // We don't add to errors here because the server is healthy.
          // We're just unauthorized to use it.
          seenIds.add(providerId);
          this.warnings.push(authRequiredMessage(baseUrl, providerId));
        }
        continue;
      }

      if (seenIds.has(server.providerId)) continue;
      seenIds.add(server.providerId);
      candidates.push(server);
    }

    // Initialize candidates in parallel
    const initResults = await Promise.allSettled(
      candidates.map((server) => server.initialize()),
    );

    // Post-process initialization results
    for (let i = 0; i < initResults.length; i++) {
      if (initResults[i].status === "fulfilled") {
        fresh.push(candidates[i]);
      } else {
        this.errors.push(providerUnreachable(candidates[i].baseUrl));
      }
    }

    return { fresh, seenIds };
  }

  /**
   * Unregisters providers that disappeared (removed or edited away) and
   * disconnects their SSE managers.
   *
   * @param oldServers The previous server list snapshot
   * @param seenIds Set of provider IDs kept in the current scan
   */
  private unregisterStaleProviders(
    pi: ExtensionAPI,
    oldServers: readonly Server[],
    seenIds: Set<string>,
  ): void {
    for (const old of oldServers) {
      if (seenIds.has(old.providerId)) continue;
      pi.unregisterProvider(old.providerId);
      // Optional chain is intentional despite the non-optional type: `sse`
      // is undefined until initialize() runs (async-constructor hack — see Server)
      old.sseManager?.disconnect();
    }
  }

  /**
   * Returns all non-duplicated server configurations
   *
   * @returns List of valid configurations
   */
  private async findServerOptions(): Promise<ServerOptions[]> {
    const seenUrls = new Set<string>(); // dedupe repeated URLs
    const response = [];

    for (const config of await this.settings.resolveServerConfigs()) {
      if (seenUrls.has(config.baseUrl)) {
        this.warnings.push(duplicateUrlWarning(config.baseUrl));
        continue;
      }

      seenUrls.add(config.baseUrl);
      response.push(config);
    }

    return response;
  }

  /**
   * Returns all models from all servers, sorted by the configured sort mode.
   * Servers maintain their order from `llamaSettings`; sorting only applies
   * to models within each server.
   *
   * @returns Flat array of all models across all servers
   */
  async getAllModels(): Promise<Model[]> {
    const sortBy = await this.settings.resolveSortBy();

    if (sortBy === "api") {
      return this.servers.flatMap((s) => s.models);
    }

    const sorter = ServerManager.SORTERS[sortBy];
    return this.servers.flatMap((s) => [...s.models].sort(sorter));
  }

  private static sortByIdAsc(a: Model, b: Model): number {
    return a.id.localeCompare(b.id);
  }

  private static sortByIdDesc(a: Model, b: Model): number {
    return b.id.localeCompare(a.id);
  }

  /** Name ascending, with ID as tiebreaker. */
  private static sortByNameAsc(a: Model, b: Model): number {
    const cmp = a.name.localeCompare(b.name);
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  }

  /** Name descending, with ID as tiebreaker. */
  private static sortByNameDesc(a: Model, b: Model): number {
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
