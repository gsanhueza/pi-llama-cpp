/**
 * SSE event types from llama-server's /models/sse endpoint
 */

/**
 * Possible event types from the SSE stream
 */
export const SSEEventType = {
  status_change: "status_change",
  download_progress: "download_progress",
  download_finished: "download_finished",
  download_failed: "download_failed",
  models_reload: "models_reload",
  model_remove: "model_remove",
} as const;

export type SSEEventType = (typeof SSEEventType)[keyof typeof SSEEventType];

/**
 * A parsed SSE event from the /models/sse endpoint
 */
export interface SSEEvent {
  event: SSEEventType;
  model: string; // model ID or "*" for global events
  data?: Record<string, unknown>;
}

/**
 * Progress data sent during model loading
 */
export interface ProgressData {
  stages: string[];
  current: string;
  value: number; // 0.0 to 1.0
}

/**
 * Data payload for status_change events
 */
export interface StatusChangeData {
  status: string;
  exit_code?: number;
  info?: Record<string, unknown>;
  progress?: ProgressData;
}

/**
 * Data payload for download_progress events
 */
export interface DownloadProgressData {
  [url: string]: {
    done: number;
    total: number;
  };
}

/**
 * Subscriber callback type for SSE events
 */
export type SSECallback = (event: SSEEvent) => void;

/**
 * Cleanup function to unsubscribe from SSE events
 */
export type SSECleanup = () => void;
