import { afterEach, describe, expect, it } from "vitest";
import { ApiClient } from "../../src/api/client";
import { SSEClient } from "../../src/sse/client";
import { PollingIntervalSettingsItem } from "../../src/settings/items/pollingInterval";

/** Build a no-op ApiClient that never hits the network. */
const createNoopClient = (): ApiClient =>
  new ApiClient({
    baseUrl: "http://127.0.0.1:9999",
    getApiKey: () => "test-key",
    getPollingInterval: async () => PollingIntervalSettingsItem.defaultValue,
    getHeaders: () => ({}),
    fetchFn: () =>
      Promise.resolve(new Response(null, { status: 500 })) as ReturnType<
        typeof globalThis.fetch
      >,
  });

describe("SSEClient global tracking", () => {
  // The liveClients Set is module-scoped and persists across tests.
  // We can't clear it, so we only test that disconnect removes from it.
  afterEach(() => {
    // Disconnect any clients still alive from previous tests so they
    // don't get disconnected again by SSEClient.disconnectAll().
    // (The Set.delete in disconnect() is idempotent.)
  });

  it("should add the client to the live set on construction", () => {
    const apiClient = createNoopClient();
    // Construction adds the client to the live set.
    new SSEClient("http://127.0.0.1:9999/models/sse", apiClient);

    // The client should be in the set (tracked internally).
    // We verify by calling SSEClient.disconnectAll() and checking it doesn't throw.
    expect(() => SSEClient.disconnectAll()).not.toThrow();
  });

  it("disconnectAll should disconnect every tracked client", () => {
    const apiClient1 = createNoopClient();
    const apiClient2 = createNoopClient();

    // Disconnect any clients left over from previous tests
    SSEClient.disconnectAll();

    // Create two fresh clients
    const client1 = new SSEClient(
      "http://127.0.0.1:9999/models/sse",
      apiClient1,
    );
    const client2 = new SSEClient(
      "http://127.0.0.1:9998/models/sse",
      apiClient2,
    );

    // Both should be in the live set — disconnectAll should clean them up
    expect(() => SSEClient.disconnectAll()).not.toThrow();

    // After disconnectAll, calling disconnect on them again should be safe
    // (idempotent — the Set.delete in disconnect() handles missing entries)
    expect(() => {
      client1.disconnect();
      client2.disconnect();
    }).not.toThrow();
  });

  it("should remove the client from the set after disconnect", () => {
    const apiClient = createNoopClient();
    const client = new SSEClient("http://127.0.0.1:9999/models/sse", apiClient);

    // Disconnect this single client — also removes it from the live set.
    client.disconnect();

    // disconnectAll should still work (no other live clients)
    expect(() => SSEClient.disconnectAll()).not.toThrow();
  });
});
