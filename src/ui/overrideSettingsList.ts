import type { ModelCostRates } from "@earendil-works/pi-ai";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type {
  Component,
  Focusable,
  KeybindingsManager,
  TUI,
} from "@earendil-works/pi-tui";
import { SettingsList, type SettingItem } from "@earendil-works/pi-tui";
import type { LlamaServer, ModelOverride } from "../interfaces/settings";
import {
  addOverrideEntry,
  formatOverrideSummary,
  parseCostValue,
  removeOverrideEntry,
  updateOverrideEntry,
} from "./overrideEntryEditor";
import { ValidatedInputSubmenu } from "./settingsListHelpers";

/**
 * Options for the SettingsList-based overrides editor.
 */
export interface OverrideSettingsListOptions {
  /** TUI instance, used to request re-renders after async persists */
  tui: TUI;
  /** App keybindings manager (injected by ctx.ui.custom) */
  keybindings: KeybindingsManager;
  /**
   * Snapshot of the merged `llamaSettings.servers` to edit. Replaced
   * in place (`options.servers = next`) after every successful persist —
   * this object is shared between the top-level list and the per-server
   * entry editors so re-entering a server sees the adopted values.
   */
  servers: LlamaServer[];
  /** Persists a new server list; a rejection keeps the current list */
  persist: (next: LlamaServer[]) => Promise<void>;
  /** Closes the editor (called on Esc in the server list) */
  done: () => void;
  /** Notifies about persistence errors */
  onError: (message: string) => void;
  /** Called after a successful add/edit/delete */
  onChanged: () => void;
}

// ─── Field items for one override entry ───────────────────────────────────

/**
 * Builds the SettingItem for one override entry's editable fields.
 *
 * - Pattern / costs: infinite → `ValidatedInputSubmenu`
 * - Capabilities: finite → `["text", "text | image"]`
 * - Reasoning: finite → `["true", "false"]`
 *
 * Commits are reported uniformly through the containing `SettingsList`'s
 * `onChange` (both finite cycling and `done(value)` from the input
 * submenus arrive there), so no per-field callback is needed here.
 */
const buildOverrideFieldItems = (
  entry: { pattern: string; override: ModelOverride },
  tui: TUI,
): SettingItem[] => [
  // Pattern — infinite
  {
    id: "pattern",
    label: "Pattern",
    description: "Model name prefix filter",
    currentValue: entry.pattern,
    submenu: (_cv, done) =>
      new ValidatedInputSubmenu(
        entry.pattern,
        (raw) => {
          const trimmed = raw.trim();
          return trimmed.length > 0 ? trimmed : null;
        },
        (value) => done(value),
        tui,
      ),
  },
  // Input cost — infinite
  {
    id: "cost.input",
    label: "Input cost",
    description: "Token cost per 1M input tokens",
    currentValue: String(entry.override.cost?.input ?? 0),
    submenu: (_cv, done) =>
      new ValidatedInputSubmenu(
        String(entry.override.cost?.input ?? 0),
        (raw) => {
          const parsed = parseCostValue(raw);
          return parsed === null ? null : String(parsed);
        },
        (value) => done(value),
        tui,
      ),
  },
  // Output cost — infinite
  {
    id: "cost.output",
    label: "Output cost",
    description: "Token cost per 1M output tokens",
    currentValue: String(entry.override.cost?.output ?? 0),
    submenu: (_cv, done) =>
      new ValidatedInputSubmenu(
        String(entry.override.cost?.output ?? 0),
        (raw) => {
          const parsed = parseCostValue(raw);
          return parsed === null ? null : String(parsed);
        },
        (value) => done(value),
        tui,
      ),
  },
  // Cache read cost — infinite
  {
    id: "cost.cacheRead",
    label: "Cache read cost",
    description: "Token cost per 1M cached tokens (read)",
    currentValue: String(entry.override.cost?.cacheRead ?? 0),
    submenu: (_cv, done) =>
      new ValidatedInputSubmenu(
        String(entry.override.cost?.cacheRead ?? 0),
        (raw) => {
          const parsed = parseCostValue(raw);
          return parsed === null ? null : String(parsed);
        },
        (value) => done(value),
        tui,
      ),
  },
  // Cache write cost — infinite
  {
    id: "cost.cacheWrite",
    label: "Cache write cost",
    description: "Token cost per 1M cached tokens (write)",
    currentValue: String(entry.override.cost?.cacheWrite ?? 0),
    submenu: (_cv, done) =>
      new ValidatedInputSubmenu(
        String(entry.override.cost?.cacheWrite ?? 0),
        (raw) => {
          const parsed = parseCostValue(raw);
          return parsed === null ? null : String(parsed);
        },
        (value) => done(value),
        tui,
      ),
  },
  // Capabilities — finite: text or text | image
  {
    id: "capabilities",
    label: "Capabilities",
    description: "Model capabilities (replaces detected)",
    currentValue: entry.override.capabilities?.join(" | ") ?? "text",
    values: ["text", "text | image"],
  },
  // Reasoning — finite: true or false
  {
    id: "reasoning",
    label: "Reasoning",
    description: "Is this a reasoning model? (true = default)",
    currentValue:
      entry.override.reasoning === undefined
        ? "true"
        : entry.override.reasoning
          ? "true"
          : "false",
    values: ["true", "false"],
  },
];

