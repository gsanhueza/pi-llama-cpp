import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { PROVIDER_NAME } from "../../constants";
import type { EventManager } from "../events";
import type { ServerManager } from "../server";
import { BaseMenu } from "./base";

/**
 * Unloads all models and re-scans providers.
 *
 * No TUI guard — the notifications work in any mode.
 */
export class UnloadMenu extends BaseMenu {
  protected label = "unload";

  constructor(
    private readonly serverManager: ServerManager,
    _eventManager: EventManager, // reserved for future use
  ) {
    super();
  }

  async show(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
    // Ensure we have the correct models first
    await this.serverManager.update(pi);

    ctx.ui.notify(`Unloading ${PROVIDER_NAME} models...`, "info");
    const models = await this.serverManager.getAllModels();

    // Fire-and-forget: don't await so the TUI stays responsive.
    Promise.allSettled(models.map((model) => model.unload())).then(() => {
      ctx.ui.notify(`Unloaded all ${PROVIDER_NAME} models`, "info");
      this.serverManager.update(pi);
    });
  }
}
