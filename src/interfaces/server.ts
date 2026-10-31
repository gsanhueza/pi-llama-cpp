import type { ModelOverride } from "./settings";

/**
 * Minimal settings resolver for {@link Server}, `SSEManager`, and
 * `Model`. Decouples all components from `SettingsService` —
 * consumers depend on this interface, not on the settings service.
 * Implemented by `SettingsService`.
 */
export interface ServerSettingsResolver {
  /**
   * Maximum time (ms) for server verification and SSE support probe.
   */
  resolveServerTimeout(): Promise<number>;
  /**
   * Time (ms) between status checks during load/unload.
   */
  resolvePollingInterval(): Promise<number>;
  /**
   * Maximum time (ms) to wait for model loading before giving up.
   */
  resolvePollingTimeout(): Promise<number>;
  /**
   * Resolves the API key stored for a provider ID.
   */
  resolveApiKey(providerId: string): string;
  /**
   * Resolves the values of a server's custom headers (literal, `$VAR`,
   * `${VAR}`, or `!command`). `$VAR` resolves against the provider's
   * credential `env` first, then `process.env`.
   * Headers that can't be resolved are left out; returns `undefined`
   * when none remain.
   */
  resolveHeaders(
    providerId: string,
    headers?: Record<string, string>,
  ): Record<string, string> | undefined;
  /**
   * Resolves whether SSE is enabled for model loading.
   */
  resolveEnableSSE(): Promise<boolean>;
}

/**
 * Identity of a llama.cpp server endpoint.
 *
 * Persisted counterpart: {@link LlamaServer} (`llamaSettings.servers`),
 * whose `url`/`id`/`name` map onto these fields.
 */
export interface ServerOptions {
  /**
   * Base URL of the llama.cpp server (e.g. "http://127.0.0.1:9931").
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
  /**
   * Custom HTTP headers from `llamaSettings.servers`, as written in the
   * settings (unresolved). Resolve them with
   * {@link ServerSettingsResolver.resolveHeaders}.
   */
  headers?: Record<string, string>;
  /**
   * Per-model overrides resolved from `llamaSettings.servers`. See
   * {@link ModelOverride} for the fallback semantics of each field.
   */
  overrides?: Record<string, ModelOverride>;
}
