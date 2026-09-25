import { ApiKeyCredential, ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  getAgentDir,
  readStoredCredential,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  API_KEY_PLACEHOLDER,
  AUTOLOAD_ON_MESSAGE,
  POLLING_TIMEOUT,
  REACT_TO_MODEL_SELECT,
  SERVER_TIMEOUT,
  SETTINGS_KEY,
  SHOW_SERVER_URLS,
  SORT_BY,
  THINKING_BUDGETS,
} from "../constants";
import {
  LlamaServer,
  LlamaSettings,
  ModelOverride,
} from "../interfaces/settings";
import type { SortBy } from "../interfaces/sortBy";
import { Server } from "../server";
import { SettingsStore } from "../utils/settingsStore";
import { UrlResolver } from "../utils/urlResolver";

export class LlamaSettingsManager {
  private settingsManager = SettingsManager.create(process.cwd());

  private globalStore = new SettingsStore(join(getAgentDir(), "settings.json"));
  private projectStore = new SettingsStore(
    join(process.cwd(), ".pi", "settings.json"),
  );

  /**
   * Check if project settings file exists in the current working directory.
   */
  private async hasProjectSettings(): Promise<boolean> {
    try {
      await access(join(process.cwd(), ".pi", "settings.json"));
      return true;
    } catch {
      return false;
    }
  }

  /** Delegated multi-source URL resolution chain (see `utils/urlResolver`). */
  private urlResolver = new UrlResolver({
    getLlamaSettings: () => this.getLlamaSettings(),
    getMergedSettings: () => this.getMergedSettings(),
  });

  /**
   * Returns and clears warnings collected during URL resolution.
   */
  takeWarnings(): string[] {
    return this.urlResolver.takeWarnings();
  }

  /**
   * Reloads settings from disk and returns merged project/global settings.
   * Project settings override global settings.
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
   * Reloads settings from disk before reading.
   */
  private async getLlamaSettings(): Promise<LlamaSettings> {
    return (await this.getMergedSettings())[SETTINGS_KEY] ?? {};
  }

  /**
   * Convenience method for the merged `servers` list (project overrides
   * global, per-key merge). Reloads settings from disk before reading.
   */
  async getLlamaServers(): Promise<LlamaServer[]> {
    return (await this.getLlamaSettings()).servers ?? [];
  }

  /**
   * Resolves the server URLs to use. Delegates to the URL resolver chain
   * (env → settings → legacy → default, see `utils/urlResolver`).
   *
   * @returns The list of URLs to use
   */
  async resolveUrls(): Promise<string[]> {
    return this.urlResolver.resolveUrls();
  }

  /**
   * Resolves the override map for a given server URL.
   *
   * Reads the `overrides` field from the matching server config and returns
   * a map of model ID → override. Returns an empty object when the server
   * has no `overrides` defined.
   *
   * @param serverUrl - The URL of the server to resolve overrides for
   * @returns A map of model ID to override configuration (partial fields,
   *          fallbacks applied at consumption time)
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
   * Resolves the servers that this extension will use.
   * Uses `resolveUrls()` as the source of truth for URLs (env > settings >
   * legacy > default), then applies `id`/`name`/`overrides` from
   * `llamaSettings.servers` as overrides when available.
   * Reloads settings from disk before reading.
   *
   * @returns A list of Server objects
   */
  async resolveServers(): Promise<Server[]> {
    const urls = await this.resolveUrls();
    const serverConfigs = (await this.getLlamaSettings()).servers ?? [];

    const servers: Server[] = [];
    for (const url of urls) {
      const config = serverConfigs.find((s) => s.url === url);
      const overrides = await this.resolveServerOverrides(url);
      servers.push(
        new Server(this, {
          baseUrl: url,
          customId: config?.id,
          customName: config?.name,
          overrides,
        }),
      );
    }
    return servers;
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
  async resolveReactToModelSelect(): Promise<boolean> {
    return (
      (await this.getLlamaSettings()).reactToModelSelect ??
      REACT_TO_MODEL_SELECT
    );
  }

  /**
   * Resolves whether the extension should auto-load models on message.
   *
   * @returns `true` if the extension should auto-load models
   */
  async resolveAutoloadOnMessage(): Promise<boolean> {
    return (
      (await this.getLlamaSettings()).autoloadOnMessage ?? AUTOLOAD_ON_MESSAGE
    );
  }

  /**
   * Resolves the timeout settings for polling and server checks.
   *
   * @returns Object with polling and server timeout values
   */
  async resolveTimeouts(): Promise<{
    pollingTimeout: number;
    serverTimeout: number;
  }> {
    const llamaSettings = await this.getLlamaSettings();
    return {
      pollingTimeout: llamaSettings.pollingTimeout ?? POLLING_TIMEOUT,
      serverTimeout: llamaSettings.serverTimeout ?? SERVER_TIMEOUT,
    };
  }

  /**
   * Resolves the sort order for model lists.
   *
   * @returns The sort order: "asc", "desc", "asc-name", "desc-name", or "api"
   */
  async resolveSortBy(): Promise<SortBy> {
    return (await this.getLlamaSettings()).sortBy ?? SORT_BY;
  }

  /**
   * Resolves whether to show server URLs in the /models model list.
   *
   * @returns `true` if server URLs should be shown
   */
  async resolveShowServerUrls(): Promise<boolean> {
    return (await this.getLlamaSettings()).showServerUrls ?? SHOW_SERVER_URLS;
  }

  /**
   * Persists one llamaSettings field to settings and reloads the in-memory
   * settings so resolvers see the change immediately.
   *
   * When `scope` is `"auto"` (default), writes to the project `.pi/settings.json`
   * if it exists, otherwise to global `~/.pi/agent/settings.json`.
   *
   * Rejects if the file can't be read (e.g. invalid JSON) or written —
   * in-memory state stays consistent (reload only on success).
   */
  async setLlamaSetting<K extends keyof LlamaSettings>(
    key: K,
    value: LlamaSettings[K],
    scope: "auto" | "global" | "project" = "auto",
  ): Promise<void> {
    const store =
      scope === "auto"
        ? (await this.hasProjectSettings())
          ? this.projectStore
          : this.globalStore
        : scope === "project"
          ? this.projectStore
          : this.globalStore;

    await store.updateKey(SETTINGS_KEY, (current) => {
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
 * Creates a new LlamaSettingsManager instance.
 */
export function createSettingsManager(): LlamaSettingsManager {
  return new LlamaSettingsManager();
}
