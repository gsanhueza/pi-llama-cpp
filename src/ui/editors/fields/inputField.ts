import type { ModelOverride } from "../../../interfaces/settings";
import { OverrideField } from "../override/fields/base";
import type { InputValidator } from "../override/fields/base";

/**
 * Abstract intermediate for "input" type fields: free-text where the user
 * types a value that gets parsed and applied to the override object.
 *
 * Subclasses own their `validate`, `displayValue`, `apply`, `remove` and
 * `summaryPart`. This class provides no-op defaults for everything except
 * `type = "input"` and `options = undefined`.
 */
export abstract class InputField extends OverrideField {
  readonly type: "input" | "finite" = "input";
  readonly options: readonly string[] | undefined = undefined;

  /** Default validate: pass-through (subclasses override for validation). */
  readonly validate: InputValidator = (raw: string) => raw;

  /** Default apply: no-op (the caller handles the value). */
  override apply(_override: ModelOverride, _value: string): void {
    // no-op
  }

  /** Default remove: nothing to reset. */
  override remove(_override: ModelOverride): boolean {
    return false;
  }

  /** Default summary: don't appear in summary. */
  override summaryPart(_override: ModelOverride): string | null {
    return null;
  }
}
