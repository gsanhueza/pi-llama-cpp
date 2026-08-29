import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { DEFAULT_LLAMA_SERVER_URL } from "../constants";

/**
 * Resolves llama-server URLs from various configuration sources.
 *
 * Priority chain: project config → env var → global settings → default.
 * Multiple URLs can be provided as a semicolon-separated string.
 */
export class UrlResolver {
  private warnings: string[] = [];
  private cachedUrls: string[] = [];
  private settingsManager = SettingsManager.create(
    process.cwd(),
    getAgentDir(),
  );

  /**
   * Resolves the llama-server URL from the global settings.json.
   *
   * @returns The resolved URL(s) in the settings file
   */
  private async resolveGlobalUrl(): Promise<string | null> {
    const settings = this.settingsManager.getGlobalSettings();
    const { llamaServerUrl = null } = settings as Record<string, string>;
    return llamaServerUrl;
  }

  /**
   * Resolves the llama-server URL from the project's .pi/settings.json.
   *
   * @returns The resolved URL(s) in the settings file
   */
  private async resolveProjectUrl(): Promise<string | null> {
    const settings = this.settingsManager.getProjectSettings();
    const { llamaServerUrl = null } = settings as Record<string, string>;
    return llamaServerUrl;
  }

  /**
   * Resolves the llama-server URL from the environment variable.
   */
  private async resolveEnvUrl(): Promise<string | null> {
    return process.env.LLAMA_SERVER_URL ?? null;
  }

  /**
   * Orchestrates the priority cascade to find the first available URL source.
   */
  private async extractJoinedUrls(): Promise<string> {
    let response = await this.resolveProjectUrl();
    if (response) return response;

    response = await this.resolveEnvUrl();
    if (response) return response;

    response = await this.resolveGlobalUrl();
    if (response) return response;

    return DEFAULT_LLAMA_SERVER_URL;
  }

  /**
   * Parses a raw URL string into an array of cleaned URLs.
   * Splits on semicolons, trims whitespace, filters empty strings,
   * and strips trailing slashes.
   */
  parseUrls(raw: string): string[] {
    return raw
      .split(";")
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
      .map((u) => u.replace(/\/+$/, ""));
  }

  /**
   * Resolves URLs where llama-servers are running (cached).
   */
  async resolve(): Promise<string[]> {
    if (this.cachedUrls.length > 0) return this.cachedUrls;

    const raw = await this.extractJoinedUrls();
    this.cachedUrls = this.parseUrls(raw);
    return this.cachedUrls;
  }

  /**
   * Returns warnings collected during URL resolution (e.g. deprecated file usage).
   */
  getWarnings(): string[] {
    const warnings = [...this.warnings];
    this.warnings.length = 0;
    return warnings;
  }
}
