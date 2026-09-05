import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Input,
  truncateToWidth,
  type Component,
  type Focusable,
  type KeybindingsManager,
  type TUI,
} from "@earendil-works/pi-tui";
import { PROVIDER_PREFIX } from "../constants";
import type { LlamaServer } from "../interfaces/settings";
import { errorMessage } from "../utils/errors";

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
 * Fields of a `LlamaServer` editable through the inline Input.
 */
type EditableField = "url" | "id" | "name";

/**
 * Returns a new list with the URL at `index` replaced, preserving any
 * `id`/`name` overrides. Immutable.
 */
export const updateServerUrl = (
  servers: LlamaServer[],
  index: number,
  url: string,
): LlamaServer[] => updateServerField(servers, index, "url", url);

/**
 * Returns a new list with `field` at `index` set to `value` (trimmed).
 * An empty `value` removes the `id`/`name` key instead of storing an empty
 * string, so the settings JSON stays clean. Only the edited field is
 * touched — the other override is preserved. Immutable.
 */
export const updateServerField = (
  servers: LlamaServer[],
  index: number,
  field: EditableField,
  value: string,
): LlamaServer[] => {
  const v = value.trim();
  return servers.map((server, i) => {
    if (i !== index) return server;
    if (field === "url") return { ...server, url: v }; // validated upstream
    if (field === "id") {
      const { id, ...rest } = server; // drop the old id override…
      return v.length === 0 ? rest : { ...rest, id: v }; // …clear or replace
    }
    const { name, ...rest } = server; // drop the old name override…
    return v.length === 0 ? rest : { ...rest, name: v }; // …clear or replace
  });
};

/**
 * Formats the dim `(...)` suffix shown after a server's URL:
 * `(<id> - <name>)`, with the auto-detected URL-based id used when no
 * custom id override exists (mirrors `Server.providerId`). Returns the
 * empty string when there is nothing to show.
 */
export const formatServerSuffix = (server: LlamaServer): string => {
  if (!server.id && !server.name) return "";
  const id = server.id ?? `${PROVIDER_PREFIX}=${server.url}`;
  return server.name ? `(${id} - ${server.name})` : `(${server.id})`;
};

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

/**
 * Editor for `llamaSettings.servers`, shown by `/models servers`.
 *
 * List mode: up/down move the cursor, Enter/e edits the selected entry's
 * URL, i edits its id, n its name, a adds a new entry, d asks for
 * confirmation before deleting, Esc closes.
 * Confirm mode: y deletes the selected entry, Esc/n aborts (Enter is
 * deliberately ignored).
 * Edit mode: all other input goes to an inline `Input`; Enter saves,
 * Esc reverts. The edited field (url/id/name) is tracked in `field`.
 *
 * Each mutation is persisted immediately through `persist()` (which maps to
 * `LlamaSettingsManager.setLlamaSetting()`); the in-memory list only updates
 * after the write succeeds, so a failed write leaves everything unchanged
 * and the editor open.
 */
