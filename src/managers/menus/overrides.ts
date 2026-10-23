import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { OverridesView } from "../../ui/views/overridesView";
import type { ServerManager } from "../server";
import type { SettingsService } from "../../settings/settings";
import { BaseMenu } from "./base";

/**
 * Interactive overrides editor for `llamaSettings.servers[].overrides`.
 *
 * Re-registers providers after editing so new overrides take effect on
 * the next request.
 */
export class OverridesMenu extends BaseMenu {
  protected label = "overrides";

  constructor(
    private readonly serverManager: ServerManager,
    private readonly settings: SettingsService,
  ) {
    super();
  }

  async show(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
    if (!this.checkTUIMode(ctx)) return;
    await OverridesView.show(ctx.ui, this.settings);

    // Re-register providers so the updated overrides take effect.
    await this.serverManager.update(pi);
  }
}
