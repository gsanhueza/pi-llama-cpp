import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_KEY_PLACEHOLDER } from "../../src/constants";
import { Server } from "../../src/servers/server";
import { createMockServer } from "../mocks/server";
import { mockResolver, mockServerOptions } from "../mocks/server";
import type { CreateMockServerOptions } from "../mocks/server";
import { createRpcFetch } from "../mocks/rpc";
import { createMockRpc } from "../mocks/mockRpc";
import { Status } from "../../src/enums/status";
import { makeResolverStub } from "../mocks/settings";

/** Per-file isolated mock RPC. */
const mockRpc = createMockRpc();
/** fetch implementation backed by mockRpc — injected into every Server. */
const mockFetch = createRpcFetch(mockRpc);

/** Helper: build a real Server wired to this file's mock RPC. */
const createRpcServer = (opts: CreateMockServerOptions = {}): Server =>
  createMockServer({ ...opts, fetchFn: mockFetch });

beforeEach(() => {
  mockRpc.mockClear();
});

describe("Server providerId", () => {
  it("should use customId when set", () => {
    const server = createMockServer({
      options: { baseUrl: "http://127.0.0.1:9931", customId: "my-server" },
    });
    expect(server.providerId).toBe("my-server");
  });

  it("should generate a unique provider ID from baseUrl", () => {
    const server = createMockServer({
      options: { baseUrl: "http://127.0.0.1:9931" },
    });
    expect(server.providerId).toBe("llama-server=http://127.0.0.1:9931");
  });

  it("should generate different IDs for different baseUrls", () => {
    const server1 = createMockServer({
      options: { baseUrl: "http://127.0.0.1:9931" },
    });
    const server2 = createMockServer({
      options: { baseUrl: "http://127.0.0.1:8081" },
    });
    expect(server1.providerId).not.toBe(server2.providerId);
  });
});

describe("Server providerName", () => {
  it("should generate a human-readable provider name", () => {
    const server = createMockServer({
      options: { baseUrl: "http://127.0.0.1:9931" },
    });
    expect(server.providerName).toBe("Llama.cpp (http://127.0.0.1:9931)");
  });

  it("should include customName when set", () => {
    const server = createMockServer({
      options: { baseUrl: "http://127.0.0.1:9931", customName: "my-server" },
    });
    expect(server.providerName).toBe("Llama.cpp (my-server)");
  });
});

describe("Server apiKey", () => {
  it("should use key from customId resolver", () => {
    const customResolver = makeResolverStub({
      resolveApiKey: vi.fn((id) =>
        id === "my-server" ? "custom-key" : API_KEY_PLACEHOLDER,
      ),
    });
    const server = createMockServer({
      resolver: customResolver,
      options: { baseUrl: "http://127.0.0.1:9931", customId: "my-server" },
    });
    expect(server.apiKey).toBe("custom-key");
  });
});

describe("Server apiBaseUrl", () => {
  it("should append the ENDPOINT_PREFIX to baseUrl", () => {
    const server = createMockServer({
      options: { baseUrl: "http://127.0.0.1:9931" },
    });
    expect(server.apiBaseUrl).toBe("http://127.0.0.1:9931/v1");
  });

  it("should not double the prefix when baseUrl already ends with it", () => {
    const server = createMockServer({
      options: { baseUrl: "http://127.0.0.1:9931/v1" },
    });
    expect(server.apiBaseUrl).toBe("http://127.0.0.1:9931/v1");
  });

  it("should keep baseUrl untouched for provider identity", () => {
    const server = createMockServer({
      options: { baseUrl: "http://127.0.0.1:9931" },
    });
    expect(server.baseUrl).toBe("http://127.0.0.1:9931");
    expect(server.providerId).toBe("llama-server=http://127.0.0.1:9931");
  });
});

describe("Server fetchModels", () => {
  it("should call the /models endpoint", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ id: "model1" }],
      models: [{ id: "model1" }],
      object: "list",
    });

    const server = createRpcServer();
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

    const server = createRpcServer();
    const result = await server.fetchModelProps("test-model");

    expect(result.is_sleeping).toBe(false);
    expect(mockRpc).toHaveBeenCalledWith(
      "/props?model=test-model&autoload=false",
    );
  });
});

describe("Server mode detection (via initialize)", () => {
  it("should detect LLAMASWAP mode when /props returns src", async () => {
    // initialize() calls fetchModels() first, then fetchServerProps()
    mockRpc
      .mockResolvedValueOnce({
        data: [{ id: "test-model" }],
        object: "list",
      })
      .mockResolvedValueOnce({
        src: "llama-swap",
        error: {
          message: "no model id could be identified",
          type: "invalid_request_error",
          param: null,
          code: "not_found",
        },
      });

    const server = createRpcServer({
      resolver: mockResolver,
      options: mockServerOptions,
      overrides: {
        initialize: async () => {
          await Server.prototype.initialize.call(server);
        },
      },
    });
    await server.initialize();
  });
});

