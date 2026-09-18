import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { SettingsList, type SettingItem } from "@earendil-works/pi-tui";

/**
 * Factory for creating `SettingsList` instances with the standard
 * geometry formula and theme.
 *
 * All call sites use this factory instead of constructing `SettingsList`
 * directly, so the height formula (`Math.min(n + 2, 15)`) and theme
 * lookup live in a single place and can't drift apart.
 */
export class SettingsListFactory {
  /**
   * Creates a `SettingsList` with the standard geometry formula and theme.
   *
   * @param items — The list items to display.
   * @param onEscape — Called when the user presses Esc to close the list.
   * @param onSelect — Optional callback for field commits (defaults to a no-op).
   */
  static create(
    items: SettingItem[],
    onEscape: () => void,
    onSelect?: (field: string, value: string) => void,
  ): SettingsList {
    return new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      onSelect ?? (() => {}),
      onEscape,
    );
  }
}
