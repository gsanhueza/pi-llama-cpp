import type { ModelOverride } from "../../../../interfaces/settings";
import type { Field } from "../../../strings";
import { OverrideEntry } from "../entry";
import type { InputValidator } from "./base";
import { OverrideField } from "./base";

/** Parses a non-negative number; blank input means zero (unset fields
 * default to zero at read time). Returns `null` when invalid. */
export function parseNonNegative(raw: string): number | null {
  const n = Number(raw.trim());
  return isFinite(n) && n >= 0 ? n : null;
}

/**
 * Non-negative numeric field (`contextSize`, `maxTokens`): keeps the
 * display format, validator and apply logic in a single place so the
 * three can't drift (e.g. the validator accepting `0` while the apply
 * drops it — unset fields default to zero at read time, so all render
 * as `0`).
 */
export class NumericField extends OverrideField {
  readonly type = "input";
  override readonly field: Field;

  constructor(
    readonly id: "maxTokens" | "contextSize",
    field: Field,
  ) {
    super();
    this.field = field;
  }

  displayValue(entry: OverrideEntry): string {
    return String(entry.override[this.id] ?? 0);
  }

  /** Accepts finite, non-negative numbers (blank means zero). */
  readonly validate: InputValidator = (raw) => {
    const n = parseNonNegative(raw);
    return n === null ? null : String(n);
  };

  /** Applies the committed value; non-positive values remove the key. */
  apply(override: ModelOverride, value: string): void {
    const n = Number(value);
    if (isFinite(n) && n > 0) override[this.id] = n;
    else delete override[this.id];
  }

  /** Appears in the summary only when set. */
  override summaryPart(override: ModelOverride): string | null {
    const value = override[this.id];
    return value === undefined ? null : `${this.id}: ${value}`;
  }
}
