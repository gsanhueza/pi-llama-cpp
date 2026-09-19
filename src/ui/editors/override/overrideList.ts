import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type {
  Component,
  Focusable,
  SettingItem,
  SettingsList,
} from "@earendil-works/pi-tui";
import type { LlamaServer } from "../../../interfaces/settings";
import type { LlamaSettingsManager } from "../../../managers/settings";
import { HINTS } from "../../strings";
import type { OverrideSettingsListOptions } from "../editorOptions";
import { SettingsListFactory } from "../settingsListFactory";
import { OverrideEntryListEditor } from "./entryEditor";

/**
 * Top-level overrides editor: one row per server, Enter drills into
 * override entries.
 *
 * Unlike `ServerSettingsList`, this has no add/delete — just drill-down.
 *
 * Within a server's entry list: Enter drills into the field-edit submenu;
 * a adds, d deletes (after confirmation). Fields use a mix of finite
 * (Enter to cycle) and infinite (Enter to type) editing:
 *
 * - Pattern / costs (input, output, cacheRead, cacheWrite): infinite —
 *   Enter opens an Input for typing.
 * - Capabilities: finite — Enter cycles between `text` and `text | image`.
 * - Reasoning: finite — Enter cycles between `true` and `false`.
 *
 * Servers themselves are not managed here — use `/models servers`.
 */
export class OverrideSettingsList implements Component, Focusable {
  private settingsList: SettingsList | null = null;
  private isFocused = false;

  constructor(private readonly options: OverrideSettingsListOptions) {
    this.settingsList = this.buildSettingsList();
  }

  /**
   * Opens the editor in a modal `ui.custom` dialog seeded with the
   * current `llamaSettings.servers` and resolves when the user closes
   * it (Esc). Writes go through `settings.setLlamaSetting()`; write
   * errors are notified via `ui` and the editor stays open with the
   * pre-mutation list.
   */
  static async show(
    ui: ExtensionUIContext,
    settings: LlamaSettingsManager,
  ): Promise<void> {
    const servers = await settings.getLlamaServers();

    await ui.custom<void>(
      (tui, theme, keybindings, done) =>
        new OverrideSettingsList({
          tui,
          theme,
          keybindings,
          servers,
          persist: (next) => settings.setLlamaSetting("servers", next),
          done: () => done(undefined),
          onError: (message) => ui.notify(message, "error"),
          onChanged: () => {}, // no per-change notification needed
        }),
    );
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
