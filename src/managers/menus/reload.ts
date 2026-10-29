import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  reloadingAllModels,
  reloadedAllModels,
  noModelsToReload,
} from "../../ui/notifyMessages";
import type { ServerManager } from "../server";
import { BaseMenu } from "./base";
import { Status } from "../../enums/status";

/**
 * Reloads all loaded/sleeping models (unload → load).
 *
 * No TUI guard — the notifications work in any mode.
 */
export class ReloadMenu extends BaseMenu {
  protected label = "reload";

  constructor(private readonly serverManager: ServerManager) {
    super();
  }

  async show(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
    // Ensure we have the correct models first
    await this.serverManager.update(pi);

    ctx.ui.notify(reloadingAllModels(), "info");
    const models = await this.serverManager.getAllModels();

    // Filter to only loaded or sleeping models
    const reloadable = (
      await Promise.all(
        models.map(async (m) => ({
          model: m,
          status: await m.getStatus(),
        })),
      )
    )
      .filter(
        ({ status }) => status === Status.LOADED || status === Status.SLEEPING,
      )
      .map(({ model }) => model);

    if (reloadable.length === 0) {
      ctx.ui.notify(noModelsToReload(), "info");
      return;
    }

    // Fire-and-forget: unload all, then load all
    Promise.allSettled(reloadable.map((m) => m.unload()))
      .then(() => Promise.allSettled(reloadable.map((m) => m.load())))
      .then(() => {
        ctx.ui.notify(reloadedAllModels(), "info");
        this.serverManager.update(pi);
      });
  }
}
