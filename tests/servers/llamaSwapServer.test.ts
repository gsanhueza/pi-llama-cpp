import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_CTX } from "../../src/constants";
import { Status } from "../../src/enums/status";
import { LlamaSwapServer } from "../../src/servers/llamaSwapServer";
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
  return Object.assign(
    new LlamaSwapServer(
      {
        resolveServerTimeout: vi.fn(async () => 5000),
        resolvePollingInterval: vi.fn(async () => 500),
        resolvePollingTimeout: vi.fn(async () => 30000),
        resolveApiKey: vi.fn(() => "test-key"),
        resolveEnableSSE: vi.fn(async () => true),
      },
      { baseUrl: "http://127.0.0.1:9931", ...overrides },
      apiClient,
    ),
    overrides,
  );
};

describe("LlamaSwapServer", () => {
  describe("getModelStatus", () => {
    it("should return LOADED when status.value is 'loaded'", async () => {
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            status: {
              value: "loaded",
              args: [],
              preset: "default",
              failed: false,
            },
          },
        ],
      });

      const server = createServer();
      const status = await server.getModelStatus("test-model");

      expect(status).toBe(Status.LOADED);
    });

    it("should return UNLOADED when status.value is 'unloaded'", async () => {
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            status: {
              value: "unloaded",
              args: [],
              preset: "default",
              failed: false,
            },
          },
        ],
      });

      const server = createServer();
      const status = await server.getModelStatus("test-model");

      expect(status).toBe(Status.UNLOADED);
    });

    it("should return UNLOADED when model is not found", async () => {
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "other-model",
            status: { value: "loaded" },
          },
        ],
      });

      const server = createServer();
      const status = await server.getModelStatus("test-model");

      expect(status).toBe(Status.UNLOADED);
    });

    it("should return UNLOADED on error", async () => {
      mockRpc.mockRejectedValueOnce(new Error("network error"));

      const server = createServer();
      const status = await server.getModelStatus("test-model");

      expect(status).toBe(Status.UNLOADED);
    });
  });

  describe("getCapabilities", () => {
    it("should detect image capability when input_modalities includes image", async () => {
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["text"],
            },
          },
        ],
      });

      const server = createServer();
      const caps = await server.getCapabilities("test-model");

      expect(caps).toEqual(["text", "image"]);
    });

    it("should detect text-only when input_modalities only has text", async () => {
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
          },
        ],
      });

      const server = createServer();
      const caps = await server.getCapabilities("test-model");

      expect(caps).toEqual(["text"]);
    });

    it("should return text-only when architecture is undefined", async () => {
      mockRpc.mockResolvedValueOnce({
        data: [{ id: "test-model" }],
      });

      const server = createServer();
      const caps = await server.getCapabilities("test-model");

      expect(caps).toEqual(["text"]);
    });

    it("should use override when set", async () => {
      const server = createServer({
        overrides: { "test-model": { capabilities: ["text", "image"] } },
      });
      expect(await server.getCapabilities("test-model")).toEqual([
        "text",
        "image",
      ]);
    });
  });

  describe("getContextSize", () => {
    it("should return n_ctx from meta", async () => {
      mockRpc.mockResolvedValueOnce({
        data: [{ id: "test-model", meta: { n_ctx: 8192 } }],
      });

      const server = createServer();
      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(8192);
    });

    it("should return FALLBACK_CTX when meta is missing", async () => {
      mockRpc.mockResolvedValueOnce({
        data: [{ id: "test-model" }],
      });

      const server = createServer();
      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(FALLBACK_CTX);
    });

    it("should use override when set", async () => {
      const server = createServer({
        overrides: { "test-model": { contextSize: 65536 } },
      });

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(65536);
    });
  });

  describe("getModelName", () => {
    it("should use llamaswap nested aliases", async () => {
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            meta: {
              llamaswap: { aliases: ["my-alias"] },
            },
            aliases: ["fallback"],
          },
        ],
      });

      const server = createServer();
      const name = await server.getModelName("test-model");

      expect(name).toBe("my-alias");
    });

    it("should fall back to standard aliases", async () => {
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            id: "test-model",
            aliases: ["my-alias"],
          },
        ],
      });

      const server = createServer();
      const name = await server.getModelName("test-model");

      expect(name).toBe("my-alias");
    });

    it("should fall back to model id", async () => {
      mockRpc.mockResolvedValueOnce({
        data: [{ id: "test-model" }],
      });

      const server = createServer();
      const name = await server.getModelName("test-model");

      expect(name).toBe("test-model");
    });
  });

  describe("loadModel", () => {
    it("should call upstream endpoint then poll", async () => {
      const server = createServer();
      mockRpc.mockResolvedValueOnce({});
      server.getModelStatus = vi.fn().mockResolvedValue(Status.LOADED);
      server.resolver.resolvePollingInterval = vi.fn(async () => 0);
      server.loadModel = LlamaSwapServer.prototype.loadModel;
      await server.loadModel("test-model");
      expect(mockRpc).toHaveBeenCalledWith("/upstream/test-model");
    });

    it("should throw when upstream fails", async () => {
      const server = createServer();
      mockRpc.mockRejectedValueOnce(new Error("GET failed"));

      await expect(server.loadModel("test-model")).rejects.toThrow(
        "Model loading failed: test-model",
      );
    });
  });

  describe("unloadModel", () => {
    it("should call unload endpoint then poll", async () => {
      const server = createServer();
      mockRpc.mockResolvedValueOnce({});
      server.getModelStatus = vi.fn().mockResolvedValue(Status.UNLOADED);
      server.resolver.resolvePollingInterval = vi.fn(async () => 0);
      server.unloadModel = LlamaSwapServer.prototype.unloadModel;
      await server.unloadModel("test-model");
      expect(mockRpc).toHaveBeenCalledWith("/api/models/unload/test-model");
    });
  });
});
