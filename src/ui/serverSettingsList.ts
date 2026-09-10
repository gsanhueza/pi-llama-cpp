import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type {
  Component,
  Focusable,
  KeybindingsManager,
  TUI,
} from "@earendil-works/pi-tui";
import { SettingsList, type SettingItem } from "@earendil-works/pi-tui";
import type { LlamaServer } from "../interfaces/settings";
import { formatServerSuffix, normalizeServerUrl } from "./serverListEditor";
import { ValidatedInputSubmenu } from "./settingsListHelpers";

/**
 * Options for the SettingsList-based server editor.
 */
export interface ServerSettingsListOptions {
  /** TUI instance, used to request re-renders after async persists */
  tui: TUI;
  /** App keybindings manager (injected by ctx.ui.custom) */
  keybindings: KeybindingsManager;
  /** Snapshot of the merged `llamaSettings.servers` to edit */
  servers: LlamaServer[];
  /** Persists a new server list; a rejection keeps the current list */
  persist: (next: LlamaServer[]) => Promise<void>;
  /** Closes the editor (called on Esc in the server list) */
  done: () => void;
  /** Notifies about persistence errors */
  onError: (message: string) => void;
}

/**
 * Builds the SettingItem for one server's editable fields (URL, id, name).
 * Each field is infinite → opens a `ValidatedInputSubmenu`.
 */
const buildServerFieldItems = (
  server: LlamaServer,
  onChange: (field: string, value: string) => void,
  onCancel: () => void,
  tui: TUI,
): SettingItem[] => [
  {
    id: "url",
    label: "URL",
    description: "Server URL (http://host:port)",
    currentValue: server.url,
    submenu: (_cv, done) =>
      new ValidatedInputSubmenu(
        server.url,
        (raw) => normalizeServerUrl(raw),
        (value) => {
          if (value !== undefined) onChange("url", value);
          done(value);
        },
        tui,
      ),
  },
  {
    id: "id",
    label: "ID",
    description: "Custom provider ID (empty uses auto-detected)",
    currentValue: server.id ?? "",
    submenu: (_cv, done) =>
      new ValidatedInputSubmenu(
        server.id ?? "",
        (raw) => raw, // free-form
        (value) => {
          if (value !== undefined) onChange("id", value);
          done(value);
        },
        tui,
      ),
  },
  {
    id: "name",
    label: "Name",
    description: "Custom display name",
    currentValue: server.name ?? "",
    submenu: (_cv, done) =>
      new ValidatedInputSubmenu(
        server.name ?? "",
        (raw) => raw, // free-form
        (value) => {
          if (value !== undefined) onChange("name", value);
          done(value);
        },
        tui,
      ),
  },
];

/**
 * Builds the SettingItem for one server row in the top-level list.
 * Enter drills into the server's field-edit submenu.
 */
const buildServerRow = (
  server: LlamaServer,
  index: number,
  onChange: (field: string, value: string) => void,
  onCancel: () => void,
  tui: TUI,
): SettingItem => ({
  id: `server-${index}`,
  label: server.url,
  description: "Enter: edit URL/id/name · a add · d delete · Esc: done",
  currentValue: formatServerSuffix(server),
  submenu: (_cv, done) => {
    const items = buildServerFieldItems(server, onChange, done, tui);
    return new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      () => {
        // Field changes are handled by the field items' onChange
      },
      done,
    );
  },
});

/**
 * Wrapper around a `SettingsList` of servers that adds `a` (add) and `d`
 * (delete) support at the list level.
 *
 * - **a** opens an inline Input for the new server's URL; Enter saves,
 *   Esc cancels.
 * - **d** shows a confirmation prompt; `y` deletes, `Esc`/`n` cancels.
 * - **Enter** on a server row drills into its field-edit submenu.
 * - **Esc** closes the editor.
 */
export class ServerSettingsList implements Component, Focusable {
  private readonly settingsList: SettingsList;
  private mode: "list" | "add" | "confirm" = "list";
  private error: string | undefined;
  private readonly addInput = new (class implements Component {
    private value = "";
    render(_width: number): string[] {
      return [`URL: ${this.value}`];
    }
    invalidate(): void {}
    getValue(): string {
      return this.value;
    }
    setValue(v: string): void {
      this.value = v;
    }
    handleInput(data: string): void {
      if (data === "\r" || data === "\n") return; // Enter handled by wrapper
      if (data === "\u001b") return; // Esc handled by wrapper
      this.value += data;
    }
  })();
  private isFocused = false;

