import {
  type BeforeProviderRequestEvent,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type ProviderStreamEvent,
  type SessionBeforeSwitchEvent,
  type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { PROVIDER_NAME } from "./constants";
import { ModelSelectEvent } from "./interfaces/events";
import { CommandManager } from "./managers/command";
import { EventManager } from "./managers/events";
import { InflightTracker } from "./managers/inflightTracker";
import { CompletionTracker } from "./managers/completionTracker";
import { ServerFactory } from "./servers/serverFactory";
import { SettingsService } from "./settings/settings";
import { ServerManager } from "./managers/server";

export default async function (pi: ExtensionAPI) {
  const inflightTracker = new InflightTracker();
  const completionTracker = new CompletionTracker();

  const settings = SettingsService.create();
  const serverManager = new ServerManager(settings, new ServerFactory());
  const eventManager = new EventManager(
    serverManager,
    settings,
    inflightTracker,
    completionTracker,
  );
  const commandManager = new CommandManager(
    serverManager,
    settings,
    eventManager,
    completionTracker,
  );

  // Register providers once at startup
  await serverManager.initialize(pi);

  // Single global /models command
  pi.registerCommand("models", {
    description: `Browse ${PROVIDER_NAME} models`,
    getArgumentCompletions: commandManager.getArgumentCompletions,
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await commandManager.handleCommand(args, ctx, pi);
    },
  });

  // Events
  pi.on("session_start", (event: SessionStartEvent, ctx: ExtensionContext) => {
    if (event.reason !== "startup") return;
    for (const error of serverManager.getErrors())
      ctx.ui.notify(error, "error");
    for (const warning of serverManager.getWarnings())
      ctx.ui.notify(warning, "warning");
  });

  pi.on(
    "before_provider_request",
    async (event: BeforeProviderRequestEvent, ctx: ExtensionContext) =>
      await eventManager.onBeforeProviderRequest(event, ctx, pi),
  );

  pi.on(
    "model_select",
    async (event: ModelSelectEvent, ctx: ExtensionContext) =>
      await eventManager.onModelSelect(event, ctx, pi),
  );
  pi.on(
    "session_before_switch",
    async (_: SessionBeforeSwitchEvent, ctx: ExtensionContext) =>
      await eventManager.onSessionBeforeSwitch(ctx),
  );

  // Track completion IDs from streaming chat responses
  pi.on("provider_stream_event", (event: ProviderStreamEvent) =>
    eventManager.onProviderStreamEvent(event),
  );
  // Clear tracked completions when the agent finishes
  pi.on("message_end", () => eventManager.onMessageEnd());
}
