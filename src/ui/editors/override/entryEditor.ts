import type { SettingItem, SettingsList } from "@earendil-works/pi-tui";
import type { LlamaServer, ModelOverride } from "../../../interfaces/settings";
import { FIELDS, FieldMessages, HINTS, TITLES } from "../../strings";
import type { OverridesTUIListOptions } from "../../lists/listOptions";
import { ListEditor } from "../listEditor";
import { SettingsListFactory } from "../settingsListFactory";
import { OverrideEntry } from "./entry";
import { OverrideFields, OverrideSummary } from "./fields/index";
import { SAMPLING_PARAM_FIELDS } from "./fields/samplingParams/index";
import { OverrideItemBuilder } from "./itemBuilder";

/**
 * The override entries of a single server, as a list view with add/delete.
 */
export class OverrideEntryListEditor extends ListEditor<OverridesTUIListOptions> {
  /** Currently open field submenu, so commits can refresh its rows */
  private fieldList: SettingsList | null = null;

  constructor(
    /** Shared options object — `persistSnapshot` updates `options.servers`
     * in place so later drill-downs (and sibling editors) see the change */
    options: OverridesTUIListOptions,
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
  protected override close(): void {
    this.done();
  }

  // -- abstract hooks -------------------------------------------------------

  protected override buildSettingsList(): SettingsList {
    const builder = new OverrideItemBuilder(this.dialogs);
    const items: SettingItem[] = this.entries().map((entry, i) => ({
      id: `entry-${i}`,
      label: entry.pattern,
      description: HINTS.overrideEntryRow,
      currentValue: OverrideSummary.of(entry.override),
      submenu: (_cv, done) => {
        const current = this.entries()[i] ?? entry;
        const fieldItems = builder.buildFieldItems(current);

        // Override the sampling params group field to open a nested list
        const groupIndex = fieldItems.findIndex(
          (item) => item.id === "samplingParams",
        );
        if (groupIndex !== -1) {
          fieldItems[groupIndex].submenu = (_groupCv, groupDone) => {
            // Re-read the entry: the field list stays open across nested
            // visits, so the captured `current` is stale after a commit
            const nestedItems = builder.buildSamplingParamsItems(
              this.entries()[i] ?? current,
            );
            const nestedList = SettingsListFactory.createResettable(
              nestedItems,
              () => {
                // Restore the field list reference clobbered when the
                // nested submenu opened, so later edits here refresh
                // their rows again
                this.fieldList = fieldList;
                // Refresh the group row in the field list so the
                // "N params set" hint is up to date
                const fresh = this.entries()[i] ?? current;
                fieldList.updateValue(
                  "samplingParams",
                  OverrideFields.byId("samplingParams").displayValue(
                    new OverrideEntry(fresh.pattern, fresh.override),
                  ),
                );
                groupDone();
                this.trackSubmenu(false);
              },
              (nestedField, nestedValue) =>
                void this.handleFieldChange(i, nestedField, nestedValue),
              (nestedField) => this.handleFieldReset(i, nestedField),
              this.options.tui,
            );
            this.fieldList = nestedList;
            this.trackSubmenu(true);
            return nestedList;
          };
        }

        const fieldList = SettingsListFactory.createResettable(
          fieldItems,
          () => {
            this.fieldList = null;
            done();
            // Flushes any rebuild deferred by a pattern rename
            // (see commitFieldChange)
            this.trackSubmenu(false);
          },
          (field, value) => void this.handleFieldChange(i, field, value),
          (field) => this.handleFieldReset(i, field),
          this.options.tui,
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

  /** Handle a field commit from a row's submenu.
   * Nested field ids (e.g. "samplingParams.temperature") are routed
   * to the leaf field's apply/remove via the override object. */
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
        if (field.startsWith("samplingParams.")) {
          const leafField = SAMPLING_PARAM_FIELDS.find(
            (f) => f.id === field.slice("samplingParams.".length),
          );
          if (leafField) {
            this.fieldList?.updateValue(
              field,
              leafField.displayValue(
                new OverrideEntry(value, result.updatedOverride),
              ),
            );
          }
        } else {
          this.fieldList?.updateValue(
            field,
            OverrideFields.byId(field).displayValue(
              new OverrideEntry(value, result.updatedOverride),
            ),
          );
        }
      },
    );
  }

  /** Handle an `r` reset from a row's field submenu: removes the field's
   * key(s) from the override (falling back to the resolved default) and
   * persists. No-op when the field wasn't set (nothing to remove) —
   * `pattern` never removes anything, so it is inert there by design.
   * Nested field ids ("samplingParams.<leaf>") are routed to the leaf
   * field's remove via the override object. */
  private handleFieldReset(entryIndex: number, field: string): void {
    const entry = this.entries()[entryIndex];
    if (!entry) return;

    // Nested sampling params field: strip prefix, route to leaf field
    if (field.startsWith("samplingParams.")) {
      const leafId = field.slice("samplingParams.".length);
      const fieldDef = SAMPLING_PARAM_FIELDS.find((f) => f.id === leafId);
      if (!fieldDef) return;
      const nextOverride: ModelOverride = { ...entry.override };
      if (!fieldDef.remove(nextOverride)) return;

      const next = this.updateEntry(entryIndex, entry.pattern, nextOverride);
      this.commitFieldChange(next, null, () => {
        this.settingsList?.updateValue(
          `entry-${entryIndex}`,
          OverrideSummary.of(nextOverride),
        );
        this.fieldList?.updateValue(
          field,
          fieldDef.displayValue(new OverrideEntry(entry.pattern, nextOverride)),
        );
      });
      return;
    }

    const fieldDef = OverrideFields.byId(field);
    const nextOverride: ModelOverride = { ...entry.override };
    if (!fieldDef.remove(nextOverride)) return;

    const next = this.updateEntry(entryIndex, entry.pattern, nextOverride);
    this.commitFieldChange(next, null, () => {
      // Refresh the entry row's summary in place
      this.settingsList?.updateValue(
        `entry-${entryIndex}`,
        OverrideSummary.of(nextOverride),
      );
      // Refresh the reset row in the open field submenu
      this.fieldList?.updateValue(
        field,
        fieldDef.displayValue(new OverrideEntry(entry.pattern, nextOverride)),
      );
    });
  }

  protected override beginAdd(): void {
    this.openDialog(
      this.dialogs.input({
        title: TITLES.addOverride,
        message: FieldMessages.of(FIELDS.pattern),
        placeholder: FIELDS.pattern.placeholder,
        validate: OverrideFields.byId("pattern").validate,
        onSubmit: (value: string) => {
          this.closeDialog();
          void this.saveAdd(value);
        },
        onCancel: () => this.closeDialog(),
      }),
    );
  }

  protected override deleteSelected(): void {
    const idx = this.selectedIndex;
    const next = this.removeEntry(idx);
    void this.persistSnapshot(next, () => {
      this.rebuildList(idx);
      this.options.onChanged?.();
      this.options.tui.requestRender();
    });
  }

  protected override readonly emptyHintKey = "emptyOverrideEntries" as const;

  protected override getCount(): number {
    return this.entries().length;
  }

  protected override getRowId(index: number): string {
    return `entry-${index}`;
  }

  protected override getRowLabel(index: number): string {
    return this.entries()[index]?.pattern ?? "";
  }

  protected override get deleteTitle(): string {
    return TITLES.deleteOverride;
  }

  // -- helpers ---------------------------------------------------------------

  /** The server's override entries, in map iteration order. */
  private entries(): OverrideEntry[] {
    return OverrideEntry.listFrom(this.options.servers[this.serverIndex]);
  }

  /** Handles a field commit from an override entry's submenu. Returns
   * `null` when the entry doesn't exist (stale index — no-op).
   * Nested field ids ("samplingParams.<leaf>") are routed to the leaf
   * field's apply/remove via the override object. */
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

    // Nested sampling params field: strip prefix, route to leaf field
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
