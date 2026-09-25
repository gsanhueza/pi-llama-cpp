import { readFile, rename, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_KEY_PLACEHOLDER,
  LLAMA_SERVER_URL,
  POLLING_TIMEOUT,
  PROVIDER_PREFIX,
  SERVER_TIMEOUT,
} from "../../src/constants";
import type { ModelOverride } from "../../src/interfaces/settings";
import { settings } from "../../src/managers/settings";
import { Server } from "../../src/server";

// Hoisted mock instances — survives vi.resetModules()
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

    const result = await settings.resolveUrls();

    expect(result).toEqual([LLAMA_SERVER_URL]);
  });

  it("should prioritize env variable over project config", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaServerUrl: "http://localhost:9999",
    });
    process.env.LLAMA_SERVER_URL = "http://env-url:8080";

    const result = await settings.resolveUrls();

    expect(result).toEqual(["http://env-url:8080"]);
  });

  it("should use env variable when no other config exists", async () => {
    process.env.LLAMA_SERVER_URL = "http://env-url:8080";

    const result = await settings.resolveUrls();

    expect(result).toEqual(["http://env-url:8080"]);
  });

  it("should use legacy llamaServerUrl when env is not set", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaServerUrl: "http://project:9999",
    });

    const result = await settings.resolveUrls();

    expect(result).toEqual(["http://project:9999"]);
  });

  it("should use global settings when no project config or env exists", async () => {
    mockGetGlobalSettings.mockReturnValue({
      llamaServerUrl: "http://global:8080",
    });

    const result = await settings.resolveUrls();

    expect(result).toEqual(["http://global:8080"]);
  });

  it("should strip trailing slashes from resolved URL", async () => {
    process.env.LLAMA_SERVER_URL = "http://localhost:8080/";

    const result = await settings.resolveUrls();

    expect(result).toEqual(["http://localhost:8080"]);
  });

  it("should cache the resolved URL on subsequent calls", async () => {
    process.env.LLAMA_SERVER_URL = "http://first:8080";

    const result1 = await settings.resolveUrls();
    const result2 = await settings.resolveUrls();

    expect(result1).toEqual(["http://first:8080"]);
    expect(result2).toEqual(["http://first:8080"]);
  });

  it("should handle multiple URLs separated by semicolons", async () => {
    process.env.LLAMA_SERVER_URL = "http://first:8080;http://second:9090/";

    const result = await settings.resolveUrls();

    expect(result).toEqual(["http://first:8080", "http://second:9090"]);
  });

  it("should drop env URLs without an http(s) scheme, warn, and fall through", async () => {
    process.env.LLAMA_SERVER_URL = "127.0.0.1:8080";

    const result = await settings.resolveUrls();

    expect(result).toEqual([LLAMA_SERVER_URL]);
    expect(settings.takeWarnings()).toEqual([
      "Ignoring invalid server URL '127.0.0.1:8080' (needs http(s)://)",
    ]);
    expect(settings.takeWarnings()).toEqual([]); // drained
  });

  it("should drop server entries without an http(s) scheme and warn", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "127.0.0.1:8080" }, { url: "http://good:8080/" }],
      },
    });

    const result = await settings.resolveUrls();

    expect(result).toEqual(["http://good:8080"]);
    expect(settings.takeWarnings()).toEqual([
      "Ignoring invalid server URL '127.0.0.1:8080' (needs http(s)://)",
    ]);
    expect(settings.takeWarnings()).toEqual([]); // drained
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

    const result = await settings.resolveUrls();

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

    const result = await settings.resolveUrls();

    expect(result).toEqual(["http://project:8080"]);
  });

  it("should use global servers when no project servers exist", async () => {
    mockGetGlobalSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://global:8080" }],
      },
    });

    const result = await settings.resolveUrls();

    expect(result).toEqual(["http://global:8080"]);
  });

  it("should prioritize env variable over servers", async () => {
    process.env.LLAMA_SERVER_URL = "http://env:8080";
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://server:9090" }],
      },
    });

    const result = await settings.resolveUrls();

    expect(result).toEqual(["http://env:8080"]);
  });

  it("should use servers when env is not set", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://server:9090" }],
      },
    });

    const result = await settings.resolveUrls();

    expect(result).toEqual(["http://server:9090"]);
  });

  it("should prioritize servers over legacy llamaServerUrl", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaServerUrl: "http://legacy:8080",
      llamaSettings: {
        servers: [{ url: "http://server:9090" }],
      },
    });

    const result = await settings.resolveUrls();

    expect(result).toEqual(["http://server:9090"]);
  });

  it("should use legacy llamaServerUrl when servers is empty", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaServerUrl: "http://legacy:8080",
      llamaSettings: {
        servers: [],
      },
    });

    const result = await settings.resolveUrls();

    expect(result).toEqual(["http://legacy:8080"]);
  });

  it("should strip trailing slashes from server URLs", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://localhost:8080/" }],
      },
    });

    const result = await settings.resolveUrls();

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
    const server = new Server(settings, {
      baseUrl: "http://127.0.0.1:8080",
      customId: "my-custom-id",
    });

    expect(server.providerId).toEqual("my-custom-id");
  });

  it("should fall back to URL-based providerId when no custom id", () => {
    const server = new Server(settings, { baseUrl: "http://127.0.0.1:8080" });

    expect(server.providerId).toEqual(
      `${PROVIDER_PREFIX}=http://127.0.0.1:8080`,
    );
  });

  it("should try custom id first in getApiKey(), then fall back to URL-based", () => {
    const server = new Server(settings, {
      baseUrl: "http://127.0.0.1:8080",
      customId: "my-custom-id",
    });

    // Server construction resolves the key eagerly (ApiClient built there);
    // clear so the assertions below observe only the explicit getApiKey() call
    vi.clearAllMocks();
    // Mock: custom id returns placeholder (no key found)
    mockReadStoredCredential
      .mockReturnValueOnce(API_KEY_PLACEHOLDER)
      .mockReturnValueOnce({ key: "fallback-key" });

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

    const server = new Server(settings, {
      baseUrl: "http://127.0.0.1:8080",
      customId: "my-custom-id",
    });

    const result = server.getApiKey();

    expect(result).toEqual("custom-key");
    expect(mockReadStoredCredential).toHaveBeenCalledWith("my-custom-id");
  });
});

