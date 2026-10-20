import type { SSEClient } from "../../src/sse/client";
import { SSEEventType } from "../../src/sse/types";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/api/client";
import { SSEManager } from "../../src/sse/manager";
import { createMockServer } from "../mocks/server";
import { mockResolver } from "../mocks/server";
import { createMockSSEClient, dispatchToMockClient } from "../mocks/sseClient";
import { makeResolverStub } from "../mocks/settings";
import { createMockApiClient } from "../mocks/apiClient";

/**
 * Builds an SSEManager bound to a stub server, mirroring how
 * `Server.initialize()` wires it up (timeouts come from the resolver).
 * Optionally injects an SSEClient and a custom fetch implementation.
 */
const createManager = (
  pollingTimeout = 60000,
  serverTimeout = 1000,
  sseClient?: SSEClient,
  fetchFn?: typeof globalThis.fetch,
): SSEManager => {
  const server = createMockServer({
    resolver: mockResolver,
    options: { baseUrl: "http://127.0.0.1:9931" },
  });
  const apiClient = fetchFn
    ? new ApiClient(
        "http://127.0.0.1:9931",
        () => "",
        async () => 500,
        fetchFn,
      )
    : createMockApiClient("http://127.0.0.1:9931");
  return new SSEManager(
    server,
    makeResolverStub({
      resolvePollingTimeout: vi.fn(async () => pollingTimeout),
      resolveServerTimeout: vi.fn(async () => serverTimeout),
    }),
    apiClient,
    sseClient,
  );
};

