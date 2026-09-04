import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Input,
  truncateToWidth,
  type Component,
  type Focusable,
  type KeybindingsManager,
  type TUI,
} from "@earendil-works/pi-tui";
import type { LlamaServer } from "../interfaces/settings";

/**
 * Validates and normalizes a user-entered server URL: trims whitespace,
 * strips trailing slashes, and rejects empty strings, semicolons (the
 * settings parser splits on them — use separate entries) and values
 * without an http(s) scheme.
 *
 * @returns The normalized URL, or `null` when the input is invalid
 */
export const normalizeServerUrl = (raw: string): string | null => {
  const url = raw.trim().replace(/\/+$/, "");
  if (url.length === 0 || url.includes(";") || !/^https?:\/\//i.test(url)) {
    return null;
  }
  return url;
};

/**
 * Returns a new list with a `{ url }` entry appended. Immutable.
 */
export const addServer = (
  servers: LlamaServer[],
  url: string,
): LlamaServer[] => [...servers, { url }];

/**
 * Returns a new list with the URL at `index` replaced, preserving any
 * `id`/`name` overrides. Immutable.
 */
export const updateServerUrl = (
  servers: LlamaServer[],
  index: number,
  url: string,
): LlamaServer[] =>
  servers.map((server, i) => (i === index ? { ...server, url } : server));

/**
 * Returns a new list without the entry at `index`. Immutable.
 */
export const removeServer = (
  servers: LlamaServer[],
  index: number,
): LlamaServer[] => servers.filter((_, i) => i !== index);

export interface ServerListEditorOptions {
  /** TUI instance, used to request re-renders */
  tui: TUI;
  /** Theme for styling */
  theme: Theme;
  /** App keybindings manager (injected by ctx.ui.custom) */
  keybindings: KeybindingsManager;
  /** Snapshot of the merged `llamaSettings.servers` to edit */
  servers: LlamaServer[];
  /** Persists a new server list; a rejection keeps the current list */
  persist: (next: LlamaServer[]) => Promise<void>;
  /** Closes the editor (called on Esc in list mode) */
  done: () => void;
  /** Notifies about persistence errors */
  onError: (message: string) => void;
}

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Editor for `llamaSettings.servers`, shown by `/models servers`.
 *
 * List mode: up/down move the cursor, Enter/e edits the selected entry,
 * a adds a new entry, d deletes, Esc closes.
 * Edit mode: all other input goes to an inline `Input`; Enter saves,
 * Esc reverts.
 *
 * Each mutation is persisted immediately through `persist()` (which maps to
 * `LlamaSettingsManager.setLlamaSetting()`); the in-memory list only updates
 * after the write succeeds, so a failed write leaves everything unchanged
 * and the editor open.
 */
export class ServerListEditor implements Component, Focusable {
  private servers: LlamaServer[];
  private selectedIndex = 0;
  private mode: "list" | "edit" | "add" = "list";
  private editingIndex = -1;
  private error: string | undefined;
  private readonly input = new Input();
  private readonly envOverride: boolean;
  private isFocused = false;

  constructor(private readonly options: ServerListEditorOptions) {
    this.servers = options.servers;
    this.envOverride = Boolean(process.env.LLAMA_SERVER_URL);
  }

