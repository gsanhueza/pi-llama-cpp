import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_CTX } from "../../src/constants";
import { Status } from "../../src/enums/status";
import { RouterServer } from "../../src/servers/routerServer";
import { SSEManager } from "../../src/sse/manager";
import { createRpcFetch } from "../mocks/rpc";
import { createMockRpc } from "../mocks/mockRpc";
import { createMockApiClient } from "../mocks/apiClient";

/** Per-file isolated mock RPC. */
const mockRpc = createMockRpc();
/** fetch implementation backed by mockRpc — injected into every Server. */
const mockFetch = createRpcFetch(mockRpc);

beforeEach(() => {
  mockRpc.mockReset();
});

const createServer = (overrides = {}) => {
  const apiClient = createMockApiClient("http://127.0.0.1:9931", mockFetch);
  const resolver = {
    resolveServerTimeout: vi.fn(async () => 5000),
    resolvePollingInterval: vi.fn(async () => 500),
    resolvePollingTimeout: vi.fn(async () => 30000),
    resolveApiKey: vi.fn(() => "test-key"),
    resolveEnableSSE: vi.fn(async () => true),
  };
  const server = new RouterServer(
    resolver,
    { baseUrl: "http://127.0.0.1:9931", ...overrides },
    apiClient,
  );
  // Create an SSEManager so `server.sse` is available for tests that need it
  server.sse = new SSEManager(server, resolver, apiClient);
  server.sse.probeSSE = vi.fn(async () => true);
  return { server: Object.assign(server, overrides), resolver };
};

