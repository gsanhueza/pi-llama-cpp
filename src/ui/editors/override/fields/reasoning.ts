import type { ModelOverride } from "../../../../interfaces/settings";
import { FIELDS } from "../../../strings";
import { OverrideEntry } from "../entry";
import type { InputValidator } from "./base";
import { BooleanField } from "../../fields/booleanField";

/** The override's `reasoning` flag (finite: true/false, default true). */
export class ReasoningField extends BooleanField {
  constructor() {
    super("reasoning", FIELDS.reasoning);
  }

  /** Shows "false" only when explicitly false; defaults to "true". */
  override displayValue(entry: OverrideEntry): string {
    return entry.override.reasoning === false ? "false" : "true";
  }

  readonly validate: InputValidator = (raw) => {
    const ok = raw === "true" || raw === "false";
    return ok ? raw : null;
  };

  apply(override: ModelOverride, value: string): void {
    if (value === "true") override.reasoning = true;
    else if (value === "false") override.reasoning = false;
    else delete override.reasoning;
  }

  /** Removes the `reasoning` key. */
  override remove(override: ModelOverride): boolean {
    const had = override.reasoning !== undefined;
    delete override.reasoning;
    return had;
  }

  /** Appears in the summary only when explicitly set. */
  override summaryPart(override: ModelOverride): string | null {
    return override.reasoning === undefined
      ? null
      : `reasoning: ${override.reasoning}`;
  }
}
