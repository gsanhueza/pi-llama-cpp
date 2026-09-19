/**
 * Shared server-URL handling: the single place where normalization and
 * validation live, used by the settings parser (`UrlResolver.parseUrls`,
 * see `utils/urlResolver`) and the editor field validator
 * (`ServerFields`) so the two can't drift.
 */
export class ServerUrl {
  /** Trims surrounding whitespace and strips trailing slashes — the
   * same treatment the settings parser applies. */
  static normalize(raw: string): string {
    return raw.trim().replace(/\/+$/, "");
  }

  /** True when the URL carries an http(s) scheme — the only schemes
   * llama-server endpoints use. */
  static isValid(url: string): boolean {
    return /^https?:\/\//i.test(url);
  }

  /**
   * Validates and normalizes a user-entered server URL: `normalize`,
   * then rejects empty strings, semicolons (the settings parser splits
   * on them — use separate entries) and values without an http(s) scheme.
   *
   * @returns The normalized URL, or `null` when the input is invalid
   */
  static parse(raw: string): string | null {
    // Reference the class explicitly (not `this`) so `parse` can be
    // passed around as a bare callback (e.g. as a field validator)
    const url = ServerUrl.normalize(raw);
    if (url.length === 0 || url.includes(";") || !ServerUrl.isValid(url)) {
      return null;
    }
    return url;
  }
}
