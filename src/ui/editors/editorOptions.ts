import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import type { LlamaServer } from "../../interfaces/settings";

/**
 * Shared options for SettingsList-based editors that operate on
 * `LlamaServer[]`. Subtypes add editor-specific fields.
 */
export interface SettingsListEditorOptions {
  /** TUI instance, used to request re-renders after async persists */
  tui: TUI;
  /** Theme for dialogs (from the ctx.ui.custom factory) */
  theme: Theme;
  /** App keybindings manager (injected by ctx.ui.custom) */
  keybindings: KeybindingsManager;
  /**
   * Snapshot of the merged `llamaSettings.servers` to edit. Replaced
   * in place (`options.servers = next`) after every successful persist.
   */
  servers: LlamaServer[];
  /** Persists a new server list; a rejection keeps the current list */
  persist: (next: LlamaServer[]) => Promise<void>;
  /** Closes the editor (called on Esc in the server list) */
  done: () => void;
  /** Notifies about persistence errors */
  onError: (message: string) => void;
}

/**
 * Options for the SettingsList-based server editor.
 */
export interface ServerSettingsListOptions extends SettingsListEditorOptions {
  /** Timeout (ms) for health checks. Defaults to 1000ms if not provided. */
  serverTimeout?: number;
}

/**
 * Options for the SettingsList-based overrides editor.
 */
export interface OverrideSettingsListOptions extends SettingsListEditorOptions {
  /** Called after a successful add/edit/delete */
  onChanged: () => void;
}
