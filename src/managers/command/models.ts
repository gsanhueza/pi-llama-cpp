import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { PROVIDER_NAME } from "../../constants";
import { Action } from "../../enums/action";
import { Mode } from "../../enums/mode";
import { Status } from "../../enums/status";
import { BaseModel } from "../../models/baseModel";
import { errorMessage } from "../../utils/errors";
import { EventManager } from "../events";
import type { ServerManager } from "../server";

/**
 * Interactive model selection/action flow for the `/models` command.
 *
 * Owns the select-model → select-action loop and the per-status action
 * tables, plus the non-blocking model load pipeline (progress events,
 * inflight tracking, success/failure handling).
 *
 * Split out of `CommandManager`: command routing stays there;
 * this class is the self-contained interactive concern.
 * `ServerManager` is injected so load/refresh paths can reach the
 * server registry without coupling the menu to command routing.
 */
export class ModelsMenu {
  constructor(private readonly serverManager: ServerManager) {}

  /**
   * Runs the interactive model selection menu.
   */
  async show(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
    const event = await this.selectionLoop(
      ctx,
      await this.serverManager.getAllModels(),
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
      // Mark the load as in-flight so session_before_switch can warn about
      // it (see EventManager.inflightModel for the coupling rationale)
      EventManager.inflightModel = model;

      // Subscribe to progress events; skip when the server is gone
      // (removed/edited away mid-load → getServer returns undefined)
      const server = this.serverManager.getServer(model);
      const cleanupProgress =
        server?.sseManager.subscribeToProgress(
          model.id,
          (percentage, stage) => {
            const stageText = stage ? ` (${stage})` : "";
            ctx.ui.notify(
              `Loading ${model.name}... [${percentage}%${stageText}]`,
              "info",
            );
          },
        ) ?? (() => {});

      const onSuccess = async () => {
        const { serverId } = model;
        const piModel = ctx.modelRegistry.find(serverId, model.id);
        if (!piModel)
          throw new Error(`Cannot find model ${model.name} in pi registry`);

        // Verify failure
        if ((await model.getStatus()) === Status.FAILED)
          throw new Error(`Failed to load model ${model.name}`);

        // Select the model if asked
        if (action === Action.LOAD_AND_SWITCH) await pi.setModel(piModel);

        ctx.ui.notify(`Model ${model.name} ready`, "info");
      };

      const onFailure = (err: any) => {
        const message = errorMessage(err);

        try {
          ctx.ui.notify(message, "error");
        } catch {
          // ctx went stale between error and notification
        }
      };

      const onFinished = async () => {
        cleanupProgress();
        EventManager.resetInflightModel();

        // Re-scan providers to ensure accuracy of loaded models
        await this.serverManager.update(pi);

        // Force TUI refresh so Pi picks up the updated model states
        ctx.ui.setStatus(PROVIDER_NAME, " ");
        ctx.ui.setStatus(PROVIDER_NAME, undefined);
      };

      // Load the model without blocking the UI
      model.load().then(onSuccess).catch(onFailure).finally(onFinished);
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
  private async selectionLoop(
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
    const base = [Action.INFO, Action.CANCEL];

    const actions: Record<Status, Array<Action>> = {
      [Status.LOADED]:
        model.mode === Mode.ROUTER
          ? [Action.SWITCH, Action.UNLOAD, ...base]
          : [Action.SWITCH, ...base],
      [Status.LOADING]: [...base],
      [Status.FAILED]: [Action.RETRY, ...base],
      [Status.SLEEPING]:
        model.mode === Mode.ROUTER
          ? [Action.SWITCH, Action.UNLOAD, ...base]
          : [Action.SWITCH, ...base],
      [Status.UNLOADED]: [Action.LOAD_AND_SWITCH, Action.LOAD, ...base],
    };

    const status = await model.getStatus();
    return actions[status];
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
