import type {
  ExtensionContext,
  SessionBeforeSwitchEvent,
} from "@earendil-works/pi-coding-agent";
import { PROVIDER_ID, READABLE_TIMEOUT } from "../constants";
import { ModelSelectEvent } from "../interfaces/events";
import { BaseModel } from "../models/baseModel";
import { Server } from "../server";

export class EventManager {
  static inflightModel: BaseModel | null = null;

  constructor(private readonly server: Server) {}

  /**
   * Reacts to a new model event triggered by Pi
   *
   * @param event Model selection event
   * @param ctx Pi context
   */
  async onModelSelect(event: ModelSelectEvent, ctx: ExtensionContext) {
    if (event.model.provider !== PROVIDER_ID) return;

    const model = this.server.models.find((m) => m.id === event.model.id);
    if (!model) return;

    ctx.ui.notify(`Loading ${model.name}...`, "info");
    await model
      .load()
      .then(() => ctx.ui.notify(`Model ${model.name} ready`, "info"))
      .catch(() =>
        ctx.ui.notify(`Failed to load model ${model.name}`, "error"),
      );
  }

  /**
   * Session-switch handler. Registered once at extension init.
   * Only notifies if a model load is actually in-flight.
   *
   * @param event Before switch event
   * @param ctx Pi context
   */
  async onSessionBeforeSwitch(
    _event: SessionBeforeSwitchEvent,
    ctx: ExtensionContext,
  ) {
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
   * Resets the in-flight model reference.
   */
  static resetInflightModel() {
    EventManager.inflightModel = null;
  }
}
