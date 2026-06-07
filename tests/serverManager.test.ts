import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerManager } from "../src/managers/server";
import { BaseModel } from "../src/models/baseModel";
import { Server } from "../src/server";
import { createMockServer, mockRpc } from "./mocks";

const mockPi = {
  registerProvider: vi.fn(),
  registerCommand: vi.fn(),
  setModel: vi.fn(),
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
    const server1 = new Server("http://127.0.0.1:8080");
    expect(server1.providerId).toBe("llama-server=http://127.0.0.1:8080");
    const server2 = new Server("http://10.0.0.5:8080");
    expect(server2.providerId).toBe("llama-server=http://10.0.0.5:8080");
    const server3 = new Server("http://127.0.0.1");
    expect(server3.providerId).toBe("llama-server=http://127.0.0.1");
    const server4 = new Server("http://127.0.0.1:80");
    expect(server4.providerId).toBe("llama-server=http://127.0.0.1:80");
    const server5 = new Server("https://127.0.0.1:443");
    expect(server5.providerId).toBe("llama-server=https://127.0.0.1:443");
  });

  it("should generate provider names from URLs", () => {
    const server1 = new Server("http://127.0.0.1:8080");
    expect(server1.providerName).toBe("Llama.cpp (http://127.0.0.1:8080)");
    const server2 = new Server("http://10.0.0.5:8080");
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
    mockRpc.mockImplementation((endpoint: string, fallback?: unknown) => {
      if (endpoint === "/v1/models") {
        return Promise.resolve({ data: [mockModel], object: "list" });
      }
      const defaults: Record<string, unknown> = {
        "/health": { status: "ok" },
        "/props?autoload=false": { role: "router" },
      };
      return Promise.resolve(defaults[endpoint] ?? fallback ?? {});
    });

    const server1 = createMockServer({
      baseUrl: "http://127.0.0.1:8080",
      apiKey: "key-1",
      providerId: "llama-server=http://127.0.0.1:8080",
      providerName: "Llama.cpp (http://127.0.0.1:8080)",
    });
    const server2 = createMockServer({
      baseUrl: "http://127.0.0.1:8081",
      apiKey: "key-2",
      providerId: "llama-server=http://127.0.0.1:8081",
      providerName: "Llama.cpp (http://127.0.0.1:8081)",
    });
    const manager = new ServerManager([server1, server2] as any);

    await manager.initialize(mockPi as any);

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

  it("should return all models from all servers", () => {
    const mockModel1 = {
      name: "model-1",
      id: "model-1",
    } as unknown as BaseModel;
    const mockModel2 = {
      name: "model-2",
      id: "model-2",
    } as unknown as BaseModel;
    const server1 = createMockServer({
      baseUrl: "http://127.0.0.1:8080",
    });
    const server2 = createMockServer({
      baseUrl: "http://127.0.0.1:8081",
    });
    const manager = new ServerManager([
      { ...server1, models: [mockModel1] } as any,
      { ...server2, models: [mockModel2] } as any,
    ] as any);

    const allModels = manager.getAllModels();

    expect(allModels).toHaveLength(2);
    expect(allModels[0]).toBe(mockModel1);
    expect(allModels[1]).toBe(mockModel2);
  });
});
