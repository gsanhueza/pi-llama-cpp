import type { SettingItem, SettingsList } from "@earendil-works/pi-tui";
import { FIELDS, FieldMessages, HINTS, TITLES } from "../../strings";
import type { OverrideSettingsListOptions } from "../editorOptions";
import { ListEditor } from "../listEditor";
import { SettingsListFactory } from "../settingsListFactory";
import { OverrideEntry } from "./entry";
import { OverrideFields, OverrideSummary } from "./fields";
import { OverrideEntryMutator } from "./handlers";
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

  // -- abstract hooks -------------------------------------------------------

  protected buildSettingsList(): SettingsList {
    const builder = new OverrideItemBuilder(this.dialogs);
    const items: SettingItem[] = this.mutator.entries().map((entry, i) => ({
      id: `entry-${i}`,
      label: entry.pattern,
      description: HINTS.overrideEntryRow,
      currentValue: OverrideSummary.of(entry.override),
      submenu: (_cv, done) => {
        const current = this.mutator.entries()[i] ?? entry;
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
    const result = this.mutator.applyFieldChange(entryIndex, field, value);
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
    const next = this.mutator.removeEntry(idx);
    void this.persistSnapshot(next, () => {
      this.rebuildList(idx);
      this.options.onChanged?.();
      this.options.tui.requestRender();
    });
  }

  protected readonly emptyHintKey = "emptyOverrideEntries" as const;

  protected getCurrentCount(): number {
    return this.mutator.entries().length;
  }

  protected getRowId(index: number): string {
    return `entry-${index}`;
  }

  protected getRowLabel(index: number): string {
    return this.mutator.entries()[index]?.pattern ?? "";
  }

  protected get deleteTitle(): string {
    return TITLES.deleteOverride;
  }

  // -- helpers ---------------------------------------------------------------

  /** Fresh mutator over the current servers snapshot — `persistSnapshot`
   * replaces `options.servers` in place, so instances can't be cached. */
  private get mutator(): OverrideEntryMutator {
    return new OverrideEntryMutator(this.options.servers, this.serverIndex);
  }

  private async saveAdd(pattern: string): Promise<void> {
    const next = this.mutator.addEntry(pattern);
    await this.persistSnapshot(next, () => {
      this.rebuildList(this.mutator.entries().length - 1);
      this.options.onChanged?.();
      this.options.tui.requestRender();
    });
  }
}
