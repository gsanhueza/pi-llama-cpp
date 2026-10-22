import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { SettingsList } from "@earendil-works/pi-tui";
import type { LlamaSettings } from "../../interfaces/settings";
import type { SettingsService } from "../../settings/settings";
import { SETTINGS_ITEMS } from "../../settings/defaults";
import type { SettingsTUIListOptions } from "../editors/editorOptions";
import { BaseTUIList } from "./baseList";
import { SettingsListFactory } from "../editors/settingsListFactory";

/**
 * Interactive settings menu for the scalar `llamaSettings` fields.
 *
 * Enter/Space cycles the value under the cursor; Esc closes.
 *
 * Reads from `SettingsService` for the current config and writes
 * via `setLlamaSettings()`; write errors are notified and leave the
 * dialog open with values unchanged.
 *
 * Boolean and sort changes apply immediately; timeout changes
 * (`pollingInterval`, `pollingTimeout`, `serverTimeout`) take effect
 * on the next model load.
 */
export class SettingsTUIList extends BaseTUIList<SettingsTUIListOptions> {
  /**
   * Opens the editor in a modal `ui.custom` dialog and resolves when the
   * user closes it (Esc).
   */
  static async show(
    ui: ExtensionUIContext,
    settings: SettingsService,
  ): Promise<void> {
    await ui.custom<void>((tui, theme, keybindings, done) => {
      const list = new SettingsTUIList({
        tui,
        theme,
        keybindings,
        settings,
        done: () => done(undefined),
        onError: (message) => ui.notify(message, "error"),
      });
      return list;
    });
  }
  private currentConfig: LlamaSettings | null = null;

  protected override async initialize(): Promise<void> {
    this.currentConfig = await this.options.settings.getLlamaSettings();
    if (!this.currentConfig) return;

    this.list = this.buildSettingsList(this.currentConfig);
    this.options.tui.requestRender();
  }

  private buildSettingsList(config: LlamaSettings): SettingsList {
    const items = Object.values(SETTINGS_ITEMS).map((item) => ({
      id: item.id,
      label: item.label,
      description: item.description,
      currentValue: item.format(config),
      ...(item.values ? { values: item.values } : {}),
    }));

    const onChangeFn = async (id: string, newValue: string): Promise<void> => {
      if (!this.currentConfig) return;
      const settingItem = SETTINGS_ITEMS[id];
      if (!settingItem) return;
      const result = settingItem.setConfig(this.currentConfig, newValue);
      if (!result.valid) {
        this.options.onError(result.errors?.join("\n") ?? "Invalid value.");
        return;
      }
      try {
        await this.options.settings.setLlamaSettings(result.config!);
        this.currentConfig = await this.options.settings.getLlamaSettings();
        this.list?.updateValue(id, settingItem.format(this.currentConfig!));
        this.options.tui.requestRender();
      } catch (error) {
        this.options.onError(`Failed to save setting: ${error}`);
      }
    };

    const onResetFn = async (id: string): Promise<void> => {
      const settingItem = SETTINGS_ITEMS[id];
      if (!settingItem) return;
      try {
        await this.options.settings.deleteLlamaSetting(settingItem.id);
        this.currentConfig = await this.options.settings.getLlamaSettings();
        this.list?.updateValue(id, settingItem.format(this.currentConfig!));
        this.options.tui.requestRender();
      } catch (error) {
        this.options.onError(`Failed to delete setting: ${error}`);
      }
    };

    return SettingsListFactory.createResettable(
      items,
      () => this.options.done(),
      onChangeFn,
      onResetFn,
      this.options.tui,
    );
  }
}
