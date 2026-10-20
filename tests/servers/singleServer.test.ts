import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_CTX } from "../../src/constants";
import { SingleServer } from "../../src/servers/singleServer";
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
    new SingleServer(
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

describe("SingleServer", () => {
  describe("getContextSize", () => {
    it("should return n_ctx from /v1/models meta", async () => {
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

    it("should return FALLBACK_CTX when fetchModels throws", async () => {
      mockRpc.mockRejectedValueOnce(new Error("network"));

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
