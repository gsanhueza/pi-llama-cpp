import { PROVIDER_PREFIX } from "../constants";

/**
 * Resolves a server's provider ID: the custom ID when set, otherwise the
 * URL-derived ID (`${PROVIDER_PREFIX}=<url>`).
 *
 * Single home for the rule shared by `Server.providerId` (runtime) and
 * `ServerDisplay.suffix` (editor display row), so the ID shown in the
 * editors can't drift from the one used at request time.
 */
export class ServerIds {
  /** The URL-derived ID: `<PROVIDER_PREFIX>=<url>`. */
  static fromUrl(url: string): string {
    return `${PROVIDER_PREFIX}=${url}`;
  }

  /** The effective provider ID: `customId` when set, else URL-derived. */
  static resolve(url: string, customId?: string): string {
    return customId ?? this.fromUrl(url);
  }
}
