import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLLING_TIMEOUT, SERVER_TIMEOUT } from "../src/constants";
import { ServerStatus } from "../src/enums/serverStatus";
import type { LlamaSettingsManager } from "../src/managers/settings";
import { Server } from "../src/server";
import { createMockServer, makeSettingsStub, mockRpc } from "./mocks";

// Injected into every real Server below; fresh per test so per-case
// overrides never leak. The Server constructor resolves the API key eagerly
// (ApiClient built there) — the stub's placeholder key is never consumed.
let settings: LlamaSettingsManager;

beforeEach(() => {
  mockRpc.mockClear();
  settings = makeSettingsStub();
});

describe("Server providerId", () => {
  it("should generate a unique provider ID from baseUrl", () => {
    const server = new Server(settings, { baseUrl: "http://127.0.0.1:8080" });
    expect(server.providerId).toBe("llama-server=http://127.0.0.1:8080");
  });

  it("should generate different IDs for different baseUrls", () => {
    const server1 = new Server(settings, { baseUrl: "http://127.0.0.1:8080" });
    const server2 = new Server(settings, { baseUrl: "http://127.0.0.1:8081" });
    expect(server1.providerId).not.toBe(server2.providerId);
  });
});

describe("Server providerName", () => {
  it("should generate a human-readable provider name", () => {
    const server = new Server(settings, { baseUrl: "http://127.0.0.1:8080" });
    expect(server.providerName).toBe("Llama.cpp (http://127.0.0.1:8080)");
  });
});

describe("Server apiBaseUrl", () => {
  it("should append the ENDPOINT_PREFIX to baseUrl", () => {
    const server = new Server(settings, { baseUrl: "http://127.0.0.1:8080" });
    expect(server.apiBaseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  it("should not double the prefix when baseUrl already ends with it", () => {
    const server = new Server(settings, {
      baseUrl: "http://127.0.0.1:8080/v1",
    });
    expect(server.apiBaseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  it("should keep baseUrl untouched for provider identity", () => {
    const server = new Server(settings, { baseUrl: "http://127.0.0.1:8080" });
    expect(server.baseUrl).toBe("http://127.0.0.1:8080");
    expect(server.providerId).toBe("llama-server=http://127.0.0.1:8080");
  });
});

describe("Server fetchModels", () => {
  it("should call the /models endpoint", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ id: "model1" }],
      models: [{ id: "model1" }],
      object: "list",
    });

    const server = createMockServer();
    const result = await server.fetchModels();

    expect(result).toEqual({
      data: [{ id: "model1" }],
      models: [{ id: "model1" }],
      object: "list",
    });
    expect(mockRpc).toHaveBeenCalledWith("/v1/models");
  });
});

describe("Server fetchModelProps", () => {
  it("should call the /props endpoint with model id", async () => {
    mockRpc.mockResolvedValueOnce({
      is_sleeping: false,
      default_generation_settings: {},
      total_slots: 1,
      model_alias: "test",
      model_path: "/path/to/model.gguf",
      modalities: { vision: false, audio: false },
      media_marker: "",
      endpoint_slots: false,
      endpoint_props: false,
      endpoint_metrics: false,
      webui: false,
      webui_settings: {},
      chat_template: "",
      chat_template_caps: {},
      bos_token: "",
      eos_token: "",
      build_info: "",
    });

    const server = createMockServer();
    const result = await server.fetchModelProps("test-model");

    expect(result.is_sleeping).toBe(false);
    expect(mockRpc).toHaveBeenCalledWith(
      "/props?model=test-model&autoload=false",
    );
  });
});

describe("Server fetchServerProps", () => {
  it("should call the /props endpoint without model", async () => {
    mockRpc.mockResolvedValueOnce({
      role: "router",
      default_generation_settings: {},
      total_slots: 2,
      model_alias: "",
      model_path: "",
      modalities: { vision: false, audio: false },
      media_marker: "",
      endpoint_slots: false,
      endpoint_props: false,
      endpoint_metrics: false,
      webui: false,
      webui_settings: {},
      chat_template: "",
      chat_template_caps: {},
      bos_token: "",
      eos_token: "",
      build_info: "",
      is_sleeping: false,
    });

    const server = createMockServer();
    const result = await server.fetchServerProps();

    expect(result.role).toBe("router");
    expect(mockRpc).toHaveBeenCalledWith("/props?autoload=false");
  });
});

describe("Server postRequest", () => {
  it("should call /models/load with model in body", async () => {
    mockRpc.mockResolvedValueOnce({});

    const server = createMockServer();
    await server.postRequest("load", "test-model");

    expect(mockRpc).toHaveBeenCalledWith("/models/load", {
      model: "test-model",
    });
  });

  it("should call /models/unload with model in body", async () => {
    mockRpc.mockResolvedValueOnce({});

    const server = createMockServer();
    await server.postRequest("unload", "test-model");

    expect(mockRpc).toHaveBeenCalledWith("/models/unload", {
      model: "test-model",
    });
  });
});

describe("Server timeouts", async () => {
  it("should resolve timeouts from the injected settings", async () => {
    const server = new Server(settings, { baseUrl: "http://127.0.0.1:8080" });

    expect(await server.getServerTimeout()).toBe(SERVER_TIMEOUT);
    expect(await server.getPollingTimeout()).toBe(POLLING_TIMEOUT);
  });

  it("should return resolved custom values", async () => {
    vi.mocked(settings.resolveTimeouts).mockResolvedValue({
      pollingTimeout: 90000,
      serverTimeout: 2000,
    });

    const server = new Server(settings, {
      baseUrl: "http://127.0.0.1:8080",
      customId: "my-id",
      customName: "My Server",
    });

    expect(await server.getPollingTimeout()).toBe(90000);
  });

  it("should read timeouts live from settings", async () => {
    const server = new Server(settings, { baseUrl: "http://127.0.0.1:8080" });

    vi.mocked(settings.resolveTimeouts).mockResolvedValue({
      pollingTimeout: 120000,
      serverTimeout: 3000,
    });
    expect(await server.getPollingTimeout()).toBe(120000);

    vi.mocked(settings.resolveTimeouts).mockResolvedValue({
      pollingTimeout: 90000,
      serverTimeout: 2000,
    });
    expect(await server.getPollingTimeout()).toBe(90000);
  });
});

describe("Server isReady", () => {
  // `isReady` delegates to the shared health probe (`utils/health`), which
  // uses plain `fetch` instead of the ApiClient — stub it per test.
  const stubFetch = (impl: () => Promise<unknown>) => {
    vi.stubGlobal("fetch", vi.fn(impl));
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should return READY when health status is ok", async () => {
    stubFetch(async () => ({ json: async () => ({ status: "ok" }) }));

    const server = createMockServer();
    const status = await server.isReady(1000);

    expect(status).toBe(ServerStatus.READY);
  });

  it("should return UNREACHABLE when health check fails", async () => {
    stubFetch(async () => {
      throw new Error("connection refused");
    });

    const server = createMockServer();
    const status = await server.isReady(1000);

    expect(status).toBe(ServerStatus.UNREACHABLE);
  });

  it("should return UNREACHABLE when health status is not ok", async () => {
    stubFetch(async () => ({ json: async () => ({ status: "error" }) }));

    const server = createMockServer();
    const status = await server.isReady(1000);

    expect(status).toBe(ServerStatus.UNREACHABLE);
  });

  it("should return TIMEOUT when the health check aborts", async () => {
    stubFetch(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    const server = createMockServer();
    const status = await server.isReady(1000);

    expect(status).toBe(ServerStatus.TIMEOUT);
  });
});
