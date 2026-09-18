import type {
  Component,
  Focusable,
  SettingItem,
  SettingsList,
} from "@earendil-works/pi-tui";
import type { LlamaServer } from "../../../interfaces/settings";
import { HINTS } from "../../strings";
import type { OverrideSettingsListOptions } from "../editorOptions";
import { SettingsListFactory } from "../settingsListFactory";
import { OverrideEntryListEditor } from "./entryEditor";

/**
 * Top-level overrides editor: one row per server, Enter drills into
 * override entries.
 *
 * Unlike `ServerSettingsList`, this has no add/delete — just drill-down.
 */
export class OverrideSettingsList implements Component, Focusable {
  private settingsList: SettingsList | null = null;
  private isFocused = false;

  constructor(private readonly options: OverrideSettingsListOptions) {
    this.settingsList = this.buildSettingsList();
  }

  // -- Component -------------------------------------------------------------

  invalidate(): void {
    this.settingsList?.invalidate();
  }

  handleInput(data: string): void {
    this.settingsList?.handleInput(data);
  }

  render(width: number): string[] {
    if (!this.settingsList) return ["Loading..."];
    return this.settingsList.render(width);
  }

  // -- Focusable -------------------------------------------------------------

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    // `SettingsList` has no `focused` flag — the flag is ours alone
    this.isFocused = value;
  }

  // -- internal --------------------------------------------------------------

  private buildSettingsList(): SettingsList {
    const serverItems: SettingItem[] = this.options.servers.map(
      (server, i) => ({
        id: `server-${i}`,
        label: server.url,
        description: HINTS.overrideServerRow,
        currentValue: OverrideSettingsList.entriesLabel(server),
        submenu: (_cv, done) =>
          new OverrideEntryListEditor(this.options, i, () => {
            // Entry count may have changed (add/delete/pattern rename)
            const current = this.options.servers[i];
            serverList?.updateValue(
              `server-${i}`,
              OverrideSettingsList.entriesLabel(current),
            );
            done();
          }),
      }),
    );

    let serverList: SettingsList | null = null;
    serverList = SettingsListFactory.create(serverItems, () => {
      this.options.done();
    });
    return serverList;
  }

  /** Row summary for a server in the list: its override entry count. */
  private static entriesLabel(server: LlamaServer | undefined): string {
    return `${Object.keys(server?.overrides ?? {}).length} entries`;
  }
}
