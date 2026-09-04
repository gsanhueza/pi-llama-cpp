import {
  type BeforeProviderRequestEvent,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { READABLE_TIMEOUT } from "../constants";
import { Status } from "../enums/status";
import { ModelSelectEvent } from "../interfaces/events";
import { settings } from "../managers/settings";
import { BaseModel } from "../models/baseModel";
import { ServerManager } from "./server";

export class EventManager {
  static inflightModel: BaseModel | null = null;

  constructor(private readonly serverManager: ServerManager) {}

  /**
   * Resets the in-flight model reference.
   */
  static resetInflightModel() {
    EventManager.inflightModel = null;
  }

  /**
   * Reacts to a new model event triggered by Pi
   *
   * @param event Model selection event
   * @param ctx Pi context
   */
  async onModelSelect(event: ModelSelectEvent, ctx: ExtensionContext) {
    // Check if the model_select event should be used
    if (!settings.resolveReactToModelSelect()) return;

    for (const { providerId, models } of this.serverManager.servers) {
      if (event.model.provider !== providerId) continue;

      const model = models.find((m) => m.id === event.model.id);
      if (!model) continue;

      ctx.ui.notify(`Loading ${model.name}...`, "info");
      await model
        .load()
        .then(() => ctx.ui.notify(`Model ${model.name} ready`, "info"))
        .catch(() =>
          ctx.ui.notify(`Failed to load model ${model.name}`, "error"),
        );
      return;
    }
  }

  /**
   * Loads the model if auto-loading is enabled and the model is unloaded.
   *
   * @param model The model to potentially auto-load
   */
  private async autoLoadIfNeeded(model: BaseModel): Promise<void> {
    if (!settings.resolveAutoloadOnMessage()) return;

    const status = await model.getStatus();
    if (status !== Status.UNLOADED) return;

    await model.load();
  }

  /**
   * Session-switch handler. Registered once at extension init.
   * Only notifies if a model load is actually in-flight.
   *
   * @param ctx Pi context
   */
  async onSessionBeforeSwitch(ctx: ExtensionContext) {
    if (!EventManager.inflightModel) return;

    const messages = [
      `Session change detected while model '${EventManager.inflightModel.name}' was still loading.`,
      "Model load will continue in the background, but UI might not update.",
      "",
      "Verify that your new model is loaded, or use /models to re-select it afterwards.",
    ];
    ctx.ui.notify(messages.join("\n"), "warning");

    // Show the notification for a reasonable amount of time
    await new Promise((r) => setTimeout(r, READABLE_TIMEOUT));
  }

  /**
   * Intercepts the request to add extra information, useful to llama.cpp.
   * Adds a custom thinking budget to the request payload.
   *
   * @param event Request event
   * @returns Updated payload
   */
  async onBeforeProviderRequest(
    event: BeforeProviderRequestEvent,
    ctx: ExtensionContext,
  ) {
    const payload = event.payload as { model?: string };
    const { model } = payload;
    if (!model) return payload;

    // Check if this model belongs to one of our servers
    const serverModel = this.serverManager.servers
      .flatMap((s) => s.models)
      .find((m) => m.id === model);

    if (!serverModel) return payload;

    // Auto-load if enabled and model is unloaded
    await this.autoLoadIfNeeded(serverModel);

    // Retrieve pi's current thinking level, so we can setup a budget
    const level =
      ctx.thinkingLevel ?? settings.resolveThinkingLevel() ?? "medium";
    const budgets = settings.resolveThinkingBudgets();
    const thinking_budget_tokens = budgets[level];

    // Setup payload
    if (level === "off")
      return { ...payload, chat_template_kwargs: { enable_thinking: false } };

    if (level === "max") return payload;

    return { ...payload, thinking_budget_tokens };
  }
}
