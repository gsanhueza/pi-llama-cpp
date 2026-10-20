import { readFile, rename, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  API_KEY_PLACEHOLDER,
  LLAMA_SERVER_URL,
  PROVIDER_PREFIX,
  THINKING_BUDGETS,
} from "../../src/constants";
import { PollingIntervalSettingsItem } from "../../src/settings/items/pollingInterval";
import { PollingTimeoutSettingsItem } from "../../src/settings/items/pollingTimeout";
import { ServerTimeoutSettingsItem } from "../../src/settings/items/serverTimeout";
import { defaultBaseUrl } from "../constants";
import type { ModelOverride } from "../../src/interfaces/settings";
import { SettingsService } from "../../src/settings/settings";
import { SettingsReader } from "../../src/settings/reader";
import { SettingsWriter } from "../../src/settings/writer";
import { CredentialResolver } from "../../src/utils/credentialResolver";
import { SettingsStore } from "../../src/settings/store";
import { SingleServer } from "../../src/servers/singleServer";
import { createMockApiClient } from "../mocks/apiClient";

let manager: SettingsService;

// Hoisted mock instances
const mockReadStoredCredential = vi.hoisted(() => vi.fn());

const mockSettingsManager = vi.hoisted(() => ({
  getProjectSettings: vi.fn(),
  getGlobalSettings: vi.fn(),
  getDefaultThinkingLevel: vi.fn(),
  getThinkingBudgets: vi.fn(),
  reload: vi.fn(),
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
  writeFile: vi.fn(),
  rename: vi.fn(),
  access: vi.fn(),
}));

// Import mocked modules
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { access } from "node:fs/promises";

describe("API key resolution", () => {
  const mockGetAgentDir = vi.mocked(getAgentDir);

  afterEach(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockReadStoredCredential.mockReturnValue(undefined);
    manager = SettingsService.create();
  });

  it("should return placeholder when credential is not found", () => {
    mockReadStoredCredential.mockReturnValue(undefined);

    const result = manager.resolveApiKey(`llama-server=${defaultBaseUrl()}`);

    expect(result).toEqual(API_KEY_PLACEHOLDER);
  });

  it("should return placeholder when apiKey is missing from credential", () => {
    mockReadStoredCredential.mockReturnValue({});

    const result = manager.resolveApiKey(`llama-server=${defaultBaseUrl()}`);

    expect(result).toEqual(API_KEY_PLACEHOLDER);
  });

  it("should return the key when present in credential", () => {
    mockReadStoredCredential.mockReturnValue({ key: "test-api-key" });

    const result = manager.resolveApiKey(`llama-server=${defaultBaseUrl()}`);

    expect(result).toEqual("test-api-key");
  });

  it("should call readStoredCredential with the provider ID", () => {
    mockReadStoredCredential.mockReturnValue({ key: "test-key" });

    manager.resolveApiKey(`llama-server=${defaultBaseUrl()}`);

    expect(mockReadStoredCredential).toHaveBeenCalledWith(
      `llama-server=${defaultBaseUrl()}`,
    );
  });

  it("should resolve $VAR env reference from process.env", () => {
    mockReadStoredCredential.mockReturnValue({ key: "$MY_API_KEY" });
    process.env.MY_API_KEY = "env-resolved-key";

    const result = manager.resolveApiKey(`llama-server=${defaultBaseUrl()}`);

    expect(result).toBe("env-resolved-key");
    delete process.env.MY_API_KEY;
  });

  it("should resolve ${VAR} braced env reference from process.env", () => {
    mockReadStoredCredential.mockReturnValue({ key: "${MY_API_KEY}" });
    process.env.MY_API_KEY = "braced-resolved-key";

    const result = manager.resolveApiKey(`llama-server=${defaultBaseUrl()}`);

    expect(result).toBe("braced-resolved-key");
    delete process.env.MY_API_KEY;
  });

  it("should prefer credential.env over process.env", () => {
    mockReadStoredCredential.mockReturnValue({
      key: "$MY_KEY",
      env: { MY_KEY: "credential-env-value" },
    });
    process.env.MY_KEY = "process-env-value";

    const result = manager.resolveApiKey(`llama-server=${defaultBaseUrl()}`);

    expect(result).toBe("credential-env-value");
    delete process.env.MY_KEY;
  });

  it("should return placeholder when env var is not set", () => {
    mockReadStoredCredential.mockReturnValue({ key: "$UNSET_VAR" });
    delete process.env.UNSET_VAR;

    const result = manager.resolveApiKey(`llama-server=${defaultBaseUrl()}`);

    expect(result).toBe(API_KEY_PLACEHOLDER);
  });

  // Shell command tests are covered by Pi core's resolve-config-value tests.
  // The local implementation delegates to execSync which is tested there.

  it("should escape $$ as literal $", () => {
    mockReadStoredCredential.mockReturnValue({ key: "$$LITERAL" });

    const result = manager.resolveApiKey(`llama-server=${defaultBaseUrl()}`);

    expect(result).toBe("$LITERAL");
  });

  it("should escape $! as literal !", () => {
    mockReadStoredCredential.mockReturnValue({ key: "$!LITERAL" });

    const result = manager.resolveApiKey(`llama-server=${defaultBaseUrl()}`);

    expect(result).toBe("!LITERAL");
  });
});

