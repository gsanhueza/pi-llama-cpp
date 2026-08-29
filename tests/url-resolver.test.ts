import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LLAMA_SERVER_URL } from "../src/constants";
import { UrlResolver } from "../src/resolvers/url-resolver";

// Mock SettingsManager before importing resolver
const mockSettingsManager = vi.hoisted(() => ({
  getProjectSettings: vi.fn(),
  getGlobalSettings: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: vi.fn().mockReturnValue("/fake/agent/dir"),
  SettingsManager: {
    create: vi.fn().mockReturnValue(mockSettingsManager),
  },
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";

describe("UrlResolver", () => {
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

  describe("priority chain", () => {
    it("should return default URL when no config is found", async () => {
      const resolver = new UrlResolver();
      const result = await resolver.resolve();

      expect(result).toEqual([DEFAULT_LLAMA_SERVER_URL]);
    });

    it("should prioritize project config over env variable", async () => {
      mockGetProjectSettings.mockReturnValue({
        llamaServerUrl: "http://localhost:9999",
      });
      process.env.LLAMA_SERVER_URL = "http://env-url:8080";

      const resolver = new UrlResolver();
      const result = await resolver.resolve();

      expect(result).toEqual(["http://localhost:9999"]);
    });

    it("should use env variable when no project config exists", async () => {
      mockGetProjectSettings.mockReturnValue({});
      process.env.LLAMA_SERVER_URL = "http://env-url:8080";

      const resolver = new UrlResolver();
      const result = await resolver.resolve();

      expect(result).toEqual(["http://env-url:8080"]);
    });

    it("should use global settings when no project config or env exists", async () => {
      mockGetProjectSettings.mockReturnValue({});
      mockGetGlobalSettings.mockReturnValue({
        llamaServerUrl: "http://global:8080",
      });

      const resolver = new UrlResolver();
      const result = await resolver.resolve();

      expect(result).toEqual(["http://global:8080"]);
    });
  });

  describe("URL parsing", () => {
    it("should strip trailing slashes from resolved URL", async () => {
      mockGetProjectSettings.mockReturnValue({
        llamaServerUrl: "http://localhost:8080/",
      });

      const resolver = new UrlResolver();
      const result = await resolver.resolve();

      expect(result).toEqual(["http://localhost:8080"]);
    });

    it("should handle multiple URLs separated by semicolons", async () => {
      mockGetProjectSettings.mockReturnValue({
        llamaServerUrl: "http://first:8080;http://second:9090/",
      });

      const resolver = new UrlResolver();
      const result = await resolver.resolve();

      expect(result).toEqual(["http://first:8080", "http://second:9090"]);
    });

    it("should cache the resolved URL on subsequent calls", async () => {
      mockGetProjectSettings.mockReturnValue({
        llamaServerUrl: "http://first:8080",
      });

      const resolver = new UrlResolver();
      const result1 = await resolver.resolve();
      const result2 = await resolver.resolve();

      expect(result1).toEqual(["http://first:8080"]);
      expect(result2).toEqual(["http://first:8080"]);
    });
  });

  describe("deprecated file warning", () => {
    it("should emit a warning when .pi/llama-server.json exists", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({ url: "http://old:8080" }),
      );

      const resolver = new UrlResolver();
      const result = await resolver.resolve();
      const warnings = resolver.getWarnings();

      expect(result).toEqual(["http://old:8080"]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("deprecated");
      expect(warnings[0]).toContain(".pi/settings.json");
    });
  });

  describe("parseUrls (pure)", () => {
    it("should split on semicolons", () => {
      const resolver = new UrlResolver();
      expect(resolver.parseUrls("a;b;c")).toEqual(["a", "b", "c"]);
    });

    it("should trim whitespace", () => {
      const resolver = new UrlResolver();
      expect(resolver.parseUrls(" a ; b ; c ")).toEqual(["a", "b", "c"]);
    });

    it("should filter empty strings", () => {
      const resolver = new UrlResolver();
      expect(resolver.parseUrls("a;;b")).toEqual(["a", "b"]);
    });

    it("should strip trailing slashes", () => {
      const resolver = new UrlResolver();
      expect(resolver.parseUrls("http://x:8080///")).toEqual(["http://x:8080"]);
    });

    it("should handle empty input", () => {
      const resolver = new UrlResolver();
      expect(resolver.parseUrls("")).toEqual([]);
    });

    it("should handle input with only separators", () => {
      const resolver = new UrlResolver();
      expect(resolver.parseUrls(";;")).toEqual([]);
    });
  });
});
