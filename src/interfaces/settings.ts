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
   * Per-model token pricing for this server. Keys are **prefix filters** —
   * a model ID matches if it starts with the key. When multiple patterns
   * match, the **longest (most specific) match wins**.
   *
   * All four cost fields are optional — unspecified fields default to zero.
   *
   * Example:
   * ```json
   * {
   *   "llama": { "input": 0.01, "output": 0.02 },
   *   "llama-3": { "input": 0.05, "output": 0.1 },
   *   "llama-3-8b": { "input": 0.2, "output": 0.6, "cacheRead": 0.01 }
   * }
   * ```
   *
   * For model `"llama-3-8b"`:
   * - `"llama"` matches → cost `{ input: 0.01, output: 0.02 }`
   * - `"llama-3"` matches → cost `{ input: 0.05, output: 0.1 }`
   * - `"llama-3-8b"` matches → cost `{ input: 0.2, output: 0.6, cacheRead: 0.01 }`
   * - **Winner**: `"llama-3-8b"` (longest match)
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