export class ServerListEditor implements Component, Focusable {
  private servers: LlamaServer[];
  private selectedIndex = 0;
  private mode: "list" | "edit" | "add" | "confirm" = "list";
  /** Which `LlamaServer` field the inline Input is editing (edit/add modes) */
  private field: EditableField = "url";
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
    } else if (this.mode === "confirm") {
      this.handleConfirmInput(data);
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
      const suffix = formatServerSuffix(server);
      const dim = suffix ? theme.fg("dim", `  ${suffix}`) : "";
      lines.push(truncate(`${prefix}${server.url}${dim}`));
    });

    if (this.mode === "confirm") {
      lines.push(
        truncate(
          theme.fg(
            "error",
            `About to delete "${this.servers[this.selectedIndex]?.url}"`,
          ),
        ),
      );
      lines.push(truncate(theme.fg("error", "Are you sure?")));
    } else if (this.mode !== "list") {
      const label =
        this.field === "url" ? "URL:" : this.field === "id" ? "ID:" : "Name:";
      lines.push("");
      lines.push(truncate(theme.fg("dim", label)));
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
            ? "Enter/e url · i id · n name · a add · d delete · Esc done"
            : this.mode === "confirm"
              ? "y delete · Esc/n cancel"
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
    if (data === "i") {
      this.beginEditField("id");
      return;
    }
    if (data === "n") {
      this.beginEditField("name");
      return;
    }
    if (data === "a") {
      this.beginAdd();
      return;
    }
    if (data === "d") {
      this.beginConfirm();
      return;
    }
  }

  /**
   * Confirm mode: only `y` deletes the selected entry, Esc/n returns to the
   * list without changing anything; every other key — Enter included, so a
   * stray keypress can't confirm — is ignored.
   */
  private handleConfirmInput(data: string): void {
    const kb = this.options.keybindings;

    if (data === "y") {
      this.deleteSelected();
      return;
    }
    if (kb.matches(data, "tui.select.cancel") || data === "n") {
      this.mode = "list";
      this.requestRender();
    }
  }

  /**
   * Edit mode: Enter saves, Esc reverts, everything else goes to the Input.
   */
  private handleEditInput(data: string): void {
    const kb = this.options.keybindings;

    if (kb.matches(data, "tui.select.confirm")) {
      this.saveEdit();
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
    this.beginEditField("url");
  }

  /**
   * Opens the selected entry for editing `field`, prefilling the Input with
   * its current value (empty when unset) and placing the cursor at the end.
   */
  private beginEditField(field: EditableField): void {
    if (this.servers.length === 0) return;
    this.mode = "edit";
    this.field = field;
    this.editingIndex = this.selectedIndex;
    this.error = undefined;
    this.input.setValue(this.servers[this.selectedIndex][field] ?? "");
    this.moveInputCursorToEnd();
    this.requestRender();
  }

  /**
   * Enters confirm mode for the selected entry: deletion only proceeds
   * after an explicit Enter/y, guarding against accidental presses of d.
   */
  private beginConfirm(): void {
    if (this.servers.length === 0) return;
    this.mode = "confirm";
    this.requestRender();
  }

  /**
   * Starts adding a new entry with an empty Input.
   */
  private beginAdd(): void {
    this.mode = "add";
    this.field = "url";
    this.editingIndex = -1;
    this.error = undefined;
    this.input.setValue("");
    this.requestRender();
  }

  /**
   * Saves the edited/added value: validates it per field, persists the new
   * list and returns to list mode. Invalid input shows an inline error and
   * keeps editing; a failed write notifies via `onError` and keeps editing
   * too.
   */
  private async saveEdit(): Promise<void> {
    const raw = this.input.getValue();
    if (this.field === "url") {
      const url = normalizeServerUrl(raw);
      if (!url) {
        this.error = "Invalid URL — use http://host:port (one URL per entry)";
        this.requestRender();
        return;
      }
      await this.applySave((servers) =>
        this.mode === "add"
          ? addServer(servers, url)
          : updateServerUrl(servers, this.editingIndex, url),
      );
      return;
    }
    // id/name: free-form; empty/whitespace clears the override
    await this.applySave((servers) =>
      updateServerField(servers, this.editingIndex, this.field, raw),
    );
  }

  /**
   * Persists `build(this.servers)`. On success, adopts the new list and
   * returns to list mode; on failure, notifies via `onError` and stays in
   * edit mode with the pre-mutation list.
   */
  private async applySave(
    build: (servers: LlamaServer[]) => LlamaServer[],
  ): Promise<void> {
    const isAdd = this.mode === "add";
    const next = build(this.servers);

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
   * Deletes the selected entry and persists immediately. Leaves confirm
   * mode synchronously so a second Enter while the write is pending cannot
   * queue a duplicate deletion.
   */
  private async deleteSelected(): Promise<void> {
    if (this.servers.length === 0) return;
    this.mode = "list";
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
