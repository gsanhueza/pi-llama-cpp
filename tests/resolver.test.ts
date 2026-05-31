import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_KEY_PLACEHOLDER,
  DEFAULT_LLAMA_SERVER_URL,
  PROVIDER_ID,
} from "../src/constants";

describe("URL resolution fallback chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.LLAMA_SERVER_URL;
  });

  it("should return default URL when no config is found", async () => {
    vi.doMock("node:fs/promises", () => ({
      access: vi.fn().mockRejectedValue(new Error("ENOENT")),
      constants: { F_OK: 0 },
      readFile: vi.fn().mockResolvedValue(""),
    }));

    const { resolveUrl } = await import("../src/tools/resolver");
    const result = await resolveUrl("/tmp/test-project");

    expect(result).toBe(DEFAULT_LLAMA_SERVER_URL);
  });

  it("should prioritize project config over env variable", async () => {
    vi.doMock("node:fs/promises", () => ({
      access: vi.fn().mockImplementation(async (path: string) => {
        if (path.includes("llama-server.json")) return undefined;
        throw new Error("ENOENT");
      }),
      constants: { F_OK: 0 },
      readFile: vi
        .fn()
        .mockResolvedValue(JSON.stringify({ url: "http://localhost:9999" })),
    }));

    process.env.LLAMA_SERVER_URL = "http://env-url:8080";

    const { resolveUrl } = await import("../src/tools/resolver");
    const result = await resolveUrl("/tmp/test-project");

    expect(result).toBe("http://localhost:9999");
  });

  it("should use env variable when no project config exists", async () => {
    vi.doMock("node:fs/promises", () => ({
      access: vi.fn().mockRejectedValue(new Error("ENOENT")),
      constants: { F_OK: 0 },
      readFile: vi.fn().mockResolvedValue(""),
    }));

    process.env.LLAMA_SERVER_URL = "http://env-url:8080";

    const { resolveUrl } = await import("../src/tools/resolver");
    const result = await resolveUrl("/tmp/test-project");

    expect(result).toBe("http://env-url:8080");
  });

  it("should use global settings when no project config or env exists", async () => {
    vi.doMock("node:fs/promises", () => ({
      access: vi.fn().mockImplementation(async (path: string) => {
        if (path.includes("settings.json")) return undefined;
        throw new Error("ENOENT");
      }),
      constants: { F_OK: 0 },
      readFile: vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({ llamaServerUrl: "http://global:8080" }),
        ),
    }));

    const { resolveUrl } = await import("../src/tools/resolver");
    const result = await resolveUrl("/tmp/test-project");

    expect(result).toBe("http://global:8080");
  });

  it("should use global settings from explicitly specified path from PI_CODING_AGENT_DIR if exist", async () => {
    process.env.PI_CODING_AGENT_DIR = "/tmp/test-project/.config";
    vi.doMock("node:fs/promises", () => ({
      access: vi.fn().mockImplementation(async (path: string) => {
        if (path.includes("settings.json")) return undefined;
        throw new Error("ENOENT");
      }),
      constants: { F_OK: 0 },
      readFile: vi.fn().mockResolvedValue(
        JSON.stringify({
          llamaServerUrl: "http://global:8088",
        }),
      ),
    }));

    const { resolveUrl } = await import("../src/tools/resolver");
    const result = await resolveUrl("/tmp/test-project/.config");

    expect(result).toBe("http://global:8088");
  });

  it("should strip trailing slashes from resolved URL", async () => {
    vi.doMock("node:fs/promises", () => ({
      access: vi.fn().mockImplementation(async (path: string) => {
        if (path.includes("llama-server.json")) return undefined;
        throw new Error("ENOENT");
      }),
      constants: { F_OK: 0 },
      readFile: vi
        .fn()
        .mockResolvedValue(JSON.stringify({ url: "http://localhost:8080/" })),
    }));

    const { resolveUrl } = await import("../src/tools/resolver");
    const result = await resolveUrl("/tmp/test-project");

    expect(result).toBe("http://localhost:8080");
  });
});

describe("API key resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should return placeholder when auth file does not exist", async () => {
    vi.doMock("node:fs/promises", () => ({
      access: vi.fn().mockRejectedValue(new Error("ENOENT")),
      constants: { F_OK: 0 },
      readFile: vi.fn().mockResolvedValue(""),
    }));

    const { resolveApiKey } = await import("../src/tools/resolver");
    const result = await resolveApiKey();

    expect(result).toBe(API_KEY_PLACEHOLDER);
  });

  it("should return placeholder when provider key is missing", async () => {
    vi.doMock("node:fs/promises", () => ({
      access: vi.fn().mockResolvedValue(undefined),
      constants: { F_OK: 0 },
      readFile: vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({ "other-provider": { key: "other-key" } }),
        ),
    }));

    const { resolveApiKey } = await import("../src/tools/resolver");
    const result = await resolveApiKey();

    expect(result).toBe(API_KEY_PLACEHOLDER);
  });

  it("should return the provider key when present", async () => {
    vi.doMock("node:fs/promises", () => ({
      access: vi.fn().mockResolvedValue(undefined),
      constants: { F_OK: 0 },
      readFile: vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({ [PROVIDER_ID]: { key: "test-api-key" } }),
        ),
    }));

    const { resolveApiKey } = await import("../src/tools/resolver");
    const result = await resolveApiKey();

    expect(result).toBe("test-api-key");
  });
});
