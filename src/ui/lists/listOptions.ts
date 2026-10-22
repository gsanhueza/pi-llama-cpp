import type {
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import type { LlamaServer } from "../../interfaces/settings";
import type { SettingsService } from "../../settings/settings";

/**
 * Options for `SettingsTUIList` — scalar settings list without server CRUD.
 */
export interface SettingsTUIListOptions {
  tui: TUI;
  theme: Theme;
  keybindings: KeybindingsManager;
  settings: SettingsService;
  done: () => void;
  onError: (message: string) => void;
}

/**
 * Shared options for top-level TUI lists that operate on
 * `LlamaServer[]`. Subtypes add editor-specific fields.
 */
export interface BaseTUIListOptions {
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
 * Options for the ServersTUIList.
 */
export interface ServersTUIListOptions extends BaseTUIListOptions {
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
 * Options for the OverridesTUIList and its drill-down submenus.
 */
export interface OverridesTUIListOptions extends BaseTUIListOptions {
  /** Called after a successful add/edit/delete */
  onChanged: () => void;
}
