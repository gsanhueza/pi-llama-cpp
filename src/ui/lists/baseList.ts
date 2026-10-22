import type {
  Component,
  Focusable,
  SettingsList,
} from "@earendil-works/pi-tui";
import type { BaseTUIListOptions } from "../editors/editorOptions";

/**
 * Base class for top-level TUI lists.
 *
 * Handles the `ui.custom()` boilerplate and `Component`/`Focusable`
 * delegation to an internal `SettingsList`. Subclasses drive their own
 * setup via `async initialize()`.
 *
 * @typeParam O — Options type. Use `BaseTUIListOptions` for server-based
 *   lists, or a custom interface for others (e.g. `SettingsTUIListOptions`).
 */
export abstract class BaseTUIList<O extends object = BaseTUIListOptions>
  implements Component, Focusable
{
  protected list: SettingsList | null = null;
  protected isFocused = false;
  /** Resolves when `initialize()` completes. */
  protected ready: Promise<void>;

  constructor(protected readonly options: O) {
    this.ready = this.initialize();
  }

  /**
   * Called once in the constructor. Subclass drives async work here.
   */
  protected abstract initialize(): Promise<void>;

  /**
   * Helper: await a list build and request a re-render.
   */
  protected async loadList(): Promise<void> {
    this.list = await this.buildList();
    (this.options as BaseTUIListOptions).tui.requestRender();
  }

  /**
   * Build the underlying `SettingsList`. Override in subclasses.
   */
  protected buildList(): SettingsList | Promise<SettingsList> {
    throw new Error("buildList() not implemented");
  }

  // -- Component -----------------------------------------------------------

  invalidate(): void {
    this.list?.invalidate();
  }

  handleInput(data: string): void {
    if (this.delegateInput(data)) return;
    this.list?.handleInput(data);
  }

  render(width: number): string[] {
    if (!this.list) return ["Loading..."];
    return this.list.render(width);
  }

  // -- Focusable -----------------------------------------------------------

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
  }

  // -- CRUD hooks (override for add/delete/reset) -------------------------

  /** Override to handle "a" key. Return true if handled. */
  protected onAdd?(): boolean {
    return false;
  }

  /** Override to handle "d" key. Return true if handled. */
  protected onDelete?(): boolean {
    return false;
  }

  /** Override to handle "r" key. Return true if handled. */
  protected onReset?(): boolean {
    return false;
  }

  // -- internal ------------------------------------------------------------

  private delegateInput(data: string): boolean {
    if (data === "a" && this.onAdd?.()) return true;
    if (data === "d" && this.onDelete?.()) return true;
    if (data === "r" && this.onReset?.()) return true;
    return false;
  }
}
