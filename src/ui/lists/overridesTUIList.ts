import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { SettingsList, type SettingItem } from "@earendil-works/pi-tui";
import type { LlamaServer } from "../../interfaces/settings";
import type { SettingsService } from "../../settings/settings";
import { HINTS } from "../strings";
import type { OverridesTUIListOptions } from "../editors/editorOptions";
import { OverrideEntryListEditor } from "../editors/override/entryEditor";
import { BaseTUIList } from "./baseList";

/**
 * Top-level overrides editor: one row per server, Enter drills into
 * override entries.
 *
 * Unlike `ServersTUIList`, this has no add/delete — just drill-down.
 * There is deliberately no `r` reset here either: reset lives inside an
 * entry's field submenu (`OverrideEntryListEditor`).
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
export class OverridesTUIList extends BaseTUIList<OverridesTUIListOptions> {
  constructor(options: OverridesTUIListOptions) {
    super(options);
  }

  /**
   * Opens the editor in a modal `ui.custom` dialog seeded with the
   * current `llamaSettings.servers` and resolves when the user closes
   * it (Esc).
   */
  static async show(
    ui: ExtensionUIContext,
    settings: SettingsService,
  ): Promise<void> {
    const servers = await settings.getLlamaServers();

    await ui.custom<void>(
      (tui, theme, keybindings, done) =>
        new OverridesTUIList({
          tui,
          theme,
          keybindings,
          servers,
          persist: (next) => settings.setLlamaSettings({ servers: next }),
          done: () => done(undefined),
          onError: (message) => ui.notify(message, "error"),
          onChanged: () => {},
        }),
    );
  }

  protected override async initialize(): Promise<void> {
    this.list = this.buildSettingsList();
    this.options.tui.requestRender();
  }

  protected buildSettingsList(): SettingsList {
    const serverItems: SettingItem[] = this.options.servers.map(
      (server, i) => ({
        id: `server-${i}`,
        label: server.url,
        description: HINTS.overrideServerRow,
        currentValue: OverridesTUIList.entriesLabel(server),
        submenu: (_cv, done) =>
          new OverrideEntryListEditor(this.options, i, () => {
            const current = this.options.servers[i];
            this.list?.updateValue(
              `server-${i}`,
              OverridesTUIList.entriesLabel(current),
            );
            done();
          }),
      }),
    );

    return new SettingsList(
      serverItems,
      Math.min(serverItems.length + 2, 15),
      getSettingsListTheme(),
      () => {},
      () => this.options.done(),
    );
  }

  /** Row summary for a server in the list: its override entry count. */
  private static entriesLabel(server: LlamaServer | undefined): string {
    return `${Object.keys(server?.overrides ?? {}).length} entries`;
  }
}
