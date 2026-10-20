import { FALLBACK_CTX } from "../constants";
import { Mode } from "../enums/mode";
import { RequestPolicy } from "../api/client";
import { Status } from "../enums/status";
import { Server } from "./server";

/**
 * Server subclass for llama-swap (cloud model proxy).
 *
 * Resolves status, capabilities, and context size from the `/v1/models`
 * endpoint, and uses llama-swap's own `/upstream/{id}` and
 * `/api/models/unload/{id}` endpoints for load/unload.
 */
export class LlamaSwapServer extends Server {
  override mode: Mode = Mode.LLAMASWAP;

  /**
   * Resolves status from `/v1/models` status field.
   *
   * @param modelId — The model ID.
   * @returns The resolved status.
   */
  override async getModelStatus(modelId: string): Promise<Status> {
    try {
      const { data } = await this.fetchModels();
      const model = data?.find((m) => m.id === modelId);
      return model?.status?.value === "loaded"
        ? Status.LOADED
        : Status.UNLOADED;
    } catch {
      return Status.UNLOADED;
    }
  }

  /**
   * Resolves capabilities from `/v1/models` architecture input_modalities.
   *
   * @param modelId — The model ID.
   * @returns The resolved capabilities.
   */
  override async getCapabilities(
    modelId: string,
  ): Promise<("text" | "image")[]> {
    const overridden = this.findOverrideForModel(modelId)?.capabilities;
    if (overridden) return overridden;

    const { data } = await this.fetchModels();
    const model = data.find((m) => m.id === modelId);
    const inputModalities = model?.architecture?.input_modalities ?? [];

    return inputModalities.includes("image") ? ["text", "image"] : ["text"];
  }

  /**
   * Resolves context size from `/v1/models` meta n_ctx.
   *
   * @param modelId — The model ID.
   * @returns The resolved context size.
   */
  override async getContextSize(modelId: string): Promise<number> {
    const overridden = this.findOverrideForModel(modelId)?.contextSize;
    if (overridden && overridden > 0) return overridden;

    const { data } = await this.fetchModels();
    const model = data.find((m) => m.id === modelId);

    return model?.meta?.n_ctx ?? FALLBACK_CTX;
  }

  /**
   * Loads a model via llama-swap's upstream endpoint, then polls
   * until loaded or timeout.
   *
   * @param modelId — The model ID to load.
   */
  override async loadModel(modelId: string): Promise<void> {
    try {
      await this.apiClient.get<void>(
        `/upstream/${modelId}`,
        undefined,
        RequestPolicy.Raw,
      );
    } catch {
      throw new Error(`Model loading failed: ${modelId}`);
    }
    await this.pollModelStatus(modelId, Status.LOADED);
  }

  /**
   * Unloads a model via llama-swap's API, then polls until unloaded.
   *
   * @param modelId — The model ID to unload.
   */
  override async unloadModel(modelId: string): Promise<void> {
    await this.apiClient.post<void>(
      `/api/models/unload/${modelId}`,
      undefined,
      undefined,
      RequestPolicy.Raw,
    );
    await this.pollModelStatus(modelId, Status.UNLOADED);
  }

  /**
   * Resolves the display name for llama-swap models, checking nested
   * llamaswap aliases first, then standard aliases, falling back to model ID.
   *
   * @param modelId — The model ID.
   * @returns The model display name.
   */
  override async getModelName(modelId: string): Promise<string> {
    const { data } = await this.fetchModels();
    const mm = data.find((m) => m.id === modelId);
    return mm?.meta?.llamaswap?.aliases?.[0] ?? mm?.aliases?.[0] ?? modelId;
  }
}
