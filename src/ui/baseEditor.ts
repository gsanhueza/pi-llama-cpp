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
import { errorMessage } from "../utils/errors";

/**
 * Options shared by the list editors (`/models servers`, the entry
 * editors of `/models overrides`).
 */
export interface ListEditorOptions {
  /** TUI instance, used to request re-renders */
  tui: TUI;
  /** App keybindings manager (injected by ctx.ui.custom) */
  keybindings: KeybindingsManager;
  /** Theme for styling */
  theme: Theme;
  /** Closes the editor (Esc in list mode; for submenus, closes the submenu) */
  done: () => void;
  /** Notifies about persistence errors */
  onError: (message: string) => void;
}

/** Deps of {@link createPersister}, structurally satisfied by the options */
export interface PersistDeps<T> {
  /** TUI instance, used to request re-renders */
  tui: TUI;
  /** Persists a new list; a rejection keeps the current snapshot */
  persist: (next: T[]) => Promise<void>;
  /** Notifies about persistence errors */
  onError: (message: string) => void;
}

/**
 * Transactional persist helper for list editors: owns the authoritative
 * in-memory snapshot and applies mutations only after a successful write.
 *
 * `applySave(build, onSaved?)` builds the next list from the current
 * snapshot and persists it. On success the snapshot is adopted, `onSaved`
 * runs (to refresh rows/move the cursor) and the TUI re-renders; on
 * failure, `onError` is notified, the pre-mutation snapshot is kept and
 * the TUI re-renders. In both cases the editor state stays consistent —
 * a failed write never partially applies.
 */
export const createPersister = <T>(deps: PersistDeps<T>, initial: T[]) => {
  let items = initial;

  return {
    get items(): T[] {
      return items;
    },
    applySave(
      build: (current: T[]) => T[],
      onSaved?: (next: T[]) => void,
    ): Promise<void> {
      const next = build(items);
      return deps.persist(next).then(
        () => {
          items = next;
          onSaved?.(next);
          deps.tui.requestRender();
        },
        (err) => {
          // Write failed: keep the pre-mutation snapshot
          deps.onError(errorMessage(err));
          deps.tui.requestRender();
        },
      );
    },
  };
};

/** Persister over the shared `llamaSettings.servers` snapshot */
export type ServerPersister = ReturnType<typeof createPersister<LlamaServer>>;

/**
 * One editable field of a list editor's rows, edited through the inline
 * `Input` via its shortcut key(s) — the same UX as `/models servers`'
 * `e` (url) / `i` (id) / `n` (name).
 */
export interface EditorField<V> {
  /** Shortcut keys that begin editing this field in list mode */
  keys: string[];
  /** Label shown in the edit-mode prompt (rendered as `label:`) */
  label: string;
  /** Current value, used to prefill the Input (cursor placed at the end) */
  getValue: (item: V) => string;
  /**
   * Converts the raw input into the value to save, or returns `null` when
   * invalid (which keeps the field open and shows an inline error).
   */
  validate: (raw: string) => string | null;
  /**
   * Inline error for invalid input; defaults to `Invalid <label> "<raw>"`.
   */
  invalidError?: (raw: string) => string;
  /**
   * Returns the new snapshot with the field saved. `index` is the row's
   * position in {@link ListEditorBase.getItems}; implementations must read
   * fresh state from `servers` so consecutive edits don't clobber each
   * other.
   */
  apply: (
    servers: LlamaServer[],
    index: number,
    value: string,
  ) => LlamaServer[];
}

/**
 * Skeleton for the list editors: a flat, selectable list of rows with
 * three modes —
 *
 * - **list**: up/down move the cursor, Enter edits the
 *   {@link ListEditorBase.primaryField}, shortcut keys edit their
 *   {@link EditorField}, `a` adds (overridable), `d` asks for
 *   confirmation before deleting, Esc closes.
 * - **confirm**: only `y` deletes the selected row, Esc/n aborts; every
 *   other key — Enter included, so a stray keypress can't confirm — is
 *   ignored.
 * - **edit**: all other input goes to an inline `Input`; Enter saves,
 *   Esc reverts; invalid input shows an inline error and keeps editing.
 *
 * Every mutation goes through the shared {@link ServerPersister}, so the
 * rows (derived fresh on every render from
 * {@link ListEditorBase.getItems}) only ever change after a successful
 * write; a failed write notifies via `onError` and leaves everything
 * unchanged.
 *
 * Subclasses provide the rows and the field specs; the mode state
 * machine, rendering scaffold and persistence wiring live here.
 */