describe("SSEManager subscribeToStatus", () => {
  it("should reject after the server's pollingTimeout, not the constant", async () => {
    vi.useFakeTimers();
    // Never-resolving fetch: the connection stays open but no events arrive
    const fetchMock = vi.fn(
      async () => new Promise<Response>(() => {}),
    ) as typeof globalThis.fetch;

    const manager = createManager(5000, 1000, undefined, fetchMock);
    const promise = manager.subscribeToStatus("test-model");
    const expectation = expect(promise).rejects.toThrow(
      "SSE status timeout for model: test-model",
    );

    // If the timer still used the fixed 60 s constant, advancing 5 s
    // would not trigger the rejection.
    await vi.advanceTimersByTimeAsync(5000);
    await expectation;

    vi.useRealTimers();
  });

  it("should resolve when a terminal status arrives before the timeout", async () => {
    vi.useFakeTimers();
    // Inject a mock SSEClient so the test can emit events manually
    const mockClient = createMockSSEClient();

    try {
      const manager = createManager(5000, 1000, mockClient);
      const promise = manager.subscribeToStatus("test-model");
      const expectation = expect(promise).resolves.toMatchObject({
        status: "loaded",
      });

      manager.subscribeToProgress("test-model", () => {});
      await vi.advanceTimersByTimeAsync(0);

      // Emit a terminal status through the injected client
      dispatchToMockClient(mockClient, {
        event: "status_change",
        model: "test-model",
        data: { status: "loaded" },
      });

      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("should reject when connection fails before any event", async () => {
    vi.useFakeTimers();
    const mockClient = createMockSSEClient();
    let failCallback: (() => void) | undefined;

    // Patch setOnConnectFailed to capture the callback
    (
      mockClient.setOnConnectFailed as ReturnType<typeof vi.fn>
    ).mockImplementation((cb: () => void) => {
      failCallback = cb;
    });

    try {
      const manager = createManager(5000, 1000, mockClient);
      const promise = manager.subscribeToStatus("test-model");

      // The subscribeToStatus call is async, so we need to await a tick
      await vi.advanceTimersByTimeAsync(0);
      failCallback?.();

      await expect(promise).rejects.toThrow(
        "SSE connection failed for model: test-model",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SSEManager subscribeToProgress", () => {
  it("should emit progress from loading status events", async () => {
    vi.useFakeTimers();
    const mockClient = createMockSSEClient();
    const onProgress = vi.fn();

    const manager = createManager(5000, 1000, mockClient);
    manager.subscribeToProgress("test-model", onProgress);
    await vi.advanceTimersByTimeAsync(0);

    dispatchToMockClient(mockClient, {
      event: SSEEventType.status_change,
      model: "test-model",
      data: {
        status: "loading",
        progress: { stages: ["init"], current: "init", value: 0.5 },
      },
    });

    expect(onProgress).toHaveBeenCalledWith(50, "init");
    vi.useRealTimers();
  });

  it("should reset download tracking on loaded/failed status", async () => {
    vi.useFakeTimers();
    const mockClient = createMockSSEClient();
    const onProgress = vi.fn();

    const manager = createManager(5000, 1000, mockClient);
    manager.subscribeToProgress("test-model", onProgress);
    await vi.advanceTimersByTimeAsync(0);

    // Set some download state
    dispatchToMockClient(mockClient, {
      event: SSEEventType.download_progress,
      model: "test-model",
      data: { url: { done: 500, total: 1000 } },
    });

    // Then load the model — should reset tracking
    dispatchToMockClient(mockClient, {
      event: SSEEventType.status_change,
      model: "test-model",
      data: { status: "loaded" },
    });

    vi.useRealTimers();
  });

  it("should emit download progress percentage", async () => {
    vi.useFakeTimers();
    const mockClient = createMockSSEClient();
    const onProgress = vi.fn();

    const manager = createManager(5000, 1000, mockClient);
    manager.subscribeToProgress("test-model", onProgress);
    await vi.advanceTimersByTimeAsync(0);

    dispatchToMockClient(mockClient, {
      event: SSEEventType.download_progress,
      model: "test-model",
      data: {
        url1: { done: 500, total: 1000 },
        url2: { done: 500, total: 1000 },
      },
    });

    expect(onProgress).toHaveBeenCalledWith(50, "downloading");
    vi.useRealTimers();
  });

  it("should not emit when total to download is zero", async () => {
    vi.useFakeTimers();
    const mockClient = createMockSSEClient();
    const onProgress = vi.fn();

    const manager = createManager(5000, 1000, mockClient);
    manager.subscribeToProgress("test-model", onProgress);
    await vi.advanceTimersByTimeAsync(0);

    dispatchToMockClient(mockClient, {
      event: SSEEventType.download_progress,
      model: "test-model",
      data: { url: { done: 0, total: 0 } },
    });

    expect(onProgress).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("SSEManager probeSSE", () => {
  it("should return false when enableSSE is disabled", async () => {
    const resolver = makeResolverStub({
      resolveEnableSSE: vi.fn(async () => false),
      resolvePollingTimeout: vi.fn(async () => 60000),
      resolveServerTimeout: vi.fn(async () => 1000),
    });
    const server = createMockServer({
      resolver: mockResolver,
      options: { baseUrl: "http://127.0.0.1:9931" },
    });
    const manager = new SSEManager(
      server,
      resolver,
      createMockApiClient("http://127.0.0.1:9931"),
    );

    expect(await manager.probeSSE()).toBe(false);
  });

  it("should return true when server responds with SSE content-type", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      headers: {
        get: (key: string) =>
          key === "content-type" ? "text/event-stream" : null,
      },
    }) as typeof globalThis.fetch;

    const manager = createManager(60000, 1000, undefined, mockFetch);

    expect(await manager.probeSSE()).toBe(true);
  });

  it("should return false when server responds with non-SSE content-type", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      headers: { get: () => "application/json" },
    }) as typeof globalThis.fetch;

    const manager = createManager(60000, 1000, undefined, mockFetch);

    expect(await manager.probeSSE()).toBe(false);
  });

  it("should return false when server responds with non-ok status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      body: null,
      headers: { get: () => null },
    }) as typeof globalThis.fetch;

    const manager = createManager(60000, 1000, undefined, mockFetch);

    expect(await manager.probeSSE()).toBe(false);
  });

  it("should cache the probe result", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      headers: {
        get: (key: string) =>
          key === "content-type" ? "text/event-stream" : null,
      },
    }) as typeof globalThis.fetch;

    const manager = createManager(60000, 1000, undefined, mockFetch);

    expect(await manager.probeSSE()).toBe(true);
    expect(await manager.probeSSE()).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should return false when fetch throws", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("network error")) as typeof globalThis.fetch;

    const manager = createManager(60000, 1000, undefined, mockFetch);

    expect(await manager.probeSSE()).toBe(false);
  });
});

describe("SSEManager disconnect", () => {
  it("should clean up all subscribers and disconnect the SSE client", () => {
    const mockClient = createMockSSEClient();
    const manager = createManager(60000, 1000, mockClient);

    // Subscribe to create internal state
    manager.subscribeToProgress("model1", () => {});
    manager.subscribeToProgress("model2", () => {});

    manager.disconnect();

    expect(mockClient.disconnect).toHaveBeenCalled();
  });
});

describe("SSEManager cleanup on last callback removal", () => {
  it("should call the SSE client cleanup when the last callback is removed", () => {
    const mockClient = createMockSSEClient();
    const manager = createManager(60000, 1000, mockClient);

    const cb1 = () => {};
    const cb2 = () => {};

    const cleanup1 = manager.subscribeToProgress("model", cb1);
    const cleanup2 = manager.subscribeToProgress("model", cb2);

    // Remove the first callback — the SSE client cleanup should NOT run yet
    cleanup1();
    expect(mockClient.disconnect).not.toHaveBeenCalled();

    // Remove the last callback — the SSE client cleanup SHOULD run
    cleanup2();
  });
});
