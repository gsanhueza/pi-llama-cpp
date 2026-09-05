import { ApiKeyCredential, ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  readStoredCredential,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  API_KEY_PLACEHOLDER,
  AUTOLOAD_ON_MESSAGE,
  LLAMA_SERVER_URL,
  POLLING_TIMEOUT,
  REACT_TO_MODEL_SELECT,
  SERVER_TIMEOUT,
  SETTINGS_KEY,
  SORT_BY,
  THINKING_BUDGETS,
  type SortBy,
} from "../constants";
import { LlamaServer, LlamaSettings } from "../interfaces/settings";
import { Server } from "../server";
import { SettingsStore } from "../utils/settingsStore";
import { isValidServerUrl, normalizeUrl } from "../utils/urls";

export class LlamaSettingsManager {
  private settingsManager = SettingsManager.create(process.cwd());

  constructor(private readonly store: SettingsStore = new SettingsStore()) {}

  /** Warnings collected during URL resolution (dropped invalid entries). */
  private warnings: string[] = [];

  /**
   * Returns and clears warnings collected during URL resolution.
   */
  takeWarnings(): string[] {
    const warnings = [...this.warnings];
    this.warnings.length = 0;
    return warnings;
  }

  /**
   * Convenience getter for merged project/global settings
   */
  private get mergedSettings(): Record<string, any> {
    const merged = {
      ...this.settingsManager.getGlobalSettings(),
      ...this.settingsManager.getProjectSettings(),
    } as Record<string, any>;
    return merged;
  }

  /**
   * Convenience getter for the `llamaSettings` key
   */
  private get llamaSettings(): LlamaSettings {
    return this.mergedSettings[SETTINGS_KEY] ?? {};
  }

  /**
   * Convenience getter for the merged `servers` list (project overrides
   * global, per-key merge)
   */
  get llamaServers(): LlamaServer[] {
    return this.llamaSettings.servers ?? [];
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
  resolveUrls(): string[] {
    let response = this.resolveEnvUrls();
    if (response.length > 0) return response;

    response = this.resolveServerUrls();
    if (response.length > 0) return response;

    response = this.resolveLegacyUrls();
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
   *
   * @returns A list of detected URLs
   */
  private resolveServerUrls(): string[] {
    const { servers = [] } = this.llamaSettings;
    return servers.map((s) => this.parseUrls(s.url)).flat();
  }

  /**
   * Resolves the llama-server URLs from `llamaSettings.servers`.
   * Settings are merged, prioritizing project over global settings.
   *
   * @returns A list of detected URLs
   */
  private resolveLegacyUrls(): string[] {
    const { llamaServerUrl = null } = this.mergedSettings;
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
      .map(normalizeUrl)
      .filter((u) => {
        if (u.length === 0) return false;
        if (!isValidServerUrl(u)) {
          this.warnings.push(
            `Ignoring invalid server URL '${u}' (needs http(s)://)`,
          );
          return false;
        }
        return true;
      });
  }

  /**
   * Resolves the servers that this extension will use.
   * Uses `resolveUrls()` as the source of truth for URLs (env > settings >
   * legacy > default), then applies `id`/`name` from `llamaSettings.servers`
   * as overrides when available.
   *
   * @returns A list of Server objects
   */
  resolveServers(): Server[] {
    const urls = this.resolveUrls();
    const serverConfigs = this.llamaSettings.servers ?? [];

    return urls.map((url) => {
      const config = serverConfigs.find((s) => s.url === url);
      return new Server(url, config?.id, config?.name);
    });
  }

  /**
   * Resolves API key for the provider ID using Pi's stored credentials.
   *
   * @returns The API key to use for the provider
   */
  resolveApiKey(providerId: string): string {
    const credential = readStoredCredential(providerId) as ApiKeyCredential;
    return credential?.key ?? API_KEY_PLACEHOLDER;
  }

  /**
   * Resolves the current thinking level from Pi.
   *
   * @returns The thinking level
   */
  resolveThinkingLevel(): ModelThinkingLevel | undefined {
    return this.settingsManager.getDefaultThinkingLevel();
  }

  /**
   * Resolves the effective thinking budgets from settings.
   *
   * @returns An object with selected budgets for thinking levels
   */
  resolveThinkingBudgets(): Record<ModelThinkingLevel, number> {
    const settingsBudgets = this.settingsManager.getThinkingBudgets() ?? {};
    return {
      ...THINKING_BUDGETS,
      ...settingsBudgets,
    };
  }

  /**
   * Resolves whether the extension should react to model selection events.
   *
   * @returns `true` if the extension should load the model on model_select
   */
  resolveReactToModelSelect(): boolean {
    return this.llamaSettings.reactToModelSelect ?? REACT_TO_MODEL_SELECT;
  }

  /**
   * Resolves whether the extension should auto-load models on message.
   *
   * @returns `true` if the extension should auto-load models
   */
  resolveAutoloadOnMessage(): boolean {
    return this.llamaSettings.autoloadOnMessage ?? AUTOLOAD_ON_MESSAGE;
  }

  /**
   * Resolves the timeout settings for polling and server checks.
   *
   * @returns Object with polling and server timeout values
   */
  resolveTimeouts(): { pollingTimeout: number; serverTimeout: number } {
    return {
      pollingTimeout: this.llamaSettings.pollingTimeout ?? POLLING_TIMEOUT,
      serverTimeout: this.llamaSettings.serverTimeout ?? SERVER_TIMEOUT,
    };
  }

  /**
   * Resolves the sort order for model lists.
   *
   * @returns The sort order: "asc", "desc", "asc-name", "desc-name", or "api"
   */
  resolveSortBy(): SortBy {
    return this.llamaSettings.sortBy ?? SORT_BY;
  }

  /**
   * Persists one llamaSettings field to the global settings file and
   * reloads the in-memory settings so resolvers see the change immediately.
   *
   * Rejects if the file can't be read (e.g. invalid JSON) or written —
   * in-memory state stays consistent (reload only on success).
   */
  async setLlamaSetting<K extends keyof LlamaSettings>(
    key: K,
    value: LlamaSettings[K],
  ): Promise<void> {
    await this.store.updateKey(SETTINGS_KEY, (current) => {
      const merged =
        typeof current === "object" && current !== null
          ? (current as Record<string, unknown>)
          : {};
      return { ...merged, [key]: value };
    });
    await this.settingsManager.reload();
  }
}

/**
 * Shared singleton instance used across the extension.
 */
export const settings = new LlamaSettingsManager();