describe("Server with custom name", () => {
  it("should use custom name as suffix in providerName", () => {
    const server = new Server(settings, {
      baseUrl: "http://127.0.0.1:8080",
      customName: "Remote Server",
    });

    expect(server.providerName).toEqual(`Llama.cpp (Remote Server)`);
  });

  it("should fall back to URL-based name when no custom name", () => {
    const server = new Server(settings, { baseUrl: "http://127.0.0.1:8080" });

    expect(server.providerName).toEqual(`Llama.cpp (http://127.0.0.1:8080)`);
  });

  it("should use custom name even with custom id", () => {
    const server = new Server(settings, {
      baseUrl: "http://127.0.0.1:8080",
      customId: "my-custom-id",
      customName: "Remote Server",
    });

    expect(server.providerId).toEqual("my-custom-id");
    expect(server.providerName).toEqual(`Llama.cpp (Remote Server)`);
  });
});

describe("reactToModelSelect and autoloadOnMessage fallbacks", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("should return true when reactToModelSelect is not set", async () => {
    const { settings } = await import("../../src/managers/settings");

    const result = await settings.resolveReactToModelSelect();

    expect(result).toBe(true);
  });

  it("should return false when autoloadOnMessage is not set", async () => {
    const { settings } = await import("../../src/managers/settings");

    const result = await settings.resolveAutoloadOnMessage();

    expect(result).toBe(false);
  });

  it("should return 'asc' when sortBy is not set", async () => {
    const { settings } = await import("../../src/managers/settings");

    const result = await settings.resolveSortBy();

    expect(result).toBe("asc");
  });

  it("should return user values when set", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: {
        reactToModelSelect: false,
        autoloadOnMessage: true,
      },
    });

    const { settings } = await import("../../src/managers/settings");

    expect(await settings.resolveReactToModelSelect()).toBe(false);
    expect(await settings.resolveAutoloadOnMessage()).toBe(true);
  });
});