describe("Server with custom id", () => {
  it("should use custom id as providerId when provided", () => {
    const server = new SingleServer(
      manager,
      { baseUrl: defaultBaseUrl(), customId: "my-custom-id" },
      createMockApiClient(defaultBaseUrl()),
    );

    expect(server.providerId).toEqual("my-custom-id");
  });

  it("should fall back to URL-based providerId when no custom id", () => {
    const server = new SingleServer(
      manager,
      { baseUrl: defaultBaseUrl() },
      createMockApiClient(defaultBaseUrl()),
    );

    expect(server.providerId).toEqual(`${PROVIDER_PREFIX}=${defaultBaseUrl()}`);
  });

  it("should try custom id first in getApiKey(), then fall back to URL-based", () => {
    const server = new SingleServer(
      manager,
      { baseUrl: defaultBaseUrl(), customId: "my-custom-id" },
      createMockApiClient(defaultBaseUrl()),
    );

    // Server construction resolves the key eagerly (ApiClient built there);
    // clear so the assertions below observe only the explicit getApiKey() call
    vi.clearAllMocks();
    // Mock: custom id returns placeholder (no key found)
    mockReadStoredCredential
      .mockReturnValueOnce(API_KEY_PLACEHOLDER)
      .mockReturnValueOnce({ key: "fallback-key" });

    const result = server.apiKey;

    expect(result).toEqual("fallback-key");
    expect(mockReadStoredCredential).toHaveBeenNthCalledWith(1, "my-custom-id");
    expect(mockReadStoredCredential).toHaveBeenNthCalledWith(
      2,
      `${PROVIDER_PREFIX}=${defaultBaseUrl()}`,
    );
  });

  it("should return custom id key directly when found", () => {
    mockReadStoredCredential.mockReturnValue({ key: "custom-key" });

    const server = new SingleServer(
      manager,
      { baseUrl: defaultBaseUrl(), customId: "my-custom-id" },
      createMockApiClient(defaultBaseUrl()),
    );

    const result = server.apiKey;

    expect(result).toEqual("custom-key");
    expect(mockReadStoredCredential).toHaveBeenCalledWith("my-custom-id");
  });
});

describe("Server with custom name", () => {
  it("should use custom name as suffix in providerName", () => {
    const server = new SingleServer(
      manager,
      { baseUrl: defaultBaseUrl(), customName: "Remote Server" },
      createMockApiClient(defaultBaseUrl()),
    );

    expect(server.providerName).toEqual(`Llama.cpp (Remote Server)`);
  });

  it("should fall back to URL-based name when no custom name", () => {
    const server = new SingleServer(
      manager,
      { baseUrl: defaultBaseUrl() },
      createMockApiClient(defaultBaseUrl()),
    );

    expect(server.providerName).toEqual(`Llama.cpp (${defaultBaseUrl()})`);
  });

  it("should use custom name even with custom id", () => {
    const server = new SingleServer(
      manager,
      {
        baseUrl: defaultBaseUrl(),
        customId: "my-custom-id",
        customName: "Remote Server",
      },
      createMockApiClient(defaultBaseUrl()),
    );

    expect(server.providerId).toEqual("my-custom-id");
    expect(server.providerName).toEqual(`Llama.cpp (Remote Server)`);
  });
});

describe("reactToModelSelect and autoloadOnMessage fallbacks", () => {
  afterEach(() => {});

  it("should return true when reactToModelSelect is not set", async () => {
    const result = await manager.resolveReactToModelSelect();

    expect(result).toBe(true);
  });

  it("should return true when autoloadOnMessage is not set", async () => {
    const result = await manager.resolveAutoloadOnMessage();

    expect(result).toBe(true);
  });

  it("should return 'asc' when sortBy is not set", async () => {
    const result = await manager.resolveSortBy();

    expect(result).toBe("asc");
  });

  it("should return user values when set", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: {
        reactToModelSelect: false,
        autoloadOnMessage: true,
      },
    });

    const manager = SettingsService.create();

    expect(await manager.resolveReactToModelSelect()).toBe(false);
    expect(await manager.resolveAutoloadOnMessage()).toBe(true);
  });
});

