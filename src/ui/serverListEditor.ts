import { PROVIDER_PREFIX } from "../constants";
import { ServerStatus } from "../enums/serverStatus";
import type { LlamaServer } from "../interfaces/settings";
import { normalizeUrl } from "../utils/urls";

/**
 * Validates and normalizes a user-entered server URL: trims whitespace and
 * strips trailing slashes (shared core in `utils/urls` — the same treatment
 * the settings parser applies), then rejects empty strings, semicolons (the
 * settings parser splits on them — use separate entries) and values without
 * an http(s) scheme.
 *
 * @returns The normalized URL, or `null` when the input is invalid
 */
export const normalizeServerUrl = (raw: string): string | null => {
  const url = normalizeUrl(raw);
  if (url.length === 0 || url.includes(";") || !/^https?:\/\//i.test(url)) {
    return null;
  }
  return url;
};

/**
 * Formats the dim `(...)` suffix shown after a server's URL:
 * `(<id> - <name>)`, with the auto-detected URL-based id used when no
 * custom id override exists (mirrors `Server.providerId`). Returns the
 * empty string when there is nothing to show.
 */
export const formatServerSuffix = (server: LlamaServer): string => {
  if (!server.id && !server.name) return "";
  const id = server.id ?? `${PROVIDER_PREFIX}=${server.url}`;
  return server.name ? `(${id} - ${server.name})` : `(${server.id})`;
};

/**
 * Emoji indicators for server health status.
 */
const SERVER_STATUS_ICONS: Record<ServerStatus, string> = {
  [ServerStatus.READY]: "🟢",
  [ServerStatus.TIMEOUT]: "🟡",
  [ServerStatus.UNREACHABLE]: "🔴",
};

/**
 * Checks the health of a server and returns the corresponding emoji.
 *
 * @param url - The server URL to check
 * @param timeout - Maximum time (ms) to wait for the health check
 * @returns The health emoji for the server status
 */
export const getServerHealthEmoji = async (
  url: string,
  timeout: number,
): Promise<string> => {
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(timeout),
    });
    const data = (await response.json()) as { status?: string };
    return data.status === "ok"
      ? SERVER_STATUS_ICONS[ServerStatus.READY]
      : SERVER_STATUS_ICONS[ServerStatus.UNREACHABLE];
  } catch (error) {
    // `AbortSignal.timeout` rejects `fetch` with a `TimeoutError` DOMException
    // (some runtimes surface it as `AbortError` with a timeout message).
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return isTimeout
      ? SERVER_STATUS_ICONS[ServerStatus.TIMEOUT]
      : SERVER_STATUS_ICONS[ServerStatus.UNREACHABLE];
  }
};
