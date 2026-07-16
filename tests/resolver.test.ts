import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_KEY_PLACEHOLDER,
  DEFAULT_LLAMA_SERVER_URL,
} from "../src/constants";

// Hoisted mock instances — survives vi.resetModules()
const mockReadStoredCredential = vi.hoisted(() => vi.fn());

const mockSettingsManager = vi.hoisted(() => ({
  getProjectSettings: vi.fn(),
  getGlobalSettings: vi.fn(),
}));

// Mock getAgentDir, readStoredCredential, and SettingsManager before importing resolver
vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: vi.fn().mockReturnValue("/fake/agent/dir"),
  readStoredCredential: (...args: unknown[]) =>
    mockReadStoredCredential(...args),
  SettingsManager: {
    create: vi.fn().mockReturnValue(mockSettingsManager),
  },
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

// Import mocked modules
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { ConfigResolver } from "../src/resolver";

describe("URL resolution fallback chain", () => {
  const mockReadFile = vi.mocked(readFile);
  const mockGetAgentDir = vi.mocked(getAgentDir);
  const mockGetProjectSettings = vi.mocked(
    mockSettingsManager.getProjectSettings,
  );
  const mockGetGlobalSettings = vi.mocked(
    mockSettingsManager.getGlobalSettings,
  );

  afterEach(() => {
    delete process.env.LLAMA_SERVER_URL;
    vi.resetModules();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    // Default: no settings found
    mockGetProjectSettings.mockReturnValue({});
    mockGetGlobalSettings.mockReturnValue({});
  });

  it("should return default URL when no config is found", async () => {
    const resolver = new ConfigResolver();
    const result = await resolver.resolveUrls();

    expect(result).toEqual([DEFAULT_LLAMA_SERVER_URL]);
  });

  it("should prioritize project config over env variable", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaServerUrl: "http://localhost:9999",
    });
    process.env.LLAMA_SERVER_URL = "http://env-url:8080";

    const resolver = new ConfigResolver();
    const result = await resolver.resolveUrls();

    expect(result).toEqual(["http://localhost:9999"]);
  });

  it("should use env variable when no project config exists", async () => {
    mockGetProjectSettings.mockReturnValue({});
    process.env.LLAMA_SERVER_URL = "http://env-url:8080";

    const resolver = new ConfigResolver();
    const result = await resolver.resolveUrls();

    expect(result).toEqual(["http://env-url:8080"]);
  });

  it("should use global settings when no project config or env exists", async () => {
    mockGetProjectSettings.mockReturnValue({});
    mockGetGlobalSettings.mockReturnValue({
      llamaServerUrl: "http://global:8080",
    });

    const resolver = new ConfigResolver();
    const result = await resolver.resolveUrls();

    expect(result).toEqual(["http://global:8080"]);
  });

  it("should strip trailing slashes from resolved URL", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaServerUrl: "http://localhost:8080/",
    });

    const resolver = new ConfigResolver();
    const result = await resolver.resolveUrls();

    expect(result).toEqual(["http://localhost:8080"]);
  });

  it("should cache the resolved URL on subsequent calls", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaServerUrl: "http://first:8080",
    });

    const resolver = new ConfigResolver();
    const result1 = await resolver.resolveUrls();
    const result2 = await resolver.resolveUrls();

    expect(result1).toEqual(["http://first:8080"]);
    expect(result2).toEqual(["http://first:8080"]);
  });

  it("should handle multiple URLs separated by semicolons", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaServerUrl: "http://first:8080;http://second:9090/",
    });

    const resolver = new ConfigResolver();
    const result = await resolver.resolveUrls();

    expect(result).toEqual(["http://first:8080", "http://second:9090"]);
  });
});

describe("API key resolution", () => {
  const mockGetAgentDir = vi.mocked(getAgentDir);

  afterEach(() => {
    vi.resetModules();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockReadStoredCredential.mockReturnValue(undefined);
  });

  it("should return placeholder when credential is not found", () => {
    mockReadStoredCredential.mockReturnValue(undefined);

    const resolver = new ConfigResolver();
    const result = resolver.resolveApiKey("llama-server=http://127.0.0.1:8080");

    expect(result).toEqual(API_KEY_PLACEHOLDER);
  });

  it("should return placeholder when apiKey is missing from credential", () => {
    mockReadStoredCredential.mockReturnValue({});

    const resolver = new ConfigResolver();
    const result = resolver.resolveApiKey("llama-server=http://127.0.0.1:8080");

    expect(result).toEqual(API_KEY_PLACEHOLDER);
  });

  it("should return the apiKey when present in credential", () => {
    mockReadStoredCredential.mockReturnValue({ apiKey: "test-api-key" });

    const resolver = new ConfigResolver();
    const result = resolver.resolveApiKey("llama-server=http://127.0.0.1:8080");

    expect(result).toEqual("test-api-key");
  });

  it("should call readStoredCredential with the provider ID", () => {
    mockReadStoredCredential.mockReturnValue({ apiKey: "test-key" });

    const resolver = new ConfigResolver();
    resolver.resolveApiKey("llama-server=http://127.0.0.1:8080");

    expect(mockReadStoredCredential).toHaveBeenCalledWith(
      "llama-server=http://127.0.0.1:8080",
    );
  });
});