describe("resolveShowServerUrls", () => {
  const mockGetAgentDir = vi.mocked(getAgentDir);
  const mockGetProjectSettings = vi.mocked(
    mockSettingsManager.getProjectSettings,
  );
  const mockGetGlobalSettings = vi.mocked(
    mockSettingsManager.getGlobalSettings,
  );

  afterEach(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockGetProjectSettings.mockReturnValue({});
    mockGetGlobalSettings.mockReturnValue({});
    manager = SettingsService.create();
  });

  it("should return true (default) when showServerUrls is not set", async () => {
    const result = await manager.resolveShowServerUrls();

    expect(result).toBe(true);
  });

  it("should return false when explicitly set to false", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        showServerUrls: false,
      },
    });

    const manager = SettingsService.create();

    expect(await manager.resolveShowServerUrls()).toBe(false);
  });

  it("should return true when explicitly set to true", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        showServerUrls: true,
      },
    });

    const manager = SettingsService.create();

    expect(await manager.resolveShowServerUrls()).toBe(true);
  });

  it("should use global settings when no project config exists", async () => {
    mockGetGlobalSettings.mockReturnValue({
      llamaSettings: {
        showServerUrls: false,
      },
    });

    const manager = SettingsService.create();

    expect(await manager.resolveShowServerUrls()).toBe(false);
  });
});

describe("resolveServerConfigs", () => {
  const mockGetAgentDir = vi.mocked(getAgentDir);
  const mockGetProjectSettings = vi.mocked(
    mockSettingsManager.getProjectSettings,
  );
  const mockGetGlobalSettings = vi.mocked(
    mockSettingsManager.getGlobalSettings,
  );

  afterEach(() => {
    delete process.env.LLAMA_SERVER_URL;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockGetProjectSettings.mockReturnValue({});
    mockGetGlobalSettings.mockReturnValue({});
    manager = SettingsService.create();
  });

  it("should use llamaSettings.servers when configured", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          { url: "http://custom:9090", id: "my-server", name: "Custom" },
        ],
      },
    });

    const result = await manager.resolveServerConfigs();

    expect(result).toHaveLength(1);
    expect(result[0].baseUrl).toBe("http://custom:9090");
    expect(result[0].customId).toBe("my-server");
  });

  it("should fall back to resolveUrls when servers is empty", async () => {
    process.env.LLAMA_SERVER_URL = "http://env-server:9090";

    const result = await manager.resolveServerConfigs();

    expect(result).toHaveLength(1);
    expect(result[0].baseUrl).toBe("http://env-server:9090");
  });

  it("should fall back to default URL when no config exists", async () => {
    const result = await manager.resolveServerConfigs();

    expect(result).toHaveLength(1);
    expect(result[0].baseUrl).toBe(LLAMA_SERVER_URL);
  });

  it("should apply id/name from llamaSettings.servers as overrides", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: defaultBaseUrl(), id: "custom-id", name: "Custom" }],
      },
    });

    const result = await manager.resolveServerConfigs();

    expect(result).toHaveLength(1);
    expect(result[0].baseUrl).toBe(defaultBaseUrl());
    expect(result[0].customId).toBe("custom-id");
    expect(result[0].customName).toBe("Custom");
  });

  it("should handle multiple URLs with partial id/name overrides", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://first:9090", id: "first-server" }],
      },
    });
    process.env.LLAMA_SERVER_URL = "http://first:9090;http://second:9091";

    const result = await manager.resolveServerConfigs();

    expect(result).toHaveLength(2);
    expect(result[0].baseUrl).toBe("http://first:9090");
    expect(result[0].customId).toBe("first-server");
    expect(result[1].baseUrl).toBe("http://second:9091");
    expect(result[1].customId).toBeUndefined();
  });

  it("should prioritize env variable over global servers", async () => {
    process.env.LLAMA_SERVER_URL = "http://env:9090";
    mockGetGlobalSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://global:9090" }],
      },
    });

    const result = await manager.resolveServerConfigs();

    // env variable takes precedence via resolveUrls
    expect(result).toHaveLength(1);
    expect(result[0].baseUrl).toBe("http://env:9090");
  });
});

