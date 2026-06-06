import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_KEY_PLACEHOLDER,
  DEFAULT_LLAMA_SERVER_URL,
} from "../src/constants";

// Mock getAgentDir before importing resolver
vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: vi.fn().mockReturnValue("/fake/agent/dir"),
}));

vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  constants: { F_OK: 0 },
  readFile: vi.fn(),
}));

// Import mocked modules
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { access, readFile } from "node:fs/promises";
import { ConfigResolver } from "../src/resolver";

describe("URL resolution fallback chain", () => {
  const mockAccess = vi.mocked(access);
  const mockReadFile = vi.mocked(readFile);
  const mockGetAgentDir = vi.mocked(getAgentDir);

  afterEach(() => {
    delete process.env.LLAMA_SERVER_URL;
    vi.resetModules();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    // Default: no files exist
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockReadFile.mockResolvedValue("");
  });

  it("should return default URL when no config is found", async () => {
    const resolver = new ConfigResolver();
    const result = await resolver.resolveUrls("/tmp/test-project");

    expect(result).toEqual([DEFAULT_LLAMA_SERVER_URL]);
  });

  it("should prioritize project config over env variable", async () => {
    mockAccess.mockImplementation(async (_path: unknown) => {
      if (typeof _path === "string" && _path.includes("llama-server.json"))
        return undefined;
      throw new Error("ENOENT");
    });
    mockReadFile.mockResolvedValue(
      JSON.stringify({ url: "http://localhost:9999" }),
    );

    process.env.LLAMA_SERVER_URL = "http://env-url:8080";

    const resolver = new ConfigResolver();
    const result = await resolver.resolveUrls("/tmp/test-project");

    expect(result).toEqual(["http://localhost:9999"]);
  });

  it("should use env variable when no project config exists", async () => {
    process.env.LLAMA_SERVER_URL = "http://env-url:8080";

    const resolver = new ConfigResolver();
    const result = await resolver.resolveUrls("/tmp/test-project");

    expect(result).toEqual(["http://env-url:8080"]);
  });

  it("should use global settings when no project config or env exists", async () => {
    mockAccess.mockImplementation(async (_path: unknown) => {
      if (typeof _path === "string" && _path.includes("settings.json"))
        return undefined;
      throw new Error("ENOENT");
    });
    mockReadFile.mockResolvedValue(
      JSON.stringify({ llamaServerUrl: "http://global:8080" }),
    );

    const resolver = new ConfigResolver();
    const result = await resolver.resolveUrls("/tmp/test-project");

    expect(result).toEqual(["http://global:8080"]);
  });

  it("should strip trailing slashes from resolved URL", async () => {
    mockAccess.mockImplementation(async (_path: unknown) => {
      if (typeof _path === "string" && _path.includes("llama-server.json"))
        return undefined;
      throw new Error("ENOENT");
    });
    mockReadFile.mockResolvedValue(
      JSON.stringify({ url: "http://localhost:8080/" }),
    );

    const resolver = new ConfigResolver();
    const result = await resolver.resolveUrls("/tmp/test-project");

    expect(result).toEqual(["http://localhost:8080"]);
  });

  it("should cache the resolved URL on subsequent calls", async () => {
    mockAccess.mockImplementation(async (_path: unknown) => {
      if (typeof _path === "string" && _path.includes("llama-server.json"))
        return undefined;
      throw new Error("ENOENT");
    });
    mockReadFile.mockResolvedValue(
      JSON.stringify({ url: "http://first:8080" }),
    );

    const resolver = new ConfigResolver();
    const result1 = await resolver.resolveUrls("/tmp/project1");
    const result2 = await resolver.resolveUrls("/tmp/project2");

    expect(result1).toEqual(["http://first:8080"]);
    expect(result2).toEqual(["http://first:8080"]);
  });

  it("should handle multiple URLs separated by semicolons", async () => {
    mockAccess.mockImplementation(async (_path: unknown) => {
      if (typeof _path === "string" && _path.includes("llama-server.json"))
        return undefined;
      throw new Error("ENOENT");
    });
    mockReadFile.mockResolvedValue(
      JSON.stringify({ url: "http://first:8080;http://second:9090/" }),
    );

    const resolver = new ConfigResolver();
    const result = await resolver.resolveUrls("/tmp/test-project");

    expect(result).toEqual(["http://first:8080", "http://second:9090"]);
  });
});

describe("API key resolution", () => {
  const mockAccess = vi.mocked(access);
  const mockReadFile = vi.mocked(readFile);
  const mockGetAgentDir = vi.mocked(getAgentDir);

  afterEach(() => {
    vi.resetModules();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockReadFile.mockResolvedValue("");
  });

  it("should return placeholder when auth file does not exist", async () => {
    const resolver = new ConfigResolver();
    const result = await resolver.resolveApiKey(
      "llama-server=http://127.0.0.1:8080",
    );

    expect(result).toBe(API_KEY_PLACEHOLDER);
  });

  it("should return placeholder when provider key is missing", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(
      JSON.stringify({ "other-provider": { key: "other-key" } }),
    );

    const resolver = new ConfigResolver();
    const result = await resolver.resolveApiKey(
      "llama-server=http://127.0.0.1:8080",
    );

    expect(result).toBe(API_KEY_PLACEHOLDER);
  });

  it("should return the provider key when present", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        "llama-server=http://127.0.0.1:8080": { key: "test-api-key" },
      }),
    );

    const resolver = new ConfigResolver();
    const result = await resolver.resolveApiKey(
      "llama-server=http://127.0.0.1:8080",
    );

    expect(result).toBe("test-api-key");
  });

  it("should cache the auth file and reuse the key", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        "llama-server=http://127.0.0.1:8080": { key: "cached-key" },
      }),
    );

    const resolver = new ConfigResolver();
    const result1 = await resolver.resolveApiKey(
      "llama-server=http://127.0.0.1:8080",
    );
    const result2 = await resolver.resolveApiKey(
      "llama-server=http://127.0.0.1:8080",
    );

    expect(result1).toBe("cached-key");
    expect(result2).toBe("cached-key");
  });
});
