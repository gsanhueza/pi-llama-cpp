import type {
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type {
  Component,
  Focusable,
  KeybindingsManager,
  SettingItem,
  TUI,
} from "@earendil-works/pi-tui";
import { SettingsList } from "@earendil-works/pi-tui";
import type { LlamaSettings } from "../../interfaces/settings";
import type { LlamaSettingsManager } from "../../managers/settings";

// ─── Options enum ─────────────────────────────────────────────────────────

/**
 * Identifiers of the editable fields shown in `/models settings`.
 * Values match the scalar `LlamaSettings` keys.
 */
export enum Options {
  REACT_TO_MODEL_SELECT = "reactToModelSelect",
  AUTOLOAD_ON_MESSAGE = "autoloadOnMessage",
  SORT_BY = "sortBy",
  POLLING_TIMEOUT = "pollingTimeout",
  SERVER_TIMEOUT = "serverTimeout",
}

// ─── Constants ──────────────────────────────────────────────────────────────

type SortByValue = NonNullable<LlamaSettings["sortBy"]>;

export const SORT_VALUES: SortByValue[] = [
  "asc",
  "desc",
  "asc-name",
  "desc-name",
  "api",
];

/** Presets (ms) for `pollingTimeout` */
export const POLLING_PRESETS = [15000, 30000, 60000, 120000, 300000];

/** Presets (ms) for `serverTimeout` */
export const SERVER_PRESETS = [500, 1000, 2000, 5000, 10000];

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Formats milliseconds compactly for display (e.g. `500 -> "500ms"`,
 * `60000 -> "60s"`).
 */
export const formatMs = (ms: number): string =>
  ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;

/**
 * Parses a value produced by `formatMs()` back to milliseconds.
 * Only ever called with values from the preset lists.
 */
const parseMs = (value: string): number =>
  value.endsWith("ms")
    ? Number(value.slice(0, -2))
    : Number(value.slice(0, -1)) * 1000;

/**
 * Builds the `SettingItem[]` for `/models settings` from the current
 * (merged) values of the scalar `llamaSettings` fields.
 */
export const buildSettingsItems = async (
  settings: LlamaSettingsManager,
): Promise<SettingItem[]> => {
  const { pollingTimeout, serverTimeout } = await settings.resolveTimeouts();

  return [
    {
      id: Options.REACT_TO_MODEL_SELECT,
      label: "React to model selection",
      description: "Load the model when you pick it in Pi (immediate)",
      currentValue: (await settings.resolveReactToModelSelect()) ? "on" : "off",
      values: ["on", "off"],
    },
    {
      id: Options.AUTOLOAD_ON_MESSAGE,
      label: "Autoload on message",
      description:
        "Auto-load the selected model when you send a message (immediate)",
      currentValue: (await settings.resolveAutoloadOnMessage()) ? "on" : "off",
      values: ["on", "off"],
    },
    {
      id: Options.SORT_BY,
      label: "Sort models by",
      description: "Order of models in /models (next open)",
      currentValue: await settings.resolveSortBy(),
      values: [...SORT_VALUES],
    },
    {
      id: Options.POLLING_TIMEOUT,
      label: "Polling timeout",
      description: "Max model-load wait (next model load)",
      currentValue: formatMs(pollingTimeout),
      values: POLLING_PRESETS.map(formatMs),
    },
    {
      id: Options.SERVER_TIMEOUT,
      label: "Server timeout",
      description: "Health check / SSE probe timeout (next model load)",
      currentValue: formatMs(serverTimeout),
      values: SERVER_PRESETS.map(formatMs),
    },
  ];
};

/**
 * Persists a change made in the settings menu.
 * Maps the `SettingsList` id/value pair to the matching `llamaSettings`
 * key and writes it via `LlamaSettingsManager.setLlamaSetting()`.
 */
export const applySettingChange = async (
  id: string,
  newValue: string,
  settings: LlamaSettingsManager,
): Promise<void> => {
  switch (id) {
    case Options.REACT_TO_MODEL_SELECT:
      await settings.setLlamaSetting("reactToModelSelect", newValue === "on");
      return;
    case Options.AUTOLOAD_ON_MESSAGE:
      await settings.setLlamaSetting("autoloadOnMessage", newValue === "on");
      return;
    case Options.SORT_BY:
      await settings.setLlamaSetting("sortBy", newValue as SortByValue);
      return;
    case Options.POLLING_TIMEOUT:
      await settings.setLlamaSetting("pollingTimeout", parseMs(newValue));
      return;
    case Options.SERVER_TIMEOUT:
      await settings.setLlamaSetting("serverTimeout", parseMs(newValue));
      return;
  }
};

// ─── SettingsEditor ─────────────────────────────────────────────────────────

/** Options passed to the settings editor. */
export interface SettingsEditorOptions {
  tui: TUI;
  theme: Theme;
  keybindings: KeybindingsManager;
  settings: LlamaSettingsManager;
  /** Called when Esc closes the editor. */
  done: () => void;
  /** Called on persistence errors. */
  onError: (message: string) => void;
}

/**
 * Interactive settings menu for the scalar `llamaSettings` fields.
 * Enter/Space cycles the value under the cursor; Esc closes.
 *
 * Writes go to the global/project `~/.pi/agent/settings.json` via
 * `LlamaSettingsManager.setLlamaSetting()`; write errors are notified
 * and leave the dialog open with values unchanged.
 */
export class SettingsEditor implements Component, Focusable {
  private settingsList: SettingsList | null = null;
  private isFocused = false;

  constructor(private readonly options: SettingsEditorOptions) {
    void this.buildList();
  }

  /**
   * Opens the editor in a modal `ui.custom` dialog and resolves when the
   * user closes it (Esc). Write errors are notified via `ui` and leave
   * the dialog open with values unchanged.
   */
  static async show(
    ui: ExtensionUIContext,
    settings: LlamaSettingsManager,
  ): Promise<void> {
    await ui.custom<void>(
      (tui, theme, keybindings, done) =>
        new SettingsEditor({
          tui,
          theme,
          keybindings,
          settings,
          done: () => done(undefined),
          onError: (message) => ui.notify(message, "error"),
        }),
    );
  }

  // -- Component -------------------------------------------------------------

  invalidate(): void {
    this.settingsList?.invalidate();
  }

  handleInput(data: string): void {
    this.settingsList?.handleInput(data);
  }

  render(width: number): string[] {
    if (!this.settingsList) return ["Loading..."];
    return this.settingsList.render(width);
  }

  // -- Focusable -------------------------------------------------------------

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
  }

  // -- internal --------------------------------------------------------------

  private async buildList(): Promise<void> {
    const items = await buildSettingsItems(this.options.settings);
    this.settingsList = new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      (id, newValue) =>
        applySettingChange(id, newValue, this.options.settings).catch(
          (err: unknown) => this.options.onError(String(err)),
        ),
      () => this.options.done(),
    );
  }
}
