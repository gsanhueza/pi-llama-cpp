/**
 * This provider's base ID
 */
export const PROVIDER_PREFIX = "llama-server";

/**
 * This provider's name
 */
export const PROVIDER_NAME = "Llama.cpp";

/**
 * The default API type used in Pi
 */
export const API_TYPE = "openai-completions";

/**
 * The placeholder api-key if it couldn't be resolved
 */
export const API_KEY_PLACEHOLDER = "sk-placeholder";

/**
 * The default URL if the resolver couldn't find it
 */
export const DEFAULT_LLAMA_SERVER_URL = "http://127.0.0.1:8080";

/**
 * The default context if the server didn't expose it
 */
export const DEFAULT_CTX = 128000;

/**
 * Polling interval (ms) for checking model load status
 */
export const POLLING_INTERVAL = 500;

/**
 * Maximum time (ms) to wait for model loading before giving up
 */
export const POLLING_TIMEOUT = 60000;

/**
 * Reasonable time (ms) to read notifications if context goes stale
 */
export const READABLE_TIMEOUT = 15000;

/**
 * Timeout (ms) for server verification and SSE support probe
 */
export const SERVER_TIMEOUT = 1000;

/**
 * Thinking budgets to send to the server, depending on user-selected level in Pi.
 */
export const DEFAULT_THINKING_BUDGETS = {
  off: 0,
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: -1,
};
