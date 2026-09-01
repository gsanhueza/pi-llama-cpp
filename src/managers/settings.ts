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
  THINKING_BUDGETS,
} from "../constants";
import { LlamaSettings } from "../interfaces/settings";
import { Server } from "../server";

export class LlamaSettingsManager {
  private settingsManager = SettingsManager.create(process.cwd());

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
   * Splits on semicolons, trims whitespace, filters empty strings,
   * and strips trailing slashes.
   *
   * @returns A sanitized URL
   */
  private parseUrls(raw: string): string[] {
    return raw
      .split(";")
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
      .map((u) => u.replace(/\/+$/, ""));
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
    const { pollingTimeout, serverTimeout } = this.resolveTimeouts();
    const urls = this.resolveUrls();
    const serverConfigs = this.llamaSettings.servers ?? [];

    return urls.map((url) => {
      const config = serverConfigs.find((s) => s.url === url);
      return new Server(
        url,
        config?.id,
        config?.name,
        serverTimeout,
        pollingTimeout,
      );
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
}

/**
 * Shared singleton instance used across the extension.
 */
export const settings = new LlamaSettingsManager();
