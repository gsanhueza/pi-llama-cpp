import { DEFAULT_CTX, POLLING_INTERVAL, POLLING_TIMEOUT } from "../constants";
import { Mode } from "../enums/mode";
import { Status } from "../enums/status";
import { BaseModel } from "./baseModel";

/**
 * Represents a model in llama-server router mode.
 * Tracks per-model status from the /models endpoint and extracts
 * context size from startup arguments when the model is not loaded.
 */
export class RouterModel extends BaseModel {
  get mode(): Mode {
    return Mode.ROUTER;
  }

  /**
   * Workaround for /models status detection
   *
   * When a model is loaded for the very first time,
   * this workaround will try to poll to /props instead of /models
   * for up to 5 seconds to try to detect if the model is really loading,
   * or if it definitely failed.
   *
   * The tradeoff is that we'll have to wait for 5 seconds
   * while the model is "loading", while not really loading.
   *
   * In exchange, it will allow unloaded models to be correctly shown as "unloaded".
   */
  async pollStatus(startTime = Date.now()): Promise<void> {
    let elapsed = 0;
    const limit = 5000;

    // Grab the glitch
    while (Date.now() - startTime <= limit) {
      try {
        await this.server.fetchModelProps(this.id);
        break;
      } catch {
        elapsed += POLLING_INTERVAL;
        await new Promise((r) => setTimeout(r, POLLING_INTERVAL));
      }
    }

    const timeout = POLLING_TIMEOUT - elapsed;
    return await super.pollStatus(startTime, timeout);
  }

  /**
   * Gets the context size of a particular model.
   * In router mode, falls back to parsing CLI args when the model is unloaded.
   *
   * @returns The context size in tokens
   */
  async getContextSize(): Promise<number> {
    // We can get a more accurate context size if the model is already loaded
    if ((await this.getStatus()) === Status.LOADED) {
      return super.getContextSize();
    }

    const response =
      this.extractFrom("--ctx-size") ??
      this.extractFrom("--fit-ctx") ??
      DEFAULT_CTX;

    return response;
  }

  /**
   * Extracts the value from a llama-server argument
   * @param arg The argument
   * @returns The value
   */
  private extractFrom(arg: string): number | null {
    const args = this.model.status!.args;
    if (!args) return null;

    const ctxIdx = args.indexOf(arg);

    if (ctxIdx === -1) return null;
    if (args.length <= ctxIdx + 1) return null;

    const parsed = parseInt(args[ctxIdx + 1], 10);
    if (!isNaN(parsed)) return parsed;

    return null;
  }
}
