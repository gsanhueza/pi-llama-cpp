import { InputField } from "./inputField";
import type { InputValidator } from "../override/fields/base";

/**
 * Free-text input field: trims on validation, does not mutate the
 * override — the caller handles the value. Subclasses must provide
 * `displayValue`.
 */
export abstract class StringField extends InputField {
  /** Trim and reject empty input. */
  readonly validate: InputValidator = (raw: string) => {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
}
