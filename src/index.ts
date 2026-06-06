import type {
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeSwitchEvent,
} from "@earendil-works/pi-coding-agent";
import { ModelSelectEvent } from "./interfaces/events";
import { CommandManager } from "./managers/command";
import { EventManager } from "./managers/events";
import { Server } from "./server";
import { resolveApiKey, resolveUrl } from "./tools/resolver";

export default async function (pi: ExtensionAPI) {
  const baseUrl = await resolveUrl(process.cwd());
  const apiKey = await resolveApiKey();

  const server = new Server(baseUrl, apiKey);
  const events = new EventManager(server);
  const manager = new CommandManager(pi, server);

  await manager.initialize();

  // Command: /models
  pi.registerCommand("models", manager.setupModelsCommand());

  // Events registration
  pi.on(
    "model_select",
    async (event: ModelSelectEvent, ctx: ExtensionContext) =>
      await events.onModelSelect(event, ctx),
  );

  pi.on(
    "session_before_switch",
    async (event: SessionBeforeSwitchEvent, ctx: ExtensionContext) =>
      await events.onSessionBeforeSwitch(event, ctx),
  );
}