describe("resolveTimeouts", () => {
  afterEach(() => {});

  it("should return default timeouts when not configured", async () => {
    const result = await manager.resolveTimeouts();

    expect(result).toEqual({
      pollingInterval: PollingIntervalSettingsItem.defaultValue,
      pollingTimeout: PollingTimeoutSettingsItem.defaultValue,
      serverTimeout: ServerTimeoutSettingsItem.defaultValue,
    });
  });

  it("should use user-defined pollingTimeout", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: {
        pollingTimeout: 120000,
      },
    });

    const result = await manager.resolveTimeouts();

    expect(result.pollingTimeout).toBe(120000);
    expect(result.serverTimeout).toBe(ServerTimeoutSettingsItem.defaultValue);
  });

  it("should use user-defined serverTimeout", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: {
        serverTimeout: 3000,
      },
    });

    const result = await manager.resolveTimeouts();

    expect(result.pollingTimeout).toBe(PollingTimeoutSettingsItem.defaultValue);
    expect(result.serverTimeout).toBe(3000);
  });

  it("should use both user-defined timeouts", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: {
        pollingTimeout: 90000,
        serverTimeout: 2000,
      },
    });

    const result = await manager.resolveTimeouts();

    expect(result).toEqual({
      pollingInterval: PollingIntervalSettingsItem.defaultValue,
      pollingTimeout: 90000,
      serverTimeout: 2000,
    });
  });
});

describe("Thinking config resolution", () => {
  const mockGetAgentDir = vi.mocked(getAgentDir);

  afterEach(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("medium");
    mockSettingsManager.getThinkingBudgets.mockReturnValue({});
    manager = SettingsService.create();
  });

  it("should return the default thinking level from SettingsManager", () => {
    mockSettingsManager.getDefaultThinkingLevel.mockReturnValue("low");

    const result = manager.resolveThinkingLevel();

    expect(result).toEqual("low");
  });

  it("should return thinking budgets merged with defaults", () => {
    mockSettingsManager.getThinkingBudgets.mockReturnValue({
      low: 4096,
    });

    const result = manager.resolveThinkingBudgets();

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

describe("setLlamaSettings", () => {
  const mockGetAgentDir = vi.mocked(getAgentDir);
  const mockGetProjectSettings = vi.mocked(
    mockSettingsManager.getProjectSettings,
  );
  const mockGetGlobalSettings = vi.mocked(
    mockSettingsManager.getGlobalSettings,
  );
  const mockReload = vi.mocked(mockSettingsManager.reload);
  const mockReadFile = vi.mocked(readFile);
  const mockWriteFile = vi.mocked(writeFile);
  const mockRename = vi.mocked(rename);
  const mockAccess = vi.mocked(access);

  const GLOBAL_SETTINGS_PATH = "/fake/agent/dir/settings.json";
  const PROJECT_SETTINGS_PATH = "/fake/project/.pi/settings.json";
  const FAKE_CWD = "/fake/project";

  afterEach(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    vi.spyOn(process, "cwd").mockReturnValue(FAKE_CWD);
    mockGetProjectSettings.mockReturnValue({});
    mockGetGlobalSettings.mockReturnValue({});
    mockReload.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue("{}");
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    manager = SettingsService.create();
  });

  it("should write to project settings when .pi/settings.json exists (auto scope)", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue("{}");

    await manager.setLlamaSettings({ sortBy: "desc" });

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${PROJECT_SETTINGS_PATH}.tmp`,
      expect.any(String),
      "utf-8",
    );
    expect(mockRename).toHaveBeenCalledWith(
      `${PROJECT_SETTINGS_PATH}.tmp`,
      PROJECT_SETTINGS_PATH,
    );
  });

  it("should write to global settings when .pi/settings.json does not exist (auto scope)", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockReadFile.mockResolvedValue("{}");

    await manager.setLlamaSettings({ sortBy: "desc" });

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${GLOBAL_SETTINGS_PATH}.tmp`,
      expect.any(String),
      "utf-8",
    );
    expect(mockRename).toHaveBeenCalledWith(
      `${GLOBAL_SETTINGS_PATH}.tmp`,
      GLOBAL_SETTINGS_PATH,
    );
  });

  it("should write the merged llamaSettings key atomically and reload", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT")); // no project settings
    mockReadFile.mockResolvedValue(
      JSON.stringify(
        { unrelated: true, llamaSettings: { reactToModelSelect: true } },
        null,
        2,
      ),
    );

    await manager.setLlamaSettings({ sortBy: "desc" });

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [tmpPath, written, encoding] = mockWriteFile.mock.calls[0];
    expect(tmpPath).toBe(`${GLOBAL_SETTINGS_PATH}.tmp`);
    expect(encoding).toBe("utf-8");
    const parsed = JSON.parse(written as string);
    expect(parsed).toEqual({
      unrelated: true,
      llamaSettings: { reactToModelSelect: true, sortBy: "desc" },
    });
    expect(mockRename).toHaveBeenCalledWith(
      `${GLOBAL_SETTINGS_PATH}.tmp`,
      GLOBAL_SETTINGS_PATH,
    );
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {});

  it("should reflect the new value in resolvers immediately after the write", async () => {
    mockSettingsManager.reload.mockImplementation(async () => {
      mockGetGlobalSettings.mockReturnValue({
        llamaSettings: { sortBy: "desc" },
      });
    });

    await manager.setLlamaSettings({ sortBy: "desc" });

    expect(await manager.resolveSortBy()).toBe("desc");
  });

  it("should reject and skip reload when the write fails", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockRejectedValue(new Error("ENOSPC: simulated"));

    await expect(manager.setLlamaSettings({ sortBy: "desc" })).rejects.toThrow(
      "ENOSPC",
    );
    expect(mockReload).not.toHaveBeenCalled();
  });

  it("should reject and leave the file untouched when the JSON is invalid", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockReadFile.mockResolvedValue("{ broken");

    await expect(manager.setLlamaSettings({ sortBy: "desc" })).rejects.toThrow(
      /Cannot parse/,
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockReload).not.toHaveBeenCalled();
  });

  it("should persist booleans and numbers with type fidelity", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));

    await manager.setLlamaSettings({ reactToModelSelect: false });

    const [, firstWrite] = mockWriteFile.mock.calls[0];
    expect(JSON.parse(firstWrite as string)).toEqual({
      llamaSettings: { reactToModelSelect: false },
    });

    await manager.setLlamaSettings({ pollingTimeout: 120000 });

    const [, secondWrite] = mockWriteFile.mock.calls[1];
    expect(JSON.parse(secondWrite as string)).toEqual({
      llamaSettings: { pollingTimeout: 120000 },
    });
  });

  it("should construct the manager with reader and writer injected", () => {
    const reader = new SettingsReader(
      mockSettingsManager as unknown as SettingsManager,
      new CredentialResolver(),
    );
    const writer = new SettingsWriter(
      mockSettingsManager as unknown as SettingsManager,
      new SettingsStore("/fake/agent/dir/settings.json"),
      new SettingsStore("/fake/project/.pi/settings.json"),
    );

    expect(() => new SettingsService(reader, writer)).not.toThrow();
  });
});