  constructor(private readonly options: ServerSettingsListOptions) {
    const items: SettingItem[] = options.servers.map((server, i) =>
      buildServerRow(
        server,
        i,
        (field, value) => this.handleFieldChange(field, value),
        () => {}, // field-level cancel goes back to server list
        options.tui,
      ),
    );

    this.settingsList = new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      () => {
        // Top-level onChange is a no-op (servers don't change at this level)
      },
      () => {
        this.options.done();
      },
    );
  }

  // -- Focusable -----------------------------------------------------------

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
  }

  // -- Component -----------------------------------------------------------

  invalidate(): void {
    this.settingsList.invalidate();
  }

  handleInput(data: string): void {
    const kb = this.options.keybindings;

    if (this.mode === "list") {
      if (kb.matches(data, "tui.select.cancel")) {
        this.options.done();
        return;
      }
      // Track selection for add/delete
      if (kb.matches(data, "tui.select.up")) {
        this._selectedIndex =
          this._selectedIndex === 0
            ? this.options.servers.length - 1
            : this._selectedIndex - 1;
      }
      if (kb.matches(data, "tui.select.down")) {
        this._selectedIndex =
          this._selectedIndex === this.options.servers.length - 1
            ? 0
            : this._selectedIndex + 1;
      }
      if (data === "a") {
        this.mode = "add";
        this.addInput.setValue("");
        this.error = undefined;
        this.options.tui.requestRender();
        return;
      }
      if (data === "d") {
        this.mode = "confirm";
        this.options.tui.requestRender();
        return;
      }
      // Delegate to SettingsList (it handles up/down internally for rendering)
      this.settingsList.handleInput(data);
      return;
    }

    if (this.mode === "add") {
      if (data === "\r" || data === "\n") {
        // Enter: validate and save
        const raw = this.addInput.getValue();
        const normalized = normalizeServerUrl(raw);
        if (normalized === null) {
          this.error = `Invalid URL "${raw}" — use http://host:port`;
          this.options.tui.requestRender();
          return;
        }
        this.saveAdd(normalized);
        return;
      }
      if (data === "\u001b") {
        // Esc: cancel add
        this.mode = "list";
        this.error = undefined;
        this.options.tui.requestRender();
        return;
      }
      this.addInput.handleInput(data);
      this.error = undefined;
      this.options.tui.requestRender();
      return;
    }

    if (this.mode === "confirm") {
      if (data === "y") {
        this.deleteSelected();
        return;
      }
      if (data === "n" || kb.matches(data, "tui.select.cancel")) {
        this.mode = "list";
        this.options.tui.requestRender();
        return;
      }
      // Ignore all other keys in confirm mode
      return;
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];

    if (this.mode === "add") {
      lines.push("Add server — enter URL");
      lines.push("");
      lines.push(this.addInput.render(width)[0] ?? "");
      if (this.error) {
        lines.push(this.error);
      }
      lines.push("");
      lines.push("Enter save · Esc cancel");
      return lines;
    }

    if (this.mode === "confirm") {
      const selectedServer = this.options.servers[this.selectedIndex()];
      lines.push(`About to delete "${selectedServer?.url}"`);
      lines.push("Are you sure?");
      lines.push("");
      lines.push("y delete · Esc/n cancel");
      return lines;
    }

    // List mode: the shortcuts live in the rows' description; only when the
    // list is empty (no rows → no description) show them as the hint line
    const settingsLines = this.settingsList.render(width);
    if (this.options.servers.length === 0) {
      settingsLines[settingsLines.length - 1] =
        getSettingsListTheme().hint("  a add · Esc done");
    }
    return settingsLines;
  }

  // -- helpers ---------------------------------------------------------------

  private selectedIndex(): number {
    // SettingsList tracks its own selection; we approximate by counting
    // items rendered before the current selection.
    // For simplicity, we use the SettingsList's internal state by
    // accessing the items array length.
    // Actually, we need a way to get the SettingsList's selected index.
    // Since SettingsList doesn't expose it, we'll track it manually.
    return this._selectedIndex;
  }

  private _selectedIndex = 0;

  private async saveAdd(normalizedUrl: string): Promise<void> {
    const servers = this.options.servers;
    const next = [...servers, { url: normalizedUrl }];
    try {
      await this.options.persist(next);
      this.mode = "list";
      this.error = undefined;
      this._selectedIndex = next.length - 1;
      this.options.tui.requestRender();
    } catch (err) {
      this.error = String(err);
      this.options.onError(String(err));
      this.options.tui.requestRender();
    }
  }

  private async deleteSelected(): Promise<void> {
    const idx = this.selectedIndex();
    const servers = this.options.servers;
    const next = servers.filter((_, i) => i !== idx);
    try {
      await this.options.persist(next);
      this.mode = "list";
      this._selectedIndex = Math.max(0, next.length - 1);
      this.options.tui.requestRender();
    } catch (err) {
      this.options.onError(String(err));
      this.options.tui.requestRender();
    }
  }

  private async handleFieldChange(field: string, value: string): Promise<void> {
    const idx = this._selectedIndex;
    const server = this.options.servers[idx];
    if (!server) return;

    const next = this.options.servers.map((s, i) => {
      if (i !== idx) return s;
      if (field === "url") return { ...s, url: value };
      if (field === "id") {
        const { id, ...rest } = s;
        return value.length === 0 ? rest : { ...rest, id: value };
      }
      const { name, ...rest } = s;
      return value.length === 0 ? rest : { ...rest, name: value };
    });

    try {
      await this.options.persist(next);
      this.options.tui.requestRender();
    } catch (err) {
      this.options.onError(String(err));
      this.options.tui.requestRender();
    }
  }
}
