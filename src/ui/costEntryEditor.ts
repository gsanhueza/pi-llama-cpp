import type { ModelCost, ModelCostRates } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
  SettingsList,
  type KeybindingsManager,
  type SettingItem,
  type SettingsListTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import type { LlamaServer } from "../interfaces/settings";
import {
  createPersister,
  ListEditorBase,
  type EditorField,
  type ListEditorOptions,
  type ServerPersister,
} from "./baseEditor";

/** Pattern given to entries added with the `a` shortcut (uniquified) */
const DEFAULT_PATTERN = "new-pattern";

/**
 * The four numeric cost fields with their edit shortcuts, in display order.
 * The field name doubles as the label shown in the edit prompt.
 */
const COST_FIELD_SPECS = [
  { field: "input", key: "i" },
  { field: "output", key: "o" },
  { field: "cacheRead", key: "r" },
  { field: "cacheWrite", key: "w" },
] as const satisfies readonly { field: keyof ModelCostRates; key: string }[];

/**
 * Parses a raw cost-field value. Empty input means zero (unspecified fields
 * default to zero in the settings). Everything else must be a finite,
 * non-negative number.
 *
 * @returns The parsed value, or `null` when the input is invalid
 */
export const parseCostValue = (raw: string): number | null => {
  const v = raw.trim();
  if (v.length === 0) return 0;
  const n = Number(v);
  if (isNaN(n) || !isFinite(n) || n < 0) return null;
  return n;
};

/**
 * Returns a new list with the server at `serverIndex` updated so its `costs`
 * map gains a new `pattern → cost` entry. Immutable.
 */
export const addCostEntry = (
  servers: LlamaServer[],
  serverIndex: number,
  pattern: string,
  cost: Partial<ModelCost> = {},
): LlamaServer[] =>
  servers.map((server, i) => {
    if (i !== serverIndex) return server;
    const costs = { ...server.costs, [pattern]: cost };
    return { ...server, costs };
  });

/**
 * Returns a new list with the cost entry at `entryIndex` (within the server's
 * costs map) replaced by `pattern → cost` in a single mutation — used both
 * for renaming the pattern and for editing its cost fields. The entry keeps
 * its position in the map's iteration order. Immutable.
 */
export const updateCostEntry = (
  servers: LlamaServer[],
  serverIndex: number,
  entryIndex: number,
  pattern: string,
  cost: Partial<ModelCost>,
): LlamaServer[] =>
  servers.map((server, i) => {
    if (i !== serverIndex) return server;
    const costs = server.costs ?? {};
    const entries = Object.entries(costs).map(([k, v], j) =>
      j === entryIndex ? [pattern, cost] : [k, v],
    );
    return { ...server, costs: Object.fromEntries(entries) };
  });

/**
 * Returns a new list with the cost entry at `entryIndex` (within the server's
 * costs map) removed. Immutable.
 */
export const removeCostEntry = (
  servers: LlamaServer[],
  serverIndex: number,
  entryIndex: number,
): LlamaServer[] =>
  servers.map((server, i) => {
    if (i !== serverIndex) return server;
    const costs = server.costs ?? {};
    const entries = Object.entries(costs).filter((_, j) => j !== entryIndex);
    return { ...server, costs: Object.fromEntries(entries) };
  });

/**
 * Formats a cost as a compact summary shown in the entry rows:
 * `in:0.2 out:0.6 cacheR:0.01` — fields that are zero or undefined are
 * omitted for brevity; `—` when everything is zero.
 */
export const formatCostSummary = (cost: Partial<ModelCost>): string => {
  const parts: string[] = [];
  if (cost.input) parts.push(`in:${cost.input}`);
  if (cost.output) parts.push(`out:${cost.output}`);
  if (cost.cacheRead) parts.push(`cacheR:${cost.cacheRead}`);
  if (cost.cacheWrite) parts.push(`cacheW:${cost.cacheWrite}`);
  return parts.length > 0 ? parts.join(" ") : "—";
};

/**
 * One cost entry of a server, as shown in the entry list rows.
 */
