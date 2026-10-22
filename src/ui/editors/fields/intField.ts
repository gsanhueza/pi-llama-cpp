import type { ModelOverride } from "../../../interfaces/settings";
import { InputField } from "./inputField";
import { Field } from "../../strings";
import { OverrideEntry } from "../override/entry";

/**
 * Generic integer input field for any `ModelOverride` property.
 *
 * When `target` is null, writes to the top-level override object.
 * When set, writes to `override[target][property]`.
 *
 * Subclasses provide their own `validate` and may override `apply`
 * to customize rounding or zero handling.
 */
export class IntField extends InputField {
  readonly id: string;
  override readonly field: Field;

  constructor(
    readonly target: string | null,
    readonly property: string,
    field: Field,
  ) {
    super();
    this.id = property;
    this.field = field;
  }

  displayValue(entry: OverrideEntry): string {
    const obj = this.target
      ? entry.override[this.target as keyof ModelOverride]
      : entry.override;
    const val = obj?.[this.property as never as keyof {}];
    return String(val ?? 0);
  }

  /** Applies the committed value. */
  override apply(override: ModelOverride, value: string): void {
    const n = Number(value);
    if (isFinite(n)) {
      const target = this.target
        ? (override[this.target as keyof ModelOverride] as
            | Record<string, number>
            | undefined)
        : (override as Record<string, number>);
      if (target) {
        target[this.property] = n;
      } else {
        override[this.target as keyof ModelOverride] = {
          [this.property]: n,
        } as never;
      }
    } else {
      const target = this.target
        ? (override[this.target as keyof ModelOverride] as
            | Record<string, number>
            | undefined)
        : (override as Record<string, number>);
      if (target) {
        delete target[this.property];
      } else {
        delete (override as Record<string, number>)[this.property];
      }
    }
  }

  /** Removes the field's key. */
  override remove(override: ModelOverride): boolean {
    const target = this.target
      ? (override[this.target as keyof ModelOverride] as
          | Record<string, number>
          | undefined)
      : (override as Record<string, number>);
    const had = target?.[this.property] !== undefined;
    if (target) {
      delete target[this.property];
    } else {
      delete (override as Record<string, number>)[this.property];
    }
    return had;
  }

  /** Appears in the summary only when set. */
  override summaryPart(override: ModelOverride): string | null {
    const obj = this.target
      ? (override[this.target as keyof ModelOverride] as
          | Record<string, number>
          | undefined)
      : (override as Record<string, number>);
    const value = obj?.[this.property as never as keyof {}];
    return value === undefined ? null : `${this.property}: ${value}`;
  }
}
