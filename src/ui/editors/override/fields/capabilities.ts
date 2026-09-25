import type { ModelOverride } from "../../../../interfaces/settings";
import { FIELDS } from "../../../strings";
import { OverrideEntry } from "../entry";
import type { InputValidator } from "./base";
import { OverrideField } from "./base";

/** The override's `capabilities` list (finite: fixed label options). */
export class CapabilitiesField extends OverrideField {
  readonly id = "capabilities";
  readonly type = "finite";
  readonly field = FIELDS.capabilities;
  override readonly options = ["text", "text | image"];

  displayValue(entry: OverrideEntry): string {
    return entry.override.capabilities?.join(" | ") ?? "text";
  }

  readonly validate: InputValidator = (raw) =>
    this.options?.includes(raw) ? raw : null;

  apply(override: ModelOverride, value: string): void {
    override.capabilities =
      value === "text | image"
        ? ["text", "image"]
        : value === "text"
          ? ["text"]
          : undefined;
  }

  /** Appears in the summary only when non-empty. */
  override summaryPart(override: ModelOverride): string | null {
    return override.capabilities?.length
      ? `capabilities: ${override.capabilities.join(",")}`
      : null;
  }
}
