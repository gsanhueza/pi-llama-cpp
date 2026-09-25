import type { SettingItem } from "@earendil-works/pi-tui";
import type { DialogFactory } from "../dialog/factory";
import type { SettingField } from "./settingField";

/**
 * Base class for building `SettingItem` arrays from a declarative field
 * registry (Template Method): {@link buildFieldItems} maps the ordered
 * {@link fields} registry over {@link buildItem}, which fills the common
 * columns from the field and delegates field-type-specific columns (e.g.
 * submenu or fixed values) to {@link decorate}.
 *
 * Injects a {@link DialogFactory} once in the constructor so subclasses
 * can build input submenus without threading `theme`/`tui` around.
 */
export abstract class ItemBuilder<TEntry, TField extends SettingField<TEntry>> {
  constructor(protected readonly dialogs: DialogFactory) {}

  /** The ordered field registry; order defines the row order in the list. */
  protected abstract get fields(): readonly TField[];

  /**
   * Builds the `SettingItem` for one field of an entry: fills the common
   * columns from the field, then hands the partial item to
   * {@link decorate}.
   */
  private buildItem(def: TField, entry: TEntry): SettingItem {
    const base: SettingItem = {
      id: def.id,
      label: def.label,
      description: def.description,
      currentValue: def.currentValue(entry),
    };
    return this.decorate(def, base);
  }

  /** Builds the `SettingItem` array for one entry's editable fields. */
  buildFieldItems(entry: TEntry): SettingItem[] {
    return this.fields.map((def) => this.buildItem(def, entry));
  }

  /** Adds field-type-specific columns (e.g. submenu or fixed values). */
  protected abstract decorate(def: TField, base: SettingItem): SettingItem;
}
