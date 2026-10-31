import { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  API_KEY_PLACEHOLDER,
  LLAMA_SERVER_URL,
  SETTINGS_KEY,
  THINKING_BUDGETS,
} from "../constants";
import { AutoloadOnMessageSettingsItem } from "./items/autoloadOnMessage";
import { PollingIntervalSettingsItem } from "./items/pollingInterval";
import { PollingTimeoutSettingsItem } from "./items/pollingTimeout";
import { ReactToModelSelectSettingsItem } from "./items/reactToModelSelect";
import { ServerTimeoutSettingsItem } from "./items/serverTimeout";
import { ShowServerUrlsSettingsItem } from "./items/showServerUrls";
import { SortBySettingsItem } from "./items/sortBy";
import {
  LlamaServer,
  LlamaSettings,
  ModelOverride,
} from "../interfaces/settings";
import type {
  ServerOptions,
  ServerSettingsResolver,
} from "../interfaces/server";
import type { SortBy } from "../interfaces/sortBy";
import { CredentialResolver } from "../utils/credentialResolver";
import { ServerUrl } from "../utils/urls";

/**
 * Read-only settings resolver.
 *
 * Owns all reading logic: merged settings, URL resolution, server configs,
 * API keys, timeouts, sort order, SSE/autoload/react flags, thinking level.
 * Implements {@link ServerSettingsResolver} so it can be injected into
 * `Server`, `SSEManager`, and `Model`.
 */
export class SettingsReader implements ServerSettingsResolver {
  private warnings: string[] = [];

  constructor(
    private readonly settingsManager: SettingsManager,
    private readonly credentialResolver: CredentialResolver,
  ) {}

  /**
   * Returns and clears warnings collected during URL resolution.
   */
  takeWarnings(): string[] {
    const warnings = [...this.warnings];
    this.warnings.length = 0;
    return warnings;
  }

  /**
   * Reloads settings from disk and returns merged project/global settings.
   */
  private async getMergedSettings(): Promise<Record<string, any>> {
    await this.settingsManager.reload();
    return {
      ...this.settingsManager.getGlobalSettings(),
      ...this.settingsManager.getProjectSettings(),
    } as Record<string, any>;
  }

  /**
   * Convenience method for the `llamaSettings` key.
   */
  async getLlamaSettings(): Promise<LlamaSettings> {
    return (await this.getMergedSettings())[SETTINGS_KEY] ?? {};
  }

  /**
   * Convenience method for the merged `servers` list.
   */
  async getLlamaServers(): Promise<LlamaServer[]> {
    return (await this.getLlamaSettings()).servers ?? [];
  }

  /**
   * Resolves the server URLs to use (env > servers > legacy > default).
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

  private resolveEnvUrls(): string[] {
    const raw = process.env.LLAMA_SERVER_URL;
    if (!raw) return [];
    return this.parseUrls(raw);
  }

  private async resolveServerUrls(): Promise<string[]> {
    const { servers = [] } = await this.getLlamaSettings();
    return servers.map((s) => this.parseUrls(s.url)).flat();
  }

  private async resolveLegacyUrls(): Promise<string[]> {
    const { llamaServerUrl = null } = await this.getMergedSettings();
    if (!llamaServerUrl) return [];
    return this.parseUrls(llamaServerUrl);
  }

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

  /**
   * Resolves the override map for a given server URL.
   */
  async resolveServerOverrides(
    serverUrl: string,
  ): Promise<Record<string, ModelOverride>> {
    const serverConfig = (await this.getLlamaSettings()).servers?.find(
      (s: { url: string }) => s.url === serverUrl,
    );
    return serverConfig?.overrides ?? {};
  }

  /**
   * Resolves the raw server configurations for building `Server` instances.
   */
  async resolveServerConfigs(): Promise<ServerOptions[]> {
    const urls = await this.resolveUrls();
    const serverConfigs = (await this.getLlamaSettings()).servers ?? [];

    const configs: ServerOptions[] = [];
    for (const url of urls) {
      const config = serverConfigs.find((s) => s.url === url);
      const overrides = await this.resolveServerOverrides(url);
      configs.push({
        baseUrl: url,
        customId: config?.id,
        customName: config?.name,
        headers: config?.headers,
        overrides,
      });
    }
    return configs;
  }

