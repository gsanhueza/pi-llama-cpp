import { POLLING_INTERVAL } from "../constants";
import type { SSECallback, SSECleanup, SSEEvent } from "./types";

/**
 * SSE client for llama-server's /models/sse endpoint.
 *
 * Uses a single shared EventSource per server instance.
 * Supports multiple model subscriptions with automatic event routing.
 * Handles reconnection by re-subscribing all callbacks.
 */
export class SSEClient {
  private eventSource: EventSource | null = null;
  private subscribers: Map<string, SSECallback> = new Map();
  private connected: boolean = false;
  private reconnecting: boolean = false; // tracks if EventSource auto-reconnect is in progress
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
   * Connects to the SSE endpoint.
   *
   * @returns true if the connection was established successfully
   */
  async connect(): Promise<boolean> {
    if (this.connected) return true;

    const url = this.buildUrl();

    try {
      this.eventSource = new EventSource(url);
    } catch {
      this.connected = false;
      return false;
    }

    this.eventSource.onopen = () => {
      this.connected = true;
      this.reconnecting = false;
    };

    this.eventSource.onerror = () => {
      // EventSource will auto-reconnect; we just track state
      this.connected = false;
      this.reconnecting = true;

      // Notify subscriber if connection fails before any event is received
      if (!this._hasReceivedEvents && this._onConnectFailed) {
        this._onConnectFailed();
      }
    };

    this.eventSource.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
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
    };

    // Wait a bit for the connection to establish
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), POLLING_INTERVAL);
      this.eventSource!.onopen = () => {
        clearTimeout(timeout);
        this.connected = true;
        this.reconnecting = false;
        resolve();
      };
    });

    return this.connected;
  }

  /**
   * Sets a callback to be called when the connection fails before
   * any event is received. Useful for rejecting promises early.
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
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connected = false;
    this.subscribers.clear();
  }

  /**
   * Builds the full URL with optional API key query param.
   */
  private buildUrl(): string {
    if (this.apiKey) {
      return `${this.sseEndpoint}?api_key=${encodeURIComponent(this.apiKey)}`;
    }
    return this.sseEndpoint;
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
