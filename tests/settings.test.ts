import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_KEY_PLACEHOLDER,
  DEFAULT_LLAMA_SERVER_URL,
  PROVIDER_PREFIX,
} from "../src/constants";
import { settings } from "../src/managers/settings";
import { Server } from "../src/server";

// Hoisted mock instances — survives vi.resetModules()
const mockReadStoredCredential = vi.hoisted(() => vi.fn());

const mockSettingsManager = vi.hoisted(() => ({
  getProjectSettings: vi.fn(),
  getGlobalSettings: vi.fn(),
  getDefaultThinkingLevel: vi.fn(),
  getThinkingBudgets: vi.fn(),
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

describe("URL resolution fallback chain", () => {
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
    // Ensure env var is not set (and not inherited from environment)
    delete process.env.LLAMA_SERVER_URL;

    const result = settings.resolveUrls();

    expect(result).toEqual([DEFAULT_LLAMA_SERVER_URL]);
  });

  it("should prioritize env variable over project config", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaServerUrl: "http://localhost:9999",
    });
    process.env.LLAMA_SERVER_URL = "http://env-url:8080";

    const result = settings.resolveUrls();

    expect(result).toEqual(["http://env-url:8080"]);
  });

  it("should use env variable when no other config exists", async () => {
    process.env.LLAMA_SERVER_URL = "http://env-url:8080";

    const result = settings.resolveUrls();

    expect(result).toEqual(["http://env-url:8080"]);
  });

  it("should use legacy llamaServerUrl when env is not set", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaServerUrl: "http://project:9999",
    });

    const result = settings.resolveUrls();

    expect(result).toEqual(["http://project:9999"]);
  });

  it("should use global settings when no project config or env exists", async () => {
    mockGetGlobalSettings.mockReturnValue({
      llamaServerUrl: "http://global:8080",
    });

    const result = settings.resolveUrls();

    expect(result).toEqual(["http://global:8080"]);
  });

  it("should strip trailing slashes from resolved URL", async () => {
    process.env.LLAMA_SERVER_URL = "http://localhost:8080/";

    const result = settings.resolveUrls();

    expect(result).toEqual(["http://localhost:8080"]);
  });

  it("should cache the resolved URL on subsequent calls", async () => {
    process.env.LLAMA_SERVER_URL = "http://first:8080";

    const result1 = settings.resolveUrls();
    const result2 = settings.resolveUrls();

    expect(result1).toEqual(["http://first:8080"]);
    expect(result2).toEqual(["http://first:8080"]);
  });

  it("should handle multiple URLs separated by semicolons", async () => {
    process.env.LLAMA_SERVER_URL = "http://first:8080;http://second:9090/";

    const result = settings.resolveUrls();

    expect(result).toEqual(["http://first:8080", "http://second:9090"]);
  });
});