export abstract class ListEditorBase<V> implements Component, Focusable {
  private selectedIndex = 0;
  private mode: "list" | "edit" | "confirm" = "list";
  /** True while the edit was started by the default `beginAdd` */
  private isAdd = false;
  /** Row being edited; `-1` while adding */
  private editingIndex = -1;
  private field: EditorField<V> | null = null;
  private error: string | undefined;
  private readonly input = new Input();
  private isFocused = false;

  protected constructor(
    protected readonly options: ListEditorOptions,
    protected readonly store: ServerPersister,
  ) {}

  // -- abstract surface --------------------------------------------------

  /** Heading rendered (accent/bold) at the top of the editor */
  protected abstract title(): string;

  /** Field edited by Enter; also prefilled by the default `beginAdd` */
  protected abstract primaryField(): EditorField<V>;

  /** All shortcut-editable fields (primary included) */
  protected abstract fields(): EditorField<V>[];

  /** The rows of the list, derived fresh from the persister snapshot */
  protected abstract getItems(): V[];

  protected abstract itemLabel(item: V, index: number): string;

  /** Dim suffix rendered after the label (e.g. a summary) */
  protected itemSuffix(_item: V, _index: number): string {
    return "";
  }

  /** Dim lines shown instead of rows when the list is empty */
  protected abstract emptyStateLines(): string[];

  /** Hint line shown in list mode (the shortcut cheatsheet) */
  protected abstract listHint(): string;

  /** The row description quoted in the confirm-mode prompt */
  protected abstract describeForConfirm(index: number): string;

  /** Builds the snapshot for a field save (`isAdd` only for the default add) */
  protected abstract editBuild(
    field: EditorField<V>,
    index: number,
    value: string,
    isAdd: boolean,
  ): (servers: LlamaServer[]) => LlamaServer[];

  /** Builds the snapshot that removes the row at `index` */
  protected abstract deleteBuild(
    index: number,
  ): (servers: LlamaServer[]) => LlamaServer[];

  // -- overridable hooks ---------------------------------------------------

  /** Extra dim lines between the rows and the hint (e.g. env override note) */
  protected footerNotes(): string[] {
    return [];
  }

  /** Runs after every successful mutation (e.g. to refresh parent rows) */
  protected afterSave(): void {}

  // -- Component / Focusable ----------------------------------------------

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

    lines.push(truncate(theme.fg("accent", theme.bold(this.title()))));
    lines.push("");

    const items = this.getItems();
    if (items.length === 0) {
      for (const line of this.emptyStateLines()) {
        lines.push(truncate(theme.fg("dim", line)));
      }
    }

    items.forEach((item, index) => {
      const selected = index === this.selectedIndex;
      const prefix = selected ? theme.fg("accent", "→ ") : "  ";
      const suffix = this.itemSuffix(item, index);
      const dim = suffix ? theme.fg("dim", `  ${suffix}`) : "";
      lines.push(truncate(`${prefix}${this.itemLabel(item, index)}${dim}`));
    });

    if (this.mode === "confirm") {
      lines.push(
        truncate(
          theme.fg(
            "error",
            `About to delete "${this.describeForConfirm(this.selectedIndex)}"`,
          ),
        ),
      );
      lines.push(truncate(theme.fg("error", "Are you sure?")));
    } else if (this.mode === "edit") {
      lines.push("");
      lines.push(truncate(theme.fg("dim", `${this.field?.label ?? ""}:`)));
      lines.push(truncate(this.input.render(width)[0] ?? ""));
      if (this.error) {
        lines.push(truncate(theme.fg("error", this.error)));
      }
    }

    lines.push("");
    for (const note of this.footerNotes()) {
      lines.push(truncate(theme.fg("dim", note)));
    }
    lines.push(
      truncate(
        theme.fg(
          "dim",
          this.mode === "list"
            ? this.listHint()
            : this.mode === "confirm"
              ? "y delete · Esc/n cancel"
              : "Enter save · Esc cancel",
        ),
      ),
    );

