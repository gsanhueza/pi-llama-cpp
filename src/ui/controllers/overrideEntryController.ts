import { DialogFactory } from "../dialog/factory";
import type { SettingsList, TUI } from "@earendil-works/pi-tui";
import type { LlamaServer, ModelOverride } from "../../interfaces/settings";
import type { OverridesViewOptions } from "../views/listOptions";
import { OverrideEntry } from "../editors/override/entry";
import { OverrideFields } from "../editors/override/fields/index";
import { SAMPLING_PARAM_FIELDS } from "../editors/override/fields/samplingParams/index";
import { FIELDS, FieldMessages, TITLES } from "../strings";
import { BaseListController } from "./baseListController";

/**
 * Interface for the view side of {@link OverrideEntryController}.
 */
export interface OverrideEntryViewHandle {
  /** TUI for re-renders. */
  readonly tui: TUI;
  /** Callback when the user closes the editor. */
  onClose(): void;
  /** Callback when the server list changes. */
  onChanged(): void;
  /** Whether the view is currently focused. */
  readonly isFocused: boolean;
  /** Build the SettingsList for the current entries. */
  buildSettingsList(): Promise<SettingsList>;
  /** Swap the internal list (called after rebuild). */
  setList(list: SettingsList): void;
  /** Returns the row id for the given index. */
  getRowId(index: number): string;
  /** Returns the row label for the given index. */
  getRowLabel(index: number): string;
}

/**
 * Controller for override entry CRUD operations.
 *
 * Manages dialogs, selectedIndex, submenu tracking, and persistence.
 */
export class OverrideEntryController extends BaseListController {
  private submenuOpen = false;
  private deferredRebuild: number | null = null;

  constructor(
    protected readonly view: OverrideEntryViewHandle,
    public readonly options: OverridesViewOptions,
    private readonly serverIndex: number,
  ) {
    super(
      view,
      options,
      new DialogFactory(options.theme, options.tui),
      options.settings,
    );
  }

  get tui(): TUI {
    return this.options.tui;
  }

  // -- public API ----------------------------------------------------------

  trackSubmenu(open: boolean): void {
    this.submenuOpen = open;
    if (open) return;
    const index = this.deferredRebuild;
    this.deferredRebuild = null;
    if (index !== null) void this.rebuildList(index);
  }

  delegateInput(data: string): boolean {
    if (super.delegateInput(data)) return true;
    if (data === "a") {
      this.beginAdd();
      return true;
    }
    if (data === "d") {
      this.beginConfirm();
      return true;
    }
    return false;
  }

  commitFieldChange(
    next: LlamaServer[],
    deferIndex: number | null,
    refresh: () => void,
  ): void {
    if (next === this.options.servers) return;
    void this.persistSnapshot(next).then((ok) => {
      if (!ok) return;
      refresh();
      if (deferIndex !== null && this.submenuOpen)
        this.deferredRebuild = deferIndex;
      this.requestRender();
    });
  }

  /**
   * Appends a new server to the list, persists, and rebuilds.
   * @param server — The new server to add.
   */
  async saveNewServer(server: LlamaServer): Promise<void> {
    const next = [...this.options.servers, server];
    const ok = await this.persistSnapshot(next);
    if (!ok) return;
    void this.rebuildList(next.length - 1);
  }

  // -- private: CRUD -------------------------------------------------------

  /**
   * Deletes the selected entry, persists, and rebuilds.
   */
  private async deleteSelected(): Promise<void> {
    const idx = this.selectedIndex;
    const next = this.removeEntry(idx);
    const ok = await this.persistSnapshot(next);
    if (!ok) return;
    void this.rebuildList(idx);
    this.view.onChanged();
    this.requestRender();
  }

  // -- private: dialog helpers ---------------------------------------------

  private beginAdd(): void {
    this.openInputDialog(
      TITLES.addOverride,
      FieldMessages.of(FIELDS.pattern),
      FIELDS.pattern.placeholder,
      OverrideFields.byId("pattern").validate,
      (value) => void this.saveAdd(value),
    );
  }

  private beginConfirm(): void {
    const idx = this.selectedIndex;
    const name = this.view.getRowLabel(idx);
    if (!name) return;
    this.openConfirmDialog(
      TITLES.deleteOverride,
      name,
      () => void this.deleteSelected(),
    );
  }