describe("resolveServerOverrides", () => {
  const mockGetAgentDir = vi.mocked(getAgentDir);
  const mockGetProjectSettings = vi.mocked(
    mockSettingsManager.getProjectSettings,
  );
  const mockGetGlobalSettings = vi.mocked(
    mockSettingsManager.getGlobalSettings,
  );

  afterEach(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockGetProjectSettings.mockReturnValue({});
    mockGetGlobalSettings.mockReturnValue({});
    manager = SettingsService.create();
  });

  it("should return overrides for a server that has them configured", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          {
            url: defaultBaseUrl(),
            overrides: {
              "llama-3-8b": { cost: { input: 0.2, output: 0.6 } },
              "llama-3-70b": {
                cost: {
                  input: 0.1,
                  output: 0.3,
                  cacheRead: 0.01,
                  cacheWrite: 0.02,
                },
              },
            },
          },
        ],
      },
    });

    const result = await manager.resolveServerOverrides(defaultBaseUrl());

    expect(result).toEqual({
      "llama-3-8b": { cost: { input: 0.2, output: 0.6 } },
      "llama-3-70b": {
        cost: {
          input: 0.1,
          output: 0.3,
          cacheRead: 0.01,
          cacheWrite: 0.02,
        },
      },
    });
  });

  it("should return empty object for a server without overrides", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: defaultBaseUrl() }],
      },
    });

    const result = await manager.resolveServerOverrides(defaultBaseUrl());

    expect(result).toEqual({});
  });

  it("should return empty object when server URL is not in config", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://127.0.0.1:9090" }],
      },
    });

    const result = await manager.resolveServerOverrides(defaultBaseUrl());

    expect(result).toEqual({});
  });

  it("should use global settings when no project config exists", async () => {
    mockGetGlobalSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          {
            url: "http://global:9090",
            overrides: { "model-a": { cost: { input: 0.5 } } },
          },
        ],
      },
    });

    const result = await manager.resolveServerOverrides("http://global:9090");

    expect(result).toEqual({ "model-a": { cost: { input: 0.5 } } });
  });

  it("should prioritize project overrides over global overrides", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          {
            url: "http://shared:9090",
            overrides: { "model-b": { cost: { input: 0.1, output: 0.2 } } },
          },
        ],
      },
    });
    mockGetGlobalSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          {
            url: "http://shared:9090",
            overrides: { "model-b": { cost: { input: 0.5, output: 0.5 } } },
          },
        ],
      },
    });

    const result = await manager.resolveServerOverrides("http://shared:9090");

    expect(result).toEqual({
      "model-b": { cost: { input: 0.1, output: 0.2 } },
    });
  });

  it("should return empty object when servers list is empty", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: { servers: [] },
    });

    const result = await manager.resolveServerOverrides(defaultBaseUrl());

    expect(result).toEqual({});
  });

  it("should return empty object when llamaSettings is missing", async () => {
    mockGetProjectSettings.mockReturnValue({});

    const result = await manager.resolveServerOverrides(defaultBaseUrl());

    expect(result).toEqual({});
  });

  it("should support partial override objects", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          {
            url: defaultBaseUrl(),
            overrides: { "partial-model": { cost: { input: 0.1 } } },
          },
        ],
      },
    });

    const result = await manager.resolveServerOverrides(defaultBaseUrl());

    expect(result).toEqual({ "partial-model": { cost: { input: 0.1 } } });
  });
});

