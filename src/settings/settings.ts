import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import type { SortBy } from "../interfaces/sortBy";
import type { ServerOptions } from "../interfaces/server";
import type {
  LlamaServer,
  LlamaSettings,
  ModelOverride,
} from "../interfaces/settings";
import { CredentialResolver } from "../utils/credentialResolver";
import { SettingsStore } from "./store";
import { SettingsReader } from "./reader";
import { SettingsWriter } from "./writer";

/**
 * Thin orchestrator composing a {@link SettingsReader} and a {@link SettingsWriter}.
 *
 * The reader owns all read paths (settings, URLs, keys, timeouts, flags);
 * the writer owns persistence (set / delete). `SettingsService`
 * forwards to both and provides a single wiring point via
 * {@link create}.
 */
export class SettingsService {
  constructor(
    private readonly reader: SettingsReader,
    private readonly writer: SettingsWriter,
  ) {}

  /**
   * Creates a fully wired SettingsService with default collaborators.
   */
  static create(): SettingsService {
    const sm = SettingsManager.create(process.cwd());
    const globalStore = new SettingsStore(join(getAgentDir(), "settings.json"));
    const projectStore = new SettingsStore(
      join(process.cwd(), ".pi", "settings.json"),
    );
    const credentialResolver = new CredentialResolver();

    const reader = new SettingsReader(sm, credentialResolver);
    const writer = new SettingsWriter(sm, globalStore, projectStore);

    return new SettingsService(reader, writer);
  }

  /**
   * Returns and clears warnings collected during URL resolution.
   */
  takeWarnings(): string[] {
    return this.reader.takeWarnings();
  }

  /**
   * Convenience method for the `llamaSettings` key.
   */
  async getLlamaSettings(): Promise<LlamaSettings> {
    return this.reader.getLlamaSettings();
  }

  /**
   * Convenience method for the merged `servers` list.
   */
  async getLlamaServers(): Promise<LlamaServer[]> {
    return this.reader.getLlamaServers();
  }

  /**
   * Resolves the server URLs to use (env > servers > legacy > default).
   */
  async resolveUrls(): Promise<string[]> {
    return this.reader.resolveUrls();
  }

  /**
   * Resolves the override map for a given server URL.
   */
  async resolveServerOverrides(serverUrl: string): Promise<ModelOverride> {
    return this.reader.resolveServerOverrides(serverUrl);
  }

  /**
   * Resolves the raw server configurations for building `Server` instances.
   */
  async resolveServerConfigs(): Promise<ServerOptions[]> {
    return this.reader.resolveServerConfigs();
  }

  /**
   * Resolves API key for the provider ID.
   */
  resolveApiKey(providerId: string): string {
    return this.reader.resolveApiKey(providerId);
  }

  /**
   * Resolves the current thinking level from Pi.
   */
  resolveThinkingLevel(): ModelThinkingLevel | undefined {
    return this.reader.resolveThinkingLevel();
  }

  /**
   * Resolves the effective thinking budgets from settings.
   */
  resolveThinkingBudgets(): Record<ModelThinkingLevel, number> {
    return this.reader.resolveThinkingBudgets();
  }

  async resolveReactToModelSelect(): Promise<boolean> {
    return this.reader.resolveReactToModelSelect();
  }

  async resolveAutoloadOnMessage(): Promise<boolean> {
    return this.reader.resolveAutoloadOnMessage();
  }

  async resolveTimeouts(): Promise<{
    pollingInterval: number;
    pollingTimeout: number;
    serverTimeout: number;
  }> {
    return this.reader.resolveTimeouts();
  }

  async resolveServerTimeout(): Promise<number> {
    return this.reader.resolveServerTimeout();
  }

  async resolvePollingInterval(): Promise<number> {
    return this.reader.resolvePollingInterval();
  }

  async resolvePollingTimeout(): Promise<number> {
    return this.reader.resolvePollingTimeout();
  }

  async resolveSortBy(): Promise<SortBy> {
    return this.reader.resolveSortBy();
  }

  async resolveShowServerUrls(): Promise<boolean> {
    return this.reader.resolveShowServerUrls();
  }

  async resolveEnableSSE(): Promise<boolean> {
    return this.reader.resolveEnableSSE();
  }

  /**
   * Persists multiple llamaSettings fields to settings and reloads.
   */
  async setLlamaSettings(partial: Partial<LlamaSettings>): Promise<void> {
    return this.writer.setLlamaSettings(partial);
  }

  /**
   * Deletes one llamaSettings field from settings and reloads.
   */
  async deleteLlamaSetting<K extends keyof LlamaSettings>(
    key: K,
  ): Promise<void> {
    return this.writer.deleteLlamaSetting(key);
  }
}
