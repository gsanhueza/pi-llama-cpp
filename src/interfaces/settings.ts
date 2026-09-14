import type { ModelCost, OpenAICompletionsCompat } from "@earendil-works/pi-ai";
import type { SortBy } from "../constants";

/**
 * Per-model overrides applied on top of what llama-server reports.
 * Every field is optional — absent fields fall back to detection/defaults.
 */
export interface ModelOverride {
  /**
   * Per-model token pricing. All four cost fields are optional —
   * unspecified fields default to zero.
   */
  cost?: Partial<ModelCost>;
  /**
   * Pi capabilities for the model. When present, **fully replaces** the
   * capabilities detected from the server (no merging).
   */
  capabilities?: ("text" | "image")[];
  /**
   * Whether the model is a reasoning model. When absent, defaults to `true`.
   */
  reasoning?: boolean;
  /**
   * Override the model's context size (in tokens), replacing the value
   * autodetected from the server. When absent or `0`, falls back to
   * detection (then `FALLBACK_CTX`).
   */
  contextSize?: number;
  /**
   * Override the maximum number of tokens the model can generate. When
   * absent, falls back to the context size detected from the server.
   */
  maxTokens?: number;
  /**
   * OpenAI-compatible provider compatibility settings. Merged with any
   * provider-level compat when the model is registered with Pi.
   */
  compat?: Partial<OpenAICompletionsCompat>;
}

/**
 * A description of a server in the "llamaSettings" key
 */
export interface LlamaServer {
  /**
   * The URL of the llama.cpp server. Must be the bare origin — the
   * OpenAI-compatible API is assumed under `/v1` (see {@link ENDPOINT_PREFIX}).
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
   * Per-model overrides for this server. Keys are **prefix filters** —
   * a model ID matches if it starts with the key. When multiple patterns
   * match, the **longest (most specific) match wins**.
   *
   * All fields of an override are optional — absent fields fall back to
   * detection (`capabilities`) or defaults (`reasoning: true`, zero costs).
   *
   * Example:
   * ```json
   * {
   *   "llama": { "cost": { "input": 0.01, "output": 0.02 } },
   *   "llama-3": { "reasoning": false },
   *   "llama-3-8b": {
   *     "cost": { "input": 0.2, "output": 0.6, "cacheRead": 0.01 },
   *     "capabilities": ["text", "image"]
   *   }
   * }
   * ```
   *
   * For model `"llama-3-8b"`:
   * - `"llama"` matches → cost `{ input: 0.01, output: 0.02 }`
   * - `"llama-3"` matches → reasoning `false`
   * - `"llama-3-8b"` matches → cost + capabilities fully replaced
   * - **Winner**: `"llama-3-8b"` (longest match)
   */
  overrides?: Record<string, ModelOverride>;
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