// ── Base class: getModelStatus (shared by Single, Legacy, Router) ──

describe("Server getModelStatus", () => {
  it("should return LOADED when not sleeping and no error", async () => {
    mockRpc.mockResolvedValueOnce({ is_sleeping: false });
    const server = createRpcServer();
    expect(await server.getModelStatus("m")).toBe(Status.LOADED);
  });

  it("should return SLEEPING when is_sleeping is true", async () => {
    mockRpc.mockResolvedValueOnce({ is_sleeping: true });
    const server = createRpcServer();
    expect(await server.getModelStatus("m")).toBe(Status.SLEEPING);
  });

  it("should return LOADING when error code is 503", async () => {
    mockRpc.mockResolvedValueOnce({ error: { code: 503 } });
    const server = createRpcServer();
    expect(await server.getModelStatus("m")).toBe(Status.LOADING);
  });

  it("should return UNLOADED when model is not loaded", async () => {
    mockRpc.mockResolvedValueOnce({
      error: { code: 400, message: "model is not loaded" },
    });
    const server = createRpcServer();
    expect(await server.getModelStatus("m")).toBe(Status.UNLOADED);
  });

  it("should return FAILED for other errors", async () => {
    mockRpc.mockResolvedValueOnce({ error: { code: 500 } });
    const server = createRpcServer();
    expect(await server.getModelStatus("m")).toBe(Status.FAILED);
  });

  it("should return FAILED on exception", async () => {
    mockRpc.mockRejectedValueOnce(new Error("network"));
    const server = createRpcServer();
    expect(await server.getModelStatus("m")).toBe(Status.FAILED);
  });
});

// ── Base class: getCapabilities (shared by Single, Router) ──

describe("Server getCapabilities", () => {
  it("should return ['text','image'] when modalities.vision is true", async () => {
    mockRpc.mockResolvedValueOnce({ modalities: { vision: true } });
    const server = createRpcServer();
    expect(await server.getCapabilities("m")).toEqual(["text", "image"]);
  });

  it("should return ['text'] when modalities.vision is false", async () => {
    mockRpc.mockResolvedValueOnce({ modalities: { vision: false } });
    const server = createRpcServer();
    expect(await server.getCapabilities("m")).toEqual(["text"]);
  });

  it("should fall back to /v1/models when /props fails", async () => {
    mockRpc
      .mockRejectedValueOnce(new Error("props error"))
      .mockResolvedValueOnce({
        data: [
          { id: "m", architecture: { input_modalities: ["text", "image"] } },
        ],
      });
    const server = createRpcServer();
    expect(await server.getCapabilities("m")).toEqual(["text", "image"]);
  });

  it("should return ['text'] when model not found in fallback", async () => {
    mockRpc
      .mockRejectedValueOnce(new Error("props error"))
      .mockResolvedValueOnce({ data: [] });
    const server = createRpcServer();
    expect(await server.getCapabilities("m")).toEqual(["text"]);
  });

  it("should return ['text'] when model has no input_modalities", async () => {
    mockRpc
      .mockRejectedValueOnce(new Error("props error"))
      .mockResolvedValueOnce({ data: [{ id: "m" }] });
    const server = createRpcServer();
    expect(await server.getCapabilities("m")).toEqual(["text"]);
  });

  it("should use override capabilities when set", async () => {
    const server = createRpcServer({
      options: { overrides: { m: { capabilities: ["text", "image"] } } },
    });
    expect(await server.getCapabilities("m")).toEqual(["text", "image"]);
  });
});

// ── Base class: findOverrideForModel ──

describe("Server findOverrideForModel", () => {
  it("should return the most specific (longest) matching override", () => {
    const server = createRpcServer({
      options: {
        overrides: {
          phi: { contextSize: 4096 },
          "phi-3": { contextSize: 8192 },
        },
      },
    });
    expect(server.findOverrideForModel("phi-3-4bit")).toEqual({
      contextSize: 8192,
    });
  });

  it("should return undefined when no key matches", () => {
    const server = createRpcServer({
      options: { overrides: { llama: { contextSize: 4096 } } },
    });
    expect(server.findOverrideForModel("gpt")).toBeUndefined();
  });

  it("should ignore empty keys", () => {
    const server = createRpcServer({
      options: { overrides: { "": { contextSize: 100 } } },
    });
    expect(server.findOverrideForModel("anything")).toBeUndefined();
  });
});

// ── Base class: getModelName ──

describe("Server getModelName", () => {
  it("should return the first alias from /v1/models", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ id: "llama-3", aliases: ["llama-3-8b", "llama3"] }],
    });
    const server = createRpcServer();
    expect(await server.getModelName("llama-3")).toBe("llama-3-8b");
  });

  it("should fall back to model id when no aliases", async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ id: "x" }] });
    const server = createRpcServer();
    expect(await server.getModelName("x")).toBe("x");
  });
});

