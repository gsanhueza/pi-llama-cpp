import type { Component, TUI } from "@earendil-works/pi-tui";
import {
  SettingsList,
  truncateToWidth,
  type SettingItem,
  type SettingsListTheme,
} from "@earendil-works/pi-tui";

/**
 * Optional row-action hooks for a {@link ResettableSettingsList}.
 *
 * When provided, the list intercepts the corresponding keys on the main
 * list (never while a submenu or modal is open) and invokes the hook.
 */
export interface SettingsListActions {
  /**
   * Invoked when `a` is pressed on the main list.
   *
   * @returns Nothing.
   */
  onAdd?: () => void;
  /**
   * Invoked when `d` is pressed on the main list.
   *
   * @param itemId The id of the selected item.
   * @returns Nothing.
   */
  onDelete?: (itemId: string) => void;
}

/**
 * SettingsList with an `r` shortcut ("return to default" for the selected
 * row) and optional add/remove action hooks.
 *
 * What a reset means (drop an override key, restore a built-in default, …)
 * is decided by the `onReset` callback; likewise add/remove semantics live
 * in the optional {@link SettingsListActions} hooks. The base class ignores
 * unrecognized keys and delegates all input to the active submenu when one
 * is open, so these shortcuts only trigger on the main list: nested lists
 * (which handle their own keys) and text inputs (which need the letters)
 * are never affected.
 */
export class ResettableSettingsList extends SettingsList {
  /** Saved for re-rendering the advertised hint line in `render`. */
  private readonly hintTheme: SettingsListTheme;
  /** TUI instance for post-action re-renders. */
  private readonly tui: TUI;
  /** Optional add/remove hooks. */
  private readonly actions: SettingsListActions;

  /**
   * Creates the list.
   *
   * @param items The settings items to display.
   * @param maxVisible Maximum visible items.
   * @param theme The settings list theme.
   * @param onChange Callback when a setting changes.
   * @param onCancel Callback when the user cancels/closes the list.
   * @param onReset Callback when a setting is reset via `r`.
   * @param tui The TUI instance for re-renders.
   * @param actions Optional add/remove hooks (`a`/`d` keys).
   */
  constructor(
    items: SettingItem[],
    maxVisible: number,
    theme: SettingsListTheme,
    onChange: (id: string, newValue: string) => void,
    onCancel: () => void,
    onReset: (id: string) => void,
    tui: TUI,
    actions?: SettingsListActions,
  ) {
    super(items, maxVisible, theme, onChange, onCancel);
    this.hintTheme = theme;
    this.tui = tui;
    this.actions = actions ?? {};
    this.onReset = onReset;
  }

  /** The reset callback (stored for the handleInput override). */
  private onReset: (id: string) => void;

  /**
   * Handles input, intercepting `r` (reset), `a` (add) and `d` (remove)
   * when no submenu is open.
   *
   * @param data The input data string.
   */
  override handleInput(data: string): void {
    if (this.hasOpenSubmenu()) {
      super.handleInput(data);
      return;
    }

    if (data === "a" && this.actions.onAdd) {
      this.actions.onAdd();
      this.tui.requestRender();
      return;
    }
    if (data === "d" && this.actions.onDelete) {
      const item = this.getSelectedItem();
      if (item) {
        this.actions.onDelete(item.id);
        this.tui.requestRender();
        return;
      }
    }
    if (data === "r") {
      const item = this.getSelectedItem();
      if (item) {
        this.onReset(item.id);
        this.tui.requestRender();
        return;
      }
    }
    super.handleInput(data);
  }

  /**
   * Replaces the list items in place (the component instance held by the
   * TUI stays the same). Selection is clamped to the new item count.
   *
   * @param items The new items to display.
   */
  setItems(items: SettingItem[]): void {
    const internal = this.internals;
    internal.items = items;
    internal.filteredItems = items;
    internal.selectedIndex = Math.min(
      internal.selectedIndex,
      Math.max(0, items.length - 1),
    );
  }

  /**
   * Shows a modal overlay component: while open it captures all input and
   * replaces the list in rendering (same mechanics as a submenu).
   *
   * @param modal The component to display as a modal.
   */
  showModal(modal: Component): void {
    this.internals.submenuComponent = modal;
    this.internals.submenuItemIndex = null;
    this.tui.requestRender();
  }

  /**
   * Closes the modal overlay (if any).
   */
  closeModal(): void {
    this.internals.submenuComponent = null;
    this.internals.submenuItemIndex = null;
  }

  /**
   * Renders the list with an added hint advertising the active shortcuts.
   *
   * @param width The available terminal width.
   * @returns An array of rendered text lines.
   */
  override render(width: number): string[] {
    const lines = super.render(width);
    const last = lines[lines.length - 1];
    if (last === undefined) return lines;

    // Empty list: advertise the add shortcut instead of the generic hint
    if (this.actions.onAdd && this.internals.items.length === 0) {
      lines[lines.length - 1] = truncateToWidth(
        this.hintTheme.hint(
          "  Press (a) to add a provider override · Esc to cancel",
        ),
        width,
      );
      return lines;
    }

    // Advertise the shortcuts in the standard hint line (the base class
    // renders it last whenever the list is non-empty)
    if (last.includes("Esc to cancel")) {
      const parts = ["Enter/Space to change"];
      if (this.actions.onAdd) parts.push("a add");
      if (this.actions.onDelete) parts.push("d remove");
      parts.push("r reset to default", "Esc to cancel");
      lines[lines.length - 1] = truncateToWidth(
        this.hintTheme.hint(`  ${parts.join(" · ")}`),
        width,
      );
    }
    return lines;
  }

  /**
   * `items`/`filteredItems`/`selectedIndex`/`submenuComponent`/
   * `submenuItemIndex` are private in the base class (with no public
   * accessor); bracket access keeps this subclass compilable against them.
   */
  private get internals(): {
    items: SettingItem[];
    filteredItems: SettingItem[];
    selectedIndex: number;
    submenuComponent: Component | null;
    submenuItemIndex: number | null;
  } {
    return this as unknown as {
      items: SettingItem[];
      filteredItems: SettingItem[];
      selectedIndex: number;
      submenuComponent: Component | null;
      submenuItemIndex: number | null;
    };
  }

  /**
   * Checks whether a nested submenu component is currently open.
   *
   * @returns True if a submenu is active.
   */
  private hasOpenSubmenu(): boolean {
    return this.internals.submenuComponent != null;
  }

  /**
   * Retrieves the currently selected (highlighted) SettingItem.
   *
   * @returns The selected SettingItem, or undefined if no item is selected.
   */
  private getSelectedItem(): SettingItem | undefined {
    return this["getDisplayItems"]()[this.internals.selectedIndex];
  }
}
