import type { SettingsList, TUI } from "@earendil-works/pi-tui";
import type { LlamaServer } from "../../interfaces/settings";
import { ApiClient } from "../../api/client";
import { Server } from "../../servers/server";
import { ServerStatus } from "../../enums/serverStatus";
import { ServerIds } from "../../utils/serverIds";
import { authRequiredMessage } from "../strings";
import { DialogFactory } from "../dialog/factory";

import type { ServersViewOptions } from "../views/listOptions";
import { ServerFields } from "../editors/server/fields";
import { BaseListController } from "./baseListController";

/**
 * Interface for the view side of {@link ServersController}.
 *
 * The controller calls back into the view to build lists, manage dialogs,
 * and get row info. The view implements this interface.
 */
export interface ServersViewHandle {
  /** Build the top-level SettingsList from the current data snapshot. */
  buildSettingsList(): Promise<SettingsList>;
  /** Swap the internal list (called after rebuild). */
  setList(list: SettingsList): void;
  /** Returns the row id for the given index. */
  getRowId(index: number): string;
  /** Returns the row label for the given index. */
  getRowLabel(index: number): string;
  /** Title for the delete confirmation dialog. */
  readonly deleteTitle: string;
  /** Whether the view is currently focused. */
  readonly isFocused: boolean;
  /** Called by controller to start the add wizard. */
  beginAdd(): void;
  /** TUI instance for re-renders. */
  readonly tui: TUI;
  /** Callback when the user closes the editor. */
  onClose(): void;
}

/**
 * Controller for {@link ServersView}.
 *
 * Manages the dialog lifecycle (add wizard, input, confirm), selectedIndex
 * mirroring, submenu tracking with deferred rebuilds, and persistence.
 * Does not render anything — delegates rendering to the view.
 */
export class ServersController extends BaseListController {
  constructor(
    protected readonly view: ServersViewHandle,
    public readonly options: ServersViewOptions,
  ) {
    super(
      view,
      options,
      new DialogFactory(options.theme, options.tui),
      options.settings,
    );
  }

  // -- public API (called by ServersView) -----------------------------------

  /**
   * Called when a row's field submenu opens or closes.
   * Currently a no-op — deferred rebuilds were removed with commitFieldChange.
   */
  trackSubmenu(): void {
    // no-op — rebuilds happen synchronously after persistence
  }

  /**
   * Handles input delegation. Returns true if handled (add/delete/cancel).
   */
  delegateInput(data: string): boolean {
    if (super.delegateInput(data)) return true;
    if (data === "a") {
      this.beginAdd();
      return true;
    }
    if (data === "d") {
      this.beginConfirm();
      return true;
    }
    return false;
  }

  /**
   * Invalidates the active dialog (if any).
   */
  invalidateActiveDialog(): void {
    this.activeDialog?.invalidate();
  }

  /**
   * Adds a new server: appends, persists, rebuilds, and warns if auth required.
   */
  async addServer(server: LlamaServer): Promise<void> {
    const next = [...this.options.servers, server];
    const ok = await this.persistSnapshot(next);
    if (!ok) return;
    void this.rebuildList(next.length - 1);
    await this.warnIfAuthRequired(server);
  }

  /**
   * Edits the selected server's field: applies the change, persists, and rebuilds.
   * @param field — The field id (e.g. "url", "id", "name").
   * @param value — The new value for the field.
   */
  async editServer(field: string, value: string): Promise<void> {
    const idx = this.selectedIndex;
    const server = this.options.servers[idx];
    if (!server) return;
    const updated = ServerFields.byId(field).apply(server, value);
    const next = this.options.servers.map((s, i) => (i === idx ? updated : s));
    const ok = await this.persistSnapshot(next);
    if (!ok) return;
    void this.rebuildList(idx);
  }

  /**
   * Deletes a server: finds the index by identity, persists the removal,
   * and rebuilds.
   */
  async deleteServer(server: LlamaServer): Promise<void> {
    const idx = this.options.servers.indexOf(server);
    if (idx === -1) return;
    const next = this.options.servers.filter((_, i) => i !== idx);
    const ok = await this.persistSnapshot(next);
    if (!ok) return;
    void this.rebuildList(idx);
  }

  // -- private: CRUD -------------------------------------------------------

  /**
   * Persists the given server array via the options callback.
   * Updates the snapshot on success; shows an error on failure.
   * @param next — The new server array to persist.
   * @returns True if the persist succeeded.
   */

  // -- private: dialog helpers ---------------------------------------------

  /**
   * Opens the add-server wizard dialog.
   */
  private beginAdd(): void {
    this.view.beginAdd();
  }

  /**
   * Opens a confirmation dialog for deleting the selected server.
   * Calls {@link deleteServer} on confirm.
   */
  private beginConfirm(): void {
    const idx = this.selectedIndex;
    const name = this.view.getRowLabel(idx);
    if (!name) return;
    this.openConfirmDialog(this.view.deleteTitle, name, async () => {
      const server = this.options.servers[this.selectedIndex];
      if (server) await this.deleteServer(server);
    });
  }

  /**
   * Probes the server for authentication and shows a warning if unauthorized.
   * @param server — The server to probe.
   */
  private async warnIfAuthRequired(server: LlamaServer): Promise<void> {
    const ui = this.options.ui;
    if (!ui) return;

    const serverTimeout = this.options.serverTimeout ?? 1000;
    const resolver = this.options.authResolver;
    const apiKey = resolver ? await resolver(server) : "placeholder";
    const client = new ApiClient(
      server.url,
      () => apiKey,
      this.options.resolvePollingInterval ??
        (() => Promise.resolve(serverTimeout)),
    );

    if (
      (await Server.check(client, serverTimeout)) === ServerStatus.UNAUTHORIZED
    ) {
      ui.notify(
        authRequiredMessage(
          server.url,
          ServerIds.resolve(server.url, server.id),
        ),
        "warning",
      );
    }
  }

  // -- helpers -------------------------------------------------------------

  /** Returns the number of servers in the current snapshot. */
  protected getCount(): number {
    return this.options.servers.length;
  }
}
