import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { Input } from "@earendil-works/pi-tui";

/**
 * A submenu component that wraps an `Input` with validation.
 *
 * - Enter validates the value; on success calls `done(value)`, on failure
 *   shows an inline error and keeps the input open.
 * - Esc calls `done("")` to cancel (keeps the current value unchanged).
 *
 * The Input is pre-filled with `currentValue` and the cursor is placed at
 * the end.
 */
export class ValidatedInputSubmenu implements Component, Focusable {
  private readonly input = new Input();
  private error: string | undefined;

  constructor(
    private readonly currentValue: string,
    private readonly validate: (raw: string) => string | null,
    private readonly done: (value: string | undefined) => void,
    private readonly tui: TUI,
  ) {
    this.input.setValue(currentValue);
    // Move cursor to end
    for (let i = 0; i < [...currentValue].length; i++) {
      this.input.handleInput("\x1b[C");
    }
  }

  // -- Focusable -----------------------------------------------------------

  get focused(): boolean {
    return this.input.focused;
  }

  set focused(value: boolean) {
    this.input.focused = value;
  }

  // -- Component -----------------------------------------------------------

  invalidate(): void {
    this.input.invalidate();
  }

  handleInput(data: string): void {
    // Enter: validate and call done
    if (data === "\r" || data === "\n") {
      const raw = this.input.getValue();
      const sanitized = this.validate(raw);
      if (sanitized === null) {
        this.error = `Invalid value "${raw}"`;
        this.tui.requestRender();
        return; // keep input open
      }
      this.done(sanitized);
      return;
    }
    // Esc: cancel
    if (data === "\u001b") {
      this.done(undefined);
      return;
    }
    // Everything else goes to the Input
    this.input.handleInput(data);
    this.error = undefined;
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const lines = this.input.render(width);
    if (this.error) {
      lines.push(this.error);
    }
    return lines;
  }
}
