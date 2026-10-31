import { describe, expect, it, vi } from "vitest";
import { ServerFactory } from "../../src/servers/serverFactory";
import { ServerStatus } from "../../src/enums/serverStatus";
import { makeResolverStub } from "../mocks/settings";

/** Builds a fetchFn that returns the given response impl. */
const stubFetch = (
  impl: (url: string, init?: RequestInit) => Promise<unknown>,
) => vi.fn(impl as typeof globalThis.fetch);

describe("ServerFactory.create", () => {
  it("should resolve the URL-based provider ID when customId is unset", async () => {
    const resolver = makeResolverStub({
      resolveApiKey: vi.fn((id) =>
        id === "llama-server=http://127.0.0.1:9931"
          ? "my-secret-key"
          : "placeholder",
      ),
      resolveHeaders: vi.fn(() => ({})),
    });

    const factory = new ServerFactory();
    const result = await factory.create(
      resolver,
      { baseUrl: "http://127.0.0.1:9931" },
      1000,
      stubFetch(async (url: string, init?: RequestInit) => {
        if (url.includes("/health"))
          return { ok: true, status: 200, json: async () => ({}) };
        const headers = init?.headers as Record<string, string> | undefined;
        if (headers?.Authorization === "Bearer my-secret-key")
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: "gguf-model.gguf", aliases: ["llama"] }],
            }),
          };
        return { ok: false, status: 401, json: async () => ({}) };
      }),
    );

    expect(result.status).toBe(ServerStatus.READY);
    expect(resolver.resolveApiKey).toHaveBeenCalledWith(
      "llama-server=http://127.0.0.1:9931",
    );
  });

  it("should prefer customId over URL-derived ID for key resolution", async () => {
    const resolver = makeResolverStub({
      resolveApiKey: vi.fn((id) =>
        id === "my-custom-id" ? "custom-key" : "placeholder",
      ),
      resolveHeaders: vi.fn(() => ({})),
    });

    const factory = new ServerFactory();
    await factory.create(
      resolver,
      { baseUrl: "http://127.0.0.1:9931", customId: "my-custom-id" },
      1000,
      stubFetch(async (url: string, init?: RequestInit) => {
        if (url.includes("/health"))
          return { ok: true, status: 200, json: async () => ({}) };
        const headers = init?.headers as Record<string, string> | undefined;
        if (headers?.Authorization === "Bearer custom-key")
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: "gguf-model.gguf", aliases: ["llama"] }],
            }),
          };
        return { ok: false, status: 401, json: async () => ({}) };
      }),
    );

    expect(resolver.resolveApiKey).toHaveBeenCalledWith("my-custom-id");
  });
});
