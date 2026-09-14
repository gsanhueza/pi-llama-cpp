import type { ModelCostRates } from "@earendil-works/pi-ai";
import {
  getSettingsListTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type {
  Component,
  Focusable,
  KeybindingsManager,
  TUI,
} from "@earendil-works/pi-tui";
import { SettingsList, type SettingItem } from "@earendil-works/pi-tui";
import type { LlamaServer, ModelOverride } from "../interfaces/settings";
import { ConfirmDialog, InputDialog } from "./dialog";
import {
  addOverrideEntry,
  applyCostFieldValue,
  formatOverrideSummary,
  parseCostValue,
  removeOverrideEntry,
  updateOverrideEntry,
} from "./overrideEntryEditor";
import { fieldMessage, FIELDS, HINTS, TITLES } from "./strings";

/**
 * Options for the SettingsList-based overrides editor.
 */
export interface OverrideSettingsListOptions {
  /** TUI instance, used to request re-renders after async persists */
  tui: TUI;
  /** Theme for dialogs (from the ctx.ui.custom factory) */
  theme: Theme;
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
 * - Pattern / costs: infinite → `InputDialog` submenus
 * - Capabilities: finite → `["text", "text | image"]`
 * - Reasoning: finite → `["true", "false"]`
 *
 * Commits are reported uniformly through the containing `SettingsList`'s
 * `onChange` (both finite cycling and `done(value)` from the input
 * submenus arrive there), so no per-field callback is needed here.
 */
/**
 * Canonical display label for one of an override's editable fields —
 * the single source of truth for both the field rows' `currentValue`
 * and the post-commit refresh of an open field submenu, so the two
 * can't drift.
 */
export const overrideFieldValue = (
  field: string,
  override: ModelOverride,
): string => {
  if (field.startsWith("cost.")) {
    const costField = field.split(".")[1] as keyof ModelCostRates;
    return String(override.cost?.[costField] ?? 0);
  }
  if (field === "capabilities")
    return override.capabilities?.join(" | ") ?? "text";
  if (field === "reasoning")
    return override.reasoning === undefined
      ? "true"
      : override.reasoning
        ? "true"
        : "false";
  if (field === "maxTokens") return String(override.maxTokens ?? 0);
  if (field === "contextSize") return String(override.contextSize ?? 0);
  return "";
};

export const buildOverrideFieldItems = (
  entry: { pattern: string; override: ModelOverride },
  theme: Theme,
  tui: TUI,
): SettingItem[] => [
  // Pattern — infinite
  {
    id: "pattern",
    label: FIELDS.pattern.label,
    description: FIELDS.pattern.description,
    currentValue: entry.pattern,
    submenu: InputDialog.inputSubmenu(
      theme,
      tui,
      TITLES.edit(FIELDS.pattern.label),
      fieldMessage(FIELDS.pattern),
      FIELDS.pattern.placeholder,
      (raw) => {
        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : null;
      },
    ),
  },
  // Input cost — infinite
  {
    id: "cost.input",
    label: FIELDS.inputCost.label,
    description: FIELDS.inputCost.description,
    currentValue: overrideFieldValue("cost.input", entry.override),
    submenu: InputDialog.inputSubmenu(
      theme,
      tui,
      TITLES.edit(FIELDS.inputCost.label),
      fieldMessage(FIELDS.inputCost),
      FIELDS.inputCost.placeholder,
      (raw) => {
        const parsed = parseCostValue(raw);
        return parsed === null ? null : String(parsed);
      },
    ),
  },
  // Output cost — infinite
  {
    id: "cost.output",
    label: FIELDS.outputCost.label,
    description: FIELDS.outputCost.description,
    currentValue: overrideFieldValue("cost.output", entry.override),
    submenu: InputDialog.inputSubmenu(
      theme,
      tui,
      TITLES.edit(FIELDS.outputCost.label),
      fieldMessage(FIELDS.outputCost),
      FIELDS.outputCost.placeholder,
      (raw) => {
        const parsed = parseCostValue(raw);
        return parsed === null ? null : String(parsed);
      },
    ),
  },
  // Cache read cost — infinite
  {
    id: "cost.cacheRead",
    label: FIELDS.cacheReadCost.label,
    description: FIELDS.cacheReadCost.description,
    currentValue: overrideFieldValue("cost.cacheRead", entry.override),
    submenu: InputDialog.inputSubmenu(
      theme,
      tui,
      TITLES.edit(FIELDS.cacheReadCost.label),
      fieldMessage(FIELDS.cacheReadCost),
      FIELDS.cacheReadCost.placeholder,
      (raw) => {
        const parsed = parseCostValue(raw);
        return parsed === null ? null : String(parsed);
      },
    ),
  },
  // Cache write cost — infinite
  {
    id: "cost.cacheWrite",
    label: FIELDS.cacheWriteCost.label,
    description: FIELDS.cacheWriteCost.description,
    currentValue: overrideFieldValue("cost.cacheWrite", entry.override),
    submenu: InputDialog.inputSubmenu(
      theme,
      tui,
      TITLES.edit(FIELDS.cacheWriteCost.label),
      fieldMessage(FIELDS.cacheWriteCost),
      FIELDS.cacheWriteCost.placeholder,
      (raw) => {
        const parsed = parseCostValue(raw);
        return parsed === null ? null : String(parsed);
      },
    ),
  },
  // Capabilities — finite: text or text | image
  {
    id: "capabilities",
    label: FIELDS.capabilities.label,
    description: FIELDS.capabilities.description,
    currentValue: overrideFieldValue("capabilities", entry.override),
    values: ["text", "text | image"],
  },
  // Reasoning — finite: true or false
  {
    id: "reasoning",
    label: FIELDS.reasoning.label,
    description: FIELDS.reasoning.description,
    currentValue: overrideFieldValue("reasoning", entry.override),
    values: ["true", "false"],
  },
  // Context size — infinite
  {
    id: "contextSize",
    label: FIELDS.contextSize.label,
    description: FIELDS.contextSize.description,
    currentValue: overrideFieldValue("contextSize", entry.override),
    submenu: InputDialog.inputSubmenu(
      theme,
      tui,
      TITLES.edit(FIELDS.contextSize.label),
      fieldMessage(FIELDS.contextSize),
      FIELDS.contextSize.placeholder,
      (raw) => {
        const n = Number(raw.trim());
        return n >= 0 && isFinite(n) ? String(n) : null;
      },
    ),
  },
  // Max tokens — infinite
  {
    id: "maxTokens",
    label: FIELDS.maxTokens.label,
    description: FIELDS.maxTokens.description,
    currentValue: overrideFieldValue("maxTokens", entry.override),
    submenu: InputDialog.inputSubmenu(
      theme,
      tui,
      TITLES.edit(FIELDS.maxTokens.label),
      fieldMessage(FIELDS.maxTokens),
      FIELDS.maxTokens.placeholder,
      (raw) => {
        const n = Number(raw.trim());
        return n >= 0 && isFinite(n) ? String(n) : null;
      },
    ),
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
  private addDialog: InputDialog | undefined;
  private confirmDialog: ConfirmDialog | undefined;
  private isFocused = false;
  private _selectedIndex = 0;
  private submenuOpen = false;
  /** Currently open field submenu, so commits can refresh its rows */
  private fieldList: SettingsList | null = null;

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
    if (this.addDialog) this.addDialog.focused = value;
    if (this.confirmDialog) this.confirmDialog.focused = value;
  }

  // -- Component -----------------------------------------------------------

  invalidate(): void {
    this.settingsList?.invalidate();
    this.addDialog?.invalidate();
    this.confirmDialog?.invalidate();
  }

  handleInput(data: string): void {
    if (this.mode === "add") {
      this.addDialog?.handleInput(data);
      return;
    }

    if (this.mode === "confirm") {
      this.confirmDialog?.handleInput(data);
      return;
    }

    // A pattern row's field submenu is open: delegate everything (Esc,
    // a/d, arrows) to the containing SettingsList, which forwards input
    // to the submenu. Intercepting here would close the whole editor on
    // Esc and trigger add/delete while typing in a field.
    if (this.submenuOpen && this.settingsList) {
      this.settingsList.handleInput(data);
      return;
    }

    const kb = this.options.keybindings;
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
      this.beginConfirm();
      return;
    }
    if (this.settingsList) {
      this.settingsList.handleInput(data);
    }
  }

  render(width: number): string[] {
    if (this.mode === "add") {
      return this.addDialog?.render(width) ?? [];
    }

    if (this.mode === "confirm") {
      return this.confirmDialog?.render(width) ?? [];
    }

    if (this.settingsList) {
      // The shortcuts live in the rows' description; only when the list is
      // empty (no rows → no description) show them as the hint line
      const lines = this.settingsList.render(width);
      if (this.getEntries().length === 0) {
        lines[lines.length - 1] = getSettingsListTheme().hint(
          HINTS.emptyOverrideEntries,
        );
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
    const { theme, tui } = this.options;
    // A fresh list never has a submenu open (also covers the pattern-key
    // rebuild path, which discards the open field submenu)
    this.submenuOpen = false;
    const items: SettingItem[] = this.getEntries().map((entry, i) => ({
      id: `entry-${i}`,
      label: entry.pattern,
      // Shortcuts live here instead of a custom hint line; the summary
      // itself is already shown as the row's currentValue
      description: HINTS.overrideEntryRow,
      currentValue: formatOverrideSummary(entry.override),
      submenu: (_cv, done) => {
        // Re-read the entry so the submenu prefills with the current
        // values (the list is rebuilt after every successful persist,
        // so `i` is stable for this list instance's lifetime)
        const current = this.getEntries()[i] ?? entry;
        const fieldItems = buildOverrideFieldItems(current, theme, tui);
        const fieldList = new SettingsList(
          fieldItems,
          Math.min(fieldItems.length + 2, 15),
          getSettingsListTheme(),
          // Field commits — finite cycling (capabilities, reasoning) and
          // input submenus (pattern, costs) — all arrive here
          (field, value) => void this.handleFieldChange(i, field, value),
          () => {
            this.submenuOpen = false;
            this.fieldList = null;
            done();
          },
        );
        // Kept so handleFieldChange can refresh the open submenu's rows
        // after a commit (the submenu stays open across edits)
        this.fieldList = fieldList;
        this.submenuOpen = true;
        return fieldList;
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

  /**
   * Rebuilds the entry list and places the cursor on `targetIndex`
   * (clamped to the last entry). A fresh SettingsList starts its cursor
   * at index 0 and `selectedIndex` is private, so `selectItem` is the
   * supported way to restore the position; the manual `_selectedIndex`
   * tracker (used for add/delete targeting) is kept in sync.
   */
  private rebuildList(targetIndex: number): void {
    this.settingsList = this.buildSettingsList();
    const count = this.getEntries().length;
    if (count === 0) {
      this._selectedIndex = 0;
      return;
    }
    const target = Math.min(targetIndex, count - 1);
    this._selectedIndex = target;
    this.settingsList.selectItem(`entry-${target}`);
  }

  private beginAdd(): void {
    this.mode = "add";
    this.addDialog = new InputDialog({
      theme: this.options.theme,
      tui: this.options.tui,
      title: TITLES.addOverride,
      message: fieldMessage(FIELDS.pattern),
      placeholder: FIELDS.pattern.placeholder,
      validate: (raw) => {
        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : null;
      },
      onSubmit: (value) => {
        this.addDialog = undefined;
        void this.saveAdd(value);
      },
      onCancel: () => {
        this.addDialog = undefined;
        this.mode = "list";
        this.options.tui.requestRender();
      },
    });
    this.addDialog.focused = this.isFocused;
    this.options.tui.requestRender();
  }

  private beginConfirm(): void {
    const entry = this.getEntries()[this._selectedIndex];
    if (!entry) return;

    this.mode = "confirm";
    this.confirmDialog = new ConfirmDialog({
      theme: this.options.theme,
      tui: this.options.tui,
      title: TITLES.deleteOverride,
      message: `Delete "${entry.pattern}"?`,
      onConfirm: () => {
        this.confirmDialog = undefined;
        void this.deleteSelected();
      },
      onCancel: () => {
        this.confirmDialog = undefined;
        this.mode = "list";
        this.options.tui.requestRender();
      },
    });
    this.confirmDialog.focused = this.isFocused;
    this.options.tui.requestRender();
  }

  private async saveAdd(pattern: string): Promise<void> {
    const server = this.options.servers[this.serverIndex];
    if (!server) {
      this.mode = "list";
      this.options.tui.requestRender();
      return;
    }

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
      // The new entry is appended last — put the cursor on it
      this.rebuildList(this.getEntries().length - 1);
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
      // The entry that followed the deleted one now sits at the same
      // index (rebuildList clamps when the last entry was deleted)
      this.rebuildList(idx);
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
      this.mode = "list";
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
        // Keep the cursor on the renamed entry
        this.rebuildList(entryIndex);
        this.options.tui.requestRender();
      });
      return;
    }

    const updatedOverride: ModelOverride = { ...entry.override };

    if (field.startsWith("cost.")) {
      const costField = field.split(".")[1] as keyof ModelCostRates;
      const nextCost = applyCostFieldValue(
        entry.override.cost,
        costField,
        Number(value),
      );
      if (nextCost) updatedOverride.cost = nextCost;
      else delete updatedOverride.cost;
    } else if (field === "capabilities") {
      updatedOverride.capabilities = parseCapabilitiesLabel(value);
    } else if (field === "reasoning") {
      const reasoning = parseReasoningLabel(value);
      if (reasoning === undefined) {
        delete updatedOverride.reasoning;
      } else {
        updatedOverride.reasoning = reasoning;
      }
    } else if (field === "maxTokens") {
      const n = Number(value);
      if (isFinite(n) && n > 0) updatedOverride.maxTokens = n;
      else delete updatedOverride.maxTokens;
    } else if (field === "contextSize") {
      const n = Number(value);
      if (isFinite(n) && n > 0) updatedOverride.contextSize = n;
      else delete updatedOverride.contextSize;
    }

    const next = updateOverrideEntry(
      this.options.servers,
      this.serverIndex,
      entryIndex,
      entry.pattern,
      updatedOverride,
    );
    // Keep the field submenu open — refresh the entry's summary row and
    // the open submenu's own row so re-entering the field prefills the
    // value just saved (InputDialog prefills from the row's currentValue)
    await this.persistSnapshot(next, () => {
      this.settingsList?.updateValue(
        `entry-${entryIndex}`,
        formatOverrideSummary(updatedOverride),
      );
      this.fieldList?.updateValue(
        field,
        overrideFieldValue(field, updatedOverride),
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
  // Assigned right after the items are built; the submenu closures below
  // only run after that, so they can safely reference the list
  let serverList: SettingsList;

  const serverItems: SettingItem[] = options.servers.map((server, i) => ({
    id: `server-${i}`,
    label: server.url,
    description: "Enter: edit this server's override entries",
    currentValue: `${Object.keys(server.overrides ?? {}).length} entries`,
    submenu: (_cv, done) =>
      // Pass the shared options object through: the entry editor replaces
      // `options.servers` after each successful persist, so a fresh editor
      // created on the next drill-down starts from the adopted list
      new OverrideEntryListEditor(options, i, () => {
        // The entry count may have changed (add/delete/pattern rename)
        // while this editor was open — refresh the row before redisplay
        const current = options.servers[i];
        serverList?.updateValue(
          `server-${i}`,
          `${Object.keys(current?.overrides ?? {}).length} entries`,
        );
        done();
      }),
  }));

  serverList = new SettingsList(
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
  return serverList;
};
