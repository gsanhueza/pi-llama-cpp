import type { Field } from "../strings";

/**
 * Base class for one editable field of an entry (Template Method): the
 * user-facing strings come from the shared `FIELDS` registry
 * (`strings.ts`), and the `ItemBuilder` template fills the common
 * `SettingItem` columns from this class while domain subclasses own the
 * value/apply behavior.
 *
 * Both field registries (`ServerFields`, `OverrideFields`) extend this
 * class, so the two editors share one field idiom instead of parallel
 * interface/class shapes.
 */
export abstract class SettingField<TEntry> {
  /** Unique id used as `SettingItem.id`. */
  abstract readonly id: string;
  /** User-facing strings from the shared FIELDS registry. */
  abstract readonly field: Field;

  /** Row label (from the shared FIELDS registry). */
  get label(): string {
    return this.field.label;
  }

  /** Row description in the containing `SettingsList`. */
  get description(): string {
    return this.field.description;
  }

  /** Example value shown dim as `e.g., <placeholder>` in input dialogs. */
  get placeholder(): string | undefined {
    return this.field.placeholder;
  }

  /** Current value shown in the entry's field row. */
  abstract currentValue(entry: TEntry): string;
}