describe("resolveServers", () => {
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

  it("should use llamaSettings.servers when configured", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          { url: "http://custom:8080", id: "my-server", name: "Custom" },
        ],
      },
    });

    const result = await settings.resolveServers();

    expect(result).toHaveLength(1);
    expect(result[0].baseUrl).toBe("http://custom:8080");
    expect(result[0].providerId).toBe("my-server");
  });

  it("should fall back to resolveUrls when servers is empty", async () => {
    process.env.LLAMA_SERVER_URL = "http://env-server:9090";

    const result = await settings.resolveServers();

    expect(result).toHaveLength(1);
    expect(result[0].baseUrl).toBe("http://env-server:9090");
  });

  it("should fall back to default URL when no config exists", async () => {
    const result = await settings.resolveServers();

    expect(result).toHaveLength(1);
    expect(result[0].baseUrl).toBe(LLAMA_SERVER_URL);
  });

  it("should apply id/name from llamaSettings.servers as overrides", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          { url: "http://127.0.0.1:8080", id: "custom-id", name: "Custom" },
        ],
      },
    });

    const result = await settings.resolveServers();

    expect(result).toHaveLength(1);
    expect(result[0].baseUrl).toBe("http://127.0.0.1:8080");
    expect(result[0].providerId).toBe("custom-id");
    expect(result[0].providerName).toBe(`Llama.cpp (Custom)`);
  });

  it("should handle multiple URLs with partial id/name overrides", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://first:8080", id: "first-server" }],
      },
    });
    process.env.LLAMA_SERVER_URL = "http://first:8080;http://second:9090";

    const result = await settings.resolveServers();

    expect(result).toHaveLength(2);
    expect(result[0].baseUrl).toBe("http://first:8080");
    expect(result[0].providerId).toBe("first-server");
    expect(result[1].baseUrl).toBe("http://second:9090");
    expect(result[1].providerId).toBe(`${PROVIDER_PREFIX}=http://second:9090`);
  });

  it("should prioritize env variable over global servers", async () => {
    process.env.LLAMA_SERVER_URL = "http://env:8080";
    mockGetGlobalSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://global:9090" }],
      },
    });

    const result = await settings.resolveServers();

    // env variable takes precedence via resolveUrls
    expect(result).toHaveLength(1);
    expect(result[0].baseUrl).toBe("http://env:8080");
  });
});

