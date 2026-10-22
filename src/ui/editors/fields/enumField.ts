import { InputField } from "./inputField";
import type { InputValidator } from "../override/fields/base";
import { OverrideEntry } from "../override/entry";

/**
 * Enum input field: fixed string options, stored as-is on the override
 * object. Subclasses provide `options`, `apply`, and `summaryPart`.
 */
export abstract class EnumField extends InputField {
  override readonly type = "finite";
  /** Subclasses provide their fixed options. */
  abstract readonly options: readonly string[];

  /** Only accepts values from `options`. */
  readonly validate: InputValidator = (raw: string) =>
    this.options.includes(raw) ? raw : null;

  /** Default display: show raw selected option (subclasses override). */
  abstract displayValue(entry: OverrideEntry): string;
}
