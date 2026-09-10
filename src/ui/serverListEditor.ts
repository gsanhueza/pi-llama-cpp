import { PROVIDER_PREFIX } from "../constants";
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
