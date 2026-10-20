import { ApiClient } from "../../../api/client";
import { Server } from "../../../servers/server";
import { ServerStatus } from "../../../enums/serverStatus";
import type { LlamaServer } from "../../../interfaces/settings";
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
   * Delegates the probe/classification to `Server.check` — this wrapper
   * only maps the status to its icon.
   *
   * @param client ApiClient configured with the server URL and auth key
   * @param timeout - Maximum time (ms) for the health check
   * @returns The emoji indicator for the server status
   */
  static async healthEmoji(
    client: ApiClient,
    timeout: number,
  ): Promise<string> {
    return SERVER_STATUS_ICONS[await Server.check(client, timeout)];
  }
}

/**
 * Emoji indicators for server health status.
 */
export const SERVER_STATUS_ICONS: Record<ServerStatus, string> = {
  [ServerStatus.READY]: "🟢",
  [ServerStatus.TIMEOUT]: "🟡",
  [ServerStatus.UNREACHABLE]: "🔴",
  [ServerStatus.UNAUTHORIZED]: "⛔",
};
