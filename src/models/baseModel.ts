import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CTX, POLLING_INTERVAL, POLLING_TIMEOUT } from "../constants";
import { Mode } from "../enums/mode";
import { Status } from "../enums/status";
import { DataProperty } from "../interfaces/endpoints/models";
import { Server } from "../server";

/**
 * Abstract base class for llama-server models.
 * Provides common functionality for model identification, status checking,
 * loading/unloading, and configuration conversion.
 */
export abstract class BaseModel {
  constructor(
    protected readonly model: DataProperty,
    protected readonly server: Server,
  ) {}

  protected readonly statusMapper: Record<string, Status> = {
    loaded: Status.LOADED,
    loading: Status.LOADING,
    failed: Status.FAILED,
    sleeping: Status.SLEEPING,
    unloaded: Status.UNLOADED,
  };

  protected readonly labelIcons: Record<Status, string> = {
    [Status.LOADED]: "🟢",
    [Status.LOADING]: "🟡",
    [Status.FAILED]: "🔴",
    [Status.SLEEPING]: "🔵",
    [Status.UNLOADED]: "⚪",
    [Status.UNAUTHORIZED]: "⛔",
  };

  abstract get mode(): Mode;

  /**
   * Returns the server URL associated with this model
   */
  get serverUrl(): string {
    return this.server.baseUrl;
  }

  /**
   * Returns the provider id associated with this model
   */
  get serverId(): string {
    return this.server.providerId;
  }

  /**
   * Returns the model's unique identifier
   */
  get id(): string {
    return this.model.id;
  }

  /**
   * Returns the model's display name (first alias, or id as fallback)
   */
  get name(): string {
    return this.model.aliases?.[0] || this.model.id;
  }

  /**
   * Whether the model is a reasoning model.
   * Currently always returns true since there's no way to detect this from llama-server.
   */
  get reasoning(): boolean {
    return true;
  }

  /**
   * Detects the capabilities of the model
   *
   * @returns An array of capabilities, as expected by Pi
   */
  async getCapabilities(): Promise<("text" | "image")[]> {
    try {
      // When loaded, this works alright
      const { modalities } = await this.server.fetchModelProps(this.id);
      return modalities.vision ? ["text", "image"] : ["text"];
    } catch {
      // Otherwise, we have to search for it ourselves
      const { data } = await this.server.fetchModels();
      const model = data.find((d) => d.id === this.id);
      if (!model) return ["text"];

      const input_modalities: ("text" | "image" | "audio")[] = model
        .architecture?.input_modalities ?? ["text"];

      const response = input_modalities.filter(
        (mod): mod is "text" | "image" => mod === "text" || mod === "image",
      );

      return response;
    }
  }

  /**
   * Gets the load status of the model
   *
   * @returns The current {@link Status}
   */
  public async getStatus(): Promise<Status> {
    try {
      const { is_sleeping, error } = await this.server.fetchModelProps(this.id);

      if (is_sleeping) return Status.SLEEPING;
      if (!error) return Status.LOADED;
      if (error.code === 401) return Status.UNAUTHORIZED;
      if (error.code === 503) return Status.LOADING;
      if (error.code === 400 && error.message === "model is not loaded")
        return Status.UNLOADED;

      return Status.FAILED;
    } catch (err) {
      return Status.FAILED;
    }
  }

  /**
   * Gets the context size of a particular model.
   *
   * @returns The context size in tokens
   */
  async getContextSize(): Promise<number> {
    try {
      const { data } = await this.server.fetchModels();
      const { n_ctx } = data.find((m) => m.id === this.id)?.meta!;

      return n_ctx ?? DEFAULT_CTX;
    } catch {
      return DEFAULT_CTX;
    }
  }

  /**
   * Returns a label for the model selection screen
   * @returns A label structured as "<icon> <name>"
   */
  async getLabel(): Promise<string> {
    const status = await this.getStatus();
    return `${this.labelIcons[status]} ${this.name}`;
  }

  /**
   * Returns human-readable information about the model
   * @returns A string with the model information
   */
  async getInfo(): Promise<string> {
    const messages = [
      `Server       : ${this.serverUrl}`,
      `ID           : ${this.id}`,
      `Model        : ${this.name}`,
      `Reasoning    : ${this.reasoning}`,
      `Capabilities : ${(await this.getCapabilities()).join(", ")}`,
      `Context size : ${await this.getContextSize()}`,
      `Status       : ${await this.getStatus()}`,
    ];

    const response = `${messages.join("\n")}\n`;
    return response;
  }

  /**
   * Converts the llama-server model into a configuration object used by Pi
   *
   * @returns A Pi configuration object
   */
  async toProviderConfig(): Promise<ProviderModelConfig> {
    const response = {
      id: this.id,
      name: this.name,
      reasoning: this.reasoning,
      thinkingLevelMap: {
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
      },
      input: await this.getCapabilities(),
      contextWindow: await this.getContextSize(),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      maxTokens: await this.getContextSize(),
    };

    return response;
  }

  /**
   * Loads the model in llama-server.
   * Uses SSE status events when available, falling back to polling.
   */
  async load(): Promise<void> {
    const status = await this.getStatus();
    if (status === Status.LOADED || status === Status.SLEEPING) return;

    await this.server.postRequest("load", this.id);

    if (await this.server.sseManager.probeSSE()) {
      const { status, exit_code } =
        await this.server.sseManager.subscribeToStatus(this.id);

      if (status === "failed" || (status === "unloaded" && exit_code !== 0)) {
        throw new Error(`Model loading failed: ${this.id}`);
      }
    } else {
      await this.pollStatus();
    }
  }

  /**
   * Unloads the model from llama-server
   */
  async unload(): Promise<void> {
    await this.server.postRequest("unload", this.id);
  }

  /**
   * Polls llama-server to check when the model is loaded
   *
   * @param startTime The initial polling timestamp
   * @param timeout The maximum amount of ms before timeout. Defaults to POLLING_TIMEOUT
   * @param interval The polling interval. Defaults to POLLING_INTERVAL
   */
  async pollStatus(
    startTime: number = Date.now(),
    timeout: number = POLLING_TIMEOUT,
    interval: number = POLLING_INTERVAL,
  ): Promise<void> {
    while ((await this.getStatus()) === Status.LOADING) {
      // Force a timeout if we wasted too much time polling
      if (Date.now() - startTime > timeout) {
        const message = `Model loading timed out after ${timeout} ms: ${this.id}`;
        throw new Error(message);
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }
}
