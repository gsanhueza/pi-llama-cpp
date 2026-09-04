import {
  getSettingsListTheme,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  AutocompleteItem,
  SettingsList,
  type SettingItem,
} from "@earendil-works/pi-tui";
import { PROVIDER_NAME } from "../constants";
import { Action } from "../enums/action";
import { Mode } from "../enums/mode";
import { Status } from "../enums/status";
import { LlamaSettings } from "../interfaces/settings";
import { BaseModel } from "../models/baseModel";
import { ServerListEditor } from "../ui/serverListEditor";
import { EventManager } from "./events";
import { ServerManager } from "./server";
import { settings } from "./settings";

/**
 * Identifiers of the editable fields shown in `/models settings`.
 * Values match the scalar `LlamaSettings` keys.
 */
export enum Options {
  REACT_TO_MODEL_SELECT = "reactToModelSelect",
  AUTOLOAD_ON_MESSAGE = "autoloadOnMessage",
  SORT_BY = "sortBy",
  POLLING_TIMEOUT = "pollingTimeout",
  SERVER_TIMEOUT = "serverTimeout",
}

type SortByValue = NonNullable<LlamaSettings["sortBy"]>;

const SORT_VALUES: SortByValue[] = [
  "asc",
  "desc",
  "asc-name",
  "desc-name",
  "api",
];

/** Presets (ms) for `pollingTimeout` */
const POLLING_PRESETS = [15000, 30000, 60000, 120000, 300000];

/** Presets (ms) for `serverTimeout` */
const SERVER_PRESETS = [500, 1000, 2000, 5000, 10000];

/**
 * Formats milliseconds compactly for display (e.g. `500 -> "500ms"`,
 * `60000 -> "60s"`).
 */
export const formatMs = (ms: number): string =>
  ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;

/**
 * Parses a value produced by `formatMs()` back to milliseconds.
 * Only ever called with values from the preset lists.
 */
const parseMs = (value: string): number =>
  value.endsWith("ms")
    ? Number(value.slice(0, -2))
    : Number(value.slice(0, -1)) * 1000;

/**
 * Builds the `SettingsList` items for `/models settings` from the current
 * (merged) values of the scalar `llamaSettings` fields.
 */
export const buildSettingsItems = (): SettingItem[] => {
  const { pollingTimeout, serverTimeout } = settings.resolveTimeouts();

  return [
    {
      id: Options.REACT_TO_MODEL_SELECT,
      label: "React to model selection",
      description: "Load the model when you pick it in Pi (immediate)",
      currentValue: settings.resolveReactToModelSelect() ? "on" : "off",
      values: ["on", "off"],
    },
    {
      id: Options.AUTOLOAD_ON_MESSAGE,
      label: "Autoload on message",
      description:
        "Auto-load the selected model when you send a message (immediate)",
      currentValue: settings.resolveAutoloadOnMessage() ? "on" : "off",
      values: ["on", "off"],
    },
    {
      id: Options.SORT_BY,
      label: "Sort models by",
      description: "Order of models in /models (next open)",
      currentValue: settings.resolveSortBy(),
      values: [...SORT_VALUES],
    },
    {
      id: Options.POLLING_TIMEOUT,
      label: "Polling timeout",
      description: "Max model-load wait (next model load)",
      currentValue: formatMs(pollingTimeout),
      values: POLLING_PRESETS.map(formatMs),
    },
    {
      id: Options.SERVER_TIMEOUT,
      label: "Server timeout",
      description: "Health check / SSE probe timeout (next model load)",
      currentValue: formatMs(serverTimeout),
      values: SERVER_PRESETS.map(formatMs),
    },
  ];
};

/**
 * Persists a change made in the settings menu.
 * Maps the `SettingsList` id/value pair to the matching `llamaSettings`
 * key and writes it via `LlamaSettingsManager.setLlamaSetting()`.
 */
export const applySettingChange = async (
  id: string,
  newValue: string,
): Promise<void> => {
  switch (id) {
    case Options.REACT_TO_MODEL_SELECT:
      await settings.setLlamaSetting("reactToModelSelect", newValue === "on");
      return;
    case Options.AUTOLOAD_ON_MESSAGE:
      await settings.setLlamaSetting("autoloadOnMessage", newValue === "on");
      return;
    case Options.SORT_BY:
      await settings.setLlamaSetting("sortBy", newValue as SortByValue);
      return;
    case Options.POLLING_TIMEOUT:
      await settings.setLlamaSetting("pollingTimeout", parseMs(newValue));
      return;
    case Options.SERVER_TIMEOUT:
      await settings.setLlamaSetting("serverTimeout", parseMs(newValue));
      return;
  }
};

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
      {
        value: "servers",
        label: "servers",
        description: "Manage llama.cpp server URLs",
      },
      {
        value: "settings",
        label: "settings",
        description: "Configure llamaSettings",
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
    // Settings menu: no network round-trip needed, handle before any
    // server updates / unreachable-server notifications
    if (args === "settings") {
      await this.runSettingsMenu(ctx);
      return;
    }

    // Servers editor: same — edits are passive until the next provider scan
    if (args === "servers") {
      await this.runServersEditor(ctx);
      return;
    }

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
   * Runs the interactive settings menu for the scalar `llamaSettings`
   * fields. Enter/Space cycles the value under the cursor; Esc closes.
   *
   * Writes go to the global `~/.pi/agent/settings.json` via
   * `LlamaSettingsManager.setLlamaSetting()`; write errors are notified
   * and leave the dialog open with values unchanged.
   */
  private async runSettingsMenu(ctx: ExtensionCommandContext): Promise<void> {
    if (ctx.mode !== "tui") {
      ctx.ui.notify(
        "/models settings requires an interactive session (TUI)",
        "warning",
      );
      return;
    }

    const items = buildSettingsItems();

    await ctx.ui.custom<void>(
      (_tui, _theme, _kb, done) =>
        new SettingsList(
          items,
          Math.min(items.length + 2, 15),
          getSettingsListTheme(),
          (id, newValue) => {
            applySettingChange(id, newValue).catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              ctx.ui.notify(message, "error");
            });
          },
          () => done(undefined),
        ),
    );
  }

  /**
   * Runs the interactive servers editor for `llamaSettings.servers`.
   * Enter/e edits the selected URL, i its id, n its name, a adds,
   * d deletes (after a confirmation prompt); Esc closes.
   *
   * Writes go to the global `~/.pi/agent/settings.json` via
   * `LlamaSettingsManager.setLlamaSetting()`; write errors are notified and
   * the editor stays open with the pre-mutation list. List changes (add,
   * remove, URL/`id`/`name` edits) apply the next time providers are
   * scanned — run `/models` to see them.
   */
  private async runServersEditor(ctx: ExtensionCommandContext): Promise<void> {
    if (ctx.mode !== "tui") {
      ctx.ui.notify(
        "/models servers requires an interactive session (TUI)",
        "warning",
      );
      return;
    }

    const servers = settings.llamaServers;

    await ctx.ui.custom<void>(
      (tui, theme, keybindings, done) =>
        new ServerListEditor({
          tui,
          theme,
          keybindings,
          servers,
          persist: (next) => settings.setLlamaSetting("servers", next),
          done: () => done(undefined),
          onError: (message) => ctx.ui.notify(message, "error"),
        }),
    );
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
