import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { ServersTUIList } from "../../ui/lists/serversTUIList";
import type { ServerManager } from "../server";
import type { SettingsService } from "../../settings/settings";
import { BaseMenu } from "./base";

/**
 * Interactive server URL editor.
 *
 * Re-registers providers after editing so server changes (add / remove
 * / URL / id / name) apply immediately.
 */
export class ServersMenu extends BaseMenu {
  protected label = "servers";

  constructor(
    private readonly serverManager: ServerManager,
    private readonly settings: SettingsService,
  ) {
    super();
  }

  async show(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
    if (!this.checkTUIMode(ctx)) return;
    await ServersTUIList.show(ctx.ui, this.settings);

    // Re-register providers so the updated server list takes effect.
    await this.serverManager.update(pi);
  }
}
