import { Container, Input, Text } from "@earendil-works/pi-tui";
import { BaseDialog } from "./base";
import type { InputDialogOptions } from "./options";

/**
 * Framed text-input dialog: Enter commits the validated value, Esc cancels.
 */
export class InputDialog extends BaseDialog {
  private readonly options: InputDialogOptions;
  private readonly body = new Container();
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

    this.setFrame(options.title, [this.body], this.inputFooter());
  }

  // -- helpers -------------------------------------------------------------------

  protected get inputTarget() {
    return this.input;
  }

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
}
