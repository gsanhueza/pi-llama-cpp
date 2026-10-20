import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { SettingItem, SettingsList } from "@earendil-works/pi-tui";
import { ApiClient } from "../../../api/client";
import { API_KEY_PLACEHOLDER } from "../../../constants";
import { ServerTimeoutSettingsItem } from "../../../settings/items/serverTimeout";
import { ServerStatus } from "../../../enums/serverStatus";
import type { LlamaServer } from "../../../interfaces/settings";
import type { SettingsService } from "../../../settings/settings";
import { Server } from "../../../servers/server";
import { ServerIds } from "../../../utils/serverIds";
import { TITLES, authRequiredMessage } from "../../strings";
import type { ServerSettingsListOptions } from "../editorOptions";
import { ListEditor } from "../listEditor";
import { SettingsListFactory } from "../settingsListFactory";
import { ServerFields } from "./fields";
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
  /**
   * Resolves once the async initial build (health probes, list
   * construction) completes. Consumers that render immediately after
   * construction can await this instead of polling internal state.
   */
  readonly ready: Promise<void>;

  constructor(options: ServerSettingsListOptions) {
    super(options);
    this.ready = this.buildSettingsList().then((list) => {
      this.settingsList = list;
      this.options.tui.requestRender();
    });
  }

  /**
   * Opens the editor in a modal `ui.custom` dialog seeded with the
   * current `llamaSettings.servers` and resolves when the user closes
   * it (Esc). Writes go through `settings.setLlamaSettings()`; write
   * errors are notified via `ui` and the editor stays open with the
   * pre-mutation list.
   */
  static async show(
    ui: ExtensionUIContext,
    settings: SettingsService,
  ): Promise<void> {
    const servers = await settings.getLlamaServers();
    const { serverTimeout } = await settings.resolveTimeouts();

    await ui.custom<void>(
      (tui, theme, keybindings, done) =>
        new ServerSettingsList({
          tui,
          theme,
          keybindings,
          servers,
          persist: (next) => settings.setLlamaSettings({ servers: next }),
          done: () => done(undefined),
          onError: (message) => ui.notify(message, "error"),
          serverTimeout,
          authResolver: async (server) => {
            // Mirror Server.getApiKey(): use ServerIds.resolve to get
            // the provider ID (customId or llama-server=<url>), then
            // resolve the key from the credential store.
            return settings.resolveApiKey(
              ServerIds.resolve(server.url, server.id),
            );
          },
          resolvePollingInterval: () => settings.resolvePollingInterval(),
          ui,
        }),
    );
  }

  // -- abstract hooks -------------------------------------------------------

  protected override async buildSettingsList(): Promise<SettingsList> {
    const builder = new ServerItemBuilder(this.dialogs);
    const serverTimeout =
      this.options.serverTimeout ?? ServerTimeoutSettingsItem.defaultValue;
    const probes = await Promise.all(
      this.options.servers.map(async (server) => {
        const resolver = this.options.authResolver;
        const apiKey = resolver ? await resolver(server) : API_KEY_PLACEHOLDER;
        const client = new ApiClient(
          server.url,
          () => apiKey,
          this.options.resolvePollingInterval ??
            (() => Promise.resolve(ServerTimeoutSettingsItem.defaultValue)),
        );
        return ServerDisplay.healthEmoji(client, serverTimeout);
      }),
    );
    const items: SettingItem[] = this.options.servers.map((server, i) =>
      builder.buildRow(
        server,
        i,
        (field, value) => this.handleFieldChange(field, value),
        probes[i],
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
    const server = this.options.servers[idx];
    const updated = server
      ? ServerFields.byId(field).apply(server, value)
      : server;
    const next = server
      ? this.options.servers.map((s, i) => (i === idx ? updated : s))
      : this.options.servers;

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

  protected override beginAdd(): void {
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

  protected override deleteSelected(): void {
    const idx = this.selectedIndex;
    const next = this.options.servers.filter((_, i) => i !== idx);
    void this.persistSnapshot(next, () => {
      void this.rebuildList(idx);
    });
  }

  protected override readonly emptyHintKey = "emptyServers" as const;

  protected override getRowId(index: number): string {
    return `server-${index}`;
  }

  protected override getRowLabel(index: number): string {
    return this.options.servers[index]?.url ?? "";
  }

  protected override get deleteTitle(): string {
    return TITLES.deleteServer;
  }

  // -- wizard helpers --------------------------------------------------------

  private async saveNewServer(server: LlamaServer): Promise<void> {
    const next = [...this.options.servers, server];
    await this.persistSnapshot(next, () => {
      void this.rebuildList(next.length - 1);
    });

    // Warn the user if the newly added server requires an API key
    await this.warnIfAuthRequired(server);
  }

  /**
   * Probes the server to check if it requires an API key. If so, notifies
   * the user so they know to configure one via `/login` or `auth.json`.
   */
  private async warnIfAuthRequired(server: LlamaServer): Promise<void> {
    const ui = this.options.ui;
    if (!ui) return;

    const serverTimeout =
      this.options.serverTimeout ?? ServerTimeoutSettingsItem.defaultValue;
    const resolver = this.options.authResolver;
    const apiKey = resolver ? await resolver(server) : API_KEY_PLACEHOLDER;
    const client = new ApiClient(
      server.url,
      () => apiKey,
      this.options.resolvePollingInterval ??
        (() => Promise.resolve(ServerTimeoutSettingsItem.defaultValue)),
    );

    if (
      (await Server.check(client, serverTimeout)) === ServerStatus.UNAUTHORIZED
    ) {
      const providerId = ServerIds.resolve(server.url, server.id);
      ui.notify(authRequiredMessage(server.url, providerId), "warning");
    }
  }
}
