/**
 * Shared URL core: trims surrounding whitespace and strips trailing
 * slashes. Used by the settings parser (`parseUrls`) and the editor
 * validator (`normalizeServerUrl`) so the two can't drift.
 */
export const normalizeUrl = (raw: string): string =>
  raw.trim().replace(/\/+$/, "");

/**
 * True when the URL carries an http(s) scheme — the only schemes
 * llama-server endpoints use. Part of the shared validation applied by
 * both the settings parser (`parseUrls`) and the editor validator
 * (`normalizeServerUrl`).
 */
export const isValidServerUrl = (url: string): boolean =>
  /^https?:\/\//i.test(url);
