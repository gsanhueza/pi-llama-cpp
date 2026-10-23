import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import { SettingsList } from "@earendil-works/pi-tui";
import type { LlamaServer } from "../../../interfaces/settings";
import { FieldMessages, HINTS, TITLES } from "../../strings";
import { ItemBuilder } from "../itemBuilder";
import { ServerFields, type ServerField } from "./fields";
import { ServerDisplay } from "./utils";

/**
 * Builds `SettingItem` objects for server rows and their field-edit submenus.
 */
export class ServerItemBuilder extends ItemBuilder<LlamaServer, ServerField> {
  protected override get fields(): readonly ServerField[] {
    return ServerFields.all;
  }

  /**
   * Adds the field-edit submenu: an `InputDialog` validating against the
   * field definition.
   */
  protected override decorate(
    def: ServerField,
    base: SettingItem,
  ): SettingItem {
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
   * Builds the `SettingItem` for one server row in the top-level list.
   * Enter drills into the server's field-edit submenu.
   * @returns The built `SettingItem`.
   */
  buildRow(
    server: LlamaServer,
    index: number,
    onChange: (field: string, value: string) => void,
    healthEmoji: string,
    onSubmenuChange: () => void,
  ): SettingItem {
    return {
      id: `server-${index}`,
      label: `${healthEmoji} ${server.url}`,
      description: HINTS.serverRow,
      currentValue: ServerDisplay.suffix(server),
      submenu: (_cv, done) => {
        // Rebuild the field items on open so they prefill with current values
        const items = this.buildFieldItems(server).map((item) => {
          const originalSubmenu = item.submenu;
          if (!originalSubmenu) return item;
          return {
            ...item,
            submenu: (cv: string, done: (selectedValue?: string) => void) => {
              const component = originalSubmenu(cv, (value) => {
                if (value !== undefined) onChange(item.id, value);
                done(value);
              });
              return component;
            },
          };
        });
        onSubmenuChange();
        return new SettingsList(
          items,
          Math.min(items.length + 2, 15),
          getSettingsListTheme(),
          () => {},
          () => {
            onSubmenuChange();
            done();
          },
        );
      },
    };
  }
}
