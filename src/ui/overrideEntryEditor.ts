import type { ModelCost, ModelCostRates } from "@earendil-works/pi-ai";
import type { LlamaServer, ModelOverride } from "../interfaces/settings";

/**
 * Parses a raw cost-field value. Empty input means zero (treated as unset
 * — the key is removed from the settings). Everything else must be a
 * finite, non-negative number.
 *
 * @returns The parsed value, or `null` when the input is invalid
 */
export const parseCostValue = (raw: string): number | null => {
  const v = raw.trim();
  if (v.length === 0) return 0;
  const n = Number(v);
  if (isNaN(n) || !isFinite(n) || n < 0) return null;
  return n;
};

/**
 * Returns a copy of `cost` with `field` set to `value`. A `0` (or
 * non-finite) value removes the field — unset cost fields default to
 * zero at read time — and when no fields remain, returns `undefined` so
 * the whole `cost` object can be dropped. Immutable.
 */
export const applyCostFieldValue = (
  cost: ModelOverride["cost"],
  field: keyof ModelCostRates,
  value: number,
): Partial<ModelCost> | undefined => {
  const next = { ...cost };
  if (isFinite(value) && value > 0) next[field] = value;
  else delete next[field];
  return Object.keys(next).length > 0 ? next : undefined;
};

/**
 * Returns a new list with the server at `serverIndex` updated so its
 * `overrides` map gains a new `pattern → override` entry. Immutable.
 */
export const addOverrideEntry = (
  servers: LlamaServer[],
  serverIndex: number,
  pattern: string,
  override: ModelOverride = {},
): LlamaServer[] =>
  servers.map((server, i) => {
    if (i !== serverIndex) return server;
    const overrides = { ...server.overrides, [pattern]: override };
    return { ...server, overrides };
  });

/**
 * Returns a new list with the override entry at `entryIndex` (within the
 * server's overrides map) replaced by `pattern → override` in a single
 * mutation — used both for renaming the pattern and for editing its
 * fields. The entry keeps its position in the map's iteration order.
 * Immutable.
 */
export const updateOverrideEntry = (
  servers: LlamaServer[],
  serverIndex: number,
  entryIndex: number,
  pattern: string,
  override: ModelOverride,
): LlamaServer[] =>
  servers.map((server, i) => {
    if (i !== serverIndex) return server;
    const overrides = server.overrides ?? {};
    const entries = Object.entries(overrides).map(([k, v], j) =>
      j === entryIndex ? [pattern, override] : [k, v],
    );
    return { ...server, overrides: Object.fromEntries(entries) };
  });

/**
 * Returns a new list with the override entry at `entryIndex` (within the
 * server's overrides map) removed. Immutable.
 */
export const removeOverrideEntry = (
  servers: LlamaServer[],
  serverIndex: number,
  entryIndex: number,
): LlamaServer[] =>
  servers.map((server, i) => {
    if (i !== serverIndex) return server;
    const overrides = server.overrides ?? {};
    const entries = Object.entries(overrides).filter(
      (_, j) => j !== entryIndex,
    );
    return { ...server, overrides: Object.fromEntries(entries) };
  });

/**
 * Formats an override as a summary shown in the entry rows:
 * `input: $0.2, output: $0.6, cache read: $0.01, capabilities: text,image,
 * reasoning: false` — cost fields that are zero or undefined are omitted
 * for brevity; `—` when everything is empty.
 */
export const formatOverrideSummary = (override: ModelOverride): string => {
  const parts: string[] = [];
  const cost = override.cost ?? {};
  if (cost.input) parts.push(`input: $${cost.input}`);
  if (cost.output) parts.push(`output: $${cost.output}`);
  if (cost.cacheRead) parts.push(`cache read: $${cost.cacheRead}`);
  if (cost.cacheWrite) parts.push(`cache write: $${cost.cacheWrite}`);
  if (override.capabilities?.length) {
    parts.push(`capabilities: ${override.capabilities.join(",")}`);
  }
  if (override.reasoning !== undefined) {
    parts.push(`reasoning: ${override.reasoning}`);
  }
  if (override.contextSize !== undefined) {
    parts.push(`contextSize: ${override.contextSize}`);
  }
  if (override.maxTokens !== undefined) {
    parts.push(`maxTokens: ${override.maxTokens}`);
  }
  return parts.length > 0 ? parts.join(", ") : "—";
};