describe("resolveTimeouts", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("should return default timeouts when not configured", async () => {
    const { settings } = await import("../../src/managers/settings");

    const result = await settings.resolveTimeouts();

    expect(result).toEqual({
      pollingTimeout: POLLING_TIMEOUT,
      serverTimeout: SERVER_TIMEOUT,
    });
  });

  it("should use user-defined pollingTimeout", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: {
        pollingTimeout: 120000,
      },
    });

    const { settings } = await import("../../src/managers/settings");

    const result = await settings.resolveTimeouts();

    expect(result.pollingTimeout).toBe(120000);
    expect(result.serverTimeout).toBe(SERVER_TIMEOUT);
  });

  it("should use user-defined serverTimeout", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: {
        serverTimeout: 3000,
      },
    });

    const { settings } = await import("../../src/managers/settings");

    const result = await settings.resolveTimeouts();

    expect(result.pollingTimeout).toBe(POLLING_TIMEOUT);
    expect(result.serverTimeout).toBe(3000);
  });

  it("should use both user-defined timeouts", async () => {
    mockSettingsManager.getProjectSettings.mockReturnValue({
      llamaSettings: {
        pollingTimeout: 90000,
        serverTimeout: 2000,
      },
    });

    const { settings } = await import("../../src/managers/settings");

    const result = await settings.resolveTimeouts();

    expect(result).toEqual({
      pollingTimeout: 90000,
      serverTimeout: 2000,
    });
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

describe("setLlamaSetting", () => {
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

  afterEach(() => {
    vi.resetModules();
  });

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
  });

  it("should write to project settings when .pi/settings.json exists (auto scope)", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue("{}");

    const { settings } = await import("../../src/managers/settings");
    await settings.setLlamaSetting("sortBy", "desc");

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

    const { settings } = await import("../../src/managers/settings");
    await settings.setLlamaSetting("sortBy", "desc");

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

  it("should always write to global when scope is explicitly 'global'", async () => {
    mockAccess.mockResolvedValue(undefined); // project exists but we override
    mockReadFile.mockResolvedValue("{}");

    const { settings } = await import("../../src/managers/settings");
    await settings.setLlamaSetting("sortBy", "desc", "global");

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${GLOBAL_SETTINGS_PATH}.tmp`,
      expect.any(String),
      "utf-8",
    );
  });

  it("should always write to project when scope is explicitly 'project'", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT")); // project doesn't exist but we override
    mockReadFile.mockResolvedValue("{}");

    const { settings } = await import("../../src/managers/settings");
    await settings.setLlamaSetting("sortBy", "desc", "project");

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${PROJECT_SETTINGS_PATH}.tmp`,
      expect.any(String),
      "utf-8",
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

    const { settings } = await import("../../src/managers/settings");
    await settings.setLlamaSetting("sortBy", "desc");

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

  afterEach(() => {
    vi.resetModules();
  });

  it("should reflect the new value in resolvers immediately after the write", async () => {
    mockSettingsManager.reload.mockImplementation(async () => {
      mockGetGlobalSettings.mockReturnValue({
        llamaSettings: { sortBy: "desc" },
      });
    });

    const { settings } = await import("../../src/managers/settings");
    await settings.setLlamaSetting("sortBy", "desc");

    expect(await settings.resolveSortBy()).toBe("desc");
  });

  it("should reject and skip reload when the write fails", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockRejectedValue(new Error("ENOSPC: simulated"));

    const { settings } = await import("../../src/managers/settings");
    await expect(settings.setLlamaSetting("sortBy", "desc")).rejects.toThrow(
      "ENOSPC",
    );
    expect(mockReload).not.toHaveBeenCalled();
  });

  it("should reject and leave the file untouched when the JSON is invalid", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockReadFile.mockResolvedValue("{ broken");

    const { settings } = await import("../../src/managers/settings");
    await expect(settings.setLlamaSetting("sortBy", "desc")).rejects.toThrow(
      /Cannot parse/,
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockReload).not.toHaveBeenCalled();
  });

  it("should persist booleans and numbers with type fidelity", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    const { settings } = await import("../../src/managers/settings");
    await settings.setLlamaSetting("reactToModelSelect", false);

    const [, firstWrite] = mockWriteFile.mock.calls[0];
    expect(JSON.parse(firstWrite as string)).toEqual({
      llamaSettings: { reactToModelSelect: false },
    });

    await settings.setLlamaSetting("pollingTimeout", 120000);

    const [, secondWrite] = mockWriteFile.mock.calls[1];
    expect(JSON.parse(secondWrite as string)).toEqual({
      llamaSettings: { pollingTimeout: 120000 },
    });
  });

  it("should still construct the manager without arguments", async () => {
    const { LlamaSettingsManager } =
      await import("../../src/managers/settings");

    expect(() => new LlamaSettingsManager()).not.toThrow();
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

  afterEach(() => {
    vi.resetModules();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockGetProjectSettings.mockReturnValue({});
    mockGetGlobalSettings.mockReturnValue({});
  });

  it("should return overrides for a server that has them configured", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          {
            url: "http://127.0.0.1:8080",
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

    const result = await settings.resolveServerOverrides(
      "http://127.0.0.1:8080",
    );

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
        servers: [{ url: "http://127.0.0.1:8080" }],
      },
    });

    const result = await settings.resolveServerOverrides(
      "http://127.0.0.1:8080",
    );

    expect(result).toEqual({});
  });

  it("should return empty object when server URL is not in config", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [{ url: "http://127.0.0.1:9090" }],
      },
    });

    const result = await settings.resolveServerOverrides(
      "http://127.0.0.1:8080",
    );

    expect(result).toEqual({});
  });

  it("should use global settings when no project config exists", async () => {
    mockGetGlobalSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          {
            url: "http://global:8080",
            overrides: { "model-a": { cost: { input: 0.5 } } },
          },
        ],
      },
    });

    const result = await settings.resolveServerOverrides("http://global:8080");

    expect(result).toEqual({ "model-a": { cost: { input: 0.5 } } });
  });

  it("should prioritize project overrides over global overrides", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          {
            url: "http://shared:8080",
            overrides: { "model-b": { cost: { input: 0.1, output: 0.2 } } },
          },
        ],
      },
    });
    mockGetGlobalSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          {
            url: "http://shared:8080",
            overrides: { "model-b": { cost: { input: 0.5, output: 0.5 } } },
          },
        ],
      },
    });

    const result = await settings.resolveServerOverrides("http://shared:8080");

    expect(result).toEqual({
      "model-b": { cost: { input: 0.1, output: 0.2 } },
    });
  });

  it("should return empty object when servers list is empty", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: { servers: [] },
    });

    const result = await settings.resolveServerOverrides(
      "http://127.0.0.1:8080",
    );

    expect(result).toEqual({});
  });

  it("should return empty object when llamaSettings is missing", async () => {
    mockGetProjectSettings.mockReturnValue({});

    const result = await settings.resolveServerOverrides(
      "http://127.0.0.1:8080",
    );

    expect(result).toEqual({});
  });

  it("should support partial override objects", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          {
            url: "http://127.0.0.1:8080",
            overrides: { "partial-model": { cost: { input: 0.1 } } },
          },
        ],
      },
    });

    const result = await settings.resolveServerOverrides(
      "http://127.0.0.1:8080",
    );

    expect(result).toEqual({ "partial-model": { cost: { input: 0.1 } } });
  });
});

