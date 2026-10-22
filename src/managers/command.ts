import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { AutocompleteItem } from "@earendil-works/pi-tui";
import { ModelsMenu } from "./menus/models";
import { SettingsMenu } from "./menus/settings";
import { InfoMenu } from "./menus/info";
import { UnloadMenu } from "./menus/unload";
import { ServersMenu } from "./menus/servers";
import { OverridesMenu } from "./menus/overrides";
import { EventManager } from "./events";
import { ServerManager } from "./server";
import type { SettingsService } from "../settings/settings";

/**
 * `/models` subcommand completions. Module-level so
 * {@link CommandManager.getArgumentCompletions} doesn't rebuild the
 * table on every keystroke.
 */
const ARGUMENT_COMPLETIONS: AutocompleteItem[] = [
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
  {
    value: "settings",
    label: "settings",
    description: "Configure llamaSettings",
  },
  {
    value: "servers",
    label: "servers",
    description: "Manage llama.cpp server URLs",
  },
  {
    value: "overrides",
    label: "overrides",
    description: "Manage llama.cpp model overrides",
  },
];

export class CommandManager {
  private readonly infoMenu: InfoMenu;
  private readonly unloadMenu: UnloadMenu;
  private readonly settingsMenu: SettingsMenu;
  private readonly serversMenu: ServersMenu;
  private readonly overridesMenu: OverridesMenu;
  private readonly modelsMenu: ModelsMenu;

  constructor(
    serverManager: ServerManager,
    settings: SettingsService,
    eventManager: EventManager,
  ) {
    this.infoMenu = new InfoMenu(serverManager);
    this.unloadMenu = new UnloadMenu(serverManager, eventManager);
    this.settingsMenu = new SettingsMenu(settings);
    this.serversMenu = new ServersMenu(serverManager, settings);
    this.overridesMenu = new OverridesMenu(serverManager, settings);
    this.modelsMenu = new ModelsMenu(serverManager, settings, eventManager);
  }

  /**
   * Sets up the argument completions for the `/models` command
   *
   * @param prefix Prefix written by the user
   * @returns Completions with that prefix
   */
  getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
    const filtered = ARGUMENT_COMPLETIONS.filter((a) =>
      a.value.startsWith(prefix),
    );
    return filtered.length > 0 ? filtered : null;
  }

  /**
   * Executes the action for the `/models` command.
   *
   * @param args Subcommand keyword (e.g. "settings", "servers")
   * @param ctx The context used by Pi
   * @param pi The Pi extension API
   */
  async handleCommand(
    args: string,
    ctx: ExtensionCommandContext,
    pi: ExtensionAPI,
  ) {
    switch (args) {
      case "info":
        return this.infoMenu.show(ctx, pi);
      case "unload":
        return this.unloadMenu.show(ctx, pi);
      case "settings":
        return this.settingsMenu.show(ctx);
      case "servers":
        return this.serversMenu.show(ctx, pi);
      case "overrides":
        return this.overridesMenu.show(ctx, pi);
      default:
        // No args: interactive model selection with server status notifications.
        return this.modelsMenu.show(ctx, pi);
    }
  }
}
