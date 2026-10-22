import type { ModelOverride } from "../../../interfaces/settings";
import { InputField } from "./inputField";
import type { InputValidator } from "../override/fields/base";
import { Field } from "../../strings";
import { OverrideEntry } from "../override/entry";

/** Known boolean override keys. */
type BooleanKey = keyof Pick<ModelOverride, "reasoning">;

/**
 * Boolean input field: "true" / "false" options, stored as a native
 * boolean on the override object.
 */
export class BooleanField extends InputField {
  override readonly type = "finite";
  readonly id: string;
  override readonly field: Field;
  override readonly options = ["true", "false"] as const;

  constructor(
    readonly property: BooleanKey,
    field: Field,
  ) {
    super();
    this.id = property;
    this.field = field;
  }

  /** Default display: show raw selected option. */
  displayValue(entry: OverrideEntry): string {
    return entry.override[this.property] === false ? "false" : "true";
  }

  /** Only accepts "true" or "false". */
  readonly validate: InputValidator = (raw: string) => {
    const ok = raw === "true" || raw === "false";
    return ok ? raw : null;
  };

  /** Sets the property as a native boolean. */
  override apply(override: ModelOverride, value: string): void {
    if (value === "true") override[this.property] = true;
    else if (value === "false") override[this.property] = false;
    else delete override[this.property];
  }

  /** Removes the field's key. */
  override remove(override: ModelOverride): boolean {
    const had = override[this.property] !== undefined;
    delete override[this.property];
    return had;
  }

  /** Always appears in summary when set. */
  override summaryPart(override: ModelOverride): string | null {
    const value = override[this.property];
    return value === undefined ? null : `${this.property}: ${value}`;
  }
}
