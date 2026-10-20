import { vi } from "vitest";
import { API_KEY_PLACEHOLDER } from "../../src/constants";
import { defaultBaseUrl } from "../constants";
import { ApiClient } from "../../src/api/client";
import { ServerIds } from "../../src/utils/serverIds";
import { PollingTimeoutSettingsItem } from "../../src/settings/items/pollingTimeout";
import { ServerTimeoutSettingsItem } from "../../src/settings/items/serverTimeout";
import type { ServerSettingsResolver } from "../../src/interfaces/server";
import type { ServerOptions } from "../../src/interfaces/server";
import { SSEManager } from "../../src/sse/manager";
import { makeResolverStub } from "./settings";
import { Model } from "../../src/models/model";
import { SingleServer } from "../../src/servers/singleServer";

/** Default resolver stub — omit the resolver argument to use this. */
const defaultResolver = makeResolverStub({
  resolveApiKey: vi.fn(() => API_KEY_PLACEHOLDER),
  resolvePollingTimeout: vi.fn(
    async () => PollingTimeoutSettingsItem.defaultValue,
  ),
  resolveServerTimeout: vi.fn(
    async () => ServerTimeoutSettingsItem.defaultValue,
  ),
});

/** Sentinel — omit the resolver (uses a no-op stub). */
export const mockResolver: ServerSettingsResolver = defaultResolver;

/** Sentinel — omit the options (uses a default baseUrl). */
export const mockServerOptions = {} as Partial<ServerOptions>;

/**
 * Default `fetchFn` for mock servers: always throws. Prevents tests from
 * ever touching a real llama-server (e.g. one listening on localhost)
 * when no `fetchFn` was injected — pass `fetchFn: createRpcFetch(mockRpc)`
 * to wire a server's HTTP to the file's mock RPC.
 */
const guardFetch = (): typeof globalThis.fetch =>
  vi.fn(async () => {
    throw new Error(
      "Mock server performed an HTTP request without an injected fetchFn — pass fetchFn: createRpcFetch(mockRpc) to createMockServer.",
    );
  });

/**
 * Options for {@link createMockServer}.
 */
export interface CreateMockServerOptions {
  resolver?: ServerSettingsResolver;
  options?: Partial<ServerOptions>;
  models?: Model[];
  overrides?: Partial<SingleServer>;
  sse?: { disconnect: () => void };
  /** Injectable fetch — used to build the server's ApiClient. */
  fetchFn?: typeof globalThis.fetch;
}

/**
 * Builds a real `Server` wired with fake collaborators.
 *
 * If `resolver` is omitted a no-op stub is used — tests that need custom
 * apiKey / timeouts should pass their own via `makeResolverStub`.
 */
export const createMockServer = (
  opts: CreateMockServerOptions = {},
): SingleServer => {
  const { resolver, options, models, overrides, sse, fetchFn } = opts;
  const effectiveResolver = resolver ?? defaultResolver;

  const effectiveFetch = fetchFn ?? guardFetch();
  const apiClient = new ApiClient(
    options?.baseUrl ?? defaultBaseUrl(),
    () =>
      effectiveResolver.resolveApiKey(
        options?.customId ??
          ServerIds.resolve(
            options?.baseUrl ?? defaultBaseUrl(),
            options?.customId,
          ),
      ),
    () => effectiveResolver.resolvePollingInterval(),
    effectiveFetch,
  );

  const server = new SingleServer(
    effectiveResolver,
    {
      baseUrl: options?.baseUrl ?? defaultBaseUrl(),
      customId: options?.customId,
      customName: options?.customName,
      overrides: options?.overrides,
    },
    apiClient,
  );
  if (models) server.models.push(...models);
  // Create an SSEManager so `server.sseManager` is available for tests
  // that call `probeSSE()` etc. — initialize() would do this in real code.
  const sseManager = new SSEManager(
    server,
    effectiveResolver,
    undefined,
    fetchFn ?? guardFetch(),
  );
  if (sse) {
    sseManager.disconnect = sse.disconnect;
  }
  server.sse = sseManager;
  // Stub initialize to a no-op so seeded models aren't overwritten by
  // network fetches — tests that need the real flow pass an override.
  server.initialize = overrides?.initialize ?? (async () => {});
  return Object.assign(server, overrides, {
    initialize: server.initialize,
    loadModel: vi.fn().mockResolvedValue(undefined),
    unloadModel: vi.fn().mockResolvedValue(undefined),
  });
};

/**
 * Convenience: create a seeded server with the default resolver —
 * the most common test pattern.
 */
export const createTestServer = (
  baseUrl: string,
  models: Model[],
  disconnects?: () => void,
): SingleServer =>
  createMockServer({
    resolver: mockResolver,
    options: { baseUrl },
    models,
    sse: disconnects ? { disconnect: disconnects } : undefined,
  });
