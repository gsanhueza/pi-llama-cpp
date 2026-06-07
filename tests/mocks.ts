import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";
import { Mode } from "../src/enums/mode";
import { ServerStatus } from "../src/enums/serverStatus";
import { Status } from "../src/enums/status";
import { BaseModel } from "../src/models/baseModel";
import { Server } from "../src/server";

/** Shared mock RPC — each test configures it */
export const mockRpc = vi.fn();

/** Default mock server that assumes everything works */
export const createMockServer = (
  overrides: Partial<Server & { apiKey?: string }> = {},
): Server => {
  const models: BaseModel[] = [];
  const server: Partial<Server> = {
    baseUrl: "http://127.0.0.1:8080",
    models,
    getApiKey: () => Promise.resolve(overrides.apiKey ?? ""),
    fetchModels: () => mockRpc("/v1/models"),
    fetchModelProps: (modelId: string) =>
      mockRpc(`/props?model=${modelId}&autoload=false`),
    fetchServerHealth: () => mockRpc("/health"),
    fetchServerProps: () => mockRpc("/props?autoload=false"),
    postRequest: (resource: "load" | "unload", model: string) =>
      mockRpc(`/models/${resource}`, { model }),
    isReady: async (timeout: number) => {
      try {
        const r = await mockRpc("/health");
        return r.status === "ok"
          ? ServerStatus.READY
          : ServerStatus.UNREACHABLE;
      } catch {
        return ServerStatus.UNREACHABLE;
      }
    },
    initialize: async () => {
      const { data } = (await mockRpc("/v1/models")) as {
        data: BaseModel[];
      };
      models.length = 0;
      models.push(...(data ?? []));
    },
    ...overrides,
  };
  return server as Server;
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
  cwd: "/tmp/test",
  ui: {
    select: vi.fn(selectFn),
    notify: vi.fn(),
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
});

/** Create a mock Pi context for EventManager */
export const createMockPiContext = (notifyFn: ReturnType<typeof vi.fn>) =>
  ({
    ui: {
      notify: notifyFn,
    },
  }) as any as ExtensionContext;
