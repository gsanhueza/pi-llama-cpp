/**
 * Shared URL core: trims surrounding whitespace and strips trailing
 * slashes. Used by the settings parser (`parseUrls`) and the editor
 * validator (`normalizeServerUrl`) so the two can't drift.
 */
export const normalizeUrl = (raw: string): string =>
  raw.trim().replace(/\/+$/, "");
