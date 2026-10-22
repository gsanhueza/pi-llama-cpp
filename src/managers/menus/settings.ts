import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SettingsEditor } from "../../ui/menus/settingsMenu";
import type { SettingsService } from "../../settings/settings";
import { BaseMenu } from "./base";

/**
 * Interactive settings menu for scalar `llamaSettings` fields.
 *
 * No provider re-registration needed — sortBy, timeouts, and similar
 * scalar settings don't affect the model registry.
 */
export class SettingsMenu extends BaseMenu {
  protected label = "settings";

  constructor(private readonly settings: SettingsService) {
    super();
  }

  async show(ctx: ExtensionCommandContext): Promise<void> {
    if (!this.checkTUIMode(ctx)) return;

    await SettingsEditor.show(ctx.ui, this.settings);
  }
}
