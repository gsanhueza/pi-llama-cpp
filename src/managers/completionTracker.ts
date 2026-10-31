/**
 * Info about a tracked chat completion, needed to send control requests.
 */
export interface CompletionInfo {
  modelId: string;
  serverUrl: string;
  completionId: string;
  providerId: string;
}

/**
 * Tracks the latest chat completion with all info needed to rush it.
 *
 * Populated by the `provider_stream_event` listener in `EventManager` —
 * stores the most recent completion so the `rush` command can fire the
 * control request without any lookups.
 */
export class CompletionTracker {
  /** Latest completion info, or `undefined` if none tracked. */
  completion?: CompletionInfo;

  /**
   * Records a completion for a model on a server.
   *
   * @param modelId - The model identifier
   * @param serverUrl - The server base URL
   * @param completionId - The completion ID from the SSE stream
   * @param providerId - The provider ID for credential resolution
   */
  set(info: CompletionInfo): void {
    this.completion = info;
  }

  /**
   * Clears the tracked completion.
   */
  reset(): void {
    this.completion = undefined;
  }
}
