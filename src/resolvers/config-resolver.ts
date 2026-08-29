import { ApiKeyCredential, ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  getAgentDir,
  readStoredCredential,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { API_KEY_PLACEHOLDER, DEFAULT_THINKING_BUDGETS } from "../constants";
import { UrlResolver } from "./url-resolver";

/**
 * Thin coordination layer that delegates to specialized resolvers.
 *
 * Responsibilities:
 * - URL resolution → delegates to UrlResolver
 * - API key resolution → direct call to Pi's credential store
 * - Thinking config → delegates to Pi's SettingsManager
 */
export class ConfigResolver {
  private urlResolver = new UrlResolver();
  private settingsManager = SettingsManager.create(
    process.cwd(),
    getAgentDir(),
  );

  /**
   * Resolves URLs where llama-servers are running.
   */
  async resolveUrls(): Promise<string[]> {
    return await this.urlResolver.resolve();
  }

  /**
   * Resolves API key for the provider ID using Pi's stored credentials.
   */
  resolveApiKey(providerId: string): string {
    const credential = readStoredCredential(providerId) as ApiKeyCredential;
    return credential?.key ?? API_KEY_PLACEHOLDER;
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
      ...DEFAULT_THINKING_BUDGETS,
      ...settingsBudgets,
    };
  }

  /**
   * Returns warnings collected during URL resolution.
   */
  getWarnings(): string[] {
    return this.urlResolver.getWarnings();
  }
}