/**
 * Parses the capabilities label back to an array or undefined.
 */
const parseCapabilitiesLabel = (
  label: string,
): ("text" | "image")[] | undefined => {
  if (label === "text") return ["text"];
  if (label === "text | image") return ["text", "image"];
  return undefined;
};

/**
 * Parses the reasoning label back to a boolean or undefined.
 */
const parseReasoningLabel = (label: string): boolean | undefined => {
  if (label === "true") return true;
  if (label === "false") return false;
  return undefined;
};

// ─── Override entry list (per-server) ─────────────────────────────────────

/**
 * The override entries of a single server, as a list view with add/delete.
 */
class OverrideEntryListEditor implements Component, Focusable {
  private settingsList: SettingsList | null = null;
  private mode: "list" | "add" | "confirm" = "list";
  private error: string | undefined;
  private isFocused = false;
  private _selectedIndex = 0;

  private addInput = new (class implements Component {
    private value = "";
    render(_width: number): string[] {
      return [`Pattern: ${this.value}`];
    }
    invalidate(): void {}
    getValue(): string {
      return this.value;
    }
    setValue(v: string): void {
      this.value = v;
    }
    handleInput(data: string): void {
      if (data === "\r" || data === "\n") return;
      if (data === "\u001b") return;
      this.value += data;
    }
  })();

  constructor(
    /** Shared options object — `persistSnapshot` updates `options.servers`
     * in place so later drill-downs (and sibling editors) see the change */
    private readonly options: OverrideSettingsListOptions,
    private readonly serverIndex: number,
    /** Closes this editor (called on Esc in the entry list) */
    private readonly done: () => void,
  ) {
    this.settingsList = this.buildSettingsList();
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
    this.settingsList?.invalidate();
  }

  handleInput(data: string): void {
    const kb = this.options.keybindings;

    if (this.mode === "list") {
      if (kb.matches(data, "tui.select.cancel")) {
        this.done();
        return;
      }
      // Track selection for add/delete (delegate to SettingsList for rendering)
      if (kb.matches(data, "tui.select.up")) {
        this._selectedIndex =
          this._selectedIndex === 0
            ? this.getEntries().length - 1
            : this._selectedIndex - 1;
      }
      if (kb.matches(data, "tui.select.down")) {
        this._selectedIndex =
          this._selectedIndex === this.getEntries().length - 1
            ? 0
            : this._selectedIndex + 1;
      }
      if (data === "a") {
        this.beginAdd();
        return;
      }
      if (data === "d") {
        this.mode = "confirm";
        this.options.tui.requestRender();
        return;
      }
      if (this.settingsList) {
        this.settingsList.handleInput(data);
      }
      return;
    }

    if (this.mode === "add") {
      if (data === "\r" || data === "\n") {
        const raw = this.addInput.getValue();
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          this.error = "Pattern cannot be empty";
          this.options.tui.requestRender();
          return;
        }
        this.saveAdd(trimmed);
        return;
      }
      if (data === "\u001b") {
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
      return;
    }
  }

