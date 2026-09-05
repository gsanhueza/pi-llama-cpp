/**
 * Identity of a llama.cpp server endpoint.
 *
 * Persisted counterpart: {@link LlamaServer} (`llamaSettings.servers`),
 * whose `url`/`id`/`name` map onto these fields.
 */
export interface ServerOptions {
  /**
   * Base URL of the llama.cpp server (e.g. "http://127.0.0.1:8080").
   */
  baseUrl: string;
  /**
   * Custom provider ID; falls back to a URL-based one.
   */
  customId?: string;
  /**
   * Custom provider name suffix; falls back to the base URL.
   */
  customName?: string;
}