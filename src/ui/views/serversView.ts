import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { SettingItem, TUI } from "@earendil-works/pi-tui";
import { SettingsList } from "@earendil-works/pi-tui";
import { ApiClient } from "../../api/client";
import { ServerTimeoutSettingsItem } from "../../settings/items/serverTimeout";
import type { SettingsService } from "../../settings/settings";
import { ServerIds } from "../../utils/serverIds";
import { TITLES } from "../strings";
import type { ServersViewOptions } from "./listOptions";
import { ServerItemBuilder } from "../editors/server/itemBuilder";
import { ServerDisplay } from "../editors/server/utils";
import { ServerWizard } from "../editors/server/wizard";
import { View } from "./view";
import {
  ServersController,
  type ServersViewHandle,
} from "../controllers/serversController";

/**
 * Server list editor view.
 *
 * Implements {@link ServersViewHandle} so the controller can call back
 * into the view to build lists and get row info. Composes a
 * {@link ServersController} that manages the dialog lifecycle,
 * selectedIndex, and persistence.
 */
export class ServersView extends View implements ServersViewHandle {
  /** Controller managing dialogs, state, and persistence. */
  private readonly controller: ServersController;
  /** Whether this view is focused (delegated to active dialog). */
  isFocused = false;
  /** Title for the delete confirmation dialog. */
  readonly deleteTitle = TITLES.deleteServer;
  /** Resolves when the async initial build (health probes, list construction) completes. */
  readonly ready: Promise<void>;

  constructor(options: ServersViewOptions) {
    super();
    this.controller = new ServersController(this, options);
    this.ready = this.initialize();
  }

  /**
   * Async initial build: constructs the settings list and sets it.
   */
  private async initialize(): Promise<void> {
    try {
      const list = await this.buildSettingsList();
      this.setList(list);
    } catch {
      // Silently fail — the view will show "Loading..."
    }
    this.controller.requestRender();
  }

  /**
   * Opens the editor in a modal `ui.custom` dialog.
   */
  static async show(
    ui: ExtensionUIContext,
    settings: SettingsService,
  ): Promise<void> {
    const servers = await settings.getLlamaServers();
    const { serverTimeout } = await settings.resolveTimeouts();

    await ui.custom<void>(
      (tui, theme, keybindings, done) =>
        new ServersView({
          tui,
          theme,
          keybindings,
          servers,
          settings,
          done: () => done(undefined),
          onError: (message) => ui.notify(message, "error"),
          serverTimeout,
          authResolver: async (server) =>
            settings.resolveApiKey(ServerIds.resolve(server.url, server.id)),
          resolvePollingInterval: () => settings.resolvePollingInterval(),
          ui,
        }),
    );
  }

  // -- ViewHandle ----------------------------------------------------------

  /**
   * Builds the top-level settings list with health probes and field submenus.
   */
  async buildSettingsList(): Promise<SettingsList> {
    const builder = new ServerItemBuilder(this.controller.dialogs);
    const serverTimeout =
      this.controller.options.serverTimeout ??
      ServerTimeoutSettingsItem.defaultValue;
    const probes = await Promise.all(
      this.controller.options.servers.map(async (server) => {
        const resolver = this.controller.options.authResolver;
        const apiKey = resolver ? await resolver(server) : "placeholder";
        const client = new ApiClient(
          server.url,
          () => apiKey,
          this.controller.options.resolvePollingInterval ??
            (() => Promise.resolve(ServerTimeoutSettingsItem.defaultValue)),
        );
        return ServerDisplay.healthEmoji(client, serverTimeout);
      }),
    );
    const items: SettingItem[] = this.controller.options.servers.map(
      (server, i) =>
        builder.buildRow(
          server,
          i,
          (field, value) => this.handleFieldChange(field, value),
          probes[i],
          () => this.controller.trackSubmenu(),
        ),
    );

    return this.createList(items);
  }

  /** Swaps the internal list (called after rebuild). */
  setList(list: SettingsList): void {
    super.setList(list);
  }

  /** Returns the row id for the given index. */
  getRowId(index: number): string {
    return `server-${index}`;
  }

  /** Returns the row label (server URL) for the given index. */
  getRowLabel(index: number): string {
    return this.controller.options.servers[index]?.url ?? "";
  }

  get tui(): TUI {
    return this.controller.options.tui;
  }

  /** Closes the editor. */
  onClose(): void {
    this.controller.options.done();
  }

  /**
   * Opens the add-server wizard, managed by the controller.
   */
  beginAdd(): void {
    const wizard = new ServerWizard(this.controller.dialogs, (dialog) => {
      this.controller.openDialog(dialog);
    });
    wizard.start(
      (server) => {
        this.controller.closeDialog();
        void this.controller.addServer(server);
      },
      () => this.controller.closeDialog(),
    );
  }

  // -- Component -----------------------------------------------------------

  /**
   * Delegates input based on the active component:
   * 1. Active dialog → dialog
   * 2. Open submenu → list (which routes to its own submenu)
   * 3. Neither → controller keybindings
   */
  override handleInput(data: string): void {
    // If a submenu is open (field editor, wizard), delegate to the list
    if ((this.list as any)?.submenuComponent) {
      this.list?.handleInput(data);
      return;
    }
    // Delegate to active dialog
    const dialog = this.controller.getActiveDialog();
    if (dialog) {
      dialog.handleInput(data);
      return;
    }
    // Controller handles keybindings
    if (this.controller.delegateInput(data)) return;
    super.handleInput(data);
  }

  /**
   * Delegates to the active dialog if open, otherwise renders the list.
   */
  override render(width: number): string[] {
    // Delegate to active dialog if one is open
    const dialog = this.controller.getActiveDialog();
    if (dialog) {
      return dialog.render(width);
    }
    return super.render(width);
  }

  /** Invalidates both the list and the active dialog. */
  override invalidate(): void {
    this.list?.invalidate();
    this.controller.invalidateActiveDialog();
  }

  // -- Focusable -----------------------------------------------------------

  /** Whether this view is currently focused. */
  get focused(): boolean {
    return this.isFocused;
  }

  /** Sets focus and forwards to the active dialog. */
  set focused(value: boolean) {
    this.isFocused = value;
    this.controller.setFocus(value);
  }

  // -- helpers -------------------------------------------------------------

  /** Creates a SettingsList from items with the standard theme and cancel callback. */
  protected createList(items: SettingItem[]): SettingsList {
    return new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      () => {},
      () => this.controller.options.done(),
    );
  }

  /**
   * Forwards a field change to the controller for transformation, persistence, and rebuild.
   * @param field — The field id (e.g. "url", "id", "name").
   * @param value — The new value for the field.
   */
  private handleFieldChange(field: string, value: string): void {
    void this.controller.editServer(field, value);
  }
}
