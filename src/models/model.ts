import type { Model as PiModel, ModelCost } from "@earendil-works/pi-ai";
import { API_TYPE } from "../constants";
import { Status } from "../enums/status";
import { DataProperty } from "../interfaces/endpoints/models";
import type { Server } from "../servers/server";

/**
 * Lightweight data carrier for a llama-server model.
 *
 * All HTTP, status, and configuration logic is delegated to its
 * {@link Server} — this class is mode-agnostic and identical across
 * all server types.
 */
export class Model {
  constructor(
    private readonly data: DataProperty,
    public readonly server: Server,
  ) {}

  private readonly labelIcons: Record<Status, string> = {
    [Status.LOADED]: "🟢",
    [Status.LOADING]: "🟡",
    [Status.FAILED]: "🔴",
    [Status.SLEEPING]: "🔵",
    [Status.UNLOADED]: "⚪",
  };

  /** Unique identifier of the model. */
  get id(): string {
    return this.data.id;
  }

  /** Display name (first alias, or id as fallback). */
  get name(): string {
    return this.data.aliases?.[0] ?? this.data.id;
  }

  /** Server URL this model belongs to. */
  get serverUrl(): string {
    return this.server.baseUrl;
  }

  /** Server provider ID. */
  get serverId(): string {
    return this.server.providerId;
  }

  /** Whether the model is a reasoning model. */
  get reasoning(): boolean {
    return this.server.findOverrideForModel(this.id)?.reasoning ?? true;
  }

  /** Current load status of the model. */
  async getStatus(): Promise<Status> {
    return this.server.getModelStatus(this.id);
  }

  /**
   * Returns a label for the model selection screen.
   * @returns A label structured as "<icon> <name>"
   */
  async getLabel(): Promise<string> {
    const status = await this.getStatus();
    return `${this.labelIcons[status]} ${this.name}`;
  }

  /**
   * Returns human-readable information about the model.
   * @returns A string with the model information
   */
  async getInfo(): Promise<string> {
    const messages = [
      `Server       : ${this.serverUrl}`,
      `Mode         : ${this.server.mode}`,
      `ID           : ${this.id}`,
      `Model        : ${this.name}`,
      `Reasoning    : ${this.reasoning}`,
      `Capabilities : ${(await this.getCapabilities()).join(", ")}`,
      `Context size : ${await this.getContextSize()}`,
      `Status       : ${await this.getStatus()}`,
    ];

    return `${messages.join("\n")}\n`;
  }

  /** Capabilities of the model (text, image, or both). */
  async getCapabilities(): Promise<("text" | "image")[]> {
    return this.server.getCapabilities(this.id);
  }

  /** Context size in tokens. */
  async getContextSize(): Promise<number> {
    return this.server.getContextSize(this.id);
  }

  /**
   * Converts the model into a Provider model shape.
   * @returns A Provider model object for openai-completions API
   */
  async toProviderConfig(): Promise<PiModel<typeof API_TYPE>> {
    const override = this.server.findOverrideForModel(this.id) ?? {};

    const userCost = override.cost ?? {};
    const cost: ModelCost = {
      input: userCost.input ?? 0,
      output: userCost.output ?? 0,
      cacheRead: userCost.cacheRead ?? 0,
      cacheWrite: userCost.cacheWrite ?? 0,
    };

    const input = override.capabilities ?? (await this.getCapabilities());
    const contextWindow =
      override.contextSize && override.contextSize > 0
        ? override.contextSize
        : await this.getContextSize();
    const maxTokens = this.getMaxTokens(contextWindow);

    const response: PiModel<typeof API_TYPE> = {
      id: this.id,
      name: this.name,
      api: API_TYPE,
      provider: this.server.providerId,
      baseUrl: this.server.apiBaseUrl,
      reasoning: this.reasoning,
      thinkingLevelMap: {
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      },
      input,
      contextWindow,
      cost,
      maxTokens,
    };

    if (override.compat) {
      response.compat = override.compat;
    }
    if (override.samplingParams) {
      response.samplingParams = override.samplingParams;
    }
    if (override.samplingParamsByThinkingLevel) {
      response.samplingParamsByThinkingLevel =
        override.samplingParamsByThinkingLevel;
    }

    return response;
  }

  /** Maximum number of tokens the model can generate. */
  private getMaxTokens(contextSize: number): number {
    return this.server.getMaxTokens(this.id, contextSize);
  }

  /** Load the model in llama-server. */
  async load(): Promise<void> {
    await this.server.loadModel(this.id);
  }

  /** Unload the model from llama-server. */
  async unload(): Promise<void> {
    await this.server.unloadModel(this.id);
  }
}
