import { ENDPOINT_PREFIX } from "../../../constants";
import { ServerStatus } from "../../../enums/serverStatus";
import type { LlamaServer } from "../../../interfaces/settings";
import { checkServerHealth } from "../../../utils/health";
import { ServerIds } from "../../../utils/serverIds";

/** Emoji shown when a server requires an API key (401 on /v1/models). */
const UNAUTHORIZED_EMOJI = "⛔";

/**
 * Display concerns for a server row in the top-level list: the dim
 * `(...)` suffix after the URL and the health-status icon.
 */
export class ServerDisplay {
  /**
   * Formats the dim `(...)` suffix shown after a server's URL:
   * `(<id> - <name>)`, with the auto-detected URL-based id used when no
   * custom id override exists (mirrors `Server.providerId`). Returns the
   * empty string when there is nothing to show.
   */
  static suffix(server: LlamaServer): string {
    if (!server.id && !server.name) return "";
    const id = ServerIds.resolve(server.url, server.id);
    return server.name ? `(${id} - ${server.name})` : `(${server.id})`;
  }

  /**
   * Checks the health of a server and returns the corresponding emoji.
   *
   * Delegates the probe/classification to the shared `checkServerHealth`
   * (`utils/health`) — this wrapper only maps the status to its icon.
   *
   * @param url - The server URL to check
   * @param timeout - Maximum time (ms) to wait for the health check
   * @returns The health emoji for the server status
   */
  static async healthEmoji(url: string, timeout: number): Promise<string> {
    return SERVER_STATUS_ICONS[await checkServerHealth(url, timeout)];
  }

  /**
   * Checks if the server requires an API key by probing `/v1/models`.
   *
   * @param url - The server URL to check
   * @param apiKey - The API key to send (may be a placeholder)
   * @param timeout - Maximum time (ms) to wait for the request
   * @returns `true` if the server responded with 401, `false` otherwise
   */
  static async requiresApiKey(
    url: string,
    apiKey: string,
    timeout: number,
  ): Promise<boolean> {
    try {
      const response = await fetch(`${url}${ENDPOINT_PREFIX}/models`, {
        signal: AbortSignal.timeout(timeout),
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return response.status === 401;
    } catch {
      // Timeout or network error — the server is unreachable, so no auth
      // indicator is needed (the health emoji will cover that).
      return false;
    }
  }

  /**
   * Probes the server's `/v1/models` endpoint to check if authentication
   * is required. Returns ⛔ when the server responds with 401, empty string
   * otherwise.
   *
   * @param url - The server URL to check
   * @param apiKey - The API key to send (may be a placeholder)
   * @param timeout - Maximum time (ms) to wait for the request
   * @returns The emoji indicator (⛔ if 401, "" otherwise)
   */
  static async authEmoji(
    url: string,
    apiKey: string,
    timeout: number,
  ): Promise<string> {
    return (await this.requiresApiKey(url, apiKey, timeout))
      ? UNAUTHORIZED_EMOJI
      : "";
  }
}

/**
 * Emoji indicators for server health status.
 */
const SERVER_STATUS_ICONS: Record<ServerStatus, string> = {
  [ServerStatus.READY]: "🟢",
  [ServerStatus.TIMEOUT]: "🟡",
  [ServerStatus.UNREACHABLE]: "🔴",
};
