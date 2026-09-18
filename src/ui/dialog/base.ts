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
  Spacer,
  Text,
} from "@earendil-works/pi-tui";

/**
 * Base dialog class encapsulating the shared Component plumbing (framed
 * container, input delegation, themes) so concrete dialogs only declare
 * their body and their input target — they don't repeat the
 * `invalidate`/`render`/`handleInput` delegation code.
 */
export abstract class BaseDialog {
  protected theme: Theme;
  protected tui: TUI;
  /** The framed container every concrete dialog renders into. */
  private readonly frame = new Container();

  constructor(theme: Theme, tui: TUI) {
    this.theme = theme;
    this.tui = tui;
  }

  // -- Component -------------------------------------------------------------

  invalidate(): void {
    this.frame.invalidate();
  }

  /** Routes input to the concrete dialog's interactive child. */
  handleInput(data: string): void {
    this.inputTarget.handleInput(data);
    this.tui.requestRender();
  }

  render(width: number): string[] {
    return this.frame.render(width);
  }

  // -- Focusable -------------------------------------------------------------

  private isFocused = false;

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    // Forward to the interactive child when it manages focus (e.g. the
    // text `Input`); plain select lists don't have a `focused` flag.
    const target = this.inputTarget as { focused?: boolean };
    if ("focused" in target) target.focused = value;
  }

  // -- shared utilities ------------------------------------------------------

  /** The component keystrokes are routed to (e.g. the text input or the
   * option list). */
  protected abstract get inputTarget(): {
    handleInput(data: string): void;
  };

  /**
   * Builds the framed chrome (borders, title, footer) around `body`.
   * Concrete dialogs call this once from their constructor, after
   * assembling the body.
   */
  protected setFrame(title: string, body: Component[], footer?: string): void {
    this.frame.addChild(
      new DynamicBorder((text) => this.theme.fg("accent", text)),
    );
    this.frame.addChild(
      new Text(this.theme.fg("accent", this.theme.bold(title)), 1, 0),
    );
    for (const child of body) this.frame.addChild(child);
    if (footer) {
      this.frame.addChild(new Spacer(1));
      this.frame.addChild(new Text(this.theme.fg("dim", footer), 1, 0));
    }
    this.frame.addChild(
      new DynamicBorder((text) => this.theme.fg("accent", text)),
    );
  }

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
}