    return lines;
  }

  // -- mode handlers -------------------------------------------------------

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
      const length = this.getItems().length;
      if (length > 0) {
        this.selectedIndex =
          this.selectedIndex === 0 ? length - 1 : this.selectedIndex - 1;
        this.requestRender();
      }
      return;
    }
    if (kb.matches(data, "tui.select.down")) {
      const length = this.getItems().length;
      if (length > 0) {
        this.selectedIndex =
          this.selectedIndex === length - 1 ? 0 : this.selectedIndex + 1;
        this.requestRender();
      }
      return;
    }
    if (kb.matches(data, "tui.select.confirm")) {
      this.beginEditPrimary();
      return;
    }
    const field = this.fields().find((f) => f.keys.includes(data));
    if (field) {
      this.beginEditField(field);
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
    if (data === "y") {
      this.deleteSelected();
      return;
    }
    if (
      data === "n" ||
      this.options.keybindings.matches(data, "tui.select.cancel")
    ) {
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
      this.resetEditMode();
      this.requestRender();
      return;
    }
    this.input.handleInput(data);
    this.requestRender();
  }

  // -- transitions ---------------------------------------------------------

  /**
   * Opens the selected row's primary field for editing.
   */
  private beginEditPrimary(): void {
    if (this.getItems().length === 0) return;
    this.beginEditField(this.primaryField());
  }

  /**
   * Opens `field` for editing on the selected row, prefilling the Input
   * with its current value and placing the cursor at the end.
   */
  private beginEditField(field: EditorField<V>): void {
    if (this.getItems().length === 0) return;
    this.mode = "edit";
    this.isAdd = false;
    this.field = field;
    this.editingIndex = this.selectedIndex;
    this.error = undefined;
    const items = this.getItems();
    this.input.setValue(field.getValue(items[this.selectedIndex]));
    moveInputCursorToEnd(this.input);
    this.requestRender();
  }

  /**
   * Enters confirm mode for the selected entry: deletion only proceeds
   * after an explicit y, guarding against accidental presses of d.
   */
  private beginConfirm(): void {
    if (this.getItems().length === 0) return;
    this.mode = "confirm";
    this.requestRender();
  }

  /**
   * Default add flow: starts editing the primary field with an empty
   * Input; saving appends a new row and moves the selection to it.
   * Subclasses with an immediate add (no inline input) override this.
   */
  protected beginAdd(): void {
    this.mode = "edit";
    this.isAdd = true;
    this.field = this.primaryField();
    this.editingIndex = -1;
    this.error = undefined;
    this.input.setValue("");
    this.requestRender();
  }

  /**
   * Saves the edited/added value: validates it, persists the new snapshot
   * and returns to list mode. Invalid input shows an inline error and
   * keeps editing; a failed write notifies via `onError` and keeps editing
   * too. Adding moves the selection to the new row.
   */
  private saveEdit(): void {
    const field = this.field;
    if (!field) return;
    const raw = this.input.getValue();
    const value = field.validate(raw);
    if (value === null) {
      this.error = field.invalidError
        ? field.invalidError(raw)
        : `Invalid ${field.label} "${raw}"`;
      this.requestRender();
      return;
    }
    const isAdd = this.isAdd;
    void this.store.applySave(
      this.editBuild(field, this.editingIndex, value, isAdd),
      () => {
        if (isAdd) this.cursorToEnd();
        this.resetEditMode();
        this.afterSave();
      },
    );
  }

  /**
   * Deletes the selected entry and persists immediately. Leaves confirm
   * mode synchronously so a second Enter while the write is pending cannot
   * queue a duplicate deletion. Clamps the selection when the last row is
   * removed.
   */
  private deleteSelected(): void {
    if (this.getItems().length === 0) return;
    this.mode = "list";
    void this.store.applySave(this.deleteBuild(this.selectedIndex), () => {
      if (this.selectedIndex >= this.getItems().length) {
        this.cursorToEnd();
      }
      this.afterSave();
    });
  }

  // -- helpers ---------------------------------------------------------------

  /** Moves the selection to the last row (used after adds and clamps) */
  protected cursorToEnd(): void {
    this.selectedIndex = Math.max(0, this.getItems().length - 1);
  }

  private resetEditMode(): void {
    this.mode = "list";
    this.editingIndex = -1;
    this.error = undefined;
  }

  private requestRender(): void {
    this.options.tui.requestRender();
  }
}

/**
 * The `Input` has no "move to end" API and `setValue()` clamps the cursor;
 * walk it right one grapheme at a time using the standard arrow sequence
 * (resolved by the Input against pi's global keybindings).
 */
const moveInputCursorToEnd = (input: Input): void => {
  for (let i = 0; i < [...input.getValue()].length; i++) {
    input.handleInput("\x1b[C");
  }
};
