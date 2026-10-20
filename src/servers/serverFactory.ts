import { Mode } from "../enums/mode";
import type {
  ServerOptions,
  ServerSettingsResolver,
} from "../interfaces/server";
import { ApiClient, ApiError, RequestPolicy } from "../api/client";
import { ServerIds } from "../utils/serverIds";
import { ServerStatus } from "../enums/serverStatus";
import { LegacyServer } from "../servers/legacyServer";
import { LlamaSwapServer } from "../servers/llamaSwapServer";
import { RouterServer } from "../servers/routerServer";
import { Server } from "./server";
import { SingleServer } from "../servers/singleServer";
import { detectMode } from "../utils/detectMode";
import type { ModelsEndpoint } from "../interfaces/endpoints/models";
import type { PropsEndpoint } from "../interfaces/endpoints/props";

/**
 * Result of creating a server, including its readiness status.
 */
interface ServerCreationResult {
  /** The created server, or `null` if the server is unreachable or timed out. */
  server: Server | null;
  /** The status of the server creation. */
  status: ServerStatus;
}

/**
 * Creates mode-aware {@link Server} instances with optional timeout and
 * health checking.
 *
 * When a timeout is provided, the factory probes `/health` and `/v1/models`
 * (auth) before mode detection. If both pass, the server is created and
 * returned with `READY` status. Otherwise `null` + the appropriate status
 * is returned.
 *
 * Without a timeout the factory waits indefinitely for mode detection and
 * returns the server with `READY` status (the caller decides whether to
 * register it).
 */
export class ServerFactory {
  /**
   * Creates a mode-aware server instance with optional health checking.
   *
   * Probes `/health` and `/v1/models` (auth) when a timeout is provided.
   * Detects the server mode from `/props` and `/v1/models`, then
   * instantiates the appropriate subclass.
   *
   * @param resolver — Settings resolver for API keys and polling config.
   * @param options — Server configuration (baseUrl, customId, etc.).
   * @param timeout — Optional timeout in ms for health/auth probes.
   * @param fetchFn — Optional custom fetch implementation.
   * @returns The creation result with server and status.
   */
  async create(
    resolver: ServerSettingsResolver,
    options: ServerOptions,
    timeout?: number,
    fetchFn?: typeof globalThis.fetch,
  ): Promise<ServerCreationResult> {
    const apiClient = new ApiClient(
      options.baseUrl,
      () =>
        resolver.resolveApiKey(
          ServerIds.resolve(options.baseUrl, options.customId),
        ),
      () => resolver.resolvePollingInterval(),
      fetchFn,
    );

    const [health, auth, props] = await Promise.allSettled([
      apiClient.get<number>("/health", timeout, RequestPolicy.Status),
      apiClient.get<ModelsEndpoint>("/v1/models", timeout),
      apiClient.get<PropsEndpoint>("/props?autoload=false", timeout),
    ]);

    // Health probe
    if (health.status === "rejected") {
      return {
        server: null,
        status: Server.isTimeout(health.reason)
          ? ServerStatus.TIMEOUT
          : ServerStatus.UNREACHABLE,
      };
    }

    // Auth probe (always required)
    if (
      auth.status === "rejected" &&
      auth.reason instanceof ApiError &&
      auth.reason.type === "authentication"
    ) {
      return { server: null, status: ServerStatus.UNAUTHORIZED };
    }

    // Non-auth auth rejection: server reachable but broken
    if (auth.status === "rejected") {
      return { server: null, status: ServerStatus.UNREACHABLE };
    }

    // Mode detection
    const mode = detectMode(
      props.status === "fulfilled" ? props.value : ({} as PropsEndpoint),
      auth.value.data,
    );

    const Ctor =
      {
        [Mode.ROUTER]: RouterServer,
        [Mode.LEGACY]: LegacyServer,
        [Mode.SINGLE]: SingleServer,
        [Mode.LLAMASWAP]: LlamaSwapServer,
      }[mode] ?? SingleServer;

    const server = new Ctor(resolver, options, apiClient, fetchFn);
    server.status = ServerStatus.READY;

    return { server, status: ServerStatus.READY };
  }
}
