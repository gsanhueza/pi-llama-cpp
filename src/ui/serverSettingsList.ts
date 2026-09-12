import {
  getSettingsListTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type {
  Component,
  Focusable,
  KeybindingsManager,
  TUI,
} from "@earendil-works/pi-tui";
import { SettingsList, type SettingItem } from "@earendil-works/pi-tui";
import type { LlamaServer } from "../interfaces/settings";
import { ConfirmDialog, InputDialog } from "./dialog";
import { formatServerSuffix, normalizeServerUrl } from "./serverListEditor";
import { fieldMessage, FIELDS, HINTS, TITLES } from "./strings";

/**
 * Options for the SettingsList-based server editor.
 */
export interface ServerSettingsListOptions {
  /** TUI instance, used to request re-renders after async persists */
  tui: TUI;
  /** Theme for dialogs (from the ctx.ui.custom factory) */
  theme: Theme;
  /** App keybindings manager (injected by ctx.ui.custom) */
  keybindings: KeybindingsManager;
  /**
   * Snapshot of the merged `llamaSettings.servers` to edit. Replaced
   * in place (`options.servers = next`) after every successful persist
   * so the rebuilt rows reflect the adopted list.
   */
  servers: LlamaServer[];
  /** Persists a new server list; a rejection keeps the current list */
  persist: (next: LlamaServer[]) => Promise<void>;
  /** Closes the editor (called on Esc in the server list) */
  done: () => void;
  /** Notifies about persistence errors */
  onError: (message: string) => void;
}

/**
 * Builds the SettingItem for one server's editable fields (URL, id, name).
 * Each field is infinite → opens an `InputDialog` submenu; commits are
 * reported by the containing `SettingsList`'s `onChange` (field id → value).
 */
const buildServerFieldItems = (
  server: LlamaServer,
  theme: Theme,
  tui: TUI,
): SettingItem[] => [
  {
    id: "url",
    label: FIELDS.serverUrl.label,
    description: FIELDS.serverUrl.description,
    currentValue: server.url,
    submenu: InputDialog.inputSubmenu(
      theme,
      tui,
      TITLES.edit(FIELDS.serverUrl.label),
      fieldMessage(FIELDS.serverUrl),
      FIELDS.serverUrl.placeholder,
      server.url,
      normalizeServerUrl,
    ),
  },
  {
    id: "id",
    label: FIELDS.providerId.label,
    description: FIELDS.providerId.description,
    currentValue: server.id ?? "",
    submenu: InputDialog.inputSubmenu(
      theme,
      tui,
      TITLES.edit(FIELDS.providerId.label),
      fieldMessage(FIELDS.providerId),
      FIELDS.providerId.placeholder,
      server.id ?? "",
    ),
  },
  {
    id: "name",
    label: FIELDS.displayName.label,
    description: FIELDS.displayName.description,
    currentValue: server.name ?? "",
    submenu: InputDialog.inputSubmenu(
      theme,
      tui,
      TITLES.edit(FIELDS.displayName.label),
      fieldMessage(FIELDS.displayName),
      FIELDS.displayName.placeholder,
      server.name ?? "",
    ),
  },
];

/**
 * Builds the SettingItem for one server row in the top-level list.
 * Enter drills into the server's field-edit submenu.
 */
const buildServerRow = (
  server: LlamaServer,
  index: number,
  theme: Theme,
  tui: TUI,
  onChange: (field: string, value: string) => void,
): SettingItem => ({
  id: `server-${index}`,
  label: server.url,
  description: HINTS.serverRow,
  currentValue: formatServerSuffix(server),
  submenu: (_cv, done) => {
    // Rebuild the field items on open so they prefill with current values
    const items = buildServerFieldItems(server, theme, tui);
    return new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      // Field commits arrive here: done(value) from the input submenus
      (field, value) => onChange(field, value),
      done,
    );
  },
});

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
export class ServerSettingsList implements Component, Focusable {
  private settingsList: SettingsList;
  private mode: "list" | "wizard" | "confirm" = "list";
  private wizardStep = 0;
  private wizardUrl = "";
  private wizardId = "";
  private wizardDialog: InputDialog | undefined;
  private confirmDialog: ConfirmDialog | undefined;
  private isFocused = false;

  constructor(private readonly options: ServerSettingsListOptions) {
    this.settingsList = this.buildSettingsList();
  }

