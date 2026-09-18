import type { LlamaServer } from "../../../interfaces/settings";
import { ServerUrl } from "../../../utils/urls";
import { FIELDS, type Field } from "../../strings";
import { SettingField } from "../settingField";
import { LlamaServerBuilder } from "./builder";

/**
 * Base class for one editable field of a server row. `apply` delegates
 * to {@link LlamaServerBuilder} so the unset-on-empty rule for `id`/
 * `name` stays in one place. Mirrors the override side's
 * `OverrideField`.
 */
export abstract class ServerField extends SettingField<LlamaServer> {
  /** Validation function for committed values (`undefined` = accept
   * any). */
  readonly validate: ((raw: string) => string | null) | undefined = undefined;

  /** Applies a committed value to the server, immutably (returns the
   * updated copy). */
  abstract apply(server: LlamaServer, value: string): LlamaServer;
}

/** The server URL (required, validated). */
class UrlField extends ServerField {
  readonly id = "url";
  readonly field = FIELDS.serverUrl;
  readonly validate = ServerUrl.parse;

  currentValue(server: LlamaServer): string {
    return server.url;
  }

  apply(server: LlamaServer, value: string): LlamaServer {
    return LlamaServerBuilder.from(server).url(value).build();
  }
}

/**
 * An optional string field (`id`, `name`). Empty input omits the key —
 * when editing an existing server this removes it, restoring the
 * URL-based auto-detected id for `id`.
 */
class OptionalTextField extends ServerField {
  readonly field: Field;

  constructor(
    readonly id: "id" | "name",
    field: Field,
  ) {
    super();
    this.field = field;
  }

  currentValue(server: LlamaServer): string {
    return server[this.id] ?? "";
  }

  apply(server: LlamaServer, value: string): LlamaServer {
    const builder = LlamaServerBuilder.from(server);
    return this.id === "id"
      ? builder.optionalId(value).build()
      : builder.optionalName(value).build();
  }
}

/**
 * The field registry for servers: the complete list of editable fields
 * (order defines the row order in the settings list) plus id-based
 * lookup. Throws on an unknown id — the registry is static, so a miss is
 * a programming error.
 */
export class ServerFields {
  static readonly all: readonly ServerField[] = [
    new UrlField(),
    new OptionalTextField("id", FIELDS.providerId),
    new OptionalTextField("name", FIELDS.displayName),
  ];

  static byId(id: string): ServerField {
    const field = this.all.find((f) => f.id === id);
    if (!field) throw new Error(`Unknown server field: ${id}`);
    return field;
  }
}
