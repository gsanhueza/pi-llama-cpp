import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { ServerManager } from "../server";
import { BaseMenu } from "./base";

/**
 * Displays model information for all loaded models.
 *
 * No TUI guard — works in both TUI and non-interactive modes.
 */
export class InfoMenu extends BaseMenu {
  protected label = "info";

  constructor(private readonly serverManager: ServerManager) {
    super();
  }

  async show(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
    // Ensure we have the correct models first
    await this.serverManager.update(pi);

    const models = await this.serverManager.getAllModels();
    const infos = await Promise.all(models.map((model) => model.getInfo()));

    ctx.ui.notify(ctx.ui.theme.fg("accent", infos.join("\n")), "info");
  }
}