describe("Server with overrides", () => {
  it("should store and expose resolved overrides", () => {
    const server = new Server(settings, {
      baseUrl: "http://127.0.0.1:8080",
      overrides: {
        "model-a": { cost: { input: 0.2, output: 0.6 } },
        "model-b": { cost: { input: 0.1, output: 0.3, cacheRead: 0.01 } },
      },
    });

    expect(server.findOverrideForModel("model-a")).toEqual({
      cost: { input: 0.2, output: 0.6 },
    });
    expect(server.findOverrideForModel("model-b")).toEqual({
      cost: { input: 0.1, output: 0.3, cacheRead: 0.01 },
    });
  });

  it("should return undefined for findOverrideForModel when no overrides are provided", () => {
    const server = new Server(settings, {
      baseUrl: "http://127.0.0.1:8080",
    });

    expect(server.findOverrideForModel("any-model")).toBeUndefined();
  });
});

describe("resolveServers passes overrides", () => {
  const mockGetAgentDir = vi.mocked(getAgentDir);
  const mockGetProjectSettings = vi.mocked(
    mockSettingsManager.getProjectSettings,
  );
  const mockGetGlobalSettings = vi.mocked(
    mockSettingsManager.getGlobalSettings,
  );

  afterEach(() => {
    vi.resetModules();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/fake/agent/dir");
    mockGetProjectSettings.mockReturnValue({});
    mockGetGlobalSettings.mockReturnValue({});
  });

  it("should pass resolved overrides to Server instances", async () => {
    mockGetProjectSettings.mockReturnValue({
      llamaSettings: {
        servers: [
          {
            url: "http://overrides-server:8080",
            overrides: { "model-x": { cost: { input: 0.5, output: 1.0 } } },
          },
          {
            url: "http://no-overrides-server:9090",
          },
        ],
      },
    });

    const result = await settings.resolveServers();

    expect(result).toHaveLength(2);
    expect(result[0].findOverrideForModel("model-x")).toEqual({
      cost: { input: 0.5, output: 1.0 },
    });
    expect(result[1].findOverrideForModel("any-model")).toBeUndefined();
  });
});

describe("Server.findOverrideForModel", () => {
  function createServer(overrides: Record<string, ModelOverride>): Server {
    return new Server(settings as any, {
      baseUrl: "http://127.0.0.1:8080",
      overrides,
    });
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
