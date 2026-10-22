import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/**
 * Base class for /models subcommand menus.
 *
 * Provides a protected `label` (used in TUI-mode warnings) and
 * `checkTUIMode()` which returns `false` when the context is not
 * interactive. Subclasses that need the guard call it at the top of
 * `show()`; those that don't simply skip it.
 */
export abstract class BaseMenu {
  protected abstract label: string;

  /**
   * Checks that the command runs in TUI mode.
   *
   * @returns `true` if the context is interactive; `false` if a
   *   warning was already sent and the caller should bail.
   */
  protected checkTUIMode(ctx: ExtensionCommandContext): boolean {
    if (ctx.mode !== "tui") {
      ctx.ui.notify(
        `/models ${this.label} requires an interactive session (TUI)`,
        "warning",
      );
      return false;
    }
    return true;
  }
}
