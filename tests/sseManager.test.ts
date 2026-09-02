import { beforeEach, describe, expect, it, vi } from "vitest";
import { POLLING_TIMEOUT, SERVER_TIMEOUT } from "../src/constants";
import { SSEManager } from "../src/sse/manager";

const mockSettings = vi.hoisted(() => ({
  resolveTimeouts: vi.fn(),
}));

vi.mock("../src/managers/settings", () => ({
  settings: mockSettings,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings.resolveTimeouts.mockReturnValue({
    pollingTimeout: POLLING_TIMEOUT,
    serverTimeout: SERVER_TIMEOUT,
  });
});

describe("SSEManager serverTimeout", () => {
  it("should resolve serverTimeout from the settings singleton", () => {
    const manager = new SSEManager("http://127.0.0.1:8080", "");

    expect(manager.serverTimeout).toBe(SERVER_TIMEOUT);
  });

  it("should read serverTimeout live from settings", () => {
    const manager = new SSEManager("http://127.0.0.1:8080", "");

    mockSettings.resolveTimeouts.mockReturnValue({
      pollingTimeout: POLLING_TIMEOUT,
      serverTimeout: 3000,
    });
    expect(manager.serverTimeout).toBe(3000);

    mockSettings.resolveTimeouts.mockReturnValue({
      pollingTimeout: POLLING_TIMEOUT,
      serverTimeout: 2000,
    });
    expect(manager.serverTimeout).toBe(2000);
  });
});

describe("SSEManager pollingTimeout", () => {
  it("should resolve pollingTimeout from the settings singleton", () => {
    const manager = new SSEManager("http://127.0.0.1:8080", "");

    expect(manager.pollingTimeout).toBe(POLLING_TIMEOUT);
  });

  it("should read pollingTimeout live from settings", () => {
    const manager = new SSEManager("http://127.0.0.1:8080", "");

    mockSettings.resolveTimeouts.mockReturnValue({
      pollingTimeout: 120000,
      serverTimeout: SERVER_TIMEOUT,
    });
    expect(manager.pollingTimeout).toBe(120000);
  });
});

describe("SSEManager subscribeToStatus", () => {
  it("should reject after the live pollingTimeout, not the constant", async () => {
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
      mockSettings.resolveTimeouts.mockReturnValue({
        pollingTimeout: 5000,
        serverTimeout: SERVER_TIMEOUT,
      });

      const manager = new SSEManager("http://127.0.0.1:8080", "");
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
      mockSettings.resolveTimeouts.mockReturnValue({
        pollingTimeout: 5000,
        serverTimeout: SERVER_TIMEOUT,
      });

      const manager = new SSEManager("http://127.0.0.1:8080", "");
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