interface CostEntryView {
  pattern: string;
  cost: Partial<ModelCost>;
}

/** The cost entries of `servers[serverIndex]`, in map iteration order */
const entriesOf = (
  servers: LlamaServer[],
  serverIndex: number,
): CostEntryView[] =>
  Object.entries(servers[serverIndex]?.costs ?? {}).map(([pattern, cost]) => ({
    pattern,
    cost,
  }));

/**
 * Field specs for one server's cost entries: the pattern plus the four
 * numeric cost fields, each edited via its shortcut (Enter/p pattern, i
 * input, o output, r cacheRead, w cacheWrite). `apply` reads the entry
 * fresh from the passed snapshot so consecutive edits don't clobber each
 * other.
 */
const entryFields = (serverIndex: number): EditorField<CostEntryView>[] => [
  {
    keys: ["p"],
    label: "pattern",
    getValue: (entry) => entry.pattern,
    validate: (raw) => {
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    apply: (servers, entryIndex, value) =>
      updateCostEntry(
        servers,
        serverIndex,
        entryIndex,
        value,
        entriesOf(servers, serverIndex)[entryIndex]?.cost ?? {},
      ),
  },
  ...COST_FIELD_SPECS.map((spec) => ({
    keys: [spec.key],
    label: spec.field,
    getValue: (entry: CostEntryView) => String(entry.cost[spec.field] ?? 0),
    validate: (raw: string): string | null => {
      const parsed = parseCostValue(raw);
      return parsed === null ? null : String(parsed);
    },
    apply: (servers: LlamaServer[], entryIndex: number, value: string) => {
      const entry = entriesOf(servers, serverIndex)[entryIndex];
      return updateCostEntry(
        servers,
        serverIndex,
        entryIndex,
        entry?.pattern ?? "",
        { ...entry?.cost, [spec.field]: Number(value) },
      );
    },
  })),
];

/**
 * Options for the `/models costs` editor.
 */
export interface CostsEditorOptions {
  /** TUI instance, used to request re-renders after async persists */
  tui: TUI;
  /** App keybindings manager (injected by ctx.ui.custom) */
  keybindings: KeybindingsManager;
  /** Full theme, used by the per-server entry editors */
  theme: Theme;
  /** Snapshot of the merged `llamaSettings.servers` to edit */
  servers: LlamaServer[];
  /** Theme for the top-level SettingsList (defaults to `getSettingsListTheme()`) */
  listTheme?: SettingsListTheme;
  /** Persists a new server list; a rejection leaves the list unchanged */
  persist: (next: LlamaServer[]) => Promise<void>;
  /** Closes the editor (called on Esc in the server list) */
  done: () => void;
  /** Notifies about persistence errors */
  onError: (message: string) => void;
  /** Called after a successful add/edit/delete (e.g. to remind about /reload) */
  onChanged: () => void;
}

/**
 * The drill-down editor for one server's cost entries: one row per entry
 * (pattern + cost summary), sharing the `/models servers` UX —
 *
 * Enter/p edits the pattern, i the input cost, o the output cost, r the
 * cacheRead cost, w the cacheWrite cost — each through an inline Input
 * (Enter saves, Esc cancels — invalid input shows an inline error and keeps
 * the field open for correction). `a` adds a new entry (default pattern,
 * zeroed costs) and `d` deletes the entry under the cursor — after an
 * "Are you sure?" confirmation (only `y` confirms, Enter is ignored, Esc/n
 * cancels), mirroring `/models servers`. Esc goes back to the server list.
 */
class CostEntryListEditor extends ListEditorBase<CostEntryView> {
  private readonly fieldSpecs: EditorField<CostEntryView>[];

  constructor(
    options: ListEditorOptions,
    store: ServerPersister,
    private readonly serverIndex: number,
    private readonly afterChange: () => void,
  ) {
    super(options, store);
    this.fieldSpecs = entryFields(serverIndex);
  }

  protected title(): string {
    return `Cost entries — ${this.store.items[this.serverIndex]?.url ?? ""}`;
  }

  protected primaryField(): EditorField<CostEntryView> {
    return this.fieldSpecs[0];
  }

  protected fields(): EditorField<CostEntryView>[] {
    return this.fieldSpecs;
  }

  protected getItems(): CostEntryView[] {
    return entriesOf(this.store.items, this.serverIndex);
  }

  protected itemLabel(entry: CostEntryView): string {
    return entry.pattern;
  }

  protected itemSuffix(entry: CostEntryView): string {
    return formatCostSummary(entry.cost);
  }

  protected emptyStateLines(): string[] {
    return ["No cost entries — press a to add one"];
  }

  protected listHint(): string {
    return "Enter/p pattern · i input · o output · r cacheRead · w cacheWrite · a add · d delete · Esc back";
  }

  protected describeForConfirm(index: number): string {
    return this.getItems()[index]?.pattern ?? "";
  }

  protected editBuild(
    field: EditorField<CostEntryView>,
    entryIndex: number,
    value: string,
  ): (servers: LlamaServer[]) => LlamaServer[] {
    return (servers) => field.apply(servers, entryIndex, value);
  }

  protected deleteBuild(
    entryIndex: number,
  ): (servers: LlamaServer[]) => LlamaServer[] {
    return (servers) => removeCostEntry(servers, this.serverIndex, entryIndex);
  }

  protected afterSave(): void {
    this.afterChange();
  }

  /**
   * Adds a new entry with a unique default pattern (new-pattern,
   * new-pattern-2, …) and zeroed costs immediately — no inline input, the
   * pattern can be renamed afterwards with Enter/p. Moves the selection to
   * the new entry.
   */
  protected beginAdd(): void {
    const existing = new Set(
      Object.keys(this.store.items[this.serverIndex]?.costs ?? {}),
    );
    let name = DEFAULT_PATTERN;
    let n = 2;
    while (existing.has(name)) name = `${DEFAULT_PATTERN}-${n++}`;
    void this.store.applySave(
      (servers) => addCostEntry(servers, this.serverIndex, name),
      () => {
        this.cursorToEnd();
        this.afterSave();
      },
    );
  }
}

/**
 * Builds the `/models costs` editor: a SettingsList of servers whose rows
 * drill down into {@link CostEntryListEditor} for each server's cost
 * entries.
 *
 * Servers themselves are not managed here — use `/models servers`.
 *
 * Each mutation is persisted immediately through `persist()` (which maps to
 * `LlamaSettingsManager.setLlamaSetting()`); the in-memory snapshot only
 * updates after the write succeeds, so a failed write leaves everything
 * unchanged and notifies via `onError`.
 */
export const createCostsEditor = (
  options: CostsEditorOptions,
): SettingsList => {
  const store = createPersister(options, options.servers);
  const listTheme = options.listTheme ?? getSettingsListTheme();

  /** Refreshes the server rows' `N entries` summaries in place */
  const refreshServerItems = () => {
    store.items.forEach((server, i) => {
      const item = serverItems[i];
      if (item) {
        item.currentValue = `${Object.keys(server.costs ?? {}).length} entries`;
      }
    });
  };

  // Top level: one row per server; Enter drills into its cost entries
  const serverItems: SettingItem[] = [];
  store.items.forEach((server, i) => {
    serverItems.push({
      id: String(i),
      label: server.url,
      description: "Enter: edit this server's cost entries · Esc: done",
      currentValue: `${Object.keys(server.costs ?? {}).length} entries`,
      submenu: (_cv, closeEntries) =>
        new CostEntryListEditor(
          {
            tui: options.tui,
            keybindings: options.keybindings,
            theme: options.theme,
            done: closeEntries,
            onError: options.onError,
          },
          store,
          i,
          () => {
            refreshServerItems();
            options.onChanged();
          },
        ),
    });
  });

  return new SettingsList(
    serverItems,
    Math.min(serverItems.length + 2, 15),
    listTheme,
    () => {
      // Server rows only open submenus; nothing changes at this level
    },
    options.done,
  );
};
