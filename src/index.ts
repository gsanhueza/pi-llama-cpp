import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionBeforeSwitchEvent,
} from "@earendil-works/pi-coding-agent";
import { PROVIDER_NAME } from "./constants";
import { ModelSelectEvent } from "./interfaces/events";
import { CommandManager } from "./managers/command";
import { EventManager } from "./managers/events";
import { ConfigResolver } from "./resolver";
import { Server } from "./server";

export default async function (pi: ExtensionAPI) {
  const resolver = new ConfigResolver();
  const urls = await resolver.resolveUrls(process.cwd());

  const servers = urls.map((url) => new Server(url));
  const events = new EventManager(servers);
  const manager = new CommandManager(pi, servers);

  // Register providers once at startup (clears failedUrls for the first /models run)
  await manager.registerAllProviders();
  manager.failedUrls.length = 0;

  // Single global /models command
  pi.registerCommand("models", {
    description: `Browse ${PROVIDER_NAME} models`,
    getArgumentCompletions: manager.getArgumentCompletions,
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await manager.handleCommand(args, ctx, pi);
    },
  });

  // Events
  pi.on(
    "model_select",
    async (event: ModelSelectEvent, ctx: ExtensionContext) =>
      await events.onModelSelect(event, ctx),
  );
  pi.on(
    "session_before_switch",
    async (_: SessionBeforeSwitchEvent, ctx: ExtensionContext) =>
      await events.onSessionBeforeSwitch(ctx),
  );
}
