import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerStatus } from "../../src/enums/serverStatus";
import { checkServerHealth } from "../../src/utils/health";

/**
 * Stubs `global.fetch` for one test. The probe only reads the parsed body,
 * so a fake response is just a `json()` accessor.
 */
const stubFetch = (
  impl: (url: string, init?: RequestInit) => Promise<unknown>,
) => vi.stubGlobal("fetch", vi.fn(impl));

const okResponse = () => ({ json: async () => ({ status: "ok" }) });

const URL_ = "http://127.0.0.1:8080";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkServerHealth", () => {
  it("should return READY when the payload status is ok", async () => {
    stubFetch(async () => ({ json: async () => ({ status: "ok" }) }));

    expect(await checkServerHealth(URL_, 1000)).toBe(ServerStatus.READY);
  });

  it("should return UNREACHABLE when the payload status is not ok", async () => {
    stubFetch(async () => ({ json: async () => ({ status: "error" }) }));

    expect(await checkServerHealth(URL_, 1000)).toBe(ServerStatus.UNREACHABLE);
  });

  it("should return UNREACHABLE when the payload has no status field", async () => {
    // llama-server answers a loading model with a 503 + error payload
    stubFetch(async () => ({
      json: async () => ({ error: { message: "Loading model" } }),
    }));

    expect(await checkServerHealth(URL_, 1000)).toBe(ServerStatus.UNREACHABLE);
  });

  it("should return UNREACHABLE when the body is not JSON", async () => {
    stubFetch(async () => ({
      json: async () => {
        throw new Error("Unexpected token");
      },
    }));

    expect(await checkServerHealth(URL_, 1000)).toBe(ServerStatus.UNREACHABLE);
  });

  it("should return UNREACHABLE on a network error", async () => {
    stubFetch(async () => {
      throw new Error("connection refused");
    });

    expect(await checkServerHealth(URL_, 1000)).toBe(ServerStatus.UNREACHABLE);
  });

  it("should return TIMEOUT when the fetch aborts with TimeoutError", async () => {
    stubFetch(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    expect(await checkServerHealth(URL_, 1000)).toBe(ServerStatus.TIMEOUT);
  });

  it("should return TIMEOUT when the fetch aborts with AbortError", async () => {
    // Some runtimes surface the timeout as a plain AbortError
    stubFetch(async () => {
      throw new DOMException("The user aborted a request.", "AbortError");
    });

    expect(await checkServerHealth(URL_, 1000)).toBe(ServerStatus.TIMEOUT);
  });

  it("should hit <url>/health", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      okResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    await checkServerHealth(URL_, 1000);

    expect(fetchMock).toHaveBeenCalledWith(`${URL_}/health`, {
      signal: expect.any(AbortSignal),
      headers: undefined,
    });
  });

  it("should send the API key as a Bearer token when provided", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      okResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    await checkServerHealth(URL_, 1000, "secret-key");

    expect(fetchMock).toHaveBeenCalledWith(`${URL_}/health`, {
      signal: expect.any(AbortSignal),
      headers: { Authorization: "Bearer secret-key" },
    });
  });

  it("should omit the Authorization header when no key is given", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      okResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    await checkServerHealth(URL_, 1000);

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });
});
