import { POLLING_TIMEOUT, SERVER_TIMEOUT } from "../constants";
import { SSEClient } from "./client";
import {
  DownloadProgressData,
  ProgressData,
  SSECallback,
  SSECleanup,
  SSEEvent,
  SSEEventType,
  StatusChangeData,
} from "./types";

/**
 * Manages SSE connections and event routing for a single llama-server instance.
 *
 * Handles:
 * - Shared EventSource connection
 * - Model-based event subscription with callback aggregation
 * - Progress parsing and callback dispatch
 */
export class SSEManager {
  private sseClient: SSEClient | null = null;
  private sseSubscribers: Map<string, SSECleanup> = new Map();
  private modelCallbacks: Map<string, SSECallback[]> = new Map();
  private sseSupported: boolean | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  /**
   * The SSE endpoint URL.
   */
  private get sseEndpoint(): string {
    return `${this.baseUrl}/models/sse`;
  }

  /**
   * Probes the SSE endpoint to check if it's supported.
   * Result is cached for the lifetime of the manager.
   *
   * @returns true if SSE is supported
   */
  async probeSSE(): Promise<boolean> {
    if (this.sseSupported !== null) return this.sseSupported;

    try {
      let url = this.sseEndpoint;
      if (this.apiKey) {
        url = `${url}?api_key=${encodeURIComponent(this.apiKey)}`;
      }
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(SERVER_TIMEOUT),
      });
      this.sseSupported =
        response.ok &&
        !!response.headers.get("content-type")?.includes("text/event-stream");
    } catch {
      this.sseSupported = false;
    }

    return this.sseSupported;
  }

  /**
   * Subscribes to SSE events for a specific model.
   * Uses a shared SSE connection per server.
   * Aggregates multiple callbacks into one SSEClient subscription.
   *
   * @param modelId - The model ID to subscribe to
   * @param callback - Callback to receive SSE events
   * @returns A cleanup function to unsubscribe
   */
  private subscribeToSSE(
    modelId: string,
    callback: (event: SSEEvent) => void,
  ): SSECleanup {
    // Aggregate callbacks for this model
    const callbacks = this.modelCallbacks.get(modelId) ?? [];
    callbacks.push(callback);
    this.modelCallbacks.set(modelId, callbacks);

    // Create SSE client if not already created
    this.sseClient ??= new SSEClient(this.sseEndpoint, this.apiKey);

    // Subscribe a single dispatching callback to the SSE client
    if (!this.sseSubscribers.has(modelId)) {
      const dispatch = (event: SSEEvent) => {
        for (const cb of callbacks) cb(event);
      };
      const cleanup = this.sseClient!.subscribe(modelId, dispatch);
      this.sseSubscribers.set(modelId, cleanup);
    }

    return () => {
      const list = this.modelCallbacks.get(modelId);
      if (list) {
        const idx = list.indexOf(callback);
        if (idx !== -1) list.splice(idx, 1);
        if (list.length === 0) {
          this.modelCallbacks.delete(modelId);
          const cleanup = this.sseSubscribers.get(modelId);
          if (cleanup) cleanup();
          this.sseSubscribers.delete(modelId);
        }
      }
    };
  }

  /**
   * Subscribes to SSE progress events for a specific model.
   * Parses SSE events and calls the progress callback with percentage and stage.
   *
   * @param modelId - The model ID to subscribe to
   * @param onProgress - Callback to receive progress updates (percentage 0-100, stage name)
   * @returns A cleanup function to unsubscribe
   */
  subscribeToProgress(
    modelId: string,
    onProgress: (percentage: number, stage?: string) => void,
  ): SSECleanup {
    // Track download progress across multiple URLs
    let totalDownloaded = 0;
    let totalToDownload = 0;

    return this.subscribeToSSE(modelId, (event: SSEEvent) => {
      if (event.event === SSEEventType.status_change && event.data) {
        const data = event.data as unknown as StatusChangeData;

        if (data.status === "loading" && data.progress) {
          const progress = data.progress as ProgressData;
          const percentage = Math.round(progress.value * 100);
          onProgress(percentage, progress.current);
        } else if (data.status === "loaded" || data.status === "failed") {
          // Reset download tracking on final state
          totalDownloaded = 0;
          totalToDownload = 0;
        }
      } else if (event.event === SSEEventType.download_progress && event.data) {
        const downloadData = event.data as DownloadProgressData;
        totalDownloaded = 0;
        totalToDownload = 0;

        for (const urlData of Object.values(downloadData)) {
          totalDownloaded += urlData.done;
          totalToDownload += urlData.total;
        }

        if (totalToDownload > 0) {
          const percentage = Math.round(
            (totalDownloaded / totalToDownload) * 100,
          );
          onProgress(percentage, "downloading");
        }
      }
    });
  }

  /**
   * Subscribes to SSE status change events for a specific model.
   * Resolves with the final status string once the model reaches a terminal state.
   * Rejects immediately if the connection fails before any event is received.
   *
   * @param modelId - The model ID to subscribe to
   * @returns Promise that resolves with the final status string
   */
  subscribeToStatus(modelId: string): Promise<StatusChangeData> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`SSE status timeout for model: ${modelId}`)),
        POLLING_TIMEOUT,
      );

      this.subscribeToSSE(modelId, (event: SSEEvent) => {
        if (event.event === SSEEventType.status_change && event.data) {
          const data = event.data as unknown as StatusChangeData;
          if (["loaded", "unloaded", "failed"].includes(data.status)) {
            clearTimeout(timeout);
            resolve(data);
          }
        }
      });

      // Reject immediately if the connection fails before any event is received
      this.sseClient?.setOnConnectFailed(() => {
        clearTimeout(timeout);
        reject(new Error(`SSE connection failed for model: ${modelId}`));
      });
    });
  }

  /**
   * Disconnects the SSE client and cleans up all subscriptions.
   */
  disconnect(): void {
    for (const cleanup of this.sseSubscribers.values()) {
      cleanup();
    }
    this.sseSubscribers.clear();
    this.modelCallbacks.clear();
    if (this.sseClient) {
      this.sseClient.disconnect();
      this.sseClient = null;
    }
  }
}
