import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { AutocompleteItem } from "@earendil-works/pi-tui";
import { modelsCommand, notFoundCommand } from "../commands/models";
import { PROVIDER_NAME } from "../constants";
import { ServerManager } from "./server";

export class CommandManager {
  constructor(private readonly serverManager: ServerManager) {}

  /**
   * Sets up the argument completions for the `/models` command
   * @param prefix Prefix written by the user
   * @returns Completions with that prefix
   */
  getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
    const available = [
      {
        value: "info",
        label: "info",
        description: "Show information of all models",
      },
      {
        value: "unload",
        label: "unload",
        description: "Unload all models",
      },
    ];
    const filtered = available.filter((a) => a.value.startsWith(prefix));
    return filtered.length > 0 ? filtered : null;
  }

  /**
   * Executes the action for the `/models` command
   *
   * @param args Arguments of the command
   * @param ctx The context used by Pi
   * @param pi The Pi extension
   */
  async handleCommand(
    args: string,
    ctx: ExtensionCommandContext,
    pi: ExtensionAPI,
  ) {
    // Re-register providers so Pi sees updated model states
    await this.serverManager.registerAllProviders();

    // Notify about unreachable servers
    for (const url of this.serverManager.failedUrls) {
      await notFoundCommand(ctx, url);
    }

    if (args === "unload") {
      await Promise.all(
        this.serverManager.getAllModels().map((model) => model.unload()),
      );
      ctx.ui.notify(`Unloaded all ${PROVIDER_NAME} models`, "info");
      return;
    }

    if (args === "info") {
      const infos = await Promise.all(
        this.serverManager.getAllModels().map((model) => model.getInfo()),
      );
      ctx.ui.notify(ctx.ui.theme.fg("accent", infos.join("\n")), "info");
      return;
    }

    // Interactive menu: show <name> (<server_url>)
    const allModels = this.serverManager.getAllModels();
    await modelsCommand(ctx, pi, allModels);
  }
}
