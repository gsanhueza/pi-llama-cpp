import type { SettingItem } from "@earendil-works/pi-tui";
import { FieldMessages, TITLES } from "../../strings";
import { ItemBuilder } from "../itemBuilder";
import { OverrideEntry } from "./entry";
import { OverrideFields, type OverrideField } from "./fields";

/**
 * Builds `SettingItem` objects for override entry field submenus.
 */
export class OverrideItemBuilder extends ItemBuilder<
  OverrideEntry,
  OverrideField
> {
  protected get fields(): readonly OverrideField[] {
    return OverrideFields.all;
  }

  /**
   * Adds field-type-specific columns: fixed `values` for "finite" fields,
   * an `InputDialog` submenu (validating against the field definition)
   * for "input" fields.
   */
  protected decorate(
    def: OverrideField,
    entry: OverrideEntry,
    base: SettingItem,
  ): SettingItem {
    if (def.type === "finite") {
      return { ...base, values: [...(def.options ?? [])] };
    }

    return {
      ...base,
      submenu: this.dialogs.inputSubmenu(
        TITLES.edit(def.label),
        FieldMessages.of(def.field),
        def.placeholder,
        def.validate,
      ),
    };
  }
}
