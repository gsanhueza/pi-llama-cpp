import type { SettingItem, SettingsList } from "@earendil-works/pi-tui";
import type { LlamaServer, ModelOverride } from "../../../interfaces/settings";
import { FIELDS, FieldMessages, HINTS, TITLES } from "../../strings";
import type { OverrideSettingsListOptions } from "../editorOptions";
import { ListEditor } from "../listEditor";
import { SettingsListFactory } from "../settingsListFactory";
import { OverrideEntry } from "./entry";
import { OverrideFields, OverrideSummary } from "./fields";
import { OverrideItemBuilder } from "./itemBuilder";

/**
 * The override entries of a single server, as a list view with add/delete.
 */
export class OverrideEntryListEditor extends ListEditor<OverrideSettingsListOptions> {
  /** Currently open field submenu, so commits can refresh its rows */
  private fieldList: SettingsList | null = null;

  constructor(
    /** Shared options object — `persistSnapshot` updates `options.servers`
     * in place so later drill-downs (and sibling editors) see the change */
    options: OverrideSettingsListOptions,
    private readonly serverIndex: number,
    /** Closes this editor (called on Esc in the entry list) */
    private readonly done: () => void,
  ) {
    super(options);
    this.settingsList = this.buildSettingsList();
  }

  // -- hooks ---------------------------------------------------------------

  /** Esc steps back to the server list, not out of the whole dialog —
   * `options.done` is the top-level close (shared options object). */
  protected close(): void {
    this.done();
  }

  // -- abstract hooks -------------------------------------------------------

  protected buildSettingsList(): SettingsList {
    const builder = new OverrideItemBuilder(this.dialogs);
    const items: SettingItem[] = this.entries().map((entry, i) => ({
      id: `entry-${i}`,
      label: entry.pattern,
      description: HINTS.overrideEntryRow,
      currentValue: OverrideSummary.of(entry.override),
      submenu: (_cv, done) => {
        const current = this.entries()[i] ?? entry;
        const fieldItems = builder.buildFieldItems(current);
        const fieldList = SettingsListFactory.create(
          fieldItems,
          () => {
            this.fieldList = null;
            done();
            // Flushes any rebuild deferred by a pattern rename
            // (see commitFieldChange)
            this.trackSubmenu(false);
          },
          (field, value) => void this.handleFieldChange(i, field, value),
        );
        this.fieldList = fieldList;
        this.trackSubmenu(true);
        return fieldList;
      },
    }));

    return SettingsListFactory.create(items, () => {
      this.done();
    });
  }

  /** Handle a field commit from a row's submenu. */
  private handleFieldChange(
    entryIndex: number,
    field: string,
    value: string,
  ): void {
    const result = this.applyFieldChange(entryIndex, field, value);
    if (!result) return;

    this.commitFieldChange(
      result.next,
      // The entry row's label is the pattern, and SettingsList labels
      // can't be patched in place — defer the rebuild until the submenu
      // closes so the user stays inside it (see commitFieldChange)
      field === "pattern" ? entryIndex : null,
      () => {
        // Refresh the entry row's summary in place
        this.settingsList?.updateValue(
          `entry-${entryIndex}`,
          OverrideSummary.of(result.updatedOverride),
        );
        // Refresh the committed row in the open field submenu. Passing
        // `value` as the pattern makes the pattern field display the new
        // pattern; other fields only read the override.
        this.fieldList?.updateValue(
          field,
          OverrideFields.byId(field).displayValue(
            new OverrideEntry(value, result.updatedOverride),
          ),
        );
      },
    );
  }

  protected beginAdd(): void {
    this.openDialog(
      this.dialogs.input({
        title: TITLES.addOverride,
        message: FieldMessages.of(FIELDS.pattern),
        placeholder: FIELDS.pattern.placeholder,
        validate: OverrideFields.byId("pattern").validate,
        onSubmit: (value) => {
          this.closeDialog();
          void this.saveAdd(value);
        },
        onCancel: () => this.closeDialog(),
      }),
    );
  }

  protected deleteSelected(): void {
    const idx = this.selectedIndex;
    const next = this.removeEntry(idx);
    void this.persistSnapshot(next, () => {
      this.rebuildList(idx);
      this.options.onChanged?.();
      this.options.tui.requestRender();
    });
  }

  protected readonly emptyHintKey = "emptyOverrideEntries" as const;

  protected getCurrentCount(): number {
    return this.entries().length;
  }

  protected getRowId(index: number): string {
    return `entry-${index}`;
  }

  protected getRowLabel(index: number): string {
    return this.entries()[index]?.pattern ?? "";
  }

  protected get deleteTitle(): string {
    return TITLES.deleteOverride;
  }

  // -- helpers ---------------------------------------------------------------

  /** The server's override entries, in map iteration order. */
  private entries(): OverrideEntry[] {
    return OverrideEntry.listFrom(this.options.servers[this.serverIndex]);
  }

  /** Handles a field commit from an override entry's submenu. Returns
   * `null` when the entry doesn't exist (stale index — no-op). */
  private applyFieldChange(
    entryIndex: number,
    field: string,
    value: string,
  ): { next: LlamaServer[]; updatedOverride: ModelOverride } | null {
    const entry = this.entries()[entryIndex];
    if (!entry) return null;

    // Pattern field: rename the pattern key, keep the override object
    if (field === "pattern") {
      return {
        next: this.updateEntry(entryIndex, value, entry.override),
        updatedOverride: entry.override,
      };
    }

    // Other fields: let the field definition apply itself
    const updatedOverride: ModelOverride = { ...entry.override };
    OverrideFields.byId(field).apply(updatedOverride, value);

    return {
      next: this.updateEntry(entryIndex, entry.pattern, updatedOverride),
      updatedOverride,
    };
  }

  /** Adds a new override entry with a uniquified pattern. */
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

  /** Removes the entry at `entryIndex`. */
  private removeEntry(entryIndex: number): LlamaServer[] {
    return this.withServer((s) => ({
      ...s,
      overrides: Object.fromEntries(
        Object.entries(s.overrides ?? {}).filter((_, j) => j !== entryIndex),
      ),
    }));
  }

  /** Returns the servers with the target server replaced by
   * `fn(server)`. Immutable. */
  private withServer(fn: (server: LlamaServer) => LlamaServer): LlamaServer[] {
    return this.options.servers.map((server, i) =>
      i === this.serverIndex ? fn(server) : server,
    );
  }

  /** Replaces the entry at `entryIndex` with `pattern → override` in a
   * single mutation — used both for renaming the pattern and for editing
   * its fields. The entry keeps its position in the map's iteration
   * order. Immutable. */
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

  private async saveAdd(pattern: string): Promise<void> {
    const next = this.addEntry(pattern);
    await this.persistSnapshot(next, () => {
      this.rebuildList(this.entries().length - 1);
      this.options.onChanged?.();
      this.options.tui.requestRender();
    });
  }
}
