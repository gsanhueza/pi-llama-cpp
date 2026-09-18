import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SettingItem, TUI } from "@earendil-works/pi-tui";
import { ConfirmDialog } from "./confirm";
import { InputDialog } from "./input";
import type { ConfirmDialogOptions, InputDialogOptions } from "./options";

/** `InputDialog` options minus the deps the factory injects. */
type InputOptions = Omit<InputDialogOptions, "theme" | "tui">;

/** `ConfirmDialog` options minus the deps the factory injects. */
type ConfirmOptions = Omit<ConfirmDialogOptions, "theme" | "tui">;

/**
 * Single factory for constructing dialogs. Holds `theme` and `tui` once
 * in the constructor so callers never thread the `{ theme, tui }` deps
 * tuple by hand, and so all dialog construction idioms (raw constructors,
 * static factories, per-field submenu builders) live in one place.
 *
 * Usage:
 * ```ts
 * const dialogs = new DialogFactory(theme, tui);
 * dialogs.input({ title, message, onSubmit, onCancel });
 * dialogs.confirmDelete(TITLES.deleteServer, name, onConfirm, onCancel);
 * dialogs.inputSubmenu(TITLES.edit(label), message, placeholder, validate);
 * ```
 */
export class DialogFactory {
  constructor(
    public readonly theme: Theme,
    /** Exposed for consumers that change UI state asynchronously after a
     * dialog commit (e.g. the wizard) and need to request a re-render. */
    public readonly tui: TUI,
  ) {}

  /** Creates a framed text-input dialog: Enter commits, Esc cancels. */
  input(options: InputOptions): InputDialog {
    return new InputDialog({ ...options, theme: this.theme, tui: this.tui });
  }

  /** Creates a framed confirmation dialog with a two-option select list. */
  confirm(options: ConfirmOptions): ConfirmDialog {
    return new ConfirmDialog({
      ...options,
      theme: this.theme,
      tui: this.tui,
    });
  }

  /**
   * Creates a delete confirmation dialog.
   *
   * @param title — Dialog title (e.g. `TITLES.deleteServer` or `TITLES.deleteOverride`).
   * @param name — The name of the entry being deleted.
   * @param onConfirm — Callback when the user confirms.
   * @param onCancel — Callback when the user cancels.
   */
  confirmDelete(
    title: string,
    name: string,
    onConfirm: () => void,
    onCancel: () => void,
  ): ConfirmDialog {
    return this.confirm({
      title,
      message: `Delete "${name}"?`,
      onConfirm,
      onCancel,
    });
  }

  /**
   * Builds a `SettingItem.submenu` factory that opens an `InputDialog`
   * (absorbs the former `InputSubmenuFactory`).
   *
   * The produced submenu prefills from the `currentValue` the containing
   * `SettingsList` passes at activation time — not a value captured at
   * build time — so re-entering a field after a commit shows the
   * just-saved value.
   *
   * @param title — Dialog title (e.g. `TITLES.edit(field.label)`).
   * @param message — Prompt shown inside the dialog.
   * @param placeholder — Optional example value shown dim in the dialog.
   * @param validate — Optional validation function for committed values.
   */
  inputSubmenu(
    title: string,
    message: string,
    placeholder?: string,
    validate?: (raw: string) => string | null,
  ): SettingItem["submenu"] {
    return (currentValue, done) => {
      const dialog = this.input({
        title,
        message,
        placeholder,
        initialValue: currentValue,
        validate,
        onSubmit: (value) => done(value),
        onCancel: () => done(undefined),
      });
      dialog.focused = true;
      return dialog;
    };
  }
}