describe("RouterServer", () => {
  describe("getCapabilities", () => {
    it("should detect image capability when modalities.vision is true", async () => {
      mockRpc.mockResolvedValueOnce({ modalities: { vision: true } });

      const { server } = createServer();
      const caps = await server.getCapabilities("test-model");

      expect(caps).toEqual(["text", "image"]);
    });

    it("should detect text-only when modalities.vision is false", async () => {
      mockRpc.mockResolvedValueOnce({ modalities: { vision: false } });

      const { server } = createServer();
      const caps = await server.getCapabilities("test-model");

      expect(caps).toEqual(["text"]);
    });

    it("should fall back to /v1/models when /props fails", async () => {
      mockRpc
        .mockRejectedValueOnce(new Error("props error"))
        .mockResolvedValueOnce({
          data: [
            {
              id: "test-model",
              architecture: { input_modalities: ["text", "image"] },
            },
          ],
        });

      const { server } = createServer();
      const caps = await server.getCapabilities("test-model");

      expect(caps).toEqual(["text", "image"]);
    });

    it("should return text-only when model not found in fallback", async () => {
      mockRpc
        .mockRejectedValueOnce(new Error("props error"))
        .mockResolvedValueOnce({ data: [] });

      const { server } = createServer();
      const caps = await server.getCapabilities("test-model");

      expect(caps).toEqual(["text"]);
    });

    it('should fall back to ["text"] when input_modalities is missing', async () => {
      mockRpc
        .mockRejectedValueOnce(new Error("props error"))
        .mockResolvedValueOnce({
          data: [{ id: "test-model", architecture: {} }],
        });

      const { server } = createServer();
      const caps = await server.getCapabilities("test-model");

      expect(caps).toEqual(["text"]);
    });

    it("should use override when set", async () => {
      const { server } = createServer({
        overrides: { "test-model": { capabilities: ["text", "image"] } },
      });
      expect(await server.getCapabilities("test-model")).toEqual([
        "text",
        "image",
      ]);
    });
  });

  describe("getContextSize", () => {
    it("should extract --ctx-size when unloaded", async () => {
      const { server } = createServer();
      // Stub getModelStatus to return UNLOADED so it reads args
      server.getModelStatus = vi.fn().mockResolvedValue(Status.UNLOADED);
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            status: {
              args: ["--model", "gguf", "--ctx-size", "4096"],
            },
          },
        ],
      });

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(4096);
    });

    it("should fall back to --fit-ctx when --ctx-size is not present", async () => {
      const { server } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.UNLOADED);
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            status: {
              args: ["--model", "gguf", "--fit-ctx", "8192"],
            },
          },
        ],
      });

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(8192);
    });

    it("should prefer --ctx-size over --fit-ctx", async () => {
      const { server } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.UNLOADED);
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            status: {
              args: [
                "--model",
                "gguf",
                "--ctx-size",
                "4096",
                "--fit-ctx",
                "8192",
              ],
            },
          },
        ],
      });

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(4096);
    });

    it("should fall back to FALLBACK_CTX when no size argument is present", async () => {
      const { server } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.UNLOADED);
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            status: {
              args: ["--model", "gguf"],
            },
          },
        ],
      });

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(FALLBACK_CTX);
    });

    it("should return n_ctx from meta when loaded", async () => {
      const { server } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.LOADED);
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            meta: { n_ctx: 4096 },
          },
        ],
      });

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(4096);
    });

    it("should return FALLBACK_CTX when n_ctx is null in meta", async () => {
      const { server } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.LOADED);
      mockRpc.mockResolvedValueOnce({
        data: [{ id: "test-model", meta: { n_ctx: null } }],
      });

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(FALLBACK_CTX);
    });

    it("should return FALLBACK_CTX when fetchModels throws while loaded", async () => {
      const { server } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.LOADED);
      mockRpc.mockRejectedValueOnce(new Error("network"));

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(FALLBACK_CTX);
    });

    it("should use override when set (loaded path)", async () => {
      const { server } = createServer({
        overrides: { "test-model": { contextSize: 65536 } },
      });
      server.getModelStatus = vi.fn().mockResolvedValue(Status.LOADED);

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(65536);
    });

    it("should override in resolveStandardContextSize when loaded", async () => {
      const { server } = createServer({
        overrides: { "test-model": { contextSize: 65536 } },
      });
      server.getModelStatus = vi.fn().mockResolvedValue(Status.LOADED);

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(65536);
    });

    it("should return FALLBACK_CTX when model has no args", async () => {
      const { server } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.UNLOADED);
      mockRpc.mockResolvedValueOnce({
        data: [{ id: "test-model", status: {} }],
      });

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(FALLBACK_CTX);
    });

    it("should skip --ctx-size when value is NaN", async () => {
      const { server } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.UNLOADED);
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            status: { args: ["--model", "gguf", "--ctx-size", "abc"] },
          },
        ],
      });

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(FALLBACK_CTX);
    });

    it("should fall back to --fit-ctx when --ctx-size is NaN", async () => {
      const { server } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.UNLOADED);
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            status: {
              args: [
                "--model",
                "gguf",
                "--ctx-size",
                "abc",
                "--fit-ctx",
                "8192",
              ],
            },
          },
        ],
      });

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(8192);
    });

    it("should return FALLBACK_CTX when both ctx-size and fit-ctx are NaN", async () => {
      const { server } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.UNLOADED);
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            status: {
              args: [
                "--model",
                "gguf",
                "--ctx-size",
                "abc",
                "--fit-ctx",
                "xyz",
              ],
            },
          },
        ],
      });

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(FALLBACK_CTX);
    });
  });

  // ── RouterServer: loadModel with SSE ──

  describe("loadModel", () => {
    it("should return early when model is already LOADED", async () => {
      const { server } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.LOADED);
      server.postRequest = vi.fn();
      await server.loadModel("m");
      expect(server.postRequest).not.toHaveBeenCalled();
    });

    it("should return early when model is SLEEPING", async () => {
      const { server } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.SLEEPING);
      server.postRequest = vi.fn();
      await server.loadModel("m");
      expect(server.postRequest).not.toHaveBeenCalled();
    });

    it("should call POST /models/load then use SSE to wait for loaded", async () => {
      const { server, resolver } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.UNLOADED);
      server.sse!.subscribeToStatus = vi.fn().mockResolvedValue({
        status: "loaded",
      });
      server.postRequest = vi.fn();
      resolver.resolvePollingInterval = vi.fn(async () => 0);
      await server.loadModel("m");
      expect(server.postRequest).toHaveBeenCalledWith("load", "m");
    });

    it("should throw when SSE reports failed", async () => {
      const { server } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.UNLOADED);
      server.sse!.subscribeToStatus = vi.fn().mockResolvedValue({
        status: "failed",
      });
      server.postRequest = vi.fn();
      server.loadModel = RouterServer.prototype.loadModel;
      await expect(server.loadModel("m")).rejects.toThrow(
        "Model loading failed: m",
      );
    });

    it("should throw when SSE reports unloaded with non-zero exit", async () => {
      const { server } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.UNLOADED);
      server.sse!.subscribeToStatus = vi.fn().mockResolvedValue({
        status: "unloaded",
        exit_code: 1,
      });
      server.postRequest = vi.fn();
      server.loadModel = RouterServer.prototype.loadModel;
      await expect(server.loadModel("m")).rejects.toThrow(
        "Model loading failed: m",
      );
    });

    it("should fall back to polling when SSE throws", async () => {
      const { server, resolver } = createServer();
      server.getModelStatus = vi
        .fn()
        .mockResolvedValueOnce(Status.UNLOADED)
        .mockResolvedValue(Status.LOADED);
      server.sse!.subscribeToStatus = vi
        .fn()
        .mockRejectedValue(new Error("sse error"));
      server.postRequest = vi.fn();
      resolver.resolvePollingInterval = vi.fn(async () => 0);
      server.loadModel = RouterServer.prototype.loadModel;
      await server.loadModel("m");
    });

    it("should throw when SSE throws and polling fails", async () => {
      const { server, resolver } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.UNLOADED);
      server.sse!.subscribeToStatus = vi
        .fn()
        .mockRejectedValue(new Error("sse error"));
      server.postRequest = vi.fn();
      resolver.resolvePollingInterval = vi.fn(async () => 0);
      server.loadModel = RouterServer.prototype.loadModel;
      await expect(server.loadModel("m")).rejects.toThrow(
        "Model loading failed: m",
      );
    });

    it("should throw when SSE throws and polling fallback also fails", async () => {
      const { server, resolver } = createServer();
      server.getModelStatus = vi
        .fn()
        .mockResolvedValueOnce(Status.UNLOADED)
        .mockResolvedValue(Status.UNLOADED);
      server.sse!.subscribeToStatus = vi
        .fn()
        .mockRejectedValue(new Error("sse error"));
      server.postRequest = vi.fn();
      resolver.resolvePollingInterval = vi.fn(async () => 0);
      await expect(server.loadModel("m")).rejects.toThrow(
        "Model loading failed: m",
      );
    });

    it("should throw when SSE throws, polling succeeds, but final status fails", async () => {
      const { server, resolver } = createServer();
      server.getModelStatus = vi
        .fn()
        .mockResolvedValueOnce(Status.UNLOADED)
        .mockResolvedValueOnce(Status.LOADED)
        .mockResolvedValueOnce(Status.LOADING);
      server.sse!.subscribeToStatus = vi
        .fn()
        .mockRejectedValue(new Error("sse error"));
      server.postRequest = vi.fn();
      resolver.resolvePollingInterval = vi.fn(async () => 0);
      await expect(server.loadModel("m")).rejects.toThrow(
        "Model loading failed: m",
      );
    });

    it("should use polling when SSE is unavailable", async () => {
      const { server, resolver } = createServer();
      server.sse = undefined;
      server.getModelStatus = vi
        .fn()
        .mockResolvedValueOnce(Status.UNLOADED)
        .mockResolvedValue(Status.LOADED);
      server.postRequest = vi.fn();
      resolver.resolvePollingInterval = vi.fn(async () => 0);
      await server.loadModel("m");
      expect(server.postRequest).toHaveBeenCalledWith("load", "m");
    });
  });

  // ── RouterServer: unloadModel with SSE ──

  describe("unloadModel", () => {
    it("should short-circuit when the model is not loaded or sleeping", async () => {
      for (const status of [Status.UNLOADED, Status.LOADING, Status.FAILED]) {
        const { server } = createServer();
        server.getModelStatus = vi.fn().mockResolvedValue(status);
        const subscribe = vi.fn();
        server.sse!.subscribeToStatus = subscribe as never;
        server.postRequest = vi.fn();
        await server.unloadModel("m");
        expect(server.postRequest).not.toHaveBeenCalled();
        expect(subscribe).not.toHaveBeenCalled();
      }
    });

    it("should subscribe to SSE before issuing the unload POST", async () => {
      const { server, resolver } = createServer();
      server.getModelStatus = vi
        .fn()
        .mockResolvedValueOnce(Status.LOADED) // pre-check
        .mockResolvedValue(Status.UNLOADED); // final check
      const callOrder: string[] = [];
      server.sse!.subscribeToStatus = vi.fn().mockImplementation(() => {
        callOrder.push("subscribe");
        return Promise.resolve({ status: "unloaded" });
      }) as never;
      server.postRequest = vi.fn().mockImplementation(() => {
        callOrder.push("post");
        return Promise.resolve({});
      });
      resolver.resolvePollingInterval = vi.fn(async () => 0);
      await server.unloadModel("m");
      expect(callOrder).toEqual(["subscribe", "post"]);
    });

    it("should call POST /models/unload then use SSE to wait for unloaded", async () => {
      const { server, resolver } = createServer();
      server.getModelStatus = vi
        .fn()
        .mockResolvedValueOnce(Status.LOADED) // pre-check
        .mockResolvedValue(Status.UNLOADED); // final check
      server.sse!.subscribeToStatus = vi.fn().mockResolvedValue({
        status: "unloaded",
      });
      server.postRequest = vi.fn();
      resolver.resolvePollingInterval = vi.fn(async () => 0);
      await server.unloadModel("m");
      expect(server.postRequest).toHaveBeenCalledWith("unload", "m");
    });

    it("should throw when SSE reports non-unloaded status", async () => {
      const { server } = createServer();
      server.getModelStatus = vi
        .fn()
        .mockResolvedValueOnce(Status.LOADED) // pre-check
        .mockResolvedValue(Status.UNLOADED); // final check
      server.sse!.subscribeToStatus = vi.fn().mockResolvedValue({
        status: "loaded",
      });
      server.postRequest = vi.fn();
      server.unloadModel = RouterServer.prototype.unloadModel;
      await expect(server.unloadModel("m")).rejects.toThrow(
        "Model unload failed: m",
      );
    });

    it("should fall back to polling when SSE throws", async () => {
      const { server, resolver } = createServer();
      server.getModelStatus = vi
        .fn()
        .mockResolvedValueOnce(Status.LOADED)
        .mockResolvedValue(Status.UNLOADED);
      server.sse!.subscribeToStatus = vi
        .fn()
        .mockRejectedValue(new Error("sse error"));
      server.postRequest = vi.fn();
      resolver.resolvePollingInterval = vi.fn(async () => 0);
      server.unloadModel = RouterServer.prototype.unloadModel;
      await server.unloadModel("m");
    });

    it("should throw when SSE throws and polling fails", async () => {
      const { server, resolver } = createServer();
      server.getModelStatus = vi.fn().mockResolvedValue(Status.LOADED);
      server.sse!.subscribeToStatus = vi
        .fn()
        .mockRejectedValue(new Error("sse error"));
      server.postRequest = vi.fn();
      resolver.resolvePollingInterval = vi.fn(async () => 0);
      resolver.resolvePollingTimeout = vi.fn(async () => 100);
      server.unloadModel = RouterServer.prototype.unloadModel;
      await expect(server.unloadModel("m")).rejects.toThrow(
        "Model unload failed: m",
      );
    });

    it("should throw when SSE throws and polling fallback also fails", async () => {
      const { server, resolver } = createServer();
      server.getModelStatus = vi
        .fn()
        .mockResolvedValueOnce(Status.LOADED)
        .mockResolvedValueOnce(Status.LOADED);
      server.sse!.subscribeToStatus = vi
        .fn()
        .mockRejectedValue(new Error("sse error"));
      server.postRequest = vi.fn();
      resolver.resolvePollingInterval = vi.fn(async () => 0);
      resolver.resolvePollingTimeout = vi.fn(async () => 100);
      await expect(server.unloadModel("m")).rejects.toThrow(
        "Model unload failed: m",
      );
    });

    it("should use polling when SSE is unavailable", async () => {
      const { server, resolver } = createServer();
      server.sse = undefined;
      server.getModelStatus = vi
        .fn()
        .mockResolvedValueOnce(Status.LOADED)
        .mockResolvedValue(Status.UNLOADED);
      server.postRequest = vi.fn();
      resolver.resolvePollingInterval = vi.fn(async () => 0);
      await server.unloadModel("m");
      expect(server.postRequest).toHaveBeenCalledWith("unload", "m");
    });

    it("should throw when SSE throws and polling exits but final status fails", async () => {
      const { server, resolver } = createServer();
      server.getModelStatus = vi
        .fn()
        .mockResolvedValueOnce(Status.LOADED) // inside pollModelStatus loop
        .mockResolvedValueOnce(Status.UNLOADED) // pollModelStatus exits
        .mockResolvedValue(Status.LOADED); // final check
      server.sse!.subscribeToStatus = vi
        .fn()
        .mockRejectedValue(new Error("sse error"));
      server.postRequest = vi.fn();
      resolver.resolvePollingInterval = vi.fn(async () => 0);
      resolver.resolvePollingTimeout = vi.fn(async () => 100);
      server.unloadModel = RouterServer.prototype.unloadModel;
      await expect(server.unloadModel("m")).rejects.toThrow(
        "Model unload failed: m",
      );
    });

    it("should throw when polling exits but final status fails (no SSE)", async () => {
      const { server, resolver } = createServer();
      server.sse = undefined;
      server.getModelStatus = vi
        .fn()
        .mockResolvedValueOnce(Status.LOADED) // inside pollModelStatus loop
        .mockResolvedValueOnce(Status.UNLOADED) // pollModelStatus exits
        .mockResolvedValue(Status.LOADED); // final check
      server.postRequest = vi.fn();
      resolver.resolvePollingInterval = vi.fn(async () => 0);
      resolver.resolvePollingTimeout = vi.fn(async () => 100);
      server.unloadModel = RouterServer.prototype.unloadModel;
      await expect(server.unloadModel("m")).rejects.toThrow(
        "Model unload failed: m",
      );
    });
  });
});
