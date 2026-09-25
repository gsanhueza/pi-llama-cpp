import type { ModelOverride } from "../../../../interfaces/settings";
import { FIELDS } from "../../../strings";
import { OverrideEntry } from "../entry";
import type { InputValidator } from "./base";
import { OverrideField } from "./base";

/** The override's `reasoning` flag (finite: true/false, default true). */
export class ReasoningField extends OverrideField {
  readonly id = "reasoning";
  readonly type = "finite";
  readonly field = FIELDS.reasoning;
  override readonly options = ["true", "false"];

  displayValue(entry: OverrideEntry): string {
    return entry.override.reasoning === false ? "false" : "true";
  }

  readonly validate: InputValidator = (raw) =>
    this.options?.includes(raw) ? raw : null;

  apply(override: ModelOverride, value: string): void {
    if (value === "true") override.reasoning = true;
    else if (value === "false") override.reasoning = false;
    else delete override.reasoning;
  }

  /** Appears in the summary only when explicitly set. */
  override summaryPart(override: ModelOverride): string | null {
    return override.reasoning === undefined
      ? null
      : `reasoning: ${override.reasoning}`;
  }
}
