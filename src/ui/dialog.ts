import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import type {
  Component,
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
 * Base dialog class encapsulating shared UI utilities (frame, hints,
 * themes) so concrete dialogs don't duplicate code.
 */
abstract class BaseDialog {
  protected theme: Theme;
  protected tui: TUI;

  constructor(theme: Theme, tui: TUI) {
    this.theme = theme;
    this.tui = tui;
  }

  // -- shared utilities ------------------------------------------------------

  protected selectListTheme(): SelectListTheme {
    return {
      selectedPrefix: (text) => this.theme.fg("accent", text),
      selectedText: (text) => this.theme.fg("accent", text),
      description: (text) => this.theme.fg("muted", text),
      scrollInfo: (text) => this.theme.fg("dim", text),
      noMatch: (text) => this.theme.fg("warning", text),
    };
  }

  protected hint(action: Keybinding, description: string): string {
    const keys = getKeybindings().getKeys(action).join("/");
    return (
      this.theme.fg("dim", keys) + this.theme.fg("muted", ` ${description}`)
    );
  }

  protected inputFooter(): string {
    return `${this.hint("tui.select.confirm", "save")} • ${this.hint("tui.select.cancel", "cancel")}`;
  }

  protected selectFooter(): string {
    return `${this.hint("tui.select.confirm", "select")} • ${this.hint("tui.select.cancel", "cancel")}`;
  }

  protected createFrame(
    title: string,
    body: Component[],
    footer?: string,
  ): Container {
    const container = new Container();
    container.addChild(
      new DynamicBorder((text) => this.theme.fg("accent", text)),
    );
    container.addChild(
      new Text(this.theme.fg("accent", this.theme.bold(title)), 1, 0),
    );
    for (const child of body) container.addChild(child);
    if (footer) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(this.theme.fg("dim", footer), 1, 0));
    }
    container.addChild(
      new DynamicBorder((text) => this.theme.fg("accent", text)),
    );
    return container;
  }
}

/**
 * Shared `SettingItem.submenu` factory for the text fields of both editors.
 * Opens an `InputDialog` pre-filled with `initialValue`; Enter commits the
 * validated value via `done(value)`, Esc cancels via `done(undefined)`.
 */
export class InputDialog extends BaseDialog {
  private readonly options: InputDialogOptions;
  private readonly body = new Container();
  private readonly container: Container;
  private readonly input = new Input();
  private errorText: Text | undefined;

  constructor(options: InputDialogOptions) {
    super(options.theme, options.tui);
    this.options = options;

    const initial = options.initialValue ?? "";
    this.input.setValue(initial);
    for (let i = 0; i < [...initial].length; i++) {
      this.input.handleInput("\x1b[C");
    }
    this.input.onSubmit = (value) => this.submit(value);
    this.input.onEscape = () => options.onCancel();

    this.body.addChild(new Text(this.theme.fg("text", options.message), 1, 0));
    if (options.placeholder) {
      this.body.addChild(
        new Text(this.theme.fg("dim", `e.g., ${options.placeholder}`), 1, 0),
      );
    }
    this.body.addChild(this.input);

    this.container = this.createFrame(
      options.title,
      [this.body],
      this.inputFooter(),
    );
  }

  // -- Component -------------------------------------------------------------

  invalidate(): void {
    this.container.invalidate();
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
    this.tui.requestRender();
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
      this.errorText = new Text(this.theme.fg("error", message), 1, 0);
      this.body.addChild(this.errorText);
    }
    this.tui.requestRender();
  }

  /**
   * Builds a `SettingItem.submenu` factory that opens an `InputDialog`.
   */
  static inputSubmenu =
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
      dialog.focused = true;
      return dialog;
    };
}

export interface InputDialogOptions {
  theme: Theme;
  tui: TUI;
  title: string;
  message: string;
  placeholder?: string;
  initialValue?: string;
  validate?: (raw: string) => string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * A framed confirmation dialog with a two-option `SelectList`
 * (Delete / Cancel), matching the confirm pattern of pi's `/llama` view.
 */
export class ConfirmDialog extends BaseDialog {
  private readonly options: ConfirmDialogOptions;
  private readonly container: Container;
  private readonly list: SelectList;
  private isFocused = false;

  constructor(options: ConfirmDialogOptions) {
    super(options.theme, options.tui);
    this.options = options;

    this.list = new SelectList(
      [
        { value: "confirm", label: options.confirmLabel ?? "Delete" },
        { value: "cancel", label: options.cancelLabel ?? "Cancel" },
      ],
      2,
      this.selectListTheme(),
    );
    this.list.onSelect = (item) => {
      if (item.value === "confirm") options.onConfirm();
      else options.onCancel();
    };
    this.list.onCancel = () => options.onCancel();

    this.container = this.createFrame(
      options.title,
      [
        new Text(this.theme.fg("text", options.message), 1, 0),
        new Spacer(1),
        this.list,
      ],
      this.selectFooter(),
    );
  }

  // -- Component -------------------------------------------------------------

  invalidate(): void {
    this.container.invalidate();
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
    this.tui.requestRender();
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

export interface ConfirmDialogOptions {
  theme: Theme;
  tui: TUI;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}