  /**
   * Resolves the values of a server's custom headers (literal, `$VAR`,
   * `${VAR}`, or `!command`). `$VAR` resolves against the provider's
   * credential `env` first, then `process.env`.
   *
   * Headers whose value can't be resolved (e.g. an unset env var) are
   * omitted rather than sent as a placeholder. Non-string values are
   * ignored, since the settings file is edited by hand.
   *
   * @param providerId - The provider ID the credential is stored under.
   * @param headers - The headers as written in `llamaSettings.servers`.
   * @returns The resolved headers, or `undefined` when none remain.
   */
  resolveHeaders(
    providerId: string,
    headers?: Record<string, string>,
  ): Record<string, string> | undefined {
    const entries = Object.entries(headers ?? {});
    if (entries.length === 0) return undefined;

    const env = this.credentialResolver.readEnv(providerId);
    const resolved: Record<string, string> = {};
    for (const [name, raw] of entries) {
      if (typeof raw !== "string") continue;
      const value = this.credentialResolver.resolve(raw, env);
      if (value !== API_KEY_PLACEHOLDER) resolved[name] = value;
    }
    return Object.keys(resolved).length > 0 ? resolved : undefined;
  }

  /**
   * Resolves API key: env var > Pi's stored credentials.
   *
   * When `LLAMA_SERVER_API_KEY` is set it takes precedence over any
   * credential store entry so the user can bypass registration entirely.
   *
   * @param providerId - The provider ID the credential is stored under.
   * @returns The resolved API key, or the placeholder on failure.
   */
  resolveApiKey(providerId: string): string {
    const envKey = process.env.LLAMA_SERVER_API_KEY;
    if (envKey) return envKey;

    return this.credentialResolver.resolveForProvider(providerId);
  }

  /**
   * Resolves the current thinking level from Pi.
   */
  resolveThinkingLevel(): ModelThinkingLevel | undefined {
    return this.settingsManager.getDefaultThinkingLevel();
  }

  /**
   * Resolves the effective thinking budgets from settings.
   */
  resolveThinkingBudgets(): Record<ModelThinkingLevel, number> {
    const settingsBudgets = this.settingsManager.getThinkingBudgets() ?? {};
    return {
      ...THINKING_BUDGETS,
      ...settingsBudgets,
    };
  }

  async resolveReactToModelSelect(): Promise<boolean> {
    return (
      (await this.getLlamaSettings()).reactToModelSelect ??
      ReactToModelSelectSettingsItem.defaultValue
    );
  }

  async resolveAutoloadOnMessage(): Promise<boolean> {
    return (
      (await this.getLlamaSettings()).autoloadOnMessage ??
      AutoloadOnMessageSettingsItem.defaultValue
    );
  }

  async resolveTimeouts(): Promise<{
    pollingInterval: number;
    pollingTimeout: number;
    serverTimeout: number;
  }> {
    const llamaSettings = await this.getLlamaSettings();
    return {
      pollingInterval:
        llamaSettings.pollingInterval ??
        PollingIntervalSettingsItem.defaultValue,
      pollingTimeout:
        llamaSettings.pollingTimeout ?? PollingTimeoutSettingsItem.defaultValue,
      serverTimeout:
        llamaSettings.serverTimeout ?? ServerTimeoutSettingsItem.defaultValue,
    };
  }

  async resolveServerTimeout(): Promise<number> {
    return (await this.resolveTimeouts()).serverTimeout;
  }

  async resolvePollingInterval(): Promise<number> {
    return (await this.resolveTimeouts()).pollingInterval;
  }

  async resolvePollingTimeout(): Promise<number> {
    return (await this.resolveTimeouts()).pollingTimeout;
  }

  async resolveSortBy(): Promise<SortBy> {
    return (
      (await this.getLlamaSettings()).sortBy ?? SortBySettingsItem.defaultValue
    );
  }

  async resolveShowServerUrls(): Promise<boolean> {
    return (
      (await this.getLlamaSettings()).showServerUrls ??
      ShowServerUrlsSettingsItem.defaultValue
    );
  }

  async resolveEnableSSE(): Promise<boolean> {
    return (await this.getLlamaSettings()).enableSSE ?? true;
  }
}