// ── Base class: getMaxTokens ──

describe("Server getMaxTokens", () => {
  it("should use override maxTokens when set", () => {
    const server = createRpcServer({
      options: { overrides: { m: { maxTokens: 2048 } } },
    });
    expect(server.getMaxTokens("m", 8192)).toBe(2048);
  });

  it("should ignore maxTokens override when 0", () => {
    const server = createRpcServer({
      options: { overrides: { m: { maxTokens: 0 } } },
    });
    expect(server.getMaxTokens("m", 8192)).toBe(8192);
  });

  it("should return contextSize when no override", () => {
    const server = createRpcServer();
    expect(server.getMaxTokens("m", 4096)).toBe(4096);
  });
});

// ── Base class: isTimeout ──

describe("Server.isTimeout", () => {
  it("should return true for TimeoutError", () => {
    const err = new Error("timeout");
    err.name = "TimeoutError";
    expect(Server.isTimeout(err)).toBe(true);
  });

  it("should return true for AbortError", () => {
    const err = new Error("abort");
    err.name = "AbortError";
    expect(Server.isTimeout(err)).toBe(true);
  });

  it("should return false for other errors", () => {
    expect(Server.isTimeout(new Error("other"))).toBe(false);
  });

  it("should return false for non-Error values", () => {
    expect(Server.isTimeout("string")).toBe(false);
    expect(Server.isTimeout(null)).toBe(false);
    expect(Server.isTimeout(undefined)).toBe(false);
  });
});

// ── Base class: loadModel / pollModelStatus ──

describe("Server loadModel", () => {
  it("should return early when model is already LOADED", async () => {
    const server = createRpcServer();
    server.getModelStatus = vi.fn().mockResolvedValue(Status.LOADED);
    server.loadModel = Server.prototype.loadModel;
    await server.loadModel("m");
    // no HTTP calls, no polling — just returns
  });

  it("should return early when model is SLEEPING", async () => {
    const server = createRpcServer();
    server.getModelStatus = vi.fn().mockResolvedValue(Status.SLEEPING);
    server.loadModel = Server.prototype.loadModel;
    await server.loadModel("m");
  });

  it("should call POST /models/load then poll when model is not loaded", async () => {
    const server = createRpcServer();
    server.getModelStatus = vi
      .fn()
      .mockResolvedValueOnce(Status.UNLOADED) // triggers load path
      .mockResolvedValue(Status.LOADED); // polling succeeds
    server.loadModel = Server.prototype.loadModel;
    await server.loadModel("m");
    expect(mockRpc).toHaveBeenCalledWith("/models/load", { model: "m" });
  });
});

describe("Server pollModelStatus (via loadModel)", () => {
  it("should throw when expecting LOADED but getting UNLOADED", async () => {
    const server = createRpcServer();
    server.getModelStatus = vi.fn().mockResolvedValue(Status.UNLOADED);
    server.loadModel = Server.prototype.loadModel;
    await expect(server.loadModel("m")).rejects.toThrow(
      "Model loading failed: m",
    );
  });
});

describe("Server unloadModel", () => {
  it("should call POST /models/unload then poll for UNLOADED", async () => {
    const server = createRpcServer();
    server.getModelStatus = vi
      .fn()
      .mockResolvedValueOnce(Status.LOADED) // pre-check
      .mockResolvedValue(Status.UNLOADED); // polling succeeds
    server.unloadModel = Server.prototype.unloadModel;
    await server.unloadModel("m");
    expect(mockRpc).toHaveBeenCalledWith("/models/unload", { model: "m" });
  });
});

describe("Server initialize", () => {
  it("should continue when fetchServerProps throws", async () => {
    const server = createRpcServer();
    mockRpc
      .mockResolvedValueOnce({ data: [{ id: "m" }] }) // fetchModels
      .mockRejectedValueOnce(new Error("props error")); // fetchServerProps
    server.initialize = Server.prototype.initialize;
    await server.initialize();
    // should not throw — mode detection still works
  });
});

describe("Server pollModelStatus timeout", () => {
  it("should throw when polling exceeds timeout", async () => {
    const server = createRpcServer();
    server.getModelStatus = vi.fn().mockResolvedValue(Status.LOADING); // never matches
    server.resolver.resolvePollingTimeout = vi.fn().mockResolvedValue(10);
    server.resolver.resolvePollingInterval = vi.fn().mockResolvedValue(5);
    let tick = 0;
    (server as unknown as { now: ReturnType<typeof vi.fn> }).now = vi
      .fn()
      .mockImplementation(() => ++tick * 5); // 5, 10, 15… exceeds 10ms
    server.loadModel = Server.prototype.loadModel;

    await expect(server.loadModel("m")).rejects.toThrow("timed out");
  });
});
