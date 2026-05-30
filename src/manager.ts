import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { modelsCommand, notFoundCommand } from "./commands/models";
import {
  DEFAULT_LLAMA_SERVER_URL,
  PROVIDER_ID,
  PROVIDER_NAME,
} from "./constants";
import { BaseModel } from "./models/baseModel";
import { resolveApiKey, resolveUrl } from "./tools/resolver";
import { isServerReady, listModels } from "./tools/retriever";

export class CommandManager {
  private baseUrl: string = DEFAULT_LLAMA_SERVER_URL;
  private serverModels: BaseModel[] = [];

  constructor(private readonly pi: ExtensionAPI) {}

  /**
   * Sets up the initial state of the provider
   */
  async initialize() {
    if (await isServerReady()) {
      await this.update();
    } else {
      await this.register([]);
    }
  }

  /**
   * Ensures the models are up-to-date with the server
   */
  async update() {
    this.baseUrl = `${await resolveUrl(process.cwd())}`;

    this.serverModels = await listModels();
    const modelConfigs = await Promise.all(
      this.serverModels.map((m) => m.toProviderConfig()),
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
      baseUrl: this.baseUrl,
      api: "openai-completions",
      apiKey: await resolveApiKey(),
      models,
    });
  }

  /**
   * Dispatches the /models command
   *
   * @param args Arguments passed to the command
   * @param ctx The context used by Pi
   * @param pi The Pi extension
   */
  async run(args: string, ctx: ExtensionCommandContext) {
    if (!(await isServerReady())) {
      return await notFoundCommand(ctx);
    }

    // Refresh the model list from the server
    await this.update();

    // Command: `/models info`
    if (args === "info") {
      const info = await Promise.all(this.serverModels.map((m) => m.getInfo()));
      const message = ctx.ui.theme.fg("accent", info.join("\n"));
      ctx.ui.notify(message, "info");
      return;
    }

    // Command: `/models unload`
    if (args === "unload") {
      await Promise.all(this.serverModels.map((m) => m.unload()));
      ctx.ui.notify(`Unloaded all ${PROVIDER_NAME} models`, "info");
      return;
    }

    // Command: `/models` (interactive menu)
    return await modelsCommand(ctx, this.pi, this.serverModels);
  }
}
