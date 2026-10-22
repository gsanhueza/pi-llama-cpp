import type { ModelOverride } from "../../../interfaces/settings";
import { InputField } from "./inputField";
import { Field } from "../../strings";
import { OverrideEntry } from "../override/entry";

/**
 * Generic float input field for any nested object in `ModelOverride`.
 *
 * @param target — top-level key of the object (e.g. "cost")
 * @param property — key within that object
 *
 * Subclasses provide their own `validate` and may override `apply`
 * to customize zero handling.
 */
export class FloatField extends InputField {
  readonly id: string;
  override readonly field: Field;

  constructor(
    readonly target: string,
    readonly property: string,
    field: Field,
  ) {
    super();
    this.id = property;
    this.field = field;
  }

  displayValue(entry: OverrideEntry): string {
    const obj = entry.override[this.target as keyof ModelOverride];
    const value = obj?.[this.property as never as keyof {}];
    return String(value ?? 0);
  }

  /** Applies the committed value to the target object. */
  override apply(override: ModelOverride, value: string): void {
    const n = Number(value);
    if (isFinite(n)) {
      const target = override[this.target as keyof ModelOverride] as
        Record<string, number> | undefined;
      if (target) {
        target[this.property] = n;
      } else {
        override[this.target as keyof ModelOverride] = {
          [this.property]: n,
        } as never;
      }
    } else {
      const target = override[this.target as keyof ModelOverride] as
        Record<string, number> | undefined;
      if (target) {
        delete target[this.property];
        if (Object.keys(target).length === 0)
          delete override[this.target as keyof ModelOverride];
      }
    }
  }

  /** Removes the field's key. */
  override remove(override: ModelOverride): boolean {
    const target = override[this.target as keyof ModelOverride] as
      Record<string, number> | undefined;
    const had = target?.[this.property] !== undefined;
    if (target) {
      delete target[this.property];
      if (Object.keys(target).length === 0)
        delete override[this.target as keyof ModelOverride];
    }
    return had;
  }

  /** Appears in the summary only when set. */
  override summaryPart(override: ModelOverride): string | null {
    const target = override[this.target as keyof ModelOverride] as
      Record<string, number> | undefined;
    const value = target?.[this.property as never as keyof {}];
    return value === undefined ? null : `${this.property}: ${value}`;
  }
}
