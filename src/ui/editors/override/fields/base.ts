import type { ModelOverride } from "../../../../interfaces/settings";
import { SettingField } from "../../settingField";
import { OverrideEntry } from "../entry";

/** Type of a field: "input" for free-text, "finite" for fixed options */
export type FieldType = "input" | "finite";

/** Validation function for input fields */
export type InputValidator = (raw: string) => string | null;

/**
 * Abstract base class for one editable field of a model override entry
 * (Template Method): each subclass owns its display format, validation
 * and apply logic in a single place, so the parse/format round-trips
 * can't drift. Extends the shared {@link SettingField} base (id, label,
 * description, placeholder from the FIELDS registry).
 */
export abstract class OverrideField extends SettingField<OverrideEntry> {
  /** Field type: "input" for free-text, "finite" for fixed options. */
  abstract readonly type: FieldType;

  /**
   * Canonical display label for this field — the single source of truth
   * for both the field rows' `currentValue` and the post-commit refresh
   * of an open field submenu, so the two can't drift.
   */
  abstract displayValue(entry: OverrideEntry): string;

  /** Current value shown in the row — defaults to `displayValue`. */
  currentValue(entry: OverrideEntry): string {
    return this.displayValue(entry);
  }

  /** For "input" fields: validation function for committed values. */
  abstract readonly validate: InputValidator;

  /** For "finite" fields: the fixed options (undefined for "input"). */
  readonly options: readonly string[] | undefined = undefined;

  /** Applies a committed value to the override object. The pattern key
   * rename is handled separately by the mutator. */
  abstract apply(override: ModelOverride, value: string): void;

  /** One `term: value` part of the entry-row summary (see
   * {@link OverrideSummary.of}), or `null` when the field shouldn't
   * appear (unset/zero values — each field decides). The pattern is the
   * row label, so it never contributes a part; the default is `null`. */
  summaryPart(_override: ModelOverride): string | null {
    return null;
  }
}