describe("Server with overrides", () => {
  it("should store and expose resolved overrides", () => {
    const server = new SingleServer(
      manager,
      {
        baseUrl: defaultBaseUrl(),
        overrides: {
          "model-a": { cost: { input: 0.2, output: 0.6 } },
          "model-b": { cost: { input: 0.1, output: 0.3, cacheRead: 0.01 } },
        },
      },
      createMockApiClient(defaultBaseUrl()),
    );

    expect(server.findOverrideForModel("model-a")).toEqual({
      cost: { input: 0.2, output: 0.6 },
    });
    expect(server.findOverrideForModel("model-b")).toEqual({
      cost: { input: 0.1, output: 0.3, cacheRead: 0.01 },
    });
  });

  it("should return undefined for findOverrideForModel when no overrides are provided", () => {
    const server = new SingleServer(
      manager,
      { baseUrl: defaultBaseUrl() },
      createMockApiClient(defaultBaseUrl()),
    );

    expect(server.findOverrideForModel("any-model")).toBeUndefined();
  });
});

describe("resolveServerConfigs passes overrides", () => {
  const mockGetAgentDir = vi.mocked(getAgentDir);
  const mockGetProjectSettings = vi.mocked(
    mockSettingsManager.getProjectSettings,
  );
  const mockGetGlobalSettings = vi.mocked(
    mockSettingsManager.getGlobalSettings,
  );

  afterEach(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockGetProjectSettings.mockReturnValue({});
    mockGetGlobalSettings.mockReturnValue({});
    manager = SettingsService.create();
  });

  it("should pass resolved overrides to ServerOptions", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          {
            url: "http://overrides-server:9090",
            overrides: { "model-x": { cost: { input: 0.5, output: 1.0 } } },
          },
          {
            url: "http://no-overrides-server:9090",
          },
        ],
      },
    });

    const result = await manager.resolveServerConfigs();

    expect(result).toHaveLength(2);
    expect(result[0].overrides).toEqual({
      "model-x": { cost: { input: 0.5, output: 1.0 } },
    });
    expect(result[1].overrides).toEqual({});
  });
});

