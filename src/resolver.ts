import {
  AuthStorage,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  API_KEY_PLACEHOLDER,
  DEFAULT_LLAMA_SERVER_URL,
  DEFAULT_THINKING_BUDGETS,
} from "./constants";
import { ThinkingLevel } from "./interfaces/levels";

export class ConfigResolver {
  private warnings: string[] = [];

  private cachedUrls: string[] = [];
  private authStorage = AuthStorage.create(join(getAgentDir(), "auth.json"));
  private settingsManager = SettingsManager.create(
    process.cwd(),
    getAgentDir(),
  );

  /**
   * Resolves the llama-server URL by searching in the global settings.json
   */
  private async resolveGlobalUrl(): Promise<string | null> {
    const settings = this.settingsManager.getGlobalSettings();
    const { llamaServerUrl = null } = settings as Record<string, string>;

    return llamaServerUrl;
  }

  /**
   * Resolves the llama-server URL by searching in the project's .pi/settings.json
   */
  private async resolveProjectUrl(): Promise<string | null> {
    // Warn the user for deprecation
    try {
      const filePath = join(process.cwd(), ".pi", "llama-server.json");
      const { url = null } = JSON.parse(await readFile(filePath, "utf-8"));

      const messages = [
        "[pi-llama-cpp]",
        "The project-level `.pi/llama-server.json` file has been deprecated.",
        "It will work for now, but you must follow these instructions as soon as possible:",
        '- Move your url to the project-level `.pi/settings.json` file as {"llamaServerUrl": "<url>"}.',
        "- Remove the old `.pi/llama-server.json` file.",
      ];

      this.warnings.push(messages.join("\n"));

      return url;
    } catch {
      // No old file available, continue as normal
    }

    const settings = this.settingsManager.getProjectSettings();
    const { llamaServerUrl = null } = settings as Record<string, string>;

    return llamaServerUrl;
  }

  /**
   * Resolves the llama-server URL from the environment
   */
  private async resolveEnvUrl(): Promise<string | null> {
    return process.env.LLAMA_SERVER_URL ?? null;
  }

  /**
   * Tries all possible ways to retrieve the llama-server URL(s)
   */
  private async extractJoinedUrls(): Promise<string> {
    // 1. per-project config
    let response = await this.resolveProjectUrl();
    if (response) return response;

    // 2. env
    response = await this.resolveEnvUrl();
    if (response) return response;

    // 3. global settings
    response = await this.resolveGlobalUrl();
    if (response) return response;

    // 4. default
    return DEFAULT_LLAMA_SERVER_URL;
  }

  /**
   * Resolves URLs where llama-servers are running (cached)
   */
  async resolveUrls(): Promise<string[]> {
    if (this.cachedUrls.length > 0) return this.cachedUrls;

    const raw = await this.extractJoinedUrls();
    const urls = raw
      .split(";")
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
      .map((u) => u.replace(/\/+$/, ""));

    this.cachedUrls = urls;
    return this.cachedUrls;
  }

  /**
   * Resolves API key for the provider ID using Pi's AuthStorage
   */
  async resolveApiKey(providerId: string): Promise<string> {
    this.authStorage.reload();
    const apiKey = await this.authStorage.getApiKey(providerId);

    return apiKey ?? API_KEY_PLACEHOLDER;
  }

  /**
   * Returns warnings collected during URL resolution.
   */
  getWarnings(): string[] {
    const warnings = [...this.warnings];
    this.warnings.length = 0;

    return warnings;
  }

  /*
   * Resolves the current thinking level from Pi.
   *
   * @returns Selected level
   */
  resolveThinkingLevel(): ThinkingLevel | undefined {
    return this.settingsManager.getDefaultThinkingLevel();
  }

  /**
   * Resolves the effective thinking budgets from settings
   *
   * @returns Thinking budgets
   */
  resolveThinkingBudgets(): Record<ThinkingLevel, number> {
    const settingsBudgets = this.settingsManager.getThinkingBudgets() ?? {};
    const availableBudgets = {
      ...DEFAULT_THINKING_BUDGETS,
      ...settingsBudgets,
    };

    return availableBudgets;
  }
}
