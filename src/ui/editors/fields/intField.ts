import type { ModelOverride } from "../../../interfaces/settings";
import { InputField } from "./inputField";
import { Field } from "../../strings";
import { OverrideEntry } from "../override/entry";

/**
 * Generic integer input field for any `ModelOverride` property.
 *
 * Subclasses provide their own `validate` and may override `apply`
 * to customize rounding or zero handling.
 */
export class IntField extends InputField {
  readonly id: string;
  override readonly field: Field;

  constructor(
    readonly property: string,
    field: Field,
  ) {
    super();
    this.id = property;
    this.field = field;
  }

  displayValue(entry: OverrideEntry): string {
    const val = (entry.override as Record<string, number>)[this.property];
    return String(val ?? 0);
  }

  /** Applies the committed value as a floored integer. */
  override apply(override: ModelOverride, value: string): void {
    const n = Math.floor(Number(value));
    if (isFinite(n)) (override as Record<string, number>)[this.property] = n;
    else delete (override as Record<string, number>)[this.property];
  }

  /** Removes the field's key. */
  override remove(override: ModelOverride): boolean {
    const rec = override as Record<string, number>;
    const had = rec[this.property] !== undefined;
    delete rec[this.property];
    return had;
  }

  /** Appears in the summary only when set. */
  override summaryPart(override: ModelOverride): string | null {
    const value = (override as Record<string, number>)[this.property];
    return value === undefined ? null : `${this.property}: ${value}`;
  }
}
