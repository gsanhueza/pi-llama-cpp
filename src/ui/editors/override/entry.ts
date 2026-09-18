import type { LlamaServer, ModelOverride } from "../../../interfaces/settings";

/**
 * One override entry: the pattern key and its override object. Owns the
 * canonical construction from a server's overrides map, so the editor
 * and the mutator share a single entry representation. Row rendering
 * (summary) is registry-driven — see `OverrideSummary`.
 */
export class OverrideEntry {
  constructor(
    readonly pattern: string,
    readonly override: ModelOverride,
  ) {}

  /**
   * Entries of a server's overrides map, in map iteration order (the
   * order the entry list renders and mutates by).
   */
  static listFrom(server: LlamaServer | undefined): OverrideEntry[] {
    return Object.entries(server?.overrides ?? {}).map(
      ([pattern, override]) => new OverrideEntry(pattern, override),
    );
  }
}
