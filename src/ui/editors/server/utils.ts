import { ServerStatus } from "../../../enums/serverStatus";
import type { LlamaServer } from "../../../interfaces/settings";
import { checkServerHealth } from "../../../utils/health";
import { ServerIds } from "../../../utils/serverIds";

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
}

/**
 * Emoji indicators for server health status.
 */
const SERVER_STATUS_ICONS: Record<ServerStatus, string> = {
  [ServerStatus.READY]: "🟢",
  [ServerStatus.TIMEOUT]: "🟡",
  [ServerStatus.UNREACHABLE]: "🔴",
};
