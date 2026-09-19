import { LLAMA_SERVER_URL } from "../constants";
import type { LlamaSettings } from "../interfaces/settings";
import { ServerUrl } from "./urls";

/**
 * Settings readers injected by {@link LlamaSettingsManager}. Both reload
 * settings from disk before reading, so the resolver always sees fresh data.
 */
export interface UrlResolverDeps {
  /** Merged `llamaSettings` (project overrides global). */
  getLlamaSettings(): Promise<LlamaSettings>;
  /** Fully merged settings map (used for the legacy `llamaServerUrl` key). */
  getMergedSettings(): Promise<Record<string, any>>;
}

/**
 * Multi-source llama-server URL resolution chain (see REFACTOR.md #4).
 *
 * Resolves URLs in priority order:
 *
 * 1. `LLAMA_SERVER_URL` env variable
 * 2. `llamaSettings.servers[].url` (current — project, then global)
 * 3. `llamaServerUrl` key (legacy — project, then global)
 * 4. Default URL
 *
 * Owns the warnings collected for dropped invalid URL entries; the
 * settings manager surfaces them via `takeWarnings()`.
 */
export class UrlResolver {
  /** Warnings collected during URL resolution (dropped invalid entries). */
  private warnings: string[] = [];

  constructor(private readonly deps: UrlResolverDeps) {}

  /**
   * Returns and clears warnings collected during URL resolution.
   */
  takeWarnings(): string[] {
    const warnings = [...this.warnings];
    this.warnings.length = 0;
    return warnings;
  }

  /**
   * Resolves the server URLs to use in the following order:
   *
   * - `LLAMA_SERVER_URL` env variable
   * - `llamaSettings` key (current - project, then global)
   * - `llamaServerUrl` key (legacy - project, then global)
   * - Default URL
   *
   * @returns The list of URLs to use
   */
  async resolveUrls(): Promise<string[]> {
    let response = this.resolveEnvUrls();
    if (response.length > 0) return response;

    response = await this.resolveServerUrls();
    if (response.length > 0) return response;

    response = await this.resolveLegacyUrls();
    if (response.length > 0) return response;

    return [LLAMA_SERVER_URL];
  }

  /**
   * Resolves the llama-server URLs from the environment variable.
   *
   * @returns A list of detected URLs
   */
  private resolveEnvUrls(): string[] {
    const raw = process.env.LLAMA_SERVER_URL;
    if (!raw) return [];

    return this.parseUrls(raw);
  }

  /**
   * Resolves the llama-server URLs from `llamaSettings.servers`.
   * Settings are merged, prioritizing project over global settings.
   * Reloads settings from disk before reading.
   *
   * @returns A list of detected URLs
   */
  private async resolveServerUrls(): Promise<string[]> {
    const { servers = [] } = await this.deps.getLlamaSettings();
    return servers.map((s) => this.parseUrls(s.url)).flat();
  }

  /**
   * Resolves the llama-server URLs from `llamaServerUrl` legacy key.
   * Settings are merged, prioritizing project over global settings.
   * Reloads settings from disk before reading.
   *
   * @returns A list of detected URLs
   */
  private async resolveLegacyUrls(): Promise<string[]> {
    const { llamaServerUrl = null } = await this.deps.getMergedSettings();
    if (!llamaServerUrl) return [];

    return this.parseUrls(llamaServerUrl);
  }

  /**
   * Parses a raw URL string into an array of cleaned URLs.
   * Splits on semicolons, trims whitespace, filters empty strings, strips
   * trailing slashes, and drops entries without an http(s) scheme —
   * collecting a warning for each dropped entry (same validation the
   * `/models servers` editor applies).
   *
   * @returns A sanitized URL
   */
  private parseUrls(raw: string): string[] {
    return raw
      .split(";")
      .map(ServerUrl.normalize)
      .filter((u) => {
        if (u.length === 0) return false;
        if (!ServerUrl.isValid(u)) {
          this.warnings.push(
            `Ignoring invalid server URL '${u}' (needs http(s)://)`,
          );
          return false;
        }
        return true;
      });
  }
}
