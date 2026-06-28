import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { AutocompleteItem } from "@earendil-works/pi-tui";
import { PROVIDER_NAME } from "../constants";
import { Action } from "../enums/action";
import { Mode } from "../enums/mode";
import { Status } from "../enums/status";
import { BaseModel } from "../models/baseModel";
import { EventManager } from "./events";
import { ServerManager } from "./server";

export class CommandManager {
  constructor(private readonly serverManager: ServerManager) {}

  /**
   * Sets up the argument completions for the `/models` command
   *
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
    await this.serverManager.update(pi);

    // Notify about unreachable servers
    for (const url of this.serverManager.failedUrls) {
      this.notifyNotFound(ctx, url);
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
    await this.runModelsMenu(ctx, pi);
  }

  /**
   * Notifies the user that a server is unreachable.
   */
  private notifyNotFound(ctx: ExtensionCommandContext, url: string): void {
    ctx.ui.notify(`${PROVIDER_NAME} unreachable at ${url}`, "error");
  }

  /**
   * Runs the interactive model selection menu.
   */
  private async runModelsMenu(
    ctx: ExtensionCommandContext,
    pi: ExtensionAPI,
  ): Promise<void> {
    const event = await this.modelSelectionHandler(
      ctx,
      this.serverManager.getAllModels(),
    );

    if (!event) return;
    const { action, model } = event;

    // Action: Cancel
    if (!action || action === Action.CANCEL) return;

    // Action: Info
    if (action === Action.INFO) {
      const info = await model.getInfo();
      ctx.ui.notify(`${info}`, "info");
      return;
    }

    // Action: Unload
    if (action === Action.UNLOAD) {
      await model.unload();
      ctx.ui.notify(`Unloaded ${model.name}`, "info");
      return;
    }

    // Action: Switch
    if (action === Action.SWITCH) {
      const { serverId } = model;
      const piModel = ctx.modelRegistry.find(serverId, model.id);
      if (!piModel)
        throw new Error(`Cannot find model ${model.name} in pi registry`);

      await pi.setModel(piModel);
      ctx.ui.notify(`Model ${model.name} ready`, "info");
      return;
    }

    // Actions: Load / Load & Switch / Retry
    const loadActions = [Action.LOAD, Action.LOAD_AND_SWITCH, Action.RETRY];
    if (loadActions.includes(action)) {
      ctx.ui.notify(`Loading ${model.name}...`, "info");
      EventManager.inflightModel = model;

      // Subscribe to progress events
      const cleanupProgress = this.serverManager
        .getServer(model)
        .sseManager.subscribeToProgress(model.id, (percentage, stage) => {
          const stageText = stage ? ` (${stage})` : "";
          ctx.ui.notify(
            `Loading ${model.name}... [${percentage}%${stageText}]`,
            "info",
          );
        });

      const onSuccess = async () => {
        const { serverId } = model;
        const piModel = ctx.modelRegistry.find(serverId, model.id);
        if (!piModel)
          throw new Error(`Cannot find model ${model.name} in pi registry`);

        // Verify auth
        if ((await model.getStatus()) === Status.UNAUTHORIZED)
          throw new Error(
            `Unauthorized for ${model.name}. Use /login and add your API key.`,
          );

        // Verify failure
        if ((await model.getStatus()) === Status.FAILED)
          throw new Error(`Failed to load model ${model.name}`);

        // Select the model if asked
        if (action === Action.LOAD_AND_SWITCH) await pi.setModel(piModel);

        ctx.ui.notify(`Model ${model.name} ready`, "info");
      };

      const onFailure = (err: any) => {
        const message = err instanceof Error ? err.message : String(err);

        try {
          ctx.ui.notify(message, "error");
        } catch {
          // ctx went stale between error and notification
        }
      };

      // Load the model without blocking the UI
      model
        .load()
        .then(onSuccess)
        .catch(onFailure)
        .finally(() => {
          cleanupProgress();
          EventManager.resetInflightModel();
        });
    }
  }

  /**
   * Handles the menu for model selection.
   * Loops: select model → select action → handle action.
   *
   * Escape on actions menu goes back to model selection.
   * Escape on model selection exits.
   *
   * @returns The selected action and model
   */
  private async modelSelectionHandler(
    ctx: ExtensionCommandContext,
    models: BaseModel[],
  ): Promise<{ action: Action; model: BaseModel } | null> {
    while (true) {
      // Select the model
      const model = await this.selectModel(ctx, models);
      if (!model) return null;

      // Select the action
      const actions = await this.getActionsForModel(model);
      const action = await this.selectAction(ctx, model, actions);
      if (action === null) {
        // Escape key pressed => back to model selection
        continue;
      }

      // Return the selected action and model
      return { action, model };
    }
  }

  /**
   * Select a model from the list. Returns null if user cancels.
   *
   * @returns The model selected by the user
   */
  private async selectModel(
    ctx: ExtensionCommandContext,
    models: BaseModel[],
  ): Promise<BaseModel | null> {
    const labels = await Promise.all(
      models.map(async (model) => ({
        label: (await model.getLabel()).trim(),
        serverUrl: model.serverUrl,
      })),
    );

    // Count grapheme clusters (not UTF-16 code units) so emoji padding aligns visually
    const graphemeLength = (str: string) =>
      [...new Intl.Segmenter().segment(str)].length;

    // Decorate the label so the spacing makes it seem more like a table
    const maxLength = Math.max(
      ...labels.map(({ label }) => graphemeLength(label)),
    );
    const choices = labels.map(({ label, serverUrl }) => {
      const extraPadding = 2;
      const padLen = maxLength - graphemeLength(label) + extraPadding;
      return `${label}${" ".repeat(padLen)} [Server: ${serverUrl}]`;
    });

    const choice = await ctx.ui.select(`${PROVIDER_NAME} models:`, choices);
    if (!choice) return null;
    const idx = choices.indexOf(choice);

    return models[idx];
  }

  /**
   * Get available actions for a model based on its mode and status.
   *
   * @returns A mapping of actions for each status
   */
  private async getActionsForModel(model: BaseModel): Promise<Array<Action>> {
    const allActions: Record<Status, Array<Action>> = {
      [Status.LOADED]:
        model.mode === Mode.ROUTER
          ? [Action.SWITCH, Action.UNLOAD, Action.INFO, Action.CANCEL]
          : [Action.SWITCH, Action.INFO, Action.CANCEL],
      [Status.LOADING]: [Action.INFO, Action.CANCEL],
      [Status.FAILED]: [Action.RETRY, Action.CANCEL],
      [Status.SLEEPING]: [
        Action.SWITCH,
        Action.UNLOAD,
        Action.INFO,
        Action.CANCEL,
      ],
      [Status.UNLOADED]: [Action.LOAD_AND_SWITCH, Action.LOAD, Action.CANCEL],
      [Status.UNAUTHORIZED]: [Action.INFO, Action.CANCEL],
    };

    const status = await model.getStatus();
    return allActions[status];
  }

  /**
   * Selects an action for a model.
   *
   * @returns The selected action
   */
  private async selectAction(
    ctx: ExtensionCommandContext,
    model: BaseModel,
    actions: Array<Action>,
  ): Promise<Action | null> {
    const labels = actions.map((a) => String(a));
    const choice = await ctx.ui.select(`${model.name}`, labels);
    if (!choice) return null;

    const idx = labels.indexOf(choice);
    return actions[idx];
  }
}
