import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, RequestPolicy } from "../../src/api/client";
import { makeMockFetch } from "../mocks/rpc";

/** Helper: build an ApiClient with a mock fetchFn and default polling interval */
const makeClient = (
  fetchMock: ReturnType<typeof vi.fn>,
  baseUrl = "http://127.0.0.1:9931",
  apiKey = "sk-test",
): ApiClient =>
  new ApiClient(
    baseUrl,
    () => apiKey,
    async () => 10_000,
    fetchMock as typeof globalThis.fetch,
  );

/** Helper: build an ApiClient with a custom polling interval */
const makeClientWithPolling = (
  fetchMock: ReturnType<typeof vi.fn>,
  pollingInterval: number,
): ApiClient =>
  new ApiClient(
    "http://127.0.0.1:9931",
    () => "sk-test",
    async () => pollingInterval,
    fetchMock as typeof globalThis.fetch,
  );

describe("ApiClient", () => {
  describe("GET caching", () => {
    it("returns cached data on second call", async () => {
      const fetchMock = makeMockFetch({
        "/v1/models": { data: [{ id: "m1" }] },
      });
      const client = makeClient(fetchMock);

      const r1 = await client.get<{ data: unknown[] }>("/v1/models");
      const r2 = await client.get<{ data: unknown[] }>("/v1/models");

      expect(r1).toEqual({ data: [{ id: "m1" }] });
      expect(r2).toEqual({ data: [{ id: "m1" }] });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("returns different data for different endpoints", async () => {
      const fetchMock = makeMockFetch({
        "/v1/models": { data: [{ id: "m1" }] },
        "/props": { modalities: { vision: false } },
      });
      const client = makeClient(fetchMock);

      const models = await client.get<{ data: unknown[] }>("/v1/models");
      const props = await client.get<{ modalities: unknown }>("/props");

      expect(models).toEqual({ data: [{ id: "m1" }] });
      expect(props).toEqual({ modalities: { vision: false } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("GET deduplication", () => {
    it("shares one fetch for concurrent calls", async () => {
      const fetchMock = makeMockFetch({
        "/v1/models": { data: [{ id: "m1" }] },
      });
      const client = makeClient(fetchMock);

      const [r1, r2] = await Promise.all([
        client.get<{ data: unknown[] }>("/v1/models"),
        client.get<{ data: unknown[] }>("/v1/models"),
      ]);

      expect(r1).toEqual({ data: [{ id: "m1" }] });
      expect(r2).toEqual({ data: [{ id: "m1" }] });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("GET TTL expiry", () => {
    it("refetches after TTL expires", async () => {
      const fetchMock = makeMockFetch({
        "/v1/models": { data: [{ id: "m1" }] },
      });
      // Polling interval = 100ms → TTL = 80ms (default 0.8 ratio)
      const client = makeClientWithPolling(fetchMock, 100);

      vi.useFakeTimers(); // fake timers also mock Date.now, driving the TTL

      await client.get<{ data: unknown[] }>("/v1/models");
      // Advance the (mocked) clock past the TTL
      await vi.advanceTimersByTimeAsync(90);
      await client.get<{ data: unknown[] }>("/v1/models");

      expect(fetchMock).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe("POST caching", () => {
    it("shares one fetch for concurrent POSTs with same body", async () => {
      const fetchMock = makeMockFetch({
        "/models/unload": { data: [] },
      });
      const client = makeClient(fetchMock);

      const [r1, r2] = await Promise.all([
        client.post<{ data: unknown[] }>("/models/unload", { model: "m1" }),
        client.post<{ data: unknown[] }>("/models/unload", { model: "m1" }),
      ]);

      expect(r1).toEqual({ data: [] });
      expect(r2).toEqual({ data: [] });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("caches POST responses", async () => {
      const fetchMock = makeMockFetch({
        "/models/unload": { data: [] },
      });
      const client = makeClient(fetchMock);

      await client.post<{ data: unknown[] }>("/models/unload", { model: "m1" });
      await client.post<{ data: unknown[] }>("/models/unload", { model: "m1" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("uses different keys for different bodies", async () => {
      const fetchMock = makeMockFetch({
        "/models/unload": { data: [] },
      });
      const client = makeClient(fetchMock);

      await client.post<{ data: unknown[] }>("/models/unload", { model: "m1" });
      await client.post<{ data: unknown[] }>("/models/unload", { model: "m2" });

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("POST no collision with GET cache", () => {
    it("POST response is not served from GET cache", async () => {
      const fetchMock = makeMockFetch({
        "/v1/models": { data: [{ id: "m1" }] },
        "/models/unload": { data: [] },
      });
      const client = makeClient(fetchMock);

      // Fill cache with GET
      await client.get<{ data: unknown[] }>("/v1/models");
      // POST to different endpoint
      await client.post<{ data: unknown[] }>("/models/unload", { model: "m1" });

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("Error handling", () => {
    it("throws ApiError on 401", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({}), { status: 401 }),
      );
      const client = makeClient(fetchMock);

      await expect(
        client.get<{ data: unknown[] }>("/v1/models"),
      ).rejects.toThrow(ApiError);

      const err = await client
        .get<{ data: unknown[] }>("/v1/models")
        .catch((e) => e);
      expect((err as ApiError).statusCode).toBe(401);
    });

    it("throws ApiError on POST 401", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({}), { status: 401 }),
      );
      const client = makeClient(fetchMock);

      await expect(
        client.post<{ data: unknown[] }>("/models/unload", { model: "m1" }),
      ).rejects.toThrow(ApiError);
    });
  });

  describe("Raw requests", () => {
    it("raw GET calls fetch with no JSON parsing", async () => {
      const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
      const client = makeClient(fetchMock);

      await client.get<void>("/health", undefined, RequestPolicy.Raw);

      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:9931/health",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("raw POST calls fetch with JSON body", async () => {
      const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
      const client = makeClient(fetchMock);

      await client.post<void>(
        "/models/unload",
        { model: "m1" },
        undefined,
        RequestPolicy.Raw,
      );

      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:9931/models/unload",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ model: "m1" }),
        }),
      );
    });
  });

  describe("Status probe", () => {
    it("returns status code", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({}), { status: 200 }),
      );
      const client = makeClient(fetchMock);

      const status = await client.get<number>(
        "/health",
        1000,
        RequestPolicy.Status,
      );

      expect(status).toBe(200);
    });

    it("throws ApiError on 401", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({}), { status: 401 }),
      );
      const client = makeClient(fetchMock);

      await expect(
        client.get<number>("/health", 1000, RequestPolicy.Status),
      ).rejects.toThrow(ApiError);
    });

    it("caches results", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({}), { status: 200 }),
      );
      const client = makeClient(fetchMock);

      await client.get<number>("/health", 1000, RequestPolicy.Status);
      await client.get<number>("/health", 1000, RequestPolicy.Status);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Authorization header", () => {
    it("sends Bearer token on GET", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );
      const client = makeClient(fetchMock, "http://127.0.0.1:9931", "my-key");

      await client.get<{ data: unknown[] }>("/v1/models");

      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:9931/v1/models",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-key",
          }),
        }),
      );
    });

    it("sends Bearer token on POST", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );
      const client = makeClient(fetchMock, "http://127.0.0.1:9931", "my-key");

      await client.post<{ data: unknown[] }>("/models/unload", { model: "m1" });

      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:9931/models/unload",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-key",
          }),
        }),
      );
    });
  });

  describe("Cache clearing", () => {
    it("clearCache removes all entries", async () => {
      const fetchMock = makeMockFetch({
        "/v1/models": { data: [{ id: "m1" }] },
      });
      const client = makeClient(fetchMock);

      await client.get<{ data: unknown[] }>("/v1/models");
      client.clearCache();
      await client.get<{ data: unknown[] }>("/v1/models");

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
