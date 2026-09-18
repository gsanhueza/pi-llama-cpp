import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { SettingsList } from "@earendil-works/pi-tui";
import type { LlamaServer } from "../../interfaces/settings";
import { BaseDialog } from "../dialog/base";
import { DialogFactory } from "../dialog/factory";
import { HINTS } from "../strings";
import type { SettingsListEditorOptions } from "./editorOptions";

// ─── Abstract base class ──────────────────────────────────────────────────

/**
 * Base class for SettingsList-based editors that manage a list of servers
 * with add/delete support at the top level.
 *
 * Subclasses must implement:
 * - {@link buildSettingsList} — how to build the top-level list items
 * - {@link beginAdd} — how to start the add wizard
 * - {@link deleteSelected} — how to delete the selected entry
 * - {@link getRowLabel} — display name for a row at the given index
 * - {@link emptyHintKey} — which hint to show when the list is empty
 * - {@link deleteTitle} — dialog title for the delete confirmation
 */
export abstract class ListEditor<
  O extends SettingsListEditorOptions = SettingsListEditorOptions,
> implements Component {
  protected settingsList: SettingsList | null = null;
  protected isFocused = false;
  /** The currently open modal dialog (add wizard, input, or confirm),
   * when one is up: input/render/invalidate/focus all delegate to it
   * until it is cleared via {@link closeDialog}. */
  protected activeDialog: BaseDialog | undefined;
  /** Dialog factory holding `theme`/`tui` once for all dialog construction. */
  protected readonly dialogs: DialogFactory;
  /** Whether a row's field submenu is open. While open, input is delegated
   * to the settingsList and list rebuilds are deferred: rebuilding would
   * discard the submenu and kick the user back to the list. */
  protected submenuOpen = false;
  /** Row index of a rebuild deferred by {@link commitFieldChange} while a
   * submenu was open; flushed by {@link trackSubmenu} on close. */
  private deferredRebuild: number | null = null;
  /** Selected row index. Mirrors the `SettingsList`'s selection, which is
   * `private` in pi-tui's typings and thus unreachable — so this copy is
   * advanced by the same wrap-around logic the list applies internally
   * (both handle the same up/down keypress). Kept in sync explicitly in
   * {@link rebuildList} via `selectItem`. */
  protected selectedIndex = 0;

  constructor(protected readonly options: O) {
    this.dialogs = new DialogFactory(options.theme, options.tui);
  }

  // -- abstract hooks -------------------------------------------------------

  /** Build the top-level SettingsList from the current data snapshot. */
  protected abstract buildSettingsList(): SettingsList | Promise<SettingsList>;

  /** Start the add wizard (called when user presses "a"). */
  protected abstract beginAdd(): void;

  /** Delete the currently selected entry (called after confirmation). */
  protected abstract deleteSelected(): void;

  /** Hint line key for the empty-list state. */
  protected abstract readonly emptyHintKey:
    | "emptyServers"
    | "emptyOverrideEntries";

  /** Total item count (entries or servers) for selection clamping. */
  protected abstract getCurrentCount(): number;

  /** Returns the id for a row at the given index. */
  protected abstract getRowId(index: number): string;

  /** Returns the display label for a row at the given index. */
  protected abstract getRowLabel(index: number): string;

  /** Title for the delete confirmation dialog (e.g. "Delete server"). */
  protected abstract get deleteTitle(): string;

  // -- Focusable ------------------------------------------------------------

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    if (this.activeDialog) this.activeDialog.focused = value;
  }

  // -- Component ------------------------------------------------------------

  invalidate(): void {
    this.settingsList?.invalidate();
    this.activeDialog?.invalidate();
  }

  handleInput(data: string): void {
    // Delegate to the open modal dialog, if any
    if (this.activeDialog) {
      this.activeDialog.handleInput(data);
      return;
    }

    // Delegate to settingsList if a submenu is open
    if (this.submenuOpen && this.settingsList) {
      this.settingsList.handleInput(data);
      return;
    }

    // Top-level keybindings. Up/down mirror the wrap-around the
    // `SettingsList` applies internally to the same keypress (its
    // selection is private — see the {@link selectedIndex} doc); the
    // trailing forward to `settingsList.handleInput` is what actually
    // moves the rendered cursor.
    const kb = this.options.keybindings;
    if (kb.matches(data, "tui.select.cancel")) {
      this.options.done();
      return;
    }
    if (kb.matches(data, "tui.select.up")) {
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.getCurrentCount() - 1
          : this.selectedIndex - 1;
    }
    if (kb.matches(data, "tui.select.down")) {
      this.selectedIndex =
        this.selectedIndex === this.getCurrentCount() - 1
          ? 0
          : this.selectedIndex + 1;
    }
    if (data === "a") {
      this.beginAdd();
      return;
    }
    if (data === "d") {
      this.beginConfirm();
      return;
    }
    if (this.settingsList) {
      this.settingsList.handleInput(data);
    }
  }

  render(width: number): string[] {
    // Delegate to the open modal dialog, if any
    if (this.activeDialog) return this.activeDialog.render(width);

    // Empty list hint
    if (!this.settingsList) return ["Loading..."];
    const lines = this.settingsList.render(width);
    if (this.getCurrentCount() === 0) {
      lines[lines.length - 1] = getSettingsListTheme().hint(
        HINTS[this.emptyHintKey],
      );
    }
    return lines;
  }

  // -- helpers ---------------------------------------------------------------

  /**
   * Rebuilds the list and places the cursor on `targetIndex`.
   * Subclasses call this after add/delete/persist to refresh the UI.
   */
  protected async rebuildList(targetIndex: number): Promise<void> {
    const list = await this.buildSettingsList();
    this.settingsList = list;
    const count = this.getCurrentCount();
    if (count === 0) {
      this.selectedIndex = 0;
      return;
    }
    this.selectedIndex = Math.min(targetIndex, count - 1);
    this.settingsList.selectItem(this.getRowId(this.selectedIndex));
    // Rebuilding is async (health checks); request a render only once the
    // new list is in place, otherwise the old frame stays on screen
    this.options.tui.requestRender();
  }

  /**
   * Tracks a row's field submenu opening or closing. While a submenu is
   * open, {@link rebuildList} would discard it and kick the user back to
   * the list — so a rebuild deferred by {@link commitFieldChange} is
   * flushed here on close instead of running mid-edit.
   */
  protected trackSubmenu(open: boolean): void {
    this.submenuOpen = open;
    if (open) return;
    const index = this.deferredRebuild;
    this.deferredRebuild = null;
    if (index !== null) void this.rebuildList(index);
  }

  /**
   * Opens a modal dialog: input/render delegate to it until
   * {@link closeDialog}. Focus follows the editor's.
   */
  protected openDialog(dialog: BaseDialog): void {
    this.activeDialog = dialog;
    dialog.focused = this.isFocused;
    this.options.tui.requestRender();
  }

  /** Closes the open modal dialog and returns to the list. */
  protected closeDialog(): void {
    this.activeDialog = undefined;
    this.options.tui.requestRender();
  }

  /**
   * Opens the delete confirmation dialog.
   */
  protected beginConfirm(): void {
    const idx = this.selectedIndex;
    const name = this.getRowLabel(idx);
    if (!name) return;

    this.openDialog(
      this.dialogs.confirmDelete(
        this.deleteTitle,
        name,
        () => {
          this.closeDialog();
          void this.deleteSelected();
        },
        () => this.closeDialog(),
      ),
    );
  }

  /**
   * Persists `next`; on success adopts it and runs `onSuccess`;
   * on failure notifies and stays in list mode.
   *
   * Callers must close any open dialog *before* the async persist:
   * render() returns the list once `activeDialog` is cleared, so
   * leaving the dialog open would blank the screen mid-save.
   */
  protected async persistSnapshot(
    next: LlamaServer[],
    onSuccess: () => void,
  ): Promise<void> {
    try {
      await this.options.persist(next);
    } catch (err) {
      this.options.onError(String(err));
      this.options.tui.requestRender();
      return;
    }
    this.options.servers = next;
    onSuccess();
  }

  /**
   * Handles a field commit from an open row submenu: persists `next` and,
   * on success, refreshes the open submenu UI in place via `refresh`, then
   * defers the full list rebuild of row `deferIndex` until the submenu
   * closes (rebuilding now would discard the submenu and kick the user
   * back to the list — see {@link trackSubmenu}). No-op when
   * `next` is the current list (unchanged, callers compare by reference).
   */
  protected commitFieldChange(
    next: LlamaServer[],
    deferIndex: number | null,
    refresh: () => void,
  ): void {
    if (next === this.options.servers) return;
    void this.persistSnapshot(next, () => {
      refresh();
      if (deferIndex !== null && this.submenuOpen)
        this.deferredRebuild = deferIndex;
      this.options.tui.requestRender();
    });
  }
}
