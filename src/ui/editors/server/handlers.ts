import type { LlamaServer } from "../../../interfaces/settings";
import { ServerFields } from "./fields";

/**
 * Applies field commits to a single server, immutably. Binds the server
 * list and server index once in the constructor so call sites don't
 * juggle long positional lists. Mirrors the override side's
 * `OverrideEntryMutator`.
 *
 * Per-field commit behavior lives in the `ServerFields` registry
 * (`apply` on each field class, backed by `LlamaServerBuilder`) — this
 * class only resolves the field definition and produces the next list.
 */
export class ServerEntryMutator {
  constructor(
    private readonly servers: LlamaServer[],
    private readonly serverIndex: number,
  ) {}

  /**
   * Handles a field commit from a server row's submenu. Returns the
   * next server list, or the same list when the server is missing
   * (no-op — callers can compare by reference).
   */
  applyFieldChange(field: string, value: string): LlamaServer[] {
    const server = this.servers[this.serverIndex];
    if (!server) return this.servers;

    const updated = ServerFields.byId(field).apply(server, value);
    return this.servers.map((s, i) => (i === this.serverIndex ? updated : s));
  }
}
