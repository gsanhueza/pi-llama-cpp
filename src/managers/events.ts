import {
  type BeforeProviderRequestEvent,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { PROVIDER_NAME, READABLE_TIMEOUT } from "../constants";
import { sessionSwitchWarning } from "../ui/strings";
import { errorMessage } from "../utils/errors";
import { Status } from "../enums/status";
import { ModelSelectEvent } from "../interfaces/events";
import type { SettingsService } from "../settings/settings";
import { Model } from "../models/model";
import { ServerManager } from "./server";
import { InflightTracker, inflightTracker } from "./inflightTracker";

export class EventManager {
  constructor(
    private readonly serverManager: ServerManager,
    private readonly settings: SettingsService,
    private readonly tracker: InflightTracker = inflightTracker,
  ) {}

  /**
   * Reacts to a new model event triggered by Pi
   *
   * @param event Model selection event
   * @param ctx Pi context
   * @param pi Pi extension API
   */
  async onModelSelect(
    event: ModelSelectEvent,
    ctx: ExtensionContext,
    pi: ExtensionAPI,
  ) {
    // Check if the model_select event should be used
    if (!(await this.settings.resolveReactToModelSelect())) return;

    for (const { providerId, models } of this.serverManager.servers) {
      if (event.model.provider !== providerId) continue;

      const model = models.find((m) => m.id === event.model.id);
      if (!model) continue;

      await this.loadWithFeedback(model, ctx, pi);
      return;
    }
  }

  /**
   * Loads the model if auto-loading is enabled and the model is unloaded,
   * or waits for an in-flight load if the model is already loading.
   *
   * @param model The model to potentially auto-load
   * @param ctx Pi context
   * @param pi Pi extension API
   */
  private async autoLoadIfNeeded(
    model: Model,
    ctx: ExtensionContext,
    pi: ExtensionAPI,
  ): Promise<void> {
    if (!(await this.settings.resolveAutoloadOnMessage())) return;

    const status = await model.getStatus();
    if (status === Status.UNLOADED) {
      await this.loadWithFeedback(model, ctx, pi);
      return;
    }

    // If the model is already loading (e.g. from /models), wait for it.
    if (status === Status.LOADING && this.tracker.inflightModel === model) {
      await this.tracker.inflightPromise;
    }
  }

  /**
   * Unloads a model: shows status notifications and re-scans providers.
   *
   * Fire-and-forget — the caller does not need to await this method.
   *
   * @param model The model to unload
   * @param ctx Pi context
   * @param pi Pi extension API (for provider re-scan)
   */
  async unloadModel(
    model: Model,
    ctx: ExtensionContext,
    pi: ExtensionAPI,
  ): Promise<void> {
    ctx.ui.notify(`Unloading ${model.name}...`, "info");

    try {
      await model.unload();
      ctx.ui.notify(`Unloaded ${model.name}`, "info");
    } catch (err) {
      ctx.ui.notify(errorMessage(err), "error");
    } finally {
      // Re-scan providers so the model registry reflects the new state
      await this.serverManager.update(pi);
    }
  }

  /**
   * Session-switch handler. Registered once at extension init.
   * Only notifies if a model load is actually in-flight.
   *
   * @param ctx Pi context
   */
  async onSessionBeforeSwitch(ctx: ExtensionContext) {
    if (!this.tracker.inflightModel) return;

    ctx.ui.notify(
      sessionSwitchWarning(this.tracker.inflightModel.name),
      "warning",
    );

    // Show the notification for a reasonable amount of time
    await new Promise((r) => setTimeout(r, READABLE_TIMEOUT));
  }

  /**
   * Intercepts the request to add extra information, useful to llama.cpp.
   * Adds a custom thinking budget to the request payload.
   *
   * @param event Request event
   * @param ctx Pi context
   * @param pi Pi extension API
   * @returns Updated payload
   */
  async onBeforeProviderRequest(
    event: BeforeProviderRequestEvent,
    ctx: ExtensionContext,
    pi: ExtensionAPI,
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
    await this.autoLoadIfNeeded(serverModel, ctx, pi);

    // Retrieve pi's current thinking level, so we can setup a budget
    const level =
      ctx.thinkingLevel ?? this.settings.resolveThinkingLevel() ?? "medium";
    const budgets = this.settings.resolveThinkingBudgets();
    const thinking_budget_tokens = budgets[level];

    // Setup payload
    if (level === "off")
      return { ...payload, chat_template_kwargs: { enable_thinking: false } };

    if (level === "max") return payload;

    return { ...payload, thinking_budget_tokens };
  }

  /**
   * Loads a model with full feedback: loading notification, SSE progress
   * (when available), inflight tracking, ready/error notifications,
   * model switch, provider re-scan, and status bar refresh.
   *
   * Non-blocking internally (fire-and-forget). Callers may `await` the
   * returned promise if they need to block until the load completes.
   *
   * @param model The model to load
   * @param ctx Pi context
   * @param pi Pi extension API (for model switching and provider re-scan)
   */
  async loadWithFeedback(
    model: Model,
    ctx: ExtensionContext,
    pi: ExtensionAPI,
  ): Promise<void> {
    ctx.ui.notify(`Loading ${model.name}...`, "info");
    this.tracker.inflightModel = model;

    // Subscribe to SSE progress when available
    const server = this.serverManager.getServer(model);
    let cleanupProgress = () => {};
    if (server?.sseManager && (await server.sseManager.probeSSE())) {
      cleanupProgress = server.sseManager.subscribeToProgress(
        model.id,
        (percentage, stage) => {
          const stageText = stage ? ` (${stage})` : "";
          ctx.ui.notify(
            `Loading ${model.name}... [${percentage}%${stageText}]`,
            "info",
          );
        },
      );
    }

    // Execute the loading process
    const loadPromise = (async () => {
      await model.load();

      ctx.ui.notify(`Model ${model.name} ready`, "info");

      // Switch the loaded model in Pi's registry
      const { serverId } = model;
      const piModel = ctx.modelRegistry.find(serverId, model.id);
      if (piModel) await pi.setModel(piModel);
    })();

    this.tracker.inflightPromise = loadPromise;

    try {
      await loadPromise;
    } catch (err) {
      ctx.ui.notify(errorMessage(err), "error");
    } finally {
      cleanupProgress();
      this.tracker.reset();
      this.tracker.inflightPromise = null;

      // Re-scan providers so the model registry reflects the new state
      await this.serverManager.update(pi);

      ctx.ui.setStatus(PROVIDER_NAME, " ");
      ctx.ui.setStatus(PROVIDER_NAME, undefined);
    }
  }
}
