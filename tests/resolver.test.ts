import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_KEY_PLACEHOLDER,
  DEFAULT_LLAMA_SERVER_URL,
  PROVIDER_ID,
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
    const result = await resolver.resolveUrl("/tmp/test-project");

    expect(result).toBe(DEFAULT_LLAMA_SERVER_URL);
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
    const result = await resolver.resolveUrl("/tmp/test-project");

    expect(result).toBe("http://localhost:9999");
  });

  it("should use env variable when no project config exists", async () => {
    process.env.LLAMA_SERVER_URL = "http://env-url:8080";

    const resolver = new ConfigResolver();
    const result = await resolver.resolveUrl("/tmp/test-project");

    expect(result).toBe("http://env-url:8080");
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
    const result = await resolver.resolveUrl("/tmp/test-project");

    expect(result).toBe("http://global:8080");
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
    const result = await resolver.resolveUrl("/tmp/test-project");

    expect(result).toBe("http://localhost:8080");
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
    const result1 = await resolver.resolveUrl("/tmp/project1");
    const result2 = await resolver.resolveUrl("/tmp/project2");

    expect(result1).toBe("http://first:8080");
    expect(result2).toBe("http://first:8080");
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
    const result = await resolver.resolveApiKey();

    expect(result).toBe(API_KEY_PLACEHOLDER);
  });

  it("should return placeholder when provider key is missing", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(
      JSON.stringify({ "other-provider": { key: "other-key" } }),
    );

    const resolver = new ConfigResolver();
    const result = await resolver.resolveApiKey();

    expect(result).toBe(API_KEY_PLACEHOLDER);
  });

  it("should return the provider key when present", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(
      JSON.stringify({ [PROVIDER_ID]: { key: "test-api-key" } }),
    );

    const resolver = new ConfigResolver();
    const result = await resolver.resolveApiKey();

    expect(result).toBe("test-api-key");
  });
});
