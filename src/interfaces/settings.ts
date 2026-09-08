import type { ModelCost } from "@earendil-works/pi-ai";
import type { SortBy } from "../constants";

/**
 * A description of a server in the "llamaSettings" key
 */
export interface LlamaServer {
  /**
   * The URL of the llama.cpp server.
   */
  url: string;
  /**
   * Custom provider ID for this server.
   */
  id?: string;
  /**
   * Custom display name for this server.
   */
  name?: string;
  /**
   * Per-model token pricing for this server. Keys are exact model IDs;
   * values define custom cost rates (input, output, cacheRead, cacheWrite).
   * All four fields are optional — unspecified fields default to zero.
   *
   * Example:
   * ```json
   * {
   *   "llama-3-8b": { "input": 0.2, "output": 0.6 },
   *   "llama-3-70b": { "input": 0.1, "output": 0.3, "cacheRead": 0.01 }
   * }
   * ```
   */
  costs?: Record<string, Partial<ModelCost>>;
}

/**
 * The main configuration interface for this extension
 *
 * E.g.:
 *
 * {
 *   "servers": [{
 *     "id": "server-a",
 *     "name": "Server A",
 *     "url": "http://localhost:8080"
 *   }],
 *   "reactToModelSelect": true
 *   "autoloadOnMessage": false
 *   "sortBy": "asc"
 * }
}
 */
export interface LlamaSettings {
  /**
   * List of servers to connect to.
   * @default []
   */
  servers?: LlamaServer[];
  /**
   * Whether to react to model selection events by loading the model.
   * @default true
   */
  reactToModelSelect?: boolean;
  /**
   * Whether to auto-load models when a message is sent.
   * @default false
   */
  autoloadOnMessage?: boolean;
  /**
   * Maximum time (ms) to wait for model loading before giving up.
   * @default 60000
   */
  pollingTimeout?: number;
  /**
   * Timeout (ms) for server verification and SSE support probe.
   * @default 1000
   */
  serverTimeout?: number;
  /**
   * How to sort models in the /models command.
   * @default "asc"
   */
  sortBy?: SortBy;
}
