import type { LlamaServer, ModelOverride } from "../../../interfaces/settings";
import { OverrideEntry } from "./entry";
import { OverrideFields } from "./fields";

/** Result of applying a field change: the next server list and the
 * updated override for UI refresh. `null` when the entry doesn't exist
 * (stale index — a no-op). */
export interface MutationResult {
  next: LlamaServer[];
  updatedOverride: ModelOverride;
}

/**
 * Applies edits (field commits, entry adds/renames/removals) to the
 * override entries of a single server, immutably. Binds the server list
 * and server index once in the constructor so call sites don't juggle
 * long positional lists.
 *
 * Per-field commit behavior lives in the {@link OverrideFields} registry
 * (`apply` on each field instance) — this class only resolves the field
 * and the entry, and handles the pattern rename specially.
 */
export class OverrideEntryMutator {
  constructor(
    private readonly servers: LlamaServer[],
    private readonly serverIndex: number,
  ) {}

  /** The server's override entries, in map iteration order. */
  entries(): OverrideEntry[] {
    return OverrideEntry.listFrom(this.servers[this.serverIndex]);
  }

  /** Handles a field commit from an override entry's submenu. Returns
   * `null` when the entry doesn't exist (stale index — no-op). */
  applyFieldChange(
    entryIndex: number,
    field: string,
    value: string,
  ): MutationResult | null {
    const entry = this.entries()[entryIndex];
    if (!entry) return null;

    // Pattern field: rename the pattern key, keep the override object
    if (field === "pattern") {
      return {
        next: this.updateEntry(entryIndex, value, entry.override),
        updatedOverride: entry.override,
      };
    }

    // Other fields: let the field definition apply itself
    const updatedOverride: ModelOverride = { ...entry.override };
    OverrideFields.byId(field).apply(updatedOverride, value);

    return {
      next: this.updateEntry(entryIndex, entry.pattern, updatedOverride),
      updatedOverride,
    };
  }

  /** Adds a new override entry with a uniquified pattern. */
  addEntry(pattern: string, override: ModelOverride = {}): LlamaServer[] {
    const server = this.servers[this.serverIndex];
    if (!server) return this.servers;

    const existing = new Set(Object.keys(server.overrides ?? {}));
    let uniquePattern = pattern;
    let n = 2;
    while (existing.has(uniquePattern)) {
      uniquePattern = `${pattern}-${n++}`;
    }

    return this.withServer((s) => ({
      ...s,
      overrides: { ...s.overrides, [uniquePattern]: override },
    }));
  }

  /** Removes the entry at `entryIndex`. */
  removeEntry(entryIndex: number): LlamaServer[] {
    return this.withServer((s) => ({
      ...s,
      overrides: Object.fromEntries(
        Object.entries(s.overrides ?? {}).filter((_, j) => j !== entryIndex),
      ),
    }));
  }

  // -- internal helpers ------------------------------------------------------

  /** Returns the servers with the target server replaced by
   * `fn(server)`. Immutable. */
  private withServer(fn: (server: LlamaServer) => LlamaServer): LlamaServer[] {
    return this.servers.map((server, i) =>
      i === this.serverIndex ? fn(server) : server,
    );
  }

  /** Replaces the entry at `entryIndex` with `pattern → override` in a
   * single mutation — used both for renaming the pattern and for editing
   * its fields. The entry keeps its position in the map's iteration
   * order. Immutable. */
  private updateEntry(
    entryIndex: number,
    pattern: string,
    override: ModelOverride,
  ): LlamaServer[] {
    return this.withServer((s) => ({
      ...s,
      overrides: Object.fromEntries(
        Object.entries(s.overrides ?? {}).map(([k, v], j) =>
          j === entryIndex ? [pattern, override] : [k, v],
        ),
      ),
    }));
  }
}
