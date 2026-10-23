import type { Component } from "@earendil-works/pi-tui";
import type { SettingsList } from "@earendil-works/pi-tui";

/**
 * Base class for list-based views.
 *
 * Composes a `SettingsList` and delegates render/input/invalidate to it.
 * Subclasses set `this.list` directly (or via {@link setList}).
 */
export abstract class View implements Component {
  protected list: SettingsList | null = null;

  render(width: number): string[] {
    return this.list?.render(width) ?? ["Loading..."];
  }

  handleInput(data: string): void {
    this.list?.handleInput(data);
  }

  invalidate(): void {
    this.list?.invalidate();
  }

  /**
   * Swap the internal list (used by controllers to rebuild after CRUD).
   */
  protected setList(list: SettingsList): void {
    this.list = list;
  }
}
