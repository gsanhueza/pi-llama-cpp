import type { SettingItem, SettingsList } from "@earendil-works/pi-tui";
import { SERVER_TIMEOUT } from "../../../constants";
import type { LlamaServer } from "../../../interfaces/settings";
import { TITLES } from "../../strings";
import type { ServerSettingsListOptions } from "../editorOptions";
import { ListEditor } from "../listEditor";
import { SettingsListFactory } from "../settingsListFactory";
import { ServerEntryMutator } from "./handlers";
import { ServerItemBuilder } from "./itemBuilder";
import { ServerDisplay } from "./utils";
import { ServerWizard } from "./wizard";

/**
 * Wrapper around a `SettingsList` of servers that adds `a` (add) and `d`
 * (delete) support at the list level.
 *
 * - **a** opens the add wizard — a sequence of framed `InputDialog`s
 *   (URL → optional ID → optional name, mirroring `/login`'s sequential
 *   prompts). Esc at any step aborts without persisting; the server is
 *   saved only after the final step.
 * - **d** opens a `ConfirmDialog` (Delete/Cancel select list).
 * - **Enter** on a server row drills into its field-edit submenu.
 * - **Esc** closes the editor.
 */
export class ServerSettingsList extends ListEditor<ServerSettingsListOptions> {
  constructor(options: ServerSettingsListOptions) {
    super(options);
    void this.buildSettingsList().then((list) => {
      this.settingsList = list;
      this.options.tui.requestRender();
    });
  }

  // -- abstract hooks -------------------------------------------------------

  protected async buildSettingsList(): Promise<SettingsList> {
    const builder = new ServerItemBuilder(this.dialogs);
    const serverTimeout = this.options.serverTimeout ?? SERVER_TIMEOUT;
    const healthEmojis = await Promise.all(
      this.options.servers.map((server) =>
        ServerDisplay.healthEmoji(server.url, serverTimeout),
      ),
    );
    const items: SettingItem[] = this.options.servers.map((server, i) =>
      builder.buildRow(
        server,
        i,
        (field, value) => this.handleFieldChange(field, value),
        healthEmojis[i],
        // Opening delegates input to the submenu; closing flushes a
        // rebuild deferred by a field commit (see commitFieldChange)
        (open) => this.trackSubmenu(open),
      ),
    );

    return SettingsListFactory.create(items, () => {
      this.options.done();
    });
  }

  /** Handle a field commit from a server row's submenu. */
  private handleFieldChange(field: string, value: string): void {
    const idx = this.selectedIndex;
    const next = new ServerEntryMutator(
      this.options.servers,
      idx,
    ).applyFieldChange(field, value);

    this.commitFieldChange(next, idx, () => {
      // Refresh the row's suffix in place; the full rebuild (row labels
      // with health emoji, fresh server snapshots for the field submenu)
      // is deferred until the submenu closes (see commitFieldChange)
      const updated = next[idx];
      if (updated) {
        this.settingsList?.updateValue(
          `server-${idx}`,
          ServerDisplay.suffix(updated),
        );
      }
    });
  }

  protected beginAdd(): void {
    const wizard = new ServerWizard(this.dialogs, (dialog) =>
      this.openDialog(dialog),
    );
    wizard.start(
      (server) => {
        this.closeDialog();
        void this.saveNewServer(server);
      },
      () => this.closeDialog(),
    );
  }

  protected deleteSelected(): void {
    const idx = this.selectedIndex;
    const next = this.options.servers.filter((_, i) => i !== idx);
    void this.persistSnapshot(next, () => {
      void this.rebuildList(idx);
    });
  }

  protected readonly emptyHintKey = "emptyServers" as const;

  protected getCurrentCount(): number {
    return this.options.servers.length;
  }

  protected getRowId(index: number): string {
    return `server-${index}`;
  }

  protected getRowLabel(index: number): string {
    return this.options.servers[index]?.url ?? "";
  }

  protected get deleteTitle(): string {
    return TITLES.deleteServer;
  }

  // -- wizard helpers --------------------------------------------------------

  private async saveNewServer(server: LlamaServer): Promise<void> {
    const next = [...this.options.servers, server];
    await this.persistSnapshot(next, () => {
      void this.rebuildList(next.length - 1);
    });
  }
}
