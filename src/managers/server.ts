import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createProvider } from "@earendil-works/pi-ai";
import {
  stream,
  streamSimple,
} from "@earendil-works/pi-ai/api/openai-completions";
import {
  API_KEY_PLACEHOLDER,
  ENDPOINT_PREFIX,
  PROVIDER_NAME,
} from "../constants";
import { ServerStatus } from "../enums/serverStatus";
import type { ServerOptions } from "../interfaces/server";
import type { SortBy } from "../interfaces/sortBy";
import { Model } from "../models/model";
import {
  authRequiredMessage,
  timeoutMessage,
  unreachableMessage,
} from "../ui/strings";
import { createLoginPrompt, resolveApiKey } from "../utils/authBuilder";
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
  private readonly failedUrls: string[] = [];
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
    // (add / remove / URL / id / name) apply on the next scan. Fresh
    // instances every scan: consumers never see a mutated Server.
    const fresh: Server[] = [];
    const seenUrls = new Set<string>(); // dedupe repeated URLs
    const seen = new Set<string>(); // dedupe repeated providerIds
    for (const options of await this.settings.resolveServerConfigs()) {
      if (seenUrls.has(options.baseUrl)) {
        this.warnings.push(
          `Duplicate server URL '${options.baseUrl}' — skipping`,
        );
        continue;
      }
      seenUrls.add(options.baseUrl);

      const { server, status } = await this.serverFactory.create(
        this.settings,
        options,
        timeout,
      );

      // Handle not-ready status
      if (!server) {
        const { baseUrl } = options;

        if (status === ServerStatus.TIMEOUT) {
          this.failedUrls.push(baseUrl);
          this.warnings.push(timeoutMessage(baseUrl, timeout!));
        } else if (status === ServerStatus.UNREACHABLE) {
          this.failedUrls.push(baseUrl);
          this.warnings.push(unreachableMessage(baseUrl));
        } else if (status === ServerStatus.UNAUTHORIZED) {
          // Register a provider with no models, so that it appears in `/login`.
          const providerId = ServerIds.resolve(baseUrl, options.customId);
          this.registerEmptyProvider(baseUrl, options, pi);

          // We don't add to failedUrls here because the server is healthy.
          // We're just unauthorized to use it.
          seen.add(providerId);
          this.warnings.push(authRequiredMessage(baseUrl, providerId));
        }
        continue;
      }

      if (seen.has(server.providerId)) continue;
      seen.add(server.providerId);
      fresh.push(server);
    }

    // Snapshot the old list before replacing it — the unregister loop
    // below iterates `this.servers` (a getter over serverList), so we
    // need the pre-replacement values.
    const oldServers = [...this.servers];

    // Replace in place so the live `servers` view stays valid
    this.serverList.length = 0;
    this.serverList.push(...fresh);

    // Initialization and registration — run first so a failure leaves old
    // providers intact (they are still registered below).
    for (const server of fresh) {
      try {
        await server.initialize();
        await this.registerProvider(server, pi);
      } catch {
        this.failedUrls.push(server.baseUrl);
        const idx = this.serverList.indexOf(server);
        if (idx !== -1) this.serverList.splice(idx, 1);
      }
    }

    // Unregister providers that disappeared (removed or edited away);
    // `seen` tracks all kept providerIds, so we skip those still present.
    for (const old of oldServers) {
      if (seen.has(old.providerId)) continue;
      pi.unregisterProvider(old.providerId);
      // Optional chain is intentional despite the non-optional type: `sse`
      // is undefined until initialize() runs (async-constructor hack — see Server)
      old.sseManager?.disconnect();
    }
  }

  /**
   * Registers the corresponding Pi provider.
   *
   * @param server The server
   * @param pi The Pi API
   */
  private async registerProvider(server: Server, pi: ExtensionAPI) {
    const models = await Promise.all(
      server.models.map((m) => m.toProviderConfig()),
    );

    const provider = createProvider({
      id: server.providerId,
      name: server.providerName,
      baseUrl: server.apiBaseUrl,
      auth: server.toProviderAuth(),
      models,
      api: { stream, streamSimple },
    });

    pi.registerProvider(provider);
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
    const name = options.customName
      ? `${PROVIDER_NAME} (${options.customName})`
      : `${PROVIDER_NAME} (${baseUrl})`;
    const rawKey = this.settings.resolveApiKey(providerId);
    const settingsKey = rawKey !== API_KEY_PLACEHOLDER ? rawKey : undefined;

    const emptyProvider = createProvider({
      id: providerId,
      name,
      baseUrl: `${baseUrl}${ENDPOINT_PREFIX}`,
      auth: {
        apiKey: {
          name: `${PROVIDER_NAME} API key`,
          login: createLoginPrompt(),
          resolve: async (input) => resolveApiKey({ ...input, settingsKey }),
        },
      },
      models: [],
      api: { stream, streamSimple },
    });

    pi.registerProvider(emptyProvider);
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
   * Returns URLs of servers that failed to initialize.
   */
  getFailedUrls(): readonly string[] {
    return [...this.failedUrls];
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
