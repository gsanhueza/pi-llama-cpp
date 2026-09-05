import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerManager } from "../src/managers/server";
import { BaseModel } from "../src/models/baseModel";
import { Server } from "../src/server";
import {
  createMockModel,
  createMockServer,
  makeSettingsStub,
  mockRpc,
} from "./mocks";

// Injected settings stub — the single instance passed to ServerManager and
// to every real `new Server(...)` construction below (Server's eager
// getApiKey() resolves the stub's placeholder, never consumed). Tests
// re-stub members per case instead of module-mocking the singleton.
const settingsStub = makeSettingsStub();

const mockPi = {
  registerProvider: vi.fn(),
  unregisterProvider: vi.fn(),
  registerCommand: vi.fn(),
  setModel: vi.fn(),
};

/**
 * Creates a ServerManager whose list is driven by the mocked
 * `settings.resolveServers()` — the same path a real scan takes.
 */
const createManager = async (...servers: Server[]): Promise<ServerManager> => {
  vi.mocked(settingsStub.resolveServers).mockReturnValue(servers);
  const manager = new ServerManager(settingsStub);
  await manager.update(mockPi as any);
  return manager;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockImplementation((endpoint: string, fallback?: unknown) => {
    const defaults: Record<string, unknown> = {
      "/health": { status: "ok" },
      "/props?autoload=false": { role: "router" },
      "/v1/models": { data: [], object: "list" },
    };
    return Promise.resolve(defaults[endpoint] ?? fallback ?? {});
  });
});

describe("Server", () => {
  it("should generate provider IDs from URLs", () => {
    const server1 = new Server(settingsStub, {
      baseUrl: "http://127.0.0.1:8080",
    });
    expect(server1.providerId).toBe("llama-server=http://127.0.0.1:8080");
    const server2 = new Server(settingsStub, {
      baseUrl: "http://10.0.0.5:8080",
    });
    expect(server2.providerId).toBe("llama-server=http://10.0.0.5:8080");
    const server3 = new Server(settingsStub, { baseUrl: "http://127.0.0.1" });
    expect(server3.providerId).toBe("llama-server=http://127.0.0.1");
    const server4 = new Server(settingsStub, {
      baseUrl: "http://127.0.0.1:80",
    });
    expect(server4.providerId).toBe("llama-server=http://127.0.0.1:80");
    const server5 = new Server(settingsStub, {
      baseUrl: "https://127.0.0.1:443",
    });
    expect(server5.providerId).toBe("llama-server=https://127.0.0.1:443");
  });

  it("should generate provider names from URLs", () => {
    const server1 = new Server(settingsStub, {
      baseUrl: "http://127.0.0.1:8080",
    });
    expect(server1.providerName).toBe("Llama.cpp (http://127.0.0.1:8080)");
    const server2 = new Server(settingsStub, {
      baseUrl: "http://10.0.0.5:8080",
    });
    expect(server2.providerName).toBe("Llama.cpp (http://10.0.0.5:8080)");
  });
});

