import { FIELDS } from "../../../strings";
import { OverrideEntry } from "../entry";
import type { InputValidator } from "./base";
import { OverrideField } from "./base";

/**
 * The entry's pattern key. The rename itself is handled by the mutator
 * (`OverrideEntryMutator`); {@link apply} is a no-op.
 */
export class PatternField extends OverrideField {
  readonly id = "pattern";
  readonly type = "input";
  readonly field = FIELDS.pattern;

  displayValue(entry: OverrideEntry): string {
    return entry.pattern;
  }

  readonly validate: InputValidator = (raw) => {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  apply(): void {
    // The pattern IS the map key — renames go through the mutator.
  }
}
