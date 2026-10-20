import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_CTX } from "../../src/constants";
import { LegacyServer } from "../../src/servers/legacyServer";
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
    new LegacyServer(
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

describe("LegacyServer", () => {
  describe("getCapabilities", () => {
    it("should detect image capability when multimodal is in capabilities", async () => {
      mockRpc.mockResolvedValueOnce({ modalities: { vision: true } });

      const server = createServer();
      const caps = await server.getCapabilities("test-model");

      expect(caps).toEqual(["text", "image"]);
    });

    it("should detect text-only when multimodal is not in capabilities", async () => {
      mockRpc.mockResolvedValueOnce({ modalities: { vision: false } });

      const server = createServer();
      const caps = await server.getCapabilities("test-model");

      expect(caps).toEqual(["text"]);
    });

    it("should fall back to /v1/models when /props fails", async () => {
      mockRpc
        .mockRejectedValueOnce(new Error("401 Unauthorized"))
        .mockResolvedValueOnce({
          models: [{ capabilities: ["multimodal"] }],
        });

      const server = createServer();
      const caps = await server.getCapabilities("test-model");

      expect(caps).toEqual(["text", "image"]);
    });

    it("should return text-only when capabilities has no multimodal", async () => {
      mockRpc
        .mockRejectedValueOnce(new Error("401 Unauthorized"))
        .mockResolvedValueOnce({
          models: [{ capabilities: ["text"] }],
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
    it("should use override when set", async () => {
      const server = createServer({
        overrides: { "test-model": { contextSize: 65536 } },
      });

      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(65536);
    });

    it("should use max_model_len when it is non-zero", async () => {
      mockRpc.mockResolvedValueOnce({ n_ctx: 4096 }); // /props
      mockRpc.mockResolvedValueOnce({ data: [{ max_model_len: 8192 }] }); // /v1/models

      const server = createServer();
      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(8192);
    });

    it("should fall back to n_ctx when max_model_len is 0", async () => {
      mockRpc.mockResolvedValueOnce({ n_ctx: 4096 });
      mockRpc.mockResolvedValueOnce({ data: [{ max_model_len: 0 }] });

      const server = createServer();
      const ctx = await server.getContextSize("test-model");

      expect(ctx).toBe(4096);
    });

    it("should return FALLBACK_CTX when both values are missing/null", async () => {
      mockRpc.mockResolvedValueOnce({});
      mockRpc.mockResolvedValueOnce({ data: [{ max_model_len: null }] });

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
});
