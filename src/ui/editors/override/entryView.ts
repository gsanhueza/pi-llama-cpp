import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { SettingItem, TUI } from "@earendil-works/pi-tui";
import { SettingsList } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { ResettableSettingsList } from "../../components/resettableSettingsList";

import { HINTS } from "../../strings";
import type { OverridesViewOptions } from "../../views/listOptions";
import { OverrideEntry } from "./entry";
import { OverrideFields, OverrideSummary } from "./fields/index";
import { SAMPLING_PARAM_FIELDS } from "./fields/samplingParams/index";
import { OverrideItemBuilder } from "./itemBuilder";
import { View } from "../../views/view";
import { OverrideEntryController } from "../../controllers/overrideEntryController";

/**
 * The override entries of a single server, as a list view with add/delete.
 *
 * Composes a {@link OverrideEntryController} that manages dialogs,
 * selectedIndex, and persistence. The view builds `SettingItem[]`
 * and delegates input/render to the controller + SettingsList.
 */
export class OverrideEntryView extends View {
  private readonly controller: OverrideEntryController;
  /** Currently open field submenu, so commits can refresh its rows */
  private fieldList: SettingsList | null = null;
  isFocused = false;

  constructor(
    options: OverridesViewOptions,
    private readonly serverIndex: number,
    private readonly done: () => void,
  ) {
    super();
    this.controller = new OverrideEntryController(this, options, serverIndex);
    this.list = this.buildSettingsListSync();
  }

  // -- ViewHandle ------------------------------------------------------------

  get tui(): TUI {
    return this.controller.tui;
  }

  onClose(): void {
    this.done();
  }

  onChanged(): void {
    // No-op at top level — the parent (OverridesView) handles this
  }

  async buildSettingsList(): Promise<SettingsList> {
    return this.buildSettingsListSync();
  }

  private buildSettingsListSync(): SettingsList {
    const builder = new OverrideItemBuilder(this.controller.dialogs);
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
            const nestedItems = builder.buildSamplingParamsItems(
              this.entries()[i] ?? current,
            );
            const nestedList = new ResettableSettingsList(
              nestedItems,
              Math.min(nestedItems.length + 2, 15),
              getSettingsListTheme(),
              (nestedField, nestedValue) =>
                void this.handleFieldChange(i, nestedField, nestedValue),
              () => {
                this.fieldList = fieldList;
                const fresh = this.entries()[i] ?? current;
                fieldList?.updateValue(
                  "samplingParams",
                  OverrideFields.byId("samplingParams").displayValue(
                    new OverrideEntry(fresh.pattern, fresh.override),
                  ),
                );
                groupDone();
                this.controller.trackSubmenu(false);
              },
              (nestedField) => this.handleFieldReset(i, nestedField),
              this.controller.tui,
            );
            this.fieldList = nestedList;
            this.controller.trackSubmenu(true);
            return nestedList;
          };
        }

        const fieldList = new ResettableSettingsList(
          fieldItems,
          Math.min(fieldItems.length + 2, 15),
          getSettingsListTheme(),
          (field, value) => void this.handleFieldChange(i, field, value),
          () => {
            this.fieldList = null;
            done();
            this.controller.trackSubmenu(false);
          },
          (nestedField) => this.handleFieldReset(i, nestedField),
          this.controller.tui,
        );
        this.fieldList = fieldList;
        this.controller.trackSubmenu(true);
        return fieldList;
      },
    }));

    return this.createList(items);
  }

  setList(list: SettingsList): void {
    super.setList(list);
  }

  /** Returns the row id for the given index. */
  getRowId(index: number): string {
    return `entry-${index}`;
  }

  /** Returns the row label (override pattern) for the given index. */
  getRowLabel(index: number): string {
    return this.entries()[index]?.pattern ?? "";
  }

  // -- Component -----------------------------------------------------------

  override handleInput(data: string): void {
    // Delegate to active dialog first (input dialog for add, etc.)
    const dialog = this.controller.getActiveDialog();
    if (dialog) {
      dialog.handleInput(data);
      return;
    }
    // If a list submenu is open, delegate to the list so Esc closes the
    // submenu instead of the entire view.
    if ((this.list as any)?.submenuComponent) {
      this.list?.handleInput(data);
      return;
    }
    if (this.controller.delegateInput(data)) return;
    super.handleInput(data);
  }

  /** Shows the "(a) add override" hint when the list is empty. */
  override render(width: number): string[] {
    // Delegate to active dialog if one is open
    const dialog = this.controller.getActiveDialog();
    if (dialog) {
      return dialog.render(width);
    }
    const lines = super.render(width);
    // Replace the generic hint when there are no entries
    if (this.controller.entries().length === 0) {
      const hint = truncateToWidth(
        getSettingsListTheme().hint(
          "  Press (a) to add a provider override · Esc to cancel",
        ),
        width,
      );
      const last = lines[lines.length - 1];
      if (last && last.includes("Esc to cancel")) {
        lines[lines.length - 1] = hint;
      } else {
        lines.push(hint);
      }
    }
    return lines;
  }

  // -- Focusable -----------------------------------------------------------

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    this.controller.setFocus(value);
  }

  // -- helpers -------------------------------------------------------------

  private createList(items: SettingItem[]): SettingsList {
    return new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      () => {},
      () => this.controller.options.done(),
    );
  }

  private entries(): OverrideEntry[] {
    return OverrideEntry.listFrom(
      this.controller.options.servers[this.serverIndex],
    );
  }

  private handleFieldChange(
    entryIndex: number,
    field: string,
    value: string,
  ): void {
    const result = this.controller.applyFieldChange(entryIndex, field, value);
    if (!result) return;

    this.controller.commitFieldChange(
      result.next,
      field === "pattern" ? entryIndex : null,
      () => {
        this.list?.updateValue(
          `entry-${entryIndex}`,
          OverrideSummary.of(result.updatedOverride),
        );
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

  private handleFieldReset(entryIndex: number, field: string): void {
    const entry = this.entries()[entryIndex];
    if (!entry) return;

    const resetResult = this.controller.handleFieldReset(entryIndex, field);
    if (!resetResult) return;

    this.controller.commitFieldChange(resetResult.next, null, () => {
      this.list?.updateValue(
        `entry-${entryIndex}`,
        OverrideSummary.of(resetResult.updatedOverride),
      );
      // Update the field value in the current list (handles both regular
      // fields and sampling params sublists).
      if (field.startsWith("samplingParams.")) {
        const leafId = field.slice("samplingParams.".length);
        const leafField = SAMPLING_PARAM_FIELDS.find((f) => f.id === leafId);
        if (leafField) {
          this.fieldList?.updateValue(
            field,
            leafField.displayValue(
              new OverrideEntry(entry.pattern, resetResult.updatedOverride),
            ),
          );
        }
      } else {
        this.fieldList?.updateValue(
          field,
          OverrideFields.byId(field).displayValue(
            new OverrideEntry(entry.pattern, resetResult.updatedOverride),
          ),
        );
      }
    });
  }
}
