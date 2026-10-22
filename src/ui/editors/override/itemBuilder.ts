import type { SettingItem } from "@earendil-works/pi-tui";
import { FieldMessages, TITLES } from "../../strings";
import { ItemBuilder } from "../itemBuilder";
import { OverrideEntry } from "./entry";
import type { OverrideField } from "./fields/base";
import { OverrideFields } from "./fields/index";
import { SAMPLING_PARAM_FIELDS } from "./fields/samplingParams/index";

/**
 * Builds `SettingItem` objects for override entry field submenus.
 */
export class OverrideItemBuilder extends ItemBuilder<
  OverrideEntry,
  OverrideField
> {
  protected override get fields(): readonly OverrideField[] {
    return OverrideFields.all;
  }

  /**
   * Adds field-type-specific columns: fixed `values` for "finite" fields,
   * an `InputDialog` submenu (validating against the field definition)
   * for "input" fields.
   */
  protected override decorate(
    def: OverrideField,
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

  /**
   * Builds `SettingItem` objects for the sampling params nested list.
   * Each item uses the field's id prefixed with "samplingParams." so
   * the parent can route commits back via the leaf field's apply/remove.
   */
  buildSamplingParamsItems(entry: OverrideEntry): SettingItem[] {
    return SAMPLING_PARAM_FIELDS.map((def) => {
      const base: SettingItem = {
        id: `samplingParams.${def.id}`,
        label: def.label,
        description: def.description,
        currentValue: def.displayValue(entry),
      };

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
    });
  }
}