describe("ServerManager", () => {
  it("should register providers for all servers", async () => {
    const mockModel = {
      name: "test-model",
      id: "test-model",
      toProviderConfig: vi.fn().mockResolvedValue({ id: "test-model" }),
    } as unknown as BaseModel;
    const server1 = createMockServer({
      baseUrl: "http://127.0.0.1:8080",
      apiKey: "key-1",
      models: [mockModel],
    });
    const server2 = createMockServer({
      baseUrl: "http://127.0.0.1:8081",
      apiKey: "key-2",
      models: [mockModel],
    });
    const manager = await createManager(server1, server2);

    expect(mockPi.registerProvider).toHaveBeenCalledTimes(2);
    expect(mockPi.registerProvider).toHaveBeenCalledWith(
      "llama-server=http://127.0.0.1:8080",
      {
        name: "Llama.cpp (http://127.0.0.1:8080)",
        baseUrl: "http://127.0.0.1:8080",
        api: "openai-completions",
        apiKey: "key-1",
        models: [{ id: "test-model" }],
      },
    );
    expect(mockPi.registerProvider).toHaveBeenCalledWith(
      "llama-server=http://127.0.0.1:8081",
      {
        name: "Llama.cpp (http://127.0.0.1:8081)",
        baseUrl: "http://127.0.0.1:8081",
        api: "openai-completions",
        apiKey: "key-2",
        models: [{ id: "test-model" }],
      },
    );
  });

  it("should return all models from all servers", async () => {
    const mockModel1 = createMockModel("model-1");
    const mockModel2 = createMockModel("model-2");
    const server1 = createMockServer({
      baseUrl: "http://127.0.0.1:8080",
      models: [mockModel1],
    });
    const server2 = createMockServer({
      baseUrl: "http://127.0.0.1:8081",
      models: [mockModel2],
    });
    const manager = await createManager(server1, server2);

    const allModels = manager.getAllModels();

    expect(allModels).toHaveLength(2);
    expect(allModels[0]).toBe(mockModel1);
    expect(allModels[1]).toBe(mockModel2);
  });

  describe("live server list (re-derived from settings)", () => {
    /** Mock server; providerId/name derive from the URL as in production. */
    const makeServer = (url: string, modelName?: string): Server =>
      createMockServer({
        baseUrl: url,
        ...(modelName
          ? { models: [createMockModel(modelName, { serverUrl: url })] }
          : {}),
      });

    it("should register servers added after the first scan", async () => {
      const server1 = makeServer("http://127.0.0.1:8080", "model-1");
      vi.mocked(settingsStub.resolveServers).mockReturnValue([server1]);
      const manager = new ServerManager(settingsStub);
      await manager.update(mockPi as any);
      expect(manager.servers).toHaveLength(1);

      const server2 = makeServer("http://127.0.0.1:8081", "model-2");
      vi.mocked(settingsStub.resolveServers).mockReturnValue([
        server1,
        server2,
      ]);
      await manager.update(mockPi as any);

      expect(mockPi.registerProvider).toHaveBeenCalledWith(
        "llama-server=http://127.0.0.1:8081",
        expect.objectContaining({ baseUrl: "http://127.0.0.1:8081" }),
      );
      expect(manager.servers).toHaveLength(2);
      expect(manager.getAllModels().map((m) => m.id)).toEqual([
        "model-1",
        "model-2",
      ]);
    });

    it("should unregister and disconnect removed servers on the next scan", async () => {
      const disconnectKept = vi.fn();
      const disconnectRemoved = vi.fn();
      const server1 = makeServer("http://127.0.0.1:8080", "model-1");
      const server2 = makeServer("http://127.0.0.1:8081", "model-2");
      // createMockServer stubs initialize out (models are pre-seeded), so the
      // SSE managers never get wired; seed the slots ServerManager reaches
      // disconnect through, mirroring an initialized server.
      (server1 as any).sse = { disconnect: disconnectKept };
      (server2 as any).sse = { disconnect: disconnectRemoved };

      const manager = await createManager(server1, server2);
      expect(manager.servers).toHaveLength(2);

      vi.mocked(settingsStub.resolveServers).mockReturnValue([server1]);
      await manager.update(mockPi as any);

      expect(mockPi.unregisterProvider).toHaveBeenCalledTimes(1);
      expect(mockPi.unregisterProvider).toHaveBeenCalledWith(
        "llama-server=http://127.0.0.1:8081",
      );
      expect(disconnectRemoved).toHaveBeenCalledTimes(1);
      // Surviving providers keep their SSE manager connected (today's behavior)
      expect(disconnectKept).not.toHaveBeenCalled();
      expect(manager.getAllModels().map((m) => m.id)).toEqual(["model-1"]);
    });

    it("should unregister the old provider when a server URL changes", async () => {
      const manager = await createManager(
        makeServer("http://127.0.0.1:8080", "model-1"),
      );

      vi.mocked(settingsStub.resolveServers).mockReturnValue([
        makeServer("http://127.0.0.1:9090", "model-1"),
      ]);
      await manager.update(mockPi as any);

      expect(mockPi.unregisterProvider).toHaveBeenCalledWith(
        "llama-server=http://127.0.0.1:8080",
      );
      expect(mockPi.registerProvider).toHaveBeenCalledWith(
        "llama-server=http://127.0.0.1:9090",
        expect.objectContaining({ baseUrl: "http://127.0.0.1:9090" }),
      );
      expect(manager.servers[0]?.providerId).toBe(
        "llama-server=http://127.0.0.1:9090",
      );
    });

    it("should re-register same-id servers without unregistering (name edit)", async () => {
      const original = createMockServer({
        baseUrl: "http://127.0.0.1:8080",
        customId: "my-custom-id",
        customName: "A",
      });
      const manager = await createManager(original);

      const renamed = createMockServer({
        baseUrl: "http://127.0.0.1:8080",
        customId: "my-custom-id",
        customName: "B",
      });
      vi.mocked(settingsStub.resolveServers).mockReturnValue([renamed]);
      await manager.update(mockPi as any);

      expect(mockPi.unregisterProvider).not.toHaveBeenCalled();
      expect(vi.mocked(mockPi.registerProvider).mock.calls.at(-1)).toEqual([
        "my-custom-id",
        expect.objectContaining({ name: "Llama.cpp (B)" }),
      ]);
      expect(manager.servers[0]?.providerId).toBe("my-custom-id");
    });

    it("should collapse duplicate URLs into a single server", async () => {
      const first = makeServer("http://127.0.0.1:8080", "model-1");
      const duplicate = makeServer("http://127.0.0.1:8080", "model-1");
      const manager = await createManager(first, duplicate);

      expect(manager.servers).toHaveLength(1);
      expect(mockPi.registerProvider).toHaveBeenCalledTimes(1);
      expect(manager.getAllModels()).toHaveLength(1);
    });

    it("should return undefined from getServer for a removed server's model", async () => {
      const manager = await createManager(
        makeServer("http://127.0.0.1:8080", "model-1"),
      );

      const live = manager.getAllModels()[0];
      expect(manager.getServer(live)).toBe(manager.servers[0]);

      const orphan = { serverUrl: "http://gone:1" } as unknown as BaseModel;
      expect(manager.getServer(orphan)).toBeUndefined();
    });
  });

  describe("sortBy", () => {
    const sortBy = () => vi.mocked(settingsStub.resolveSortBy);

    it("should return models in API order when sortBy is 'api'", async () => {
      sortBy().mockReturnValue("api");

      const mockModelA = createMockModel("model-a");
      const mockModelZ = createMockModel("model-z");
      const manager = await createManager(
        createMockServer({
          baseUrl: "http://127.0.0.1:8080",
          models: [mockModelA, mockModelZ],
        }),
      );

      const allModels = manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]).toBe(mockModelA);
      expect(allModels[1]).toBe(mockModelZ);
    });

    it("should sort models by ID ascending when sortBy is 'asc'", async () => {
      sortBy().mockReturnValue("asc");

      const mockModelZ = createMockModel("model-z");
      const mockModelA = createMockModel("model-a");
      const manager = await createManager(
        createMockServer({
          baseUrl: "http://127.0.0.1:8080",
          models: [mockModelZ, mockModelA],
        }),
      );

      const allModels = manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]).toBe(mockModelA);
      expect(allModels[1]).toBe(mockModelZ);
    });

    it("should sort models by ID descending when sortBy is 'desc'", async () => {
      sortBy().mockReturnValue("desc");

      const mockModelA = createMockModel("model-a");
      const mockModelZ = createMockModel("model-z");
      const manager = await createManager(
        createMockServer({
          baseUrl: "http://127.0.0.1:8080",
          models: [mockModelA, mockModelZ],
        }),
      );

      const allModels = manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]).toBe(mockModelZ);
      expect(allModels[1]).toBe(mockModelA);
    });

    it("should sort models by name ascending when sortBy is 'asc-name'", async () => {
      sortBy().mockReturnValue("asc-name");

      const mockModelB = createMockModel("zebra", { id: "model-b" });
      const mockModelA = createMockModel("alpha", { id: "model-a" });
      const manager = await createManager(
        createMockServer({
          baseUrl: "http://127.0.0.1:8080",
          models: [mockModelB, mockModelA],
        }),
      );

      const allModels = manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]).toBe(mockModelA);
      expect(allModels[1]).toBe(mockModelB);
    });

    it("should sort models by name descending when sortBy is 'desc-name'", async () => {
      sortBy().mockReturnValue("desc-name");

      const mockModelA = createMockModel("alpha", { id: "model-a" });
      const mockModelB = createMockModel("zebra", { id: "model-b" });
      const manager = await createManager(
        createMockServer({
          baseUrl: "http://127.0.0.1:8080",
          models: [mockModelA, mockModelB],
        }),
      );

      const allModels = manager.getAllModels();

      expect(allModels).toHaveLength(2);
      expect(allModels[0]).toBe(mockModelB);
      expect(allModels[1]).toBe(mockModelA);
    });
  });
});
