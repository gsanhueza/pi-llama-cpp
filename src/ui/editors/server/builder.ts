import type { LlamaServer } from "../../../interfaces/settings";

/**
 * Builder for `LlamaServer` objects, centralizing the "empty string means
 * omit the key" rule for the optional `id` and `name` fields — the single
 * place where that invariant lives, shared by the add-server wizard's
 * final step and by field commits on existing servers.
 *
 * Start from an existing server with {@link from}, chain the setters,
 * then call {@link build}. Immutable with respect to the input: the
 * source server is never mutated.
 */
export class LlamaServerBuilder {
  private constructor(private data: LlamaServer) {}

  /** Starts a builder from an existing server (also used to start a
   * fresh `{ url }` server in the wizard flow). */
  static from(server: LlamaServer): LlamaServerBuilder {
    return new LlamaServerBuilder({ ...server });
  }

  /** Sets the URL (always present, never omitted). */
  url(url: string): this {
    this.data = { ...this.data, url };
    return this;
  }

  /**
   * Sets the custom provider ID. An empty value omits the key — when
   * editing an existing server this removes it, restoring the
   * URL-based auto-detected ID.
   */
  optionalId(id: string): this {
    this.data = this.withOptional("id", id);
    return this;
  }

  /**
   * Sets the display name. An empty value omits the key — when editing
   * an existing server this removes it.
   */
  optionalName(name: string): this {
    this.data = this.withOptional("name", name);
    return this;
  }

  /** Returns the built server. */
  build(): LlamaServer {
    return this.data;
  }

  /** Copies `data`, setting `key` to `value` when non-empty and
   * removing the key otherwise. */
  private withOptional(key: "id" | "name", value: string): LlamaServer {
    const next = { ...this.data };
    if (value.length > 0) next[key] = value;
    else delete next[key];
    return next;
  }
}