  /**
   * Builds the top-level `SettingsList` from the current
   * `options.servers`. Called on construction and rebuilt after every
   * successful persist so added/deleted/edited servers are reflected
   * immediately (the initial snapshot is not mutated by `persist`).
   */
  private buildSettingsList(): SettingsList {
    const { theme, tui } = this.options;
    const items: SettingItem[] = this.options.servers.map((server, i) =>
      buildServerRow(server, i, theme, tui, (field, value) =>
        this.handleFieldChange(field, value),
      ),
    );

    return new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      () => {
        // Top-level onChange is a no-op (servers don't change at this level)
      },
      () => {
        this.options.done();
      },
    );
  }

  // -- Focusable -----------------------------------------------------------

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    if (this.wizardDialog) this.wizardDialog.focused = value;
    if (this.confirmDialog) this.confirmDialog.focused = value;
  }

  // -- Component -----------------------------------------------------------

  invalidate(): void {
    this.settingsList.invalidate();
    this.wizardDialog?.invalidate();
    this.confirmDialog?.invalidate();
  }

  handleInput(data: string): void {
    if (this.mode === "wizard") {
      this.wizardDialog?.handleInput(data);
      return;
    }

    if (this.mode === "confirm") {
      this.confirmDialog?.handleInput(data);
      return;
    }

    const kb = this.options.keybindings;
    if (kb.matches(data, "tui.select.cancel")) {
      this.options.done();
      return;
    }
    // Track selection for add/delete
    if (kb.matches(data, "tui.select.up")) {
      this._selectedIndex =
        this._selectedIndex === 0
          ? this.options.servers.length - 1
          : this._selectedIndex - 1;
    }
    if (kb.matches(data, "tui.select.down")) {
      this._selectedIndex =
        this._selectedIndex === this.options.servers.length - 1
          ? 0
          : this._selectedIndex + 1;
    }
    if (data === "a") {
      this.beginWizard();
      return;
    }
    if (data === "d") {
      this.beginConfirm();
      return;
    }
    // Delegate to SettingsList (it handles up/down internally for rendering)
    this.settingsList.handleInput(data);
  }

  render(width: number): string[] {
    if (this.mode === "wizard") {
      return this.wizardDialog?.render(width) ?? [];
    }

    if (this.mode === "confirm") {
      return this.confirmDialog?.render(width) ?? [];
    }

    // List mode: the shortcuts live in the rows' description; only when the
    // list is empty (no rows → no description) show them as the hint line
    const settingsLines = this.settingsList.render(width);
    if (this.options.servers.length === 0) {
      settingsLines[settingsLines.length - 1] = getSettingsListTheme().hint(
        HINTS.emptyServers,
      );
    }
    return settingsLines;
  }

  // -- helpers ---------------------------------------------------------------

  private selectedIndex(): number {
    // Manual tracker for add/delete targeting, kept in sync with the
    // SettingsList's cursor by rebuildList (SettingsList doesn't expose
    // a getter)
    return this._selectedIndex;
  }

  private _selectedIndex = 0;

  /**
   * Rebuilds the server list and places the cursor on `targetIndex`
   * (clamped to the last row). A fresh SettingsList starts its cursor
   * at index 0, so `selectItem` is used to restore the position.
   */
  private rebuildList(targetIndex: number): void {
    this.settingsList = this.buildSettingsList();
    const count = this.options.servers.length;
    if (count === 0) {
      this._selectedIndex = 0;
      return;
    }
    const target = Math.min(targetIndex, count - 1);
    this._selectedIndex = target;
    this.settingsList.selectItem(`server-${target}`);
  }

  // -- add wizard ---------------------------------------------------------------

  /**
   * Opens the add wizard at step 1/3 (URL). Esc at any step cancels the
   * whole wizard; the server is persisted only after the final step.
   */
  private beginWizard(): void {
    this.mode = "wizard";
    this.wizardStep = 0;
    this.wizardUrl = "";
    this.wizardId = "";
    this.showWizardStep();
    this.options.tui.requestRender();
  }

  private showWizardStep(): void {
    const { theme, tui } = this.options;
    const step = this.wizardStep;

    const dialog =
      step === 0
        ? new InputDialog({
            theme,
            tui,
            title: TITLES.addServerStep(1),
            message: fieldMessage(FIELDS.serverUrl),
            placeholder: FIELDS.serverUrl.placeholder,
            validate: normalizeServerUrl,
            onSubmit: (value) => this.wizardSubmit(value),
            onCancel: () => this.cancelWizard(),
          })
        : step === 1
          ? new InputDialog({
              theme,
              tui,
              title: TITLES.addServerStep(2),
              message: fieldMessage(FIELDS.providerId, "(optional)"),
              placeholder: FIELDS.providerId.placeholder,
              onSubmit: (value) => this.wizardSubmit(value),
              onCancel: () => this.cancelWizard(),
            })
          : new InputDialog({
              theme,
              tui,
              title: TITLES.addServerStep(3),
              message: fieldMessage(FIELDS.displayName, "(optional)"),
              placeholder: FIELDS.displayName.placeholder,
              onSubmit: (value) => this.wizardSubmit(value),
              onCancel: () => this.cancelWizard(),
            });

    this.wizardDialog = dialog;
    dialog.focused = this.isFocused;
  }

  private wizardSubmit(value: string): void {
    if (this.wizardStep === 0) {
      this.wizardUrl = value;
      this.wizardStep = 1;
      this.showWizardStep();
    } else if (this.wizardStep === 1) {
      this.wizardId = value;
      this.wizardStep = 2;
      this.showWizardStep();
    } else {
      // Final step (display name): commit the collected fields
      this.wizardDialog = undefined;
      void this.saveNewServer(this.wizardUrl, this.wizardId, value);
      return;
    }
    this.options.tui.requestRender();
  }

  private cancelWizard(): void {
    this.wizardDialog = undefined;
    this.mode = "list";
    this.options.tui.requestRender();
  }

  private async saveNewServer(
    url: string,
    id: string,
    name: string,
  ): Promise<void> {
    const next = [
      ...this.options.servers,
      {
        url,
        ...(id.length > 0 ? { id } : {}),
        ...(name.length > 0 ? { name } : {}),
      },
    ];
    try {
      await this.options.persist(next);
      // Adopt the persisted list and rebuild so the new row appears;
      // the new server is appended last — put the cursor on it
      this.options.servers = next;
      this.rebuildList(next.length - 1);
      this.mode = "list";
    } catch (err) {
      this.options.onError(String(err));
      this.mode = "list";
    }
    this.options.tui.requestRender();
  }

  // -- delete ------------------------------------------------------------------

  private beginConfirm(): void {
    const server = this.options.servers[this.selectedIndex()];
    if (!server) return;

    this.mode = "confirm";
    this.confirmDialog = new ConfirmDialog({
      theme: this.options.theme,
      tui: this.options.tui,
      title: TITLES.deleteServer,
      message: `Delete "${server.url}"?`,
      onConfirm: () => {
        this.confirmDialog = undefined;
        void this.deleteSelected();
      },
      onCancel: () => {
        this.confirmDialog = undefined;
        this.mode = "list";
        this.options.tui.requestRender();
      },
    });
    this.confirmDialog.focused = this.isFocused;
    this.options.tui.requestRender();
  }

  private async deleteSelected(): Promise<void> {
    const idx = this.selectedIndex();
    const servers = this.options.servers;
    const next = servers.filter((_, i) => i !== idx);
    try {
      await this.options.persist(next);
      // Adopt the persisted list and rebuild so the row disappears;
      // the server that followed the deleted one now sits at the same
      // index (rebuildList clamps when the last row was deleted)
      this.options.servers = next;
      this.rebuildList(idx);
      this.mode = "list";
    } catch (err) {
      this.options.onError(String(err));
      this.mode = "list";
    }
    this.options.tui.requestRender();
  }

  private async handleFieldChange(field: string, value: string): Promise<void> {
    const idx = this._selectedIndex;
    const server = this.options.servers[idx];
    if (!server) return;

    const next = this.options.servers.map((s, i) => {
      if (i !== idx) return s;
      if (field === "url") return { ...s, url: value };
      if (field === "id") {
        const { id, ...rest } = s;
        return value.length === 0 ? rest : { ...rest, id: value };
      }
      const { name, ...rest } = s;
      return value.length === 0 ? rest : { ...rest, name: value };
    });

    try {
      await this.options.persist(next);
      // URL/id/name changes alter row labels → rebuild the list;
      // keep the cursor on the edited server
      this.options.servers = next;
      this.rebuildList(idx);
      this.options.tui.requestRender();
    } catch (err) {
      this.options.onError(String(err));
      this.options.tui.requestRender();
    }
  }
}