  /** Focusable: delegates to the inline Input while it is rendered */
  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    this.input.focused = value;
  }

  invalidate(): void {
    // No cached state to invalidate
  }

  handleInput(data: string): void {
    if (this.mode === "list") {
      this.handleListInput(data);
    } else {
      this.handleEditInput(data);
    }
  }

  render(width: number): string[] {
    const { theme } = this.options;
    const truncate = (line: string) => truncateToWidth(line, width);
    const lines: string[] = [];

    lines.push(
      truncate(theme.fg("accent", theme.bold("Manage llama.cpp servers"))),
    );
    lines.push("");

    if (this.servers.length === 0) {
      lines.push(
        truncate(
          theme.fg("dim", "No servers configured — press a to add one."),
        ),
      );
      lines.push(
        truncate(
          theme.fg(
            "dim",
            "With an empty list the default http://127.0.0.1:8080 is used.",
          ),
        ),
      );
    }

    this.servers.forEach((server, index) => {
      const selected = index === this.selectedIndex;
      const prefix = selected ? theme.fg("accent", "→ ") : "  ";
      const name = server.name ? theme.fg("dim", `  ${server.name}`) : "";
      lines.push(truncate(`${prefix}${server.url}${name}`));
    });

    if (this.mode !== "list") {
      lines.push("");
      lines.push(truncate(theme.fg("dim", "URL:")));
      lines.push(truncate(this.input.render(width)[0] ?? ""));
      if (this.error) {
        lines.push(truncate(theme.fg("error", this.error)));
      }
    }

    lines.push("");
    if (this.envOverride) {
      lines.push(
        truncate(
          theme.fg("dim", "LLAMA_SERVER_URL env var overrides these servers."),
        ),
      );
    }
    lines.push(
      truncate(
        theme.fg(
          "dim",
          this.mode === "list"
            ? "Enter/e edit · a add · d delete · Esc done"
            : "Enter save · Esc cancel",
        ),
      ),
    );

    return lines;
  }

  /**
   * List mode: navigation, edit/add/delete shortcuts and close.
   */
  private handleListInput(data: string): void {
    const kb = this.options.keybindings;

    if (kb.matches(data, "tui.select.cancel")) {
      this.options.done();
      return;
    }
    if (kb.matches(data, "tui.select.up")) {
      if (this.servers.length > 0) {
        this.selectedIndex =
          this.selectedIndex === 0
            ? this.servers.length - 1
            : this.selectedIndex - 1;
        this.requestRender();
      }
      return;
    }
    if (kb.matches(data, "tui.select.down")) {
      if (this.servers.length > 0) {
        this.selectedIndex =
          this.selectedIndex === this.servers.length - 1
            ? 0
            : this.selectedIndex + 1;
        this.requestRender();
      }
      return;
    }
    if (kb.matches(data, "tui.select.confirm") || data === "e") {
      this.beginEdit();
      return;
    }
    if (data === "a") {
      this.beginAdd();
      return;
    }
    if (data === "d") {
      void this.deleteSelected();
      return;
    }
  }

  /**
   * Edit mode: Enter saves, Esc reverts, everything else goes to the Input.
   */
  private handleEditInput(data: string): void {
    const kb = this.options.keybindings;

    if (kb.matches(data, "tui.select.confirm")) {
      void this.saveEdit();
      return;
    }
    if (kb.matches(data, "tui.select.cancel")) {
      this.mode = "list";
      this.editingIndex = -1;
      this.error = undefined;
      this.requestRender();
      return;
    }
    this.input.handleInput(data);
    this.requestRender();
  }

  /**
   * Opens the selected entry for editing, prefilling the Input with its URL
   * and placing the cursor at the end (the common edit: appending/changing
   * the port).
   */
  private beginEdit(): void {
    if (this.servers.length === 0) return;
    this.mode = "edit";
    this.editingIndex = this.selectedIndex;
    this.error = undefined;
    this.input.setValue(this.servers[this.selectedIndex].url);
    this.moveInputCursorToEnd();
    this.requestRender();
  }

  /**
   * Starts adding a new entry with an empty Input.
   */
  private beginAdd(): void {
    this.mode = "add";
    this.editingIndex = -1;
    this.error = undefined;
    this.input.setValue("");
    this.requestRender();
  }

  /**
   * Saves the edited/added URL: validates and normalizes it, persists the
   * new list and returns to list mode. Invalid input shows an inline error
   * and keeps editing; a failed write notifies via `onError` and keeps
   * editing too.
   */
  private async saveEdit(): Promise<void> {
    const url = normalizeServerUrl(this.input.getValue());
    if (!url) {
      this.error = "Invalid URL — use http://host:port (one URL per entry)";
      this.requestRender();
      return;
    }

    const isAdd = this.mode === "add";
    const next = isAdd
      ? addServer(this.servers, url)
      : updateServerUrl(this.servers, this.editingIndex, url);

    try {
      await this.options.persist(next);
      this.servers = next;
      if (isAdd) this.selectedIndex = next.length - 1;
      this.mode = "list";
      this.editingIndex = -1;
      this.error = undefined;
    } catch (err) {
      // Write failed: keep the pre-mutation list and stay in edit mode
      this.options.onError(errorMessage(err));
    }
    this.requestRender();
  }

  /**
   * Deletes the selected entry and persists immediately.
   */
  private async deleteSelected(): Promise<void> {
    if (this.servers.length === 0) return;
    const next = removeServer(this.servers, this.selectedIndex);

    try {
      await this.options.persist(next);
      this.servers = next;
      if (this.selectedIndex >= next.length) {
        this.selectedIndex = Math.max(0, next.length - 1);
      }
    } catch (err) {
      // Write failed: keep the pre-mutation list
      this.options.onError(errorMessage(err));
    }
    this.requestRender();
  }

  /**
   * The Input has no "move to end" API and `setValue()` clamps the cursor;
   * walk it right one grapheme at a time using the standard arrow sequence
   * (resolved by the Input against pi's global keybindings).
   */
  private moveInputCursorToEnd(): void {
    for (let i = 0; i < [...this.input.getValue()].length; i++) {
      this.input.handleInput("\x1b[C");
    }
  }

  private requestRender(): void {
    this.options.tui.requestRender();
  }
}