  // -- helpers -------------------------------------------------------------

  protected getCount(): number {
    return this.entries().length;
  }

  /** Returns the override entries for the current server. */
  entries(): OverrideEntry[] {
    return OverrideEntry.listFrom(this.options.servers[this.serverIndex]);
  }

  private removeEntry(entryIndex: number): LlamaServer[] {
    return this.withServer((s) => ({
      ...s,
      overrides: Object.fromEntries(
        Object.entries(s.overrides ?? {}).filter((_, j) => j !== entryIndex),
      ),
    }));
  }

  private withServer(fn: (server: LlamaServer) => LlamaServer): LlamaServer[] {
    return this.options.servers.map((server, i) =>
      i === this.serverIndex ? fn(server) : server,
    );
  }

  /**
   * Adds a new override entry pattern to the current server, persists, and rebuilds.
   * @param pattern — The pattern string to add.
   */
  private async saveAdd(pattern: string): Promise<void> {
    const next = this.addEntry(pattern);
    await this.persistSnapshot(next).then((ok) => {
      if (!ok) return;
      void this.rebuildList(this.entries().length - 1);
      this.view.onChanged();
      this.requestRender();
    });
  }

  private addEntry(pattern: string): LlamaServer[] {
    const server = this.options.servers[this.serverIndex];
    if (!server) return this.options.servers;

    const existing = new Set(Object.keys(server.overrides ?? {}));
    let uniquePattern = pattern;
    let n = 2;
    while (existing.has(uniquePattern)) {
      uniquePattern = `${pattern}-${n++}`;
    }

    return this.withServer((s) => ({
      ...s,
      overrides: { ...s.overrides, [uniquePattern]: {} },
    }));
  }

  /** Handles a field commit from an override entry's submenu. */
  applyFieldChange(
    entryIndex: number,
    field: string,
    value: string,
  ): { next: LlamaServer[]; updatedOverride: ModelOverride } | null {
    const entry = this.entries()[entryIndex];
    if (!entry) return null;

    if (field === "pattern") {
      return {
        next: this.updateEntry(entryIndex, value, entry.override),
        updatedOverride: entry.override,
      };
    }

    if (field.startsWith("samplingParams.")) {
      const leafId = field.slice("samplingParams.".length);
      const leafField = SAMPLING_PARAM_FIELDS.find((f) => f.id === leafId);
      if (!leafField) return null;
      const updatedOverride: ModelOverride = { ...entry.override };
      leafField.apply(updatedOverride, value);
      return {
        next: this.updateEntry(entryIndex, entry.pattern, updatedOverride),
        updatedOverride,
      };
    }

    const updatedOverride: ModelOverride = { ...entry.override };
    OverrideFields.byId(field).apply(updatedOverride, value);

    return {
      next: this.updateEntry(entryIndex, entry.pattern, updatedOverride),
      updatedOverride,
    };
  }

  /** Handle an `r` reset from a row's field submenu. */
  handleFieldReset(
    entryIndex: number,
    field: string,
  ): { next: LlamaServer[]; updatedOverride: ModelOverride } | null {
    const entry = this.entries()[entryIndex];
    if (!entry) return null;

    if (field.startsWith("samplingParams.")) {
      const leafId = field.slice("samplingParams.".length);
      const fieldDef = SAMPLING_PARAM_FIELDS.find((f) => f.id === leafId);
      if (!fieldDef) return null;
      const nextOverride: ModelOverride = { ...entry.override };
      if (!fieldDef.remove(nextOverride)) return null;
      return {
        next: this.updateEntry(entryIndex, entry.pattern, nextOverride),
        updatedOverride: nextOverride,
      };
    }

    const fieldDef = OverrideFields.byId(field);
    const nextOverride: ModelOverride = { ...entry.override };
    if (!fieldDef.remove(nextOverride)) return null;
    return {
      next: this.updateEntry(entryIndex, entry.pattern, nextOverride),
      updatedOverride: nextOverride,
    };
  }

  private updateEntry(
    entryIndex: number,
    pattern: string,
    override: ModelOverride,
  ): LlamaServer[] {
    return this.withServer((s) => ({
      ...s,
      overrides: Object.fromEntries(
        Object.entries(s.overrides ?? {}).map(([k, v], j) =>
          j === entryIndex ? [pattern, override] : [k, v],
        ),
      ),
    }));
  }
}