describe("Server.findOverrideForModel", () => {
  function createServer(
    overrides: Record<string, ModelOverride>,
  ): SingleServer {
    return new SingleServer(
      SettingsService.create(),
      { baseUrl: "http://127.0.0.1:9931", overrides },
      createMockApiClient("http://127.0.0.1:9931"),
    );
  }

  it("should return undefined when overrides is empty", () => {
    const server = createServer({});
    expect(server.findOverrideForModel("llama-3-8b")).toBeUndefined();
  });

  it("should return undefined when no key matches", () => {
    const server = createServer({
      mistral: { cost: { input: 0.1 } },
      "gpt-4": { cost: { input: 0.3 } },
    });
    expect(server.findOverrideForModel("llama-3-8b")).toBeUndefined();
  });

  it("should match exact ID", () => {
    const server = createServer({
      "llama-3-8b": { cost: { input: 0.2, output: 0.6 } },
    });
    expect(server.findOverrideForModel("llama-3-8b")).toEqual({
      cost: { input: 0.2, output: 0.6 },
    });
  });

  it("should match prefix", () => {
    const server = createServer({
      llama: { cost: { input: 0.01, output: 0.02 } },
    });
    expect(server.findOverrideForModel("llama-3-8b")).toEqual({
      cost: { input: 0.01, output: 0.02 },
    });
  });

  it("should prefer longest match (most specific)", () => {
    const server = createServer({
      llama: { cost: { input: 0.01, output: 0.02 } },
      "llama-3": { cost: { input: 0.05, output: 0.1 } },
      "llama-3-8b": { cost: { input: 0.2, output: 0.6 } },
    });
    expect(server.findOverrideForModel("llama-3-8b")).toEqual({
      cost: { input: 0.2, output: 0.6 },
    });
  });

  it("should match the second-longest when exact match is absent", () => {
    const server = createServer({
      llama: { cost: { input: 0.01, output: 0.02 } },
      "llama-3": { cost: { input: 0.05, output: 0.1 } },
      "llama-3-8b": { cost: { input: 0.2, output: 0.6 } },
    });
    expect(server.findOverrideForModel("llama-3-70b")).toEqual({
      cost: { input: 0.05, output: 0.1 },
    });
  });

  it("should skip empty keys", () => {
    const server = createServer({
      "": { cost: { input: 0.001 } },
      llama: { cost: { input: 0.01 } },
    });
    expect(server.findOverrideForModel("llama-3-8b")).toEqual({
      cost: { input: 0.01 },
    });
  });

  it("should not match when model ID is shorter than key", () => {
    const server = createServer({
      "llama-3-8b": { cost: { input: 0.2 } },
    });
    expect(server.findOverrideForModel("llama")).toBeUndefined();
  });

  it("should handle single matching key", () => {
    const server = createServer({
      qwen: { cost: { input: 0.1, output: 0.3 } },
    });
    expect(server.findOverrideForModel("qwen-3-8b")).toEqual({
      cost: { input: 0.1, output: 0.3 },
    });
  });

  it("should handle overlapping but non-prefix matches", () => {
    const server = createServer({
      model: { cost: { input: 0.1 } },
      "model-a": { cost: { input: 0.2 } },
    });
    // "model" matches "model-a" and "model-b"
    // "model-a" matches only "model-a"
    expect(server.findOverrideForModel("model-a")).toEqual({
      cost: { input: 0.2 },
    });
    expect(server.findOverrideForModel("model-b")).toEqual({
      cost: { input: 0.1 },
    });
  });

  it("should return overrides with capabilities and reasoning", () => {
    const server = createServer({
      qwen: { capabilities: ["text", "image"], reasoning: false },
    });
    expect(server.findOverrideForModel("qwen-3-8b")).toEqual({
      capabilities: ["text", "image"],
      reasoning: false,
    });
  });
});

describe("resolveUrls", () => {
  const mockGetAgentDir = vi.mocked(getAgentDir);
  const mockGetProjectSettings = vi.mocked(
    mockSettingsManager.getProjectSettings,
  );
  const mockGetGlobalSettings = vi.mocked(
    mockSettingsManager.getGlobalSettings,
  );
  const mockReload = vi.mocked(mockSettingsManager.reload);

  afterEach(() => {
    delete process.env.LLAMA_SERVER_URL;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockGetProjectSettings.mockReturnValue({});
    mockGetGlobalSettings.mockReturnValue({});
    mockReload.mockResolvedValue(undefined);
    manager = SettingsService.create();
  });

  it("falls back to default when nothing is configured", async () => {
    const result = await manager.resolveUrls();
    expect(result).toEqual([LLAMA_SERVER_URL]);
  });

  it("prioritizes env variable over all config sources", async () => {
    process.env.LLAMA_SERVER_URL = "http://env:9090";
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://servers:9090" }],
      },
    });
    mockGetGlobalSettings.mockReturnValue({
      llamaServerUrl: "http://legacy:7070",
    });

    const result = await manager.resolveUrls();
    expect(result).toEqual(["http://env:9090"]);
  });

  it("prioritizes llamaSettings.servers over legacy llamaServerUrl", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://servers:9090" }],
      },
    });
    mockGetGlobalSettings.mockReturnValue({
      llamaServerUrl: "http://legacy:7070",
    });

    const result = await manager.resolveUrls();
    expect(result).toEqual(["http://servers:9090"]);
  });

  it("falls back to legacy when servers is empty", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [],
      },
    });
    mockGetGlobalSettings.mockReturnValue({
      llamaServerUrl: "http://legacy:7070",
    });

    const result = await manager.resolveUrls();
    expect(result).toEqual(["http://legacy:7070"]);
  });

  it("returns empty arrays from settings when values are falsy", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: undefined,
      },
    });
    mockGetGlobalSettings.mockReturnValue({
      llamaServerUrl: undefined,
    });

    const result = await manager.resolveUrls();
    expect(result).toEqual([LLAMA_SERVER_URL]);
  });
});