  render(width: number): string[] {
    if (this.mode === "add") {
      return [
        "Add override — enter pattern",
        "",
        this.addInput.render(width)[0] ?? "",
        ...(this.error ? [this.error] : []),
        "",
        "Enter save · Esc cancel",
      ];
    }

    if (this.mode === "confirm") {
      const entries = this.getEntries();
      const entry = entries[this._selectedIndex];
      return [
        `About to delete "${entry?.pattern}"`,
        "Are you sure?",
        "",
        "y delete · Esc/n cancel",
      ];
    }

    if (this.settingsList) {
      // The shortcuts live in the rows' description; only when the list is
      // empty (no rows → no description) show them as the hint line
      const lines = this.settingsList.render(width);
      if (this.getEntries().length === 0) {
        lines[lines.length - 1] =
          getSettingsListTheme().hint("  a add · Esc back");
      }
      return lines;
    }
    return ["Loading..."];
  }

  // -- helpers ---------------------------------------------------------------

  private getEntries(): { pattern: string; override: ModelOverride }[] {
    const server = this.options.servers[this.serverIndex];
    return Object.entries(server?.overrides ?? {}).map(
      ([pattern, override]) => ({ pattern, override }),
    );
  }

  private buildSettingsList(): SettingsList {
    const items: SettingItem[] = this.getEntries().map((entry, i) => ({
      id: `entry-${i}`,
      label: entry.pattern,
      // Shortcuts live here instead of a custom hint line; the summary
      // itself is already shown as the row's currentValue
      description: "Enter: edit fields · a add · d delete · Esc back",
      currentValue: formatOverrideSummary(entry.override),
      submenu: (_cv, done) => {
        // Re-read the entry so the submenu prefills with the current
        // values (the list is rebuilt after every successful persist,
        // so `i` is stable for this list instance's lifetime)
        const current = this.getEntries()[i] ?? entry;
        const fieldItems = buildOverrideFieldItems(current, this.options.tui);
        return new SettingsList(
          fieldItems,
          Math.min(fieldItems.length + 2, 15),
          getSettingsListTheme(),
          // Field commits — finite cycling (capabilities, reasoning) and
          // input submenus (pattern, costs) — all arrive here
          (field, value) => void this.handleFieldChange(i, field, value),
          done,
        );
      },
    }));

    return new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      () => {},
      () => {
        this.done();
      },
    );
  }

  private beginAdd(): void {
    this.mode = "add";
    this.addInput.setValue("");
    this.error = undefined;
    this.options.tui.requestRender();
  }

  private async saveAdd(pattern: string): Promise<void> {
    const server = this.options.servers[this.serverIndex];
    if (!server) return;

    // Uniquify the pattern
    const existing = new Set(Object.keys(server.overrides ?? {}));
    let uniquePattern = pattern;
    let n = 2;
    while (existing.has(uniquePattern)) {
      uniquePattern = `${pattern}-${n++}`;
    }

    const next = addOverrideEntry(
      this.options.servers,
      this.serverIndex,
      uniquePattern,
    );
    await this.persistSnapshot(next, () => {
      this.mode = "list";
      this._selectedIndex = this.getEntries().length - 1;
      this.settingsList = this.buildSettingsList();
      this.options.onChanged();
      this.options.tui.requestRender();
    });
  }

  private async deleteSelected(): Promise<void> {
    const idx = this._selectedIndex;
    const next = removeOverrideEntry(
      this.options.servers,
      this.serverIndex,
      idx,
    );
    await this.persistSnapshot(next, () => {
      this.mode = "list";
      this._selectedIndex = Math.max(0, this.getEntries().length - 1);
      this.settingsList = this.buildSettingsList();
      this.options.onChanged();
      this.options.tui.requestRender();
    });
  }

  /**
   * Persists `next`; on success adopts it as the editor's snapshot and
   * runs `onSuccess`; on failure notifies and keeps the current state.
   *
   * Adopting the persisted list is essential: the editor holds a snapshot
   * taken when it opened (not a live reference), so without this the next
   * edit would build on stale data and rebuilt rows would show old values.
   */
  private async persistSnapshot(
    next: LlamaServer[],
    onSuccess: () => void,
  ): Promise<void> {
    try {
      await this.options.persist(next);
    } catch (err) {
      this.options.onError(String(err));
      this.options.tui.requestRender();
      return;
    }
    this.options.servers = next;
    onSuccess();
  }

  private async handleFieldChange(
    entryIndex: number,
    field: string,
    value: string,
  ): Promise<void> {
    const entries = this.getEntries();
    const entry = entries[entryIndex];
    if (!entry) return;

    const server = this.options.servers[this.serverIndex];
    if (!server) return;

    if (field === "pattern") {
      // Pattern change: update the key (row label changes → full rebuild)
      const next = updateOverrideEntry(
        this.options.servers,
        this.serverIndex,
        entryIndex,
        value,
        entry.override,
      );
      await this.persistSnapshot(next, () => {
        this.settingsList = this.buildSettingsList();
        this.options.tui.requestRender();
      });
      return;
    }

    const updatedOverride: ModelOverride = { ...entry.override };

    if (field.startsWith("cost.")) {
      const costField = field.split(".")[1] as keyof ModelCostRates;
      const numValue = Number(value);
      updatedOverride.cost = {
        ...entry.override.cost,
        [costField]: numValue,
      };
    } else if (field === "capabilities") {
      updatedOverride.capabilities = parseCapabilitiesLabel(value);
    } else if (field === "reasoning") {
      const reasoning = parseReasoningLabel(value);
      if (reasoning === undefined) {
        delete updatedOverride.reasoning;
      } else {
        updatedOverride.reasoning = reasoning;
      }
    }

    const next = updateOverrideEntry(
      this.options.servers,
      this.serverIndex,
      entryIndex,
      entry.pattern,
      updatedOverride,
    );
    // Keep the field submenu open — just refresh the entry's summary row
    await this.persistSnapshot(next, () => {
      this.settingsList?.updateValue(
        `entry-${entryIndex}`,
        formatOverrideSummary(updatedOverride),
      );
      this.options.tui.requestRender();
    });
  }
}

// ─── Top-level overrides editor ───────────────────────────────────────────

/**
 * Builds the top-level SettingsList for the overrides editor.
 * One row per server; Enter drills into the server's override entries.
 */
export const createOverrideSettingsList = (
  options: OverrideSettingsListOptions,
): SettingsList => {
  const serverItems: SettingItem[] = options.servers.map((server, i) => ({
    id: `server-${i}`,
    label: server.url,
    description: "Enter: edit this server's override entries",
    currentValue: `${Object.keys(server.overrides ?? {}).length} entries`,
    submenu: (_cv, done) =>
      // Pass the shared options object through: the entry editor replaces
      // `options.servers` after each successful persist, so a fresh editor
      // created on the next drill-down starts from the adopted list
      new OverrideEntryListEditor(options, i, done),
  }));

  return new SettingsList(
    serverItems,
    Math.min(serverItems.length + 2, 15),
    getSettingsListTheme(),
    () => {
      // Server rows only open submenus; nothing changes at this level
    },
    () => {
      options.done();
    },
  );
};
