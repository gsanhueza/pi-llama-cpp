import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import type {
  Component,
  Focusable,
  Keybinding,
  SelectListTheme,
  TUI,
} from "@earendil-works/pi-tui";
import {
  Container,
  getKeybindings,
  Input,
  SelectList,
  Spacer,
  Text,
} from "@earendil-works/pi-tui";

/**
 * Dialog primitives styled after pi's `/login` flow (`LoginDialogComponent`)
 * and the built-in llama.cpp `/llama` view: a `DynamicBorder` frame with an
 * accent bold title, a body area, and a dim key-hint footer.
 *
 * Themes are always passed in explicitly (from the `ctx.ui.custom` factory)
 * instead of relying on pi's global `theme` proxy, which may not be
 * initialized in extension module caches.
 */

/** Theme for `SelectList` rows, mirroring the `/llama` view's selection colors */
export const selectListTheme = (theme: Theme): SelectListTheme => ({
  selectedPrefix: (text) => theme.fg("accent", text),
  selectedText: (text) => theme.fg("accent", text),
  description: (text) => theme.fg("muted", text),
  scrollInfo: (text) => theme.fg("dim", text),
  noMatch: (text) => theme.fg("warning", text),
});

/** Dim key-hint text for an action, e.g. "return save" (theme-aware) */
const hint = (
  theme: Theme,
  action: Keybinding,
  description: string,
): string => {
  const keys = getKeybindings().getKeys(action).join("/");
  return theme.fg("dim", keys) + theme.fg("muted", ` ${description}`);
};

const inputFooter = (theme: Theme): string =>
  `${hint(theme, "tui.select.confirm", "save")} • ${hint(theme, "tui.select.cancel", "cancel")}`;

const selectFooter = (theme: Theme): string =>
  `${hint(theme, "tui.select.confirm", "select")} • ${hint(theme, "tui.select.cancel", "cancel")}`;

/**
 * Builds the framed dialog shell: border, accent bold title, body children
 * and an optional dim footer line, closed by a bottom border.
 */
export const createFrame = (
  theme: Theme,
  title: string,
  body: Component[],
  footer?: string,
): Container => {
  const container = new Container();
  container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
  container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
  for (const child of body) container.addChild(child);
  if (footer) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("dim", footer), 1, 0));
  }
  container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
  return container;
};

/**
 * Shared `SettingItem.submenu` factory for the text fields of both editors.
 * Opens an `InputDialog` pre-filled with `initialValue`; Enter commits the
 * validated value via `done(value)`, Esc cancels via `done(undefined)` —
 * matching `ValidatedInputSubmenu`'s contract with `SettingsList.onChange`.
 */
export const inputSubmenu =
  (
    theme: Theme,
    tui: TUI,
    title: string,
    message: string,
    placeholder: string | undefined,
    initialValue: string,
    validate?: (raw: string) => string | null,
  ) =>
  (
    _currentValue: string,
    done: (selectedValue?: string) => void,
  ): Component => {
    const dialog = new InputDialog({
      theme,
      tui,
      title,
      message,
      placeholder,
      initialValue,
      validate,
      onSubmit: (value) => done(value),
      onCancel: () => done(undefined),
    });
    // The submenu owns the keyboard while open (the TUI only tracks the
    // outer focused component), so mark it focused to render the cursor.
    dialog.focused = true;
    return dialog;
  };

export interface InputDialogOptions {
  theme: Theme;
  /** Used to request re-renders after input handling */
  tui: TUI;
  /** Accent title shown in the frame header */
  title: string;
  /** Prompt shown above the input */
  message: string;
  /** Shown dim as `e.g., <placeholder>` when provided */
  placeholder?: string;
  /** Pre-filled value; the cursor is placed at the end */
  initialValue?: string;
  /**
   * Returns the sanitized value to commit, or `null` when the input is
   * invalid (the dialog stays open and shows a themed error line).
   * Defaults to identity.
   */
  validate?: (raw: string) => string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * A framed single-line text entry dialog, modeled on pi's
 * `LoginDialogComponent.showPrompt`: message, dim example placeholder, a
 * real `Input` (cursor, history editing, paste handling) and key hints.
 * Enter validates and submits; Esc cancels; invalid input shows a themed
 * error and keeps the dialog open.
 */
export class InputDialog implements Component, Focusable {
  private readonly options: InputDialogOptions;
  private readonly body = new Container();
  private readonly container: Container;
  private readonly input = new Input();
  private errorText: Text | undefined;

