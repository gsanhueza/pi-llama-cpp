import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { AutocompleteItem } from "@earendil-works/pi-tui";
import { modelsCommand, notFoundCommand } from "../commands/models";
import { PROVIDER_ID, PROVIDER_NAME } from "../constants";
import { BaseModel } from "../models/baseModel";
import { Server } from "../server";

export class CommandManager {
  static inflightModel: BaseModel | null = null;

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly server: Server,
  ) {}

  /**
   * Sets up the initial state of the provider
   */
  async initialize() {
    if (await this.server.isReady()) {
      await this.update();
    } else {
      await this.register([]);
    }
  }

  /**
   * Ensures the models are up-to-date with the server
   */
  async update() {
    await this.server.initialize();

    const modelConfigs = await Promise.all(
      this.server.models.map((m) => m.toProviderConfig()),
    );

    await this.register(modelConfigs);
  }

  /**
   * Registers the provider in Pi with the given configurations
   * Note: Registrations overload previous provider
   *
   * @param models Provider configurations for the models
   */
  async register(models: ProviderModelConfig[]) {
    this.pi.registerProvider(PROVIDER_ID, {
      name: PROVIDER_NAME,
      baseUrl: this.server.baseUrl,
      api: "openai-completions",
      apiKey: this.server.apiKey,
      models,
    });
  }

  /**
   * Sets up the behavior of the `/models` command
   *
   * @returns The object used by Pi to setup the command
   */
  setupModelsCommand() {
    return {
      description: `Browse ${PROVIDER_NAME} models`,
      getArgumentCompletions: this.getArgumentCompletions,
      handler: async (args: string, ctx: ExtensionCommandContext) =>
        await this.run(args, ctx),
    };
  }

  /**
   * Dispatches the /models command
   *
   * @param args Arguments passed to the command
   * @param ctx The context used by Pi
   * @param pi The Pi extension
   */
  async run(args: string, ctx: ExtensionCommandContext) {
    if (!(await this.server.isReady())) return await notFoundCommand(ctx);

    // Updates the available models
    await this.update();

    // Command: `/models info`
    if (args === "info") {
      const info = await Promise.all(
        this.server.models.map((m) => m.getInfo()),
      );
      const message = ctx.ui.theme.fg("accent", info.join("\n"));
      ctx.ui.notify(message, "info");
      return;
    }

    // Command: `/models unload`
    if (args === "unload") {
      await Promise.all(this.server.models.map((m) => m.unload()));
      ctx.ui.notify(`Unloaded all ${PROVIDER_NAME} models`, "info");
      return;
    }

    // Command: `/models` (interactive menu)
    return await modelsCommand(ctx, this.pi, this.server.models);
  }

  /**
   * Sets up the autocomplete for the `/models` command
   *
   * @param prefix The prefix to filter completions
   * @returns An array of AutocompleteItem objects or null
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
}
