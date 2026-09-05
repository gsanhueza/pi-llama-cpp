import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";
import type { ApiClient } from "../src/api/client";
import {
  API_KEY_PLACEHOLDER,
  AUTOLOAD_ON_MESSAGE,
  POLLING_TIMEOUT,
  REACT_TO_MODEL_SELECT,
  SERVER_TIMEOUT,
  SORT_BY,
  THINKING_BUDGETS,
} from "../src/constants";
import { Mode } from "../src/enums/mode";
import { Status } from "../src/enums/status";
import type { LlamaServer } from "../src/interfaces/settings";
import type { LlamaSettingsManager } from "../src/managers/settings";
import { BaseModel } from "../src/models/baseModel";
import { Server } from "../src/server";
import type { SSEManager } from "../src/sse/manager";

/** Shared mock RPC — each test configures it */
export const mockRpc = vi.fn();

/**
 * Hand-made stub of `LlamaSettingsManager` for constructor injection —
 * replaces whole-module `vi.mock` blocks and per-case `vi.spyOn` on the
 * real singleton. Defaults give every consumer-used member a benign value;
 * a case that cares passes just that member as an override. The single
 * `as unknown as` cast lives here so test bodies stay cast-free.
 */
export const makeSettingsStub = (
  overrides: Partial<LlamaSettingsManager> = {},
): LlamaSettingsManager =>
  ({
    resolveTimeouts: vi.fn(() => ({
      pollingTimeout: POLLING_TIMEOUT,
      serverTimeout: SERVER_TIMEOUT,
    })),
    resolveServers: vi.fn((): Server[] => []),
    resolveSortBy: vi.fn(() => SORT_BY),
    resolveApiKey: vi.fn(() => API_KEY_PLACEHOLDER),
    resolveReactToModelSelect: vi.fn(() => REACT_TO_MODEL_SELECT),
    resolveAutoloadOnMessage: vi.fn(() => AUTOLOAD_ON_MESSAGE),
    resolveThinkingLevel: vi.fn(() => undefined),
    resolveThinkingBudgets: vi.fn(() => ({ ...THINKING_BUDGETS })),
    llamaServers: [] as LlamaServer[],
    takeWarnings: vi.fn((): string[] => []),
    setLlamaSetting: vi.fn(() => Promise.resolve()),
    ...overrides,
  }) as unknown as LlamaSettingsManager;

/**
 * Fake `ApiClient`/`SSEManager` pair for injection via `ServerDeps`. The
 * ApiClient delegates every request to the shared `mockRpc`, keyed by the
 * endpoint path (and body for POSTs) — the same contract the old hand-rolled
 * mock server used, so tests keep configuring responses on `mockRpc`. The
 * SSEManager is inert: `disconnect` is a spy and `probeSSE` resolves false,
 * steering load flows onto the HTTP polling path.
 */
export const createFakeClients = (): {
  apiClient: ApiClient;
  sseManager: SSEManager;
} => {
  const apiClient = {
    get: (endpoint: string) => mockRpc(endpoint),
    post: (endpoint: string, body?: Record<string, unknown>) =>
      mockRpc(endpoint, body),
    clearCache: vi.fn(),
  } as unknown as ApiClient;
  const sseManager = {
    disconnect: vi.fn(),
    probeSSE: vi.fn(async () => false),
    subscribeToStatus: vi.fn(),
    subscribeToProgress: vi.fn(() => () => {}),
  } as unknown as SSEManager;
  return { apiClient, sseManager };
};

/**
 * Overrides for {@link createMockServer}. Identity (`baseUrl`/`customId`/
 * `customName`), `apiKey` and the timeout getters are constructor wiring
 * (ServerOptions + a synthesized settings stub) — a real Server has no
 * assignable properties by those names. Everything else is shadowed onto the
 * instance as-is (e.g. a custom `initialize`).
 */
export type MockServerOverrides = Partial<
  Omit<
    Server,
    | "baseUrl"
    | "providerId"
    | "providerName"
    | "pollingTimeout"
    | "serverTimeout"
    | "sseManager"
    | "models"
  >
> & {
  baseUrl?: string;
  customId?: string;
  customName?: string;
  apiKey?: string;
  models?: BaseModel[];
  pollingTimeout?: number;
  serverTimeout?: number;
};

/**
 * Builds a real `Server` wired with fake collaborators (`createFakeClients`),
 * replacing the old hand-rolled `Partial<Server>` mock whose `isReady` /
 * `initialize` re-implementations drifted from the real ones.
 *
 * Seeded `models` land directly in `server.models`; `initialize` is stubbed
 * to a no-op so a `ServerManager.update()` scan cannot wipe the seeds with
 * fetched data — pass an `initialize` override to restore the real flow.
 */
export const createMockServer = (
  overrides: MockServerOverrides = {},
): Server => {
  const {
    baseUrl,
    customId,
    customName,
    apiKey,
    models,
    pollingTimeout,
    serverTimeout,
    initialize,
    ...members
  } = overrides;

  const settings = makeSettingsStub({
    ...(apiKey !== undefined && { resolveApiKey: vi.fn(() => apiKey) }),
    ...((pollingTimeout !== undefined || serverTimeout !== undefined) && {
      resolveTimeouts: vi.fn(() => ({
        pollingTimeout: pollingTimeout ?? POLLING_TIMEOUT,
        serverTimeout: serverTimeout ?? SERVER_TIMEOUT,
      })),
    }),
  });

  const { apiClient, sseManager } = createFakeClients();
  const server = new Server(
    settings,
    {
      baseUrl: baseUrl ?? "http://127.0.0.1:8080",
      customId,
      customName,
    },
    {
      createApiClient: () => apiClient,
      createSSEManager: () => sseManager,
    },
  );
  if (models) server.models.push(...models);
  return Object.assign(server, members, {
    initialize: initialize ?? (async () => {}),
  });
};

/** Helper to create a mock BaseModel */
export const createMockModel = (
  name: string,
  overrides: Partial<BaseModel> = {},
): BaseModel =>
  ({
    name,
    id: name,
    mode: Mode.ROUTER,
    serverUrl: "http://127.0.0.1:8080",
    capabilities: ["text"] as ["text"],
    getStatus: vi.fn().mockResolvedValue(Status.LOADED),
    getContextSize: vi.fn().mockResolvedValue(4096),
    getInfo: vi.fn().mockResolvedValue(`Model: ${name}\nID: ${name}`),
    load: vi.fn().mockResolvedValue(undefined),
    unload: vi.fn().mockResolvedValue(undefined),
    toProviderConfig: vi.fn().mockResolvedValue({}),
    getLabel: vi.fn().mockResolvedValue(name),
    ...overrides,
  }) as unknown as BaseModel;

/** Create a mock extension context */
export const createMockCtx = (
  selectFn: (prompt: string, options: string[]) => string | null,
) => ({
  mode: "tui",
  cwd: "/tmp/test",
  ui: {
    select: vi.fn(selectFn),
    notify: vi.fn(),
    custom: vi.fn(),
    theme: {
      fg: (color: string, text: string) => text,
    },
  },
  modelRegistry: {
    find: vi.fn().mockReturnValue({ id: "test-model-id" }),
  },
});

/** Create a mock Pi instance */
export const createMockPi = () => ({
  setModel: vi.fn(),
  registerProvider: vi.fn(),
  unregisterProvider: vi.fn(),
});

/** Create a mock Pi context for EventManager */
export const createMockPiContext = (notifyFn: ReturnType<typeof vi.fn>) =>
  ({
    ui: {
      notify: notifyFn,
    },
  }) as any as ExtensionContext;
