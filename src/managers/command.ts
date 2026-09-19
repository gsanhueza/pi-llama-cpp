import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { AutocompleteItem } from "@earendil-works/pi-tui";
import { PROVIDER_NAME } from "../constants";
import { OverrideSettingsList } from "../ui/editors/override/overrideList";
import { ServerSettingsList } from "../ui/editors/server/serverEditor";
import { SettingsEditor } from "../ui/settings";
import { ModelsMenu } from "./command/models";
import { ServerManager } from "./server";
import type { LlamaSettingsManager } from "./settings";

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
  private readonly modelsMenu: ModelsMenu;

  constructor(
    private readonly serverManager: ServerManager,
    private readonly settings: LlamaSettingsManager,
  ) {
    this.modelsMenu = new ModelsMenu(serverManager);
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
    // Settings menu: no provider re-registration needed (sortBy, timeouts,
    // etc. don't affect the model registry)
    if (args === "settings") {
      await this.runSettingsMenu(ctx);
      return;
    }

    // Servers editor: re-registers providers after editing so changes
    // (add / remove / URL / id / name) apply immediately
    if (args === "servers") {
      await this.runServersEditor(ctx, pi);
      return;
    }

    // Overrides editor: re-registers providers after editing so new
    // overrides take effect on the next request
    if (args === "overrides") {
      await this.runOverridesEditor(ctx, pi);
      return;
    }

    // Re-register providers so Pi sees updated model states
    await this.serverManager.update(pi);

    // Notify about unreachable servers
    for (const url of this.serverManager.failedUrls) {
      this.notifyNotFound(ctx, url);
    }

    if (args === "unload") {
      const models = await this.serverManager.getAllModels();
      await Promise.all(models.map((model) => model.unload()));
      ctx.ui.notify(`Unloaded all ${PROVIDER_NAME} models`, "info");
      return;
    }

    if (args === "info") {
      const models = await this.serverManager.getAllModels();
      const infos = await Promise.all(models.map((model) => model.getInfo()));
      ctx.ui.notify(ctx.ui.theme.fg("accent", infos.join("\n")), "info");
      return;
    }

    // Interactive menu: show <name> (<server_url>)
    await this.modelsMenu.show(ctx, pi);
  }

  /**
   * Runs the interactive settings menu for the scalar `llamaSettings`
   * fields. Enter/Space cycles the value under the cursor; Esc closes.
   */
  private async runSettingsMenu(ctx: ExtensionCommandContext): Promise<void> {
    if (ctx.mode !== "tui") {
      ctx.ui.notify(
        "/models settings requires an interactive session (TUI)",
        "warning",
      );
      return;
    }

    await SettingsEditor.show(ctx.ui, this.settings);
  }

  /**
   * Runs the interactive servers editor for `llamaSettings.servers`
   * (see `ServerSettingsList` for the editing semantics). After closing,
   * providers are re-registered so server changes apply immediately.
   */
  private async runServersEditor(
    ctx: ExtensionCommandContext,
    pi: ExtensionAPI,
  ): Promise<void> {
    if (ctx.mode !== "tui") {
      ctx.ui.notify(
        "/models servers requires an interactive session (TUI)",
        "warning",
      );
      return;
    }

    await ServerSettingsList.show(ctx.ui, this.settings);

    // Re-register providers so the updated server list takes effect
    await this.serverManager.update(pi);
  }

  /**
   * Runs the interactive overrides editor for
   * `llamaSettings.servers[].overrides` (see `OverrideSettingsList` for
   * the editing semantics). After closing, providers are re-registered
   * so new overrides take effect on the next request.
   */
  private async runOverridesEditor(
    ctx: ExtensionCommandContext,
    pi: ExtensionAPI,
  ): Promise<void> {
    if (ctx.mode !== "tui") {
      ctx.ui.notify(
        "/models overrides requires an interactive session (TUI)",
        "warning",
      );
      return;
    }

    await OverrideSettingsList.show(ctx.ui, this.settings);

    // Re-register providers so the updated overrides take effect
    await this.serverManager.update(pi);
  }

  /**
   * Notifies the user that a server is unreachable.
   */
  private notifyNotFound(ctx: ExtensionCommandContext, url: string): void {
    ctx.ui.notify(`${PROVIDER_NAME} unreachable at ${url}`, "error");
  }
}
