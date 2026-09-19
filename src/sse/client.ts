import { POLLING_INTERVAL } from "../constants";
import { openSSEStream } from "./fetch";
import type { SSECallback, SSECleanup, SSEEvent } from "./types";

/**
 * SSE client for llama-server's /models/sse endpoint.
 *
 * Uses a single shared stream per server instance, consumed with `fetch`
 * (EventSource cannot send the API key as a header, and llama-server no
 * longer accepts it as a query parameter — see `fetch.ts`).
 * Supports multiple model subscriptions with automatic event routing.
 * Handles reconnection by re-subscribing all callbacks.
 */
export class SSEClient {
  private abortController: AbortController | null = null;
  private disposed: boolean = false;
  private subscribers: Map<string, SSECallback> = new Map();
  private connected: boolean = false;
  private reconnecting: boolean = false; // tracks if reconnect is in progress
  /**
   * Single shared slot — each setOnConnectFailed call overwrites the
   * previous callback (see there for the constraint this imposes).
   */
  private _onConnectFailed: (() => void) | null = null;
  private _hasReceivedEvents: boolean = false;

  /**
   * @param sseEndpoint - The full SSE endpoint URL (e.g., "http://127.0.0.1:8080/models/sse")
   * @param apiKey - Optional API key for authenticated servers
   */
  constructor(
    private readonly sseEndpoint: string,
    private readonly apiKey?: string,
  ) {}

  /**
   * Waits the given amount of time (used between reconnection attempts).
   */
  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Connects to the SSE endpoint and keeps it open, reconnecting with a
   * fixed delay until `disconnect()` is called.
   *
   * No current caller consumes the result: `subscribe()` triggers the
   * connection without awaiting it, and connection failures before the
   * first event are surfaced through the `setOnConnectFailed` callback.
   *
   * @returns true if the connection was established successfully
   */
  private async connect(): Promise<boolean> {
    if (this.connected) return true;
    this.disposed = false;

    // Loop-local so a stale, already-aborted controller from a previous
    // connection can't be confused with the current one after a revival.
    let abortController: AbortController | null = this.abortController;

    while (!this.disposed) {
      if (abortController?.signal.aborted) return false;
      abortController = new AbortController();
      this.abortController = abortController;

      let body: ReadableStream<Uint8Array>;
      try {
        body = await openSSEStream(
          this.sseEndpoint,
          this.apiKey,
          abortController.signal,
        );
      } catch {
        if (this.disposed || abortController.signal.aborted) return false;
        this.notifyConnectFailed();
        this.reconnecting = true;
        await this.delay(POLLING_INTERVAL);
        continue;
      }

      this.connected = true;
      this.reconnecting = false;

      await this.consume(body);

      if (this.disposed || abortController.signal.aborted) return false;
      // Stream ended (server closed or network error): reconnect
      this.reconnecting = true;
      await this.delay(POLLING_INTERVAL);
    }

    return false;
  }

  /**
   * Reads the raw byte stream, parses the SSE framing and dispatches
   * `data:` payloads. Resolves when the stream ends or errors.
   */
  private async consume(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          this.handleLine(line);
        }
      }
      // Flush a trailing data line that lacked its event-terminating newline
      if (buffer) this.handleLine(buffer);
    } catch {
      // Stream aborted or network error — handled by the reconnect logic
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Handles a single SSE line, dispatching `data:` payloads as events.
   */
  private handleLine(line: string): void {
    if (!line.startsWith("data:")) return;

    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;

    try {
      const data = JSON.parse(payload);
      const sseEvent: SSEEvent = {
        event: data.event ?? "unknown",
        model: data.model ?? "*",
        data: data.data,
      };
      this._hasReceivedEvents = true;
      this.dispatch(sseEvent);
    } catch {
      // Invalid JSON, ignore
    }
  }

  /**
   * Notifies the connect-failed callback if the connection failed before
   * any event was received.
   */
  private notifyConnectFailed(): void {
    if (!this._hasReceivedEvents && this._onConnectFailed) {
      this._onConnectFailed();
    }
  }

  /**
   * Sets a callback to be called when the connection fails before
   * any event is received. Useful for rejecting promises early.
   *
   * Single shared slot: each call overwrites the previous callback, so at
   * most one caller may depend on it at a time. The only caller today is
   * `SSEManager.subscribeToStatus`, which must therefore not be invoked
   * twice concurrently on the same client — the second registration would
   * take over the failure signal and the first promise would only reject
   * via its own timeout.
   *
   * @param callback - Called once when connection fails
   */
  setOnConnectFailed(callback: () => void): void {
    this._onConnectFailed = callback;
  }

  /**
   * Subscribes to SSE events for a specific model.
   * Auto-connects if not already connected.
   *
   * @param modelId - The model ID to subscribe to
   * @param callback - Callback to receive SSE events
   * @returns A cleanup function to unsubscribe
   */
  subscribe(modelId: string, callback: SSECallback): SSECleanup {
    this.subscribers.set(modelId, callback);

    if (!this.connected && !this.reconnecting) {
      this.connect();
    }

    return () => {
      this.subscribers.delete(modelId);
    };
  }

  /**
   * Disconnects from the SSE endpoint and clears all subscriptions.
   */
  disconnect(): void {
    this.disposed = true;
    this.abortController?.abort();
    this.abortController = null;
    this.connected = false;
    this.reconnecting = false;
    this.subscribers.clear();
  }

  /**
   * Dispatches an SSE event to all matching subscribers.
   */
  private dispatch(event: SSEEvent): void {
    // Dispatch to model-specific subscriber
    const modelCallback = this.subscribers.get(event.model);
    if (modelCallback) {
      modelCallback(event);
    }

    // Also dispatch to wildcard subscriber if present
    const wildcardCallback = this.subscribers.get("*");
    if (wildcardCallback && event.model !== "*") {
      wildcardCallback(event);
    }
  }
}
