import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ApiClient, RequestPolicy } from "../../api/client";
import {
  skipThinkingUnavailable,
  skipThinkingFail,
  skipThinkingSuccess,
} from "../../ui/notifyMessages";
import type { SettingsService } from "../../settings/settings";
import type { CompletionInfo, CompletionTracker } from "../completionTracker";
import { BaseMenu } from "./base";

/**
 * Sends a `reasoning_end` control request for the model with the active completion.
 *
 * No TUI guard — works in any mode.
 */
export class RushMenu extends BaseMenu {
  protected label = "rush";

  constructor(
    private readonly settings: SettingsService,
    private readonly completionTracker: CompletionTracker,
  ) {
    super();
  }

  async show(ctx: ExtensionCommandContext): Promise<void> {
    const track = this.completionTracker.completion;
    if (!track) {
      ctx.ui.notify(skipThinkingUnavailable(), "info");
      return;
    }

    const result = await this.rushModel(track);
    if (result.success) {
      ctx.ui.notify(skipThinkingSuccess(), "info");
    } else {
      ctx.ui.notify(skipThinkingFail(result.message ?? "unknown"), "info");
    }
  }

  /**
   * Sends a reasoning_end control request for the tracked completion.
   * @returns Result with success status and optional message.
   */
  private async rushModel(
    track: CompletionInfo,
  ): Promise<{ success: boolean; message?: string }> {
    const apiKey = this.settings.resolveApiKey(track.providerId);
    const client = new ApiClient({
      baseUrl: track.serverUrl,
      getApiKey: () => apiKey,
      getPollingInterval: () => this.settings.resolvePollingInterval(),
    });

    try {
      const endpoint = "/v1/chat/completions/control";
      const body = {
        id: track.completionId,
        action: "reasoning_end",
        model: track.modelId,
      };
      const timeout = await this.settings.resolveServerTimeout();

      const response = await client.post<Response>(
        endpoint,
        body,
        timeout,
        RequestPolicy.Raw,
      );

      if (response.status === 200) {
        return { success: true };
      }

      if (response.status === 404) {
        return {
          success: false,
          message: `Server does not support endpoint ${endpoint}`,
        };
      }

      const message = await response.text();
      return { success: false, message };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "request failed",
      };
    }
  }
}
