import { FIELDS } from "../../../strings";
import { OverrideEntry } from "../entry";
import type { InputValidator } from "./base";
import { StringField } from "../../fields/stringField";

/**
 * The entry's pattern key. Renames are handled by the editor
 * (`OverrideEntryView.applyFieldChange`), so {@link apply}
 * inherits the base no-op.
 */
export class PatternField extends StringField {
  readonly id = "pattern";
  readonly field = FIELDS.pattern;

  displayValue(entry: OverrideEntry): string {
    return entry.pattern;
  }

  override readonly validate: InputValidator = (raw) => {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
}
