import type { SettingItem } from "@earendil-works/pi-tui";
import type { LlamaServer } from "../../../interfaces/settings";
import { FieldMessages, HINTS, TITLES } from "../../strings";
import { ItemBuilder } from "../itemBuilder";
import { SettingsListFactory } from "../settingsListFactory";
import { ServerFields, type ServerField } from "./fields";
import { ServerDisplay } from "./utils";

/**
 * Builds `SettingItem` objects for server rows and their field-edit submenus.
 */
export class ServerItemBuilder extends ItemBuilder<LlamaServer, ServerField> {
  protected get fields(): readonly ServerField[] {
    return ServerFields.all;
  }

  /**
   * Adds the field-edit submenu: an `InputDialog` validating against the
   * field definition.
   */
  protected decorate(
    def: ServerField,
    server: LlamaServer,
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
   */
  buildRow(
    server: LlamaServer,
    index: number,
    onChange: (field: string, value: string) => void,
    healthEmoji: string,
    onSubmenuChange: (open: boolean) => void,
  ): SettingItem {
    return {
      id: `server-${index}`,
      label: `${healthEmoji} ${server.url}`,
      description: HINTS.serverRow,
      currentValue: ServerDisplay.suffix(server),
      submenu: (_cv, done) => {
        // Rebuild the field items on open so they prefill with current values
        const items = this.buildFieldItems(server);
        onSubmenuChange(true);
        return SettingsListFactory.create(
          items,
          () => {
            onSubmenuChange(false);
            done();
          },
          onChange,
        );
      },
    };
  }
}
