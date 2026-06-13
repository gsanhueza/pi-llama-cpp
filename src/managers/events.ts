import {
  type BeforeProviderRequestEvent,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { READABLE_TIMEOUT } from "../constants";
import { ModelSelectEvent } from "../interfaces/events";
import { BaseModel } from "../models/baseModel";
import { ConfigResolver } from "../resolver";
import { Server } from "../server";

export class EventManager {
  static inflightModel: BaseModel | null = null;

  constructor(private readonly servers: Server[]) {}

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
    for (const { providerId, models } of this.servers) {
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
  async onBeforeProviderRequest(event: BeforeProviderRequestEvent) {
    const payload = event.payload as { model?: string };
    const { model } = payload;
    if (!model) return payload;

    // Check if this model belongs to one of our servers
    const isLlamaCpp = this.servers.some((s) =>
      s.models.some((m) => m.id === model),
    );

    if (!isLlamaCpp) return payload;

    // Retrieve pi's current thinking level, so we can setup a budget
    const resolver = new ConfigResolver();
    const level = resolver.resolveThinkingLevel() ?? "medium";
    const budgets = resolver.resolveThinkingBudgets();
    const thinking_budget_tokens = budgets[level];

    // Setup payload
    if (level === "off")
      return { ...payload, chat_template_kwargs: { enable_thinking: false } };

    if (level === "xhigh") return payload;

    return { ...payload, thinking_budget_tokens };
  }
}
