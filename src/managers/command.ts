import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { AutocompleteItem } from "@earendil-works/pi-tui";
import { modelsCommand, notFoundCommand } from "../commands/models";
import { API_TYPE, PROVIDER_NAME } from "../constants";
import { BaseModel } from "../models/baseModel";
import { Server } from "../server";

export class CommandManager {
  readonly failedUrls: string[] = [];

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly servers: Server[],
  ) {}

  /**
   * Registers one provider per server in Pi with their model configurations.
   * Call this after the servers have been initialized.
   * The manual awaiting per-server is deliberate (we want them in order)
   */
  async registerAllProviders() {
    for (const server of this.servers) {
      await this.registerProvider(server);
    }
  }

  /**
   * Creates a Pi provider for the given server
   *
   * @param server The server
   */
  private async registerProvider(server: Server) {
    try {
      await server.initialize();
    } catch {
      this.failedUrls.push(server.baseUrl);
      return;
    }

    // Setup the Pi registration
    const { baseUrl, models, providerId, providerName } = server;
    const apiKey = await server.getApiKey();
    const modelConfigs = await Promise.all(
      models.map((m) => m.toProviderConfig()),
    );

    this.pi.registerProvider(providerId, {
      name: providerName,
      baseUrl: baseUrl,
      api: API_TYPE,
      apiKey: apiKey,
      models: modelConfigs,
    });
  }

  /**
   * Returns all models from all servers.
   *
   * @returns Flat array of all models across all servers
   */
  getAllModels(): BaseModel[] {
    const response = [];

    for (const { models } of this.servers) {
      for (const model of models) {
        response.push(model);
      }
    }

    return response;
  }

  /**
   * Sets up the argument completions for the `/models` command
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
    // Re-register providers so Pi sees updated model states
    await this.registerAllProviders();

    // Notify about unreachable servers
    for (const url of this.failedUrls) {
      await notFoundCommand(ctx, url);
    }
    this.failedUrls.length = 0; // Clear for next run

    if (args === "unload") {
      await Promise.all(this.getAllModels().map((model) => model.unload()));
      ctx.ui.notify(`Unloaded all ${PROVIDER_NAME} models`, "info");
      return;
    }

    if (args === "info") {
      const infos = await Promise.all(
        this.getAllModels().map((model) => model.getInfo()),
      );
      ctx.ui.notify(ctx.ui.theme.fg("accent", infos.join("\n")), "info");
      return;
    }

    // Interactive menu: show <name> (<server_url>)
    const allModels = this.getAllModels();
    await modelsCommand(ctx, pi, allModels);
  }
}
