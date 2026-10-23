import type { BaseDialog } from "../dialog/base";
import type { DialogFactory } from "../dialog/factory";
import type { LlamaServer } from "../../interfaces/settings";
import type { SettingsService } from "../../settings/settings";
import type {
  KeybindingsManager,
  SettingsList,
  TUI,
} from "@earendil-works/pi-tui";

/**
 * Shared view interface for list-based controllers.
 *
 * Subtypes add domain-specific methods (e.g. getRowId, getRowLabel).
 */
export interface BaseListControllerHandle {
  /** Build the SettingsList from the current data snapshot. */
  buildSettingsList(): Promise<SettingsList>;
  /** Swap the internal list (called after rebuild). */
  setList(list: SettingsList): void;
  /** Callback when the user closes the editor. */
  onClose(): void;
  /** TUI instance for re-renders. */
  readonly tui: TUI;
  /** Whether the view is currently focused. */
  readonly isFocused: boolean;
  /** Returns the row id for the given index. */
  getRowId(index: number): string;
  /** Returns the row label for the given index. */
  getRowLabel(index: number): string;
}

/**
 * Shared options for list controllers.
 *
 * Subtypes add domain-specific fields (e.g. servers, authResolver).
 */
export interface BaseListControllerOptions {
  /** App keybindings manager. */
  keybindings: KeybindingsManager;
  /** TUI instance, used to request re-renders after async persists. */
  tui: TUI;
  /** Current snapshot of items to edit. Replaced after every successful persist. */
  servers: LlamaServer[];
  /** Notifies about persistence errors. */
  onError: (message: string) => void;
}

/**
 * Base class for list-based controllers.
 *
 * Holds shared state (active dialog, selected index) and common methods
 * (requestRender, focus management, dialog lifecycle). Subclasses implement
 * `getCount`, `persistSnapshot`, and `rebuildList` for their domain.
 */
export abstract class BaseListController {
  protected activeDialog: BaseDialog | undefined;
  protected selectedIndex = 0;

  constructor(
    protected readonly view: BaseListControllerHandle,
    protected readonly options: BaseListControllerOptions,
    public readonly dialogs: DialogFactory,
    protected readonly settings: SettingsService,
  ) {}

  // -- shared state management -------------------------------------------

  /** Returns the current selected index. */
  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  /** Requests a render from the TUI. */
  requestRender(): void {
    this.options.tui.requestRender();
  }

  /** Sets focus state to the active dialog. */
  setFocus(focused: boolean): void {
    if (this.activeDialog) this.activeDialog.focused = focused;
  }

  /** Returns the active dialog (if any). */
  getActiveDialog(): BaseDialog | undefined {
    return this.activeDialog;
  }

  /** Opens a modal dialog, setting its focus to match the view. */
  openDialog(dialog: BaseDialog): void {
    this.activeDialog = dialog;
    dialog.focused = this.view.isFocused;
    this.requestRender();
  }

  /** Closes the open modal dialog. */
  closeDialog(): void {
    this.activeDialog = undefined;
    this.requestRender();
  }

  // -- shared persistence ------------------------------------------------

  /**
   * Persists the given array via SettingsService.
   * Updates the snapshot on success; shows an error on failure.
   * @param next — The new server list to persist.
   * @returns True if the persist succeeded.
   */
  protected async persistSnapshot(next: LlamaServer[]): Promise<boolean> {
    try {
      await this.settings.setLlamaSettings({ servers: next });

      // Keep the local snapshot in sync — we already know the new state
      // (it's `next`), so re-reading from disk would be wasted I/O.
      this.options.servers = next;
      return true;
    } catch (err) {
      this.options.onError(String(err));
      this.requestRender();
      return false;
    }
  }

  // -- shared rebuild ----------------------------------------------------

  /**
   * Rebuilds the settings list and selects the target index.
   * @param targetIndex — Index to select after rebuild.
   */
  protected async rebuildList(targetIndex: number): Promise<void> {
    const list = await this.view.buildSettingsList();
    this.view.setList(list);
    const count = this.getCount();
    if (count === 0) {
      this.selectedIndex = 0;
      this.requestRender();
      return;
    }
    this.selectedIndex = Math.min(targetIndex, count - 1);
    list.selectItem(this.view.getRowId(this.selectedIndex));
    this.requestRender();
  }

  /** Returns the number of items in the current snapshot. */
  // -- dialog wiring helpers -----------------------------------------------

  /**
   * Opens an input dialog, auto-closing on submit or cancel.
   * @param title — Dialog title.
   * @param message — Prompt shown inside the dialog.
   * @param placeholder — Optional example value shown dim.
   * @param validate — Validation function; returns null on invalid input.
   * @param onSubmit — Action to call with the validated value.
   */
  protected openInputDialog(
    title: string,
    message: string,
    placeholder: string | undefined,
    validate: (raw: string) => string | null,
    onSubmit: (value: string) => void,
  ): void {
    const dialog = this.dialogs.input({
      title,
      message,
      placeholder,
      validate,
      onSubmit: (value: string) => {
        this.closeDialog();
        void onSubmit(value);
      },
      onCancel: () => this.closeDialog(),
    });
    this.openDialog(dialog);
  }

  /**
   * Opens a delete-confirmation dialog, auto-closing on confirm or cancel.
   * @param title — Dialog title.
   * @param name — The name of the entry being deleted.
   * @param onConfirm — Action to call on confirmation (fire-and-forget).
   */
  protected openConfirmDialog(
    title: string,
    name: string,
    onConfirm: () => void,
  ): void {
    const dialog = this.dialogs.confirmDelete(
      title,
      name,
      () => {
        this.closeDialog();
        void onConfirm();
      },
      () => this.closeDialog(),
    );
    this.openDialog(dialog);
  }

  protected abstract getCount(): number;

  // -- shared input delegation -------------------------------------------

  /**
   * Handles input delegation for dialog and keyboard navigation.
   * Returns true if the input was consumed.
   * Subclasses should call this first; if it returns false, handle domain
   * keybindings (e.g. "a" for add, "d" for delete).
   */
  protected delegateInput(data: string): boolean {
    // Delegate to open dialog first
    if (this.activeDialog) {
      this.activeDialog.handleInput(data);
      return true;
    }

    // Top-level keybindings
    const kb = this.options.keybindings;
    if (kb.matches(data, "tui.select.cancel")) {
      this.view.onClose();
      return true;
    }
    if (kb.matches(data, "tui.select.up")) {
      this.selectedIndex =
        this.selectedIndex === 0 ? this.getCount() - 1 : this.selectedIndex - 1;
      return false; // let the view forward to SettingsList
    }
    if (kb.matches(data, "tui.select.down")) {
      this.selectedIndex =
        this.selectedIndex === this.getCount() - 1 ? 0 : this.selectedIndex + 1;
      return false;
    }
    return false;
  }
}
