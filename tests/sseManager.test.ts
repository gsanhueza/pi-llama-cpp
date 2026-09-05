import { describe, expect, it, vi } from "vitest";
import { SSEManager } from "../src/sse/manager";
import { createMockServer } from "./mocks";

/**
 * Builds an SSEManager bound to a stub server, mirroring how
 * `Server.initialize()` wires it up (timeouts are read through the server).
 */
const createManager = (
  pollingTimeout = 60000,
  serverTimeout = 1000,
): SSEManager =>
  new SSEManager(
    createMockServer({
      baseUrl: "http://127.0.0.1:8080",
      pollingTimeout,
      serverTimeout,
    }),
    "",
  );

describe("SSEManager timeouts", () => {
  it("should expose the timeouts of its server", () => {
    const manager = createManager(5678, 1234);

    expect(manager.pollingTimeout).toBe(5678);
    expect(manager.serverTimeout).toBe(1234);
  });
});

describe("SSEManager subscribeToStatus", () => {
  it("should reject after the server's pollingTimeout, not the constant", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "EventSource",
      class StubEventSource {
        onopen = null;
        onerror = null;
        onmessage = null;
        close() {}
      },
    );

    try {
      const manager = createManager(5000);
      const promise = manager.subscribeToStatus("test-model");
      const expectation = expect(promise).rejects.toThrow(
        "SSE status timeout for model: test-model",
      );

      // If the timer still used the fixed 60 s constant, advancing 5 s
      // would not trigger the rejection.
      await vi.advanceTimersByTimeAsync(5000);
      await expectation;
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("should resolve when a terminal status arrives before the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "EventSource",
      class StubEventSource {
        onopen = null;
        onerror = null;
        onmessage = null;
        close() {}
      },
    );

    try {
      const manager = createManager(5000);
      const promise = manager.subscribeToStatus("test-model");
      const expectation = expect(promise).resolves.toMatchObject({
        status: "loaded",
      });

      manager.subscribeToProgress("test-model", () => {});
      await vi.advanceTimersByTimeAsync(0);

      // Emit a terminal status through the shared client's dispatch path
      const client = (manager as any).sseClient;
      const handler = client.subscribers.get("test-model");
      handler({
        event: "status_change",
        model: "test-model",
        data: { status: "loaded" },
      });

      await expectation;
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