describe("llamaSettings.servers resolution", () => {
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
    mockGetProjectSettings.mockReturnValue({});
    mockGetGlobalSettings.mockReturnValue({});
  });

  it("should resolve URLs from llamaSettings.servers in project config", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          { url: "http://project-server:8080" },
          { url: "http://project-server2:9090" },
        ],
      },
    });

    const result = settings.resolveUrls();

    expect(result).toEqual([
      "http://project-server:8080",
      "http://project-server2:9090",
    ]);
  });

  it("should prioritize project servers over global servers", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://project:8080" }],
      },
    });
    mockGetGlobalSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://global:9090" }],
      },
    });

    const result = settings.resolveUrls();

    expect(result).toEqual(["http://project:8080"]);
  });

  it("should use global servers when no project servers exist", async () => {
    mockGetGlobalSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://global:8080" }],
      },
    });

    const result = settings.resolveUrls();

    expect(result).toEqual(["http://global:8080"]);
  });

  it("should prioritize env variable over servers", async () => {
    process.env.LLAMA_SERVER_URL = "http://env:8080";
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://server:9090" }],
      },
    });

    const result = settings.resolveUrls();

    expect(result).toEqual(["http://env:8080"]);
  });

  it("should use servers when env is not set", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://server:9090" }],
      },
    });

    const result = settings.resolveUrls();

    expect(result).toEqual(["http://server:9090"]);
  });

  it("should prioritize servers over legacy llamaServerUrl", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaServerUrl: "http://legacy:8080",
      llamaSettings: {
        servers: [{ url: "http://server:9090" }],
      },
    });

    const result = settings.resolveUrls();

    expect(result).toEqual(["http://server:9090"]);
  });

  it("should use legacy llamaServerUrl when servers is empty", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaServerUrl: "http://legacy:8080",
      llamaSettings: {
        servers: [],
      },
    });

    const result = settings.resolveUrls();

    expect(result).toEqual(["http://legacy:8080"]);
  });

  it("should strip trailing slashes from server URLs", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://localhost:8080/" }],
      },
    });

    const result = settings.resolveUrls();

    expect(result).toEqual(["http://localhost:8080"]);
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

    const result = settings.resolveApiKey("llama-server=http://127.0.0.1:8080");

    expect(result).toEqual(API_KEY_PLACEHOLDER);
  });

  it("should return placeholder when apiKey is missing from credential", () => {
    mockReadStoredCredential.mockReturnValue({});

    const result = settings.resolveApiKey("llama-server=http://127.0.0.1:8080");

    expect(result).toEqual(API_KEY_PLACEHOLDER);
  });

  it("should return the key when present in credential", () => {
    mockReadStoredCredential.mockReturnValue({ key: "test-api-key" });

    const result = settings.resolveApiKey("llama-server=http://127.0.0.1:8080");

    expect(result).toEqual("test-api-key");
  });

  it("should call readStoredCredential with the provider ID", () => {
    mockReadStoredCredential.mockReturnValue({ key: "test-key" });

    settings.resolveApiKey("llama-server=http://127.0.0.1:8080");

    expect(mockReadStoredCredential).toHaveBeenCalledWith(
      "llama-server=http://127.0.0.1:8080",
    );
  });
});

describe("Server with custom id", () => {
  it("should use custom id as providerId when provided", () => {
    const server = new Server("http://127.0.0.1:8080", "my-custom-id");

    expect(server.providerId).toEqual("my-custom-id");
  });

  it("should fall back to URL-based providerId when no custom id", () => {
    const server = new Server("http://127.0.0.1:8080");

    expect(server.providerId).toEqual(
      `${PROVIDER_PREFIX}=http://127.0.0.1:8080`,
    );
  });

  it("should try custom id first in getApiKey(), then fall back to URL-based", () => {
    vi.clearAllMocks();
    // Mock: custom id returns placeholder (no key found)
    mockReadStoredCredential
      .mockReturnValueOnce(API_KEY_PLACEHOLDER)
      .mockReturnValueOnce({ key: "fallback-key" });

    const server = new Server("http://127.0.0.1:8080", "my-custom-id");

    const result = server.getApiKey();

    expect(result).toEqual("fallback-key");
    expect(mockReadStoredCredential).toHaveBeenNthCalledWith(1, "my-custom-id");
    expect(mockReadStoredCredential).toHaveBeenNthCalledWith(
      2,
      `${PROVIDER_PREFIX}=http://127.0.0.1:8080`,
    );
  });

  it("should return custom id key directly when found", () => {
    mockReadStoredCredential.mockReturnValue({ key: "custom-key" });

    const server = new Server("http://127.0.0.1:8080", "my-custom-id");

    const result = server.getApiKey();

    expect(result).toEqual("custom-key");
    expect(mockReadStoredCredential).toHaveBeenCalledWith("my-custom-id");
  });
});

describe("Thinking config resolution", () => {
  const mockGetAgentDir = vi.mocked(getAgentDir);

  afterEach(() => {
    vi.resetModules();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("medium");
    mockSettingsManager.getThinkingBudgets.mockReturnValue({});
  });

  it("should return the default thinking level from SettingsManager", () => {
    mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("low");

    const result = settings.resolveThinkingLevel();

    expect(result).toEqual("low");
  });

  it("should return thinking budgets merged with defaults", () => {
    mockSettingsManager.getThinkingBudgets.mockReturnValue({
      low: 4096,
    });

    const result = settings.resolveThinkingBudgets();

    expect(result).toEqual(
      expect.objectContaining({
        off: 0,
        minimal: 1024,
        low: 4096,
        medium: 8192,
        high: 16384,
        xhigh: 32768,
        max: -1,
      }),
    );
  });
});