describe("URL resolution warnings", () => {
  const mockGetAgentDir = vi.mocked(getAgentDir);
  const mockGetProjectSettings = vi.mocked(
    mockSettingsManager.getProjectSettings,
  );
  const mockGetGlobalSettings = vi.mocked(
    mockSettingsManager.getGlobalSettings,
  );
  const mockReload = vi.mocked(mockSettingsManager.reload);

  afterEach(() => {
    delete process.env.LLAMA_SERVER_URL;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockGetProjectSettings.mockReturnValue({});
    mockGetGlobalSettings.mockReturnValue({});
    mockReload.mockResolvedValue(undefined);
    manager = SettingsService.create();
  });

  it("collects warnings for invalid env URLs", async () => {
    process.env.LLAMA_SERVER_URL = "invalid-url;http://good:9931";

    const result = await manager.resolveUrls();
    expect(result).toEqual(["http://good:9931"]);
    expect(manager.takeWarnings()).toEqual([
      "Ignoring invalid server URL 'invalid-url' (needs http(s)://)",
    ]);
  });

  it("collects warnings for invalid server URLs", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "bad-url" }, { url: "http://good:9931" }],
      },
    });

    const result = await manager.resolveUrls();
    expect(result).toEqual(["http://good:9931"]);
    expect(manager.takeWarnings()).toEqual([
      "Ignoring invalid server URL 'bad-url' (needs http(s)://)",
    ]);
  });

  it("clears warnings after takeWarnings()", async () => {
    process.env.LLAMA_SERVER_URL = "bad;http://good:9931";

    await manager.resolveUrls();
    expect(manager.takeWarnings()).toHaveLength(1);
    expect(manager.takeWarnings()).toEqual([]);
  });
});

describe("getLlamaServers", () => {
  it("should return the servers list from settings", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          { url: "http://127.0.0.1:9931" },
          { url: "http://127.0.0.1:8081" },
        ],
      },
    });

    const result = await manager.getLlamaServers();
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe("http://127.0.0.1:9931");
  });

  it("should return an empty array when no servers are configured", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: {},
    });

    const result = await manager.getLlamaServers();
    expect(result).toEqual([]);
  });
});

describe("resolveServerTimeout", () => {
  it("should return the server timeout from resolveTimeouts", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: { serverTimeout: 5000 },
    });

    expect(await manager.resolveServerTimeout()).toBe(5000);
  });
});

describe("resolvePollingInterval", () => {
  it("should return the polling interval from resolveTimeouts", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: { pollingInterval: 20 },
    });

    expect(await manager.resolvePollingInterval()).toBe(20);
  });
});

describe("resolvePollingTimeout", () => {
  it("should return the polling timeout from resolveTimeouts", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: { pollingTimeout: 30000 },
    });

    expect(await manager.resolvePollingTimeout()).toBe(30000);
  });
});

describe("resolveEnableSSE", () => {
  it("should return true when enableSSE is not set (default)", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: {},
    });

    expect(await manager.resolveEnableSSE()).toBe(true);
  });

  it("should return the configured enableSSE value", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: { enableSSE: false },
    });

    expect(await manager.resolveEnableSSE()).toBe(false);
  });
});

describe("resolveThinkingBudgets undefined fallback", () => {
  it("should return defaults when getThinkingBudgets returns undefined", () => {
    mockSettingsManager.getThinkingBudgets.mockReturnValue(undefined);

    const result = manager.resolveThinkingBudgets();

    expect(result).toEqual(THINKING_BUDGETS);
  });
});

describe("parseUrls edge cases", () => {
  it("should skip empty URL segments from trailing semicolons", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://good:9931;" }],
      },
    });

    const result = await manager.resolveUrls();
    expect(result).toEqual(["http://good:9931"]);
  });

  it("should skip empty URL segments from consecutive semicolons", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://good:9931;;http://also-good:8080" }],
      },
    });

    const result = await manager.resolveUrls();
    expect(result).toEqual(["http://good:9931", "http://also-good:8080"]);
  });
});