  constructor(options: InputDialogOptions) {
    this.options = options;
    const { theme } = options;

    const initial = options.initialValue ?? "";
    this.input.setValue(initial);
    // Move the cursor to the end of the pre-filled value
    for (let i = 0; i < [...initial].length; i++) {
      this.input.handleInput("\x1b[C");
    }
    this.input.onSubmit = (value) => this.submit(value);
    this.input.onEscape = () => options.onCancel();

    this.body.addChild(new Text(theme.fg("text", options.message), 1, 0));
    if (options.placeholder) {
      this.body.addChild(
        new Text(theme.fg("dim", `e.g., ${options.placeholder}`), 1, 0),
      );
    }
    this.body.addChild(this.input);

    this.container = createFrame(
      theme,
      options.title,
      [this.body],
      inputFooter(theme),
    );
  }

  // -- Component -------------------------------------------------------------

  invalidate(): void {
    this.container.invalidate();
  }

  handleInput(data: string): void {
    // Input handles Enter (submit) and Esc (cancel) internally via the
    // app keybindings; everything else edits the value.
    this.input.handleInput(data);
    this.options.tui.requestRender();
  }

  render(width: number): string[] {
    return this.container.render(width);
  }

  // -- Focusable ---------------------------------------------------------------

  get focused(): boolean {
    return this.input.focused;
  }

  set focused(value: boolean) {
    this.input.focused = value;
  }

  // -- helpers -------------------------------------------------------------------

  private submit(raw: string): void {
    const validated = this.options.validate ? this.options.validate(raw) : raw;
    if (validated === null) {
      this.setError(`Invalid value "${raw}"`);
      return;
    }
    this.options.onSubmit(validated);
  }

  private setError(message: string | undefined): void {
    if (this.errorText) {
      this.body.removeChild(this.errorText);
      this.errorText = undefined;
    }
    if (message) {
      this.errorText = new Text(this.options.theme.fg("error", message), 1, 0);
      this.body.addChild(this.errorText);
    }
    this.options.tui.requestRender();
  }
}

export interface ConfirmDialogOptions {
  theme: Theme;
  tui: TUI;
  /** Accent title shown in the frame header */
  title: string;
  /** Question shown above the options */
  message: string;
  /** Label for the confirming option (default "Delete") */
  confirmLabel?: string;
  /** Label for the cancelling option (default "Cancel") */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A framed confirmation dialog with a two-option `SelectList`
 * (Delete / Cancel), matching the confirm pattern of pi's `/llama` view.
 * Esc selects the cancel option.
 */
export class ConfirmDialog implements Component, Focusable {
  private readonly options: ConfirmDialogOptions;
  private readonly container: Container;
  private readonly list: SelectList;
  private isFocused = false;

  constructor(options: ConfirmDialogOptions) {
    this.options = options;
    const confirmLabel = options.confirmLabel ?? "Delete";
    const cancelLabel = options.cancelLabel ?? "Cancel";

    this.list = new SelectList(
      [
        { value: "confirm", label: confirmLabel },
        { value: "cancel", label: cancelLabel },
      ],
      2,
      selectListTheme(options.theme),
    );
    this.list.onSelect = (item) => {
      if (item.value === "confirm") options.onConfirm();
      else options.onCancel();
    };
    this.list.onCancel = () => options.onCancel();

    this.container = createFrame(
      options.theme,
      options.title,
      [
        new Text(options.theme.fg("text", options.message), 1, 0),
        new Spacer(1),
        this.list,
      ],
      selectFooter(options.theme),
    );
  }

  // -- Component -------------------------------------------------------------

  invalidate(): void {
    this.container.invalidate();
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
    this.options.tui.requestRender();
  }

  render(width: number): string[] {
    return this.container.render(width);
  }

  // -- Focusable ---------------------------------------------------------------

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
  }
}
