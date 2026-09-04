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
   */
  servers: LlamaServer[];
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
  sortBy?: "asc" | "desc" | "asc-name" | "desc-name" | "api";
}
