import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { PROVIDER_NAME } from "../constants";
import { Action } from "../enums/action";
import { Mode } from "../enums/mode";
import { Status } from "../enums/status";
import { EventManager } from "../managers/events";
import { BaseModel } from "../models/baseModel";

/**
 * Select a model from the list. Returns null if user cancels.
 *
 * @param ctx The context used by Pi
 * @param models A list of models
 * @returns The selected model
 */
const selectModel = async (
  ctx: ExtensionCommandContext,
  models: BaseModel[],
): Promise<BaseModel | null> => {
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
};

/**
 * Get available actions for a model based on its mode and status.
 *
 * @param model The selected model
 * @returns The array of available actions for the given model status
 */
const getActionsForModel = async (model: BaseModel): Promise<Array<Action>> => {
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
    [Status.UNLOADED]: [Action.LOAD, Action.CANCEL],
    [Status.UNAUTHORIZED]: [Action.INFO, Action.CANCEL],
  };

  const status = await model.getStatus();
  return allActions[status];
};

/**
 * Selects an action for a model.
 *
 * @param ctx The context used by Pi
 * @param model The selected model
 * @param actions Possible actions to execute
 * @returns The action, or null if user cancels
 */
const selectAction = async (
  ctx: ExtensionCommandContext,
  model: BaseModel,
  actions: Array<Action>,
): Promise<Action | null> => {
  const labels = actions.map((a) => String(a));
  const choice = await ctx.ui.select(`${model.name}`, labels);
  if (!choice) return null;

  const idx = labels.indexOf(choice);
  return actions[idx];
};

/**
 * Handles the menu for model selection.
 * Loops: select model → select action → handle action.
 *
 * Escape on actions menu goes back to model selection.
 * Escape on model selection exits.
 *
 * @param ctx The context used by Pi
 * @param models List of available models
 * @returns The selected action and model, or null if the user cancels
 */
const modelSelectionHandler = async (
  ctx: ExtensionCommandContext,
  models: BaseModel[],
): Promise<{ action: Action; model: BaseModel } | null> => {
  while (true) {
    // Select the model
    const model = await selectModel(ctx, models);
    if (!model) return null;

    // Select the action
    const actions = await getActionsForModel(model);
    const action = await selectAction(ctx, model, actions);
    if (action === null) {
      // Escape key pressed => back to model selection
      continue;
    }

    // Return the selected action and model
    return { action, model };
  }
};

/**
 * Handles the /models command when the server is unreachable.
 *
 * @param ctx The context used by Pi
 * @param url The URL of the unreachable server
 */
export const notFoundCommand = async (
  ctx: ExtensionCommandContext,
  url: string,
): Promise<void> => {
  ctx.ui.notify(`${PROVIDER_NAME} unreachable at ${url}`, "error");
};

/**
 * Handles the /models command across multiple servers.
 *
 * @param ctx The context used by Pi
 * @param pi The Pi extension
 * @param models List of models with their server URLs and provider IDs
 */
export const modelsCommand = async (
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  models: BaseModel[],
): Promise<void> => {
  const event = await modelSelectionHandler(ctx, models);

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

  // Actions: Load/Switch/Retry
  const loadActions = [Action.LOAD, Action.SWITCH, Action.RETRY];
  if (loadActions.includes(action)) {
    ctx.ui.notify(`Loading ${model.name}...`, "info");
    EventManager.inflightModel = model;

    const onSuccess = async () => {
      const { serverId } = model;
      const piModel = ctx.modelRegistry.find(serverId, model.id);
      if (!piModel) {
        throw new Error(`Cannot find model ${model.name} in pi registry`);
      }

      // Verify auth
      if ((await model.getStatus()) === Status.UNAUTHORIZED)
        throw new Error(
          `Unauthorized for ${model.name}. Use /login and add your API key.`,
        );

      // Verify failure
      if ((await model.getStatus()) === Status.FAILED)
        throw new Error(`Failed to load model ${model.name}`);

      await pi.setModel(piModel);
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
      .finally(EventManager.resetInflightModel);
  }
};
