import { POLLING_TIMEOUT } from "../constants";
import { SSEClient } from "./client";
import {
  DownloadProgressData,
  ProgressData,
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
 * - Model-based event subscription
 * - Progress parsing and callback dispatch
 */
export class SSEManager {
  private sseClient: SSEClient | null = null;
  private sseSubscribers: Map<string, SSECleanup> = new Map();

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  /**
   * Subscribes to SSE events for a specific model.
   * Uses a shared SSE connection per server.
   *
   * @param modelId - The model ID to subscribe to
   * @param callback - Callback to receive SSE events
   * @returns A cleanup function to unsubscribe
   */
  subscribeToSSE(
    modelId: string,
    callback: (event: SSEEvent) => void,
  ): SSECleanup {
    // Create SSE client if not already created
    if (!this.sseClient) {
      this.sseClient = new SSEClient(this.baseUrl, this.apiKey);
    }

    // Subscribe to events (auto-connects if needed)
    const cleanup = this.sseClient.subscribe(modelId, callback);
    this.sseSubscribers.set(modelId, cleanup);

    return () => {
      this.sseSubscribers.delete(modelId);
      cleanup();
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
   *
   * @param modelId - The model ID to subscribe to
   * @returns Promise that resolves with the final status string
   */
  subscribeToStatus(modelId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`SSE status timeout for model: ${modelId}`)),
        POLLING_TIMEOUT,
      );

      this.subscribeToSSE(modelId, (event: SSEEvent) => {
        if (
          event.event === SSEEventType.status_change &&
          event.data
        ) {
          const data = event.data as unknown as StatusChangeData;
          if (data.status === "loaded" || data.status === "failed") {
            clearTimeout(timeout);
            resolve(data.status);
          }
        }
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
    if (this.sseClient) {
      this.sseClient.disconnect();
      this.sseClient = null;
    }
  }
}
