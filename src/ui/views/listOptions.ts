import type {
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import type { LlamaServer } from "../../interfaces/settings";
import type { SettingsService } from "../../settings/settings";

/**
 * Options for `SettingsView` — scalar settings list without server CRUD.
 */
export interface SettingsViewOptions {
  tui: TUI;
  theme: Theme;
  keybindings: KeybindingsManager;
  settings: SettingsService;
  done: () => void;
  onError: (message: string) => void;
}

/**
 * Shared options for top-level views that operate on
 * `LlamaServer[]`. Subtypes add editor-specific fields.
 */
export interface BaseViewOptions {
  /** TUI instance, used to request re-renders after async persists */
  tui: TUI;
  /** Theme for dialogs (from the ctx.ui.custom factory) */
  theme: Theme;
  /** App keybindings manager (injected by ctx.ui.custom) */
  keybindings: KeybindingsManager;
  /** Settings service for persistence operations */
  settings: SettingsService;
  /**
   * Snapshot of the merged `llamaSettings.servers` to edit. Replaced
   * in place (`options.servers = next`) after every successful persist.
   */
  servers: LlamaServer[];
  /** Closes the editor (called on Esc in the server list) */
  done: () => void;
  /** Notifies about persistence errors */
  onError: (message: string) => void;
}

/**
 * Options for the ServersView.
 */
export interface ServersViewOptions extends BaseViewOptions {
  /** Timeout (ms) for health checks. Defaults to 1000ms if not provided. */
  serverTimeout?: number;
  /** Resolves the API key for a server (used for auth probing). */
  authResolver?: (server: LlamaServer) => Promise<string>;
  /** Resolves the polling interval for health-check ApiClients. */
  resolvePollingInterval?: () => Promise<number>;
  /** UI context for notifications (used to warn about auth-required servers). */
  ui?: ExtensionUIContext;
}

/**
 * Options for the OverridesView and its drill-down submenus.
 */
export interface OverridesViewOptions extends BaseViewOptions {
  /** Called after a successful add/edit/delete */
  onChanged: () => void;
}
