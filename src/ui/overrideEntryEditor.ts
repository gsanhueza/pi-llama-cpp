import type { ModelCostRates } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
  SettingsList,
  type KeybindingsManager,
  type SettingItem,
  type SettingsListTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import type { LlamaServer, ModelOverride } from "../interfaces/settings";
import {
  createPersister,
  ListEditorBase,
  type EditorField,
  type ListEditorOptions,
  type ServerPersister,
} from "./baseEditor";

/** Pattern given to entries added with the `a` shortcut (uniquified) */
const DEFAULT_PATTERN = "new-pattern";

/** The capabilities accepted in an override, as expected by Pi */
const CAPABILITY_VALUES = ["text", "image"] as const;

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
 * Parses a raw capabilities value: a comma-separated list of Pi
 * capabilities (`text`, `image`). Empty input clears the override
 * (detection applies again).
 *
 * @returns The deduped capability list, the empty string to clear the
 *          key, or `null` when the input is invalid
 */
export const parseCapabilitiesValue = (
  raw: string,
): ("text" | "image")[] | "" | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  const seen = new Set<"text" | "image">();
  for (const token of trimmed.split(",")) {
    const capability = token.trim().toLowerCase();
    if (!(CAPABILITY_VALUES as readonly string[]).includes(capability)) {
      return null;
    }
    seen.add(capability as "text" | "image");
  }
  return [...seen];
};

/**
 * Parses a raw reasoning value: `true` or `false` (case-insensitive).
 * Empty input clears the override (the `true` default applies again).
 *
 * @returns `"true"`, `"false"`, the empty string to clear the key, or
 *          `null` when the input is invalid
 */
export const parseReasoningValue = (
  raw: string,
): "true" | "false" | "" | null => {
  const v = raw.trim().toLowerCase();
  if (v.length === 0) return "";
  if (v === "true") return "true";
  if (v === "false") return "false";
  return null;
};

/**
 * Returns a new list with the server at `serverIndex` updated so its
 * `overrides` map gains a new `pattern → override` entry. Immutable.
 */
export const addOverrideEntry = (
  servers: LlamaServer[],
  serverIndex: number,
  pattern: string,
  override: ModelOverride = {},
): LlamaServer[] =>
  servers.map((server, i) => {
    if (i !== serverIndex) return server;
    const overrides = { ...server.overrides, [pattern]: override };
    return { ...server, overrides };
  });

/**
 * Returns a new list with the override entry at `entryIndex` (within the
 * server's overrides map) replaced by `pattern → override` in a single
 * mutation — used both for renaming the pattern and for editing its
 * fields. The entry keeps its position in the map's iteration order.
 * Immutable.
 */
export const updateOverrideEntry = (
  servers: LlamaServer[],
  serverIndex: number,
  entryIndex: number,
  pattern: string,
  override: ModelOverride,
): LlamaServer[] =>
  servers.map((server, i) => {
    if (i !== serverIndex) return server;
    const overrides = server.overrides ?? {};
    const entries = Object.entries(overrides).map(([k, v], j) =>
      j === entryIndex ? [pattern, override] : [k, v],
    );
    return { ...server, overrides: Object.fromEntries(entries) };
  });

/**
 * Returns a new list with the override entry at `entryIndex` (within the
 * server's overrides map) removed. Immutable.
 */
export const removeOverrideEntry = (
  servers: LlamaServer[],
  serverIndex: number,
  entryIndex: number,
): LlamaServer[] =>
  servers.map((server, i) => {
    if (i !== serverIndex) return server;
    const overrides = server.overrides ?? {};
    const entries = Object.entries(overrides).filter(
      (_, j) => j !== entryIndex,
    );
    return { ...server, overrides: Object.fromEntries(entries) };
  });

/**
 * Formats an override as a compact summary shown in the entry rows:
 * `in:0.2 out:0.6 cacheR:0.01 caps:text,image reasoning:false` — cost
 * fields that are zero or undefined are omitted for brevity; `—` when
 * everything is empty.
 */
export const formatOverrideSummary = (override: ModelOverride): string => {
  const parts: string[] = [];
  const cost = override.cost ?? {};
  if (cost.input) parts.push(`in:${cost.input}`);
  if (cost.output) parts.push(`out:${cost.output}`);
  if (cost.cacheRead) parts.push(`cacheR:${cost.cacheRead}`);
  if (cost.cacheWrite) parts.push(`cacheW:${cost.cacheWrite}`);
  if (override.capabilities?.length) {
    parts.push(`caps:${override.capabilities.join(",")}`);
  }
  if (override.reasoning !== undefined) {
    parts.push(`reasoning:${override.reasoning}`);
  }
  return parts.length > 0 ? parts.join(" ") : "—";
};

/**
 * One override entry of a server, as shown in the entry list rows.
 */
interface OverrideEntryView {
  pattern: string;
  override: ModelOverride;
}

/** The override entries of `servers[serverIndex]`, in map iteration order */
const entriesOf = (
  servers: LlamaServer[],
  serverIndex: number,
): OverrideEntryView[] =>
  Object.entries(servers[serverIndex]?.overrides ?? {}).map(
    ([pattern, override]) => ({ pattern, override }),
  );

/**
 * Field specs for one server's override entries: the pattern, the four
 * numeric cost fields, capabilities and reasoning — each edited via its
 * shortcut (Enter/p pattern, i input, o output, r cacheRead, w cacheWrite,
 * c capabilities, g reasoning). `apply` reads the entry fresh from the
 * passed snapshot so consecutive edits don't clobber each other.
 */
const entryFields = (serverIndex: number): EditorField<OverrideEntryView>[] => [
  {
    keys: ["p"],
    label: "pattern",
    getValue: (entry) => entry.pattern,
    validate: (raw) => {
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    apply: (servers, entryIndex, value) =>
      updateOverrideEntry(
        servers,
        serverIndex,
        entryIndex,
        value,
        entriesOf(servers, serverIndex)[entryIndex]?.override ?? {},
      ),
  },
  ...COST_FIELD_SPECS.map((spec) => ({
    keys: [spec.key],
    label: spec.field,
    getValue: (entry: OverrideEntryView) =>
      String(entry.override.cost?.[spec.field] ?? 0),
    validate: (raw: string): string | null => {
      const parsed = parseCostValue(raw);
      return parsed === null ? null : String(parsed);
    },
    apply: (servers: LlamaServer[], entryIndex: number, value: string) => {
      const entry = entriesOf(servers, serverIndex)[entryIndex];
      return updateOverrideEntry(
        servers,
        serverIndex,
        entryIndex,
        entry?.pattern ?? "",
        {
          ...entry?.override,
          cost: { ...entry?.override.cost, [spec.field]: Number(value) },
        },
      );
    },
  })),
  {
    keys: ["c"],
    label: "capabilities",
    getValue: (entry) => entry.override.capabilities?.join(", ") ?? "",
    validate: (raw) => {
      const parsed = parseCapabilitiesValue(raw);
      return parsed === null
        ? null
        : Array.isArray(parsed)
          ? parsed.join(",")
          : "";
    },
    invalidError: (raw: string) =>
      `Invalid capabilities "${raw}" — allowed: ${CAPABILITY_VALUES.join(", ")}`,
    apply: (servers, entryIndex, value) => {
      const entry = entriesOf(servers, serverIndex)[entryIndex];
      const override: ModelOverride = { ...(entry?.override ?? {}) };
      delete override.capabilities;
      const parsed = parseCapabilitiesValue(value);
      if (Array.isArray(parsed)) override.capabilities = parsed;
      return updateOverrideEntry(
        servers,
        serverIndex,
        entryIndex,
        entry?.pattern ?? "",
        override,
      );
    },
  },
  {
    keys: ["g"],
    label: "reasoning",
    getValue: (entry) =>
      entry.override.reasoning === undefined
        ? ""
        : String(entry.override.reasoning),
    validate: (raw) => {
      const parsed = parseReasoningValue(raw);
      return parsed === null ? null : parsed;
    },
    invalidError: (raw: string) =>
      `Invalid reasoning "${raw}" — allowed: true, false (empty clears)`,
    apply: (servers, entryIndex, value) => {
      const entry = entriesOf(servers, serverIndex)[entryIndex];
      const override: ModelOverride = { ...(entry?.override ?? {}) };
      delete override.reasoning;
      if (value !== "") override.reasoning = value === "true";
      return updateOverrideEntry(
        servers,
        serverIndex,
        entryIndex,
        entry?.pattern ?? "",
        override,
      );
    },
  },
];

/**
 * Options for the `/models overrides` editor.
 */
export interface OverridesEditorOptions {
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
 * The drill-down editor for one server's override entries: one row per
 * entry (pattern + override summary), sharing the `/models servers` UX —
 *
 * Enter/p edits the pattern, i the input cost, o the output cost, r the
 * cacheRead cost, w the cacheWrite cost, c the capabilities and g the
 * reasoning flag — each through an inline Input (Enter saves, Esc cancels
 * — invalid input shows an inline error and keeps the field open for
 * correction). `a` adds a new entry (default pattern, empty override) and
 * `d` deletes the entry under the cursor — after an "Are you sure?"
 * confirmation (only `y` confirms, Enter is ignored, Esc/n cancels),
 * mirroring `/models servers`. Esc goes back to the server list.
 */
class OverrideEntryListEditor extends ListEditorBase<OverrideEntryView> {
  private readonly fieldSpecs: EditorField<OverrideEntryView>[];

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
    return `Overrides — ${this.store.items[this.serverIndex]?.url ?? ""}`;
  }

  protected primaryField(): EditorField<OverrideEntryView> {
    return this.fieldSpecs[0];
  }

  protected fields(): EditorField<OverrideEntryView>[] {
    return this.fieldSpecs;
  }

  protected getItems(): OverrideEntryView[] {
    return entriesOf(this.store.items, this.serverIndex);
  }

  protected itemLabel(entry: OverrideEntryView): string {
    return entry.pattern;
  }

  protected itemSuffix(entry: OverrideEntryView): string {
    return formatOverrideSummary(entry.override);
  }

  protected emptyStateLines(): string[] {
    return ["No overrides — press a to add one"];
  }

  protected listHint(): string {
    return "Enter/p pattern · i input · o output · r cacheRead · w cacheWrite · c capabilities · g reasoning · a add · d delete · Esc back";
  }

  protected describeForConfirm(index: number): string {
    return this.getItems()[index]?.pattern ?? "";
  }

  protected editBuild(
    field: EditorField<OverrideEntryView>,
    entryIndex: number,
    value: string,
  ): (servers: LlamaServer[]) => LlamaServer[] {
    return (servers) => field.apply(servers, entryIndex, value);
  }

  protected deleteBuild(
    entryIndex: number,
  ): (servers: LlamaServer[]) => LlamaServer[] {
    return (servers) =>
      removeOverrideEntry(servers, this.serverIndex, entryIndex);
  }

  protected afterSave(): void {
    this.afterChange();
  }

  /**
   * Adds a new entry with a unique default pattern (new-pattern,
   * new-pattern-2, …) and an empty override immediately — no inline
   * input, the pattern can be renamed afterwards with Enter/p. Moves the
   * selection to the new entry.
   */
  protected beginAdd(): void {
    const existing = new Set(
      Object.keys(this.store.items[this.serverIndex]?.overrides ?? {}),
    );
    let name = DEFAULT_PATTERN;
    let n = 2;
    while (existing.has(name)) name = `${DEFAULT_PATTERN}-${n++}`;
    void this.store.applySave(
      (servers) => addOverrideEntry(servers, this.serverIndex, name),
      () => {
        this.cursorToEnd();
        this.afterSave();
      },
    );
  }
}

/**
 * Builds the `/models overrides` editor: a SettingsList of servers whose
 * rows drill down into {@link OverrideEntryListEditor} for each server's
 * override entries.
 *
 * Servers themselves are not managed here — use `/models servers`.
 *
 * Each mutation is persisted immediately through `persist()` (which maps to
 * `LlamaSettingsManager.setLlamaSetting()`); the in-memory snapshot only
 * updates after the write succeeds, so a failed write leaves everything
 * unchanged and notifies via `onError`.
 */
export const createOverridesEditor = (
  options: OverridesEditorOptions,
): SettingsList => {
  const store = createPersister(options, options.servers);
  const listTheme = options.listTheme ?? getSettingsListTheme();

  /** Refreshes the server rows' `N entries` summaries in place */
  const refreshServerItems = () => {
    store.items.forEach((server, i) => {
      const item = serverItems[i];
      if (item) {
        item.currentValue = `${Object.keys(server.overrides ?? {}).length} entries`;
      }
    });
  };

  // Top level: one row per server; Enter drills into its override entries
  const serverItems: SettingItem[] = [];
  store.items.forEach((server, i) => {
    serverItems.push({
      id: String(i),
      label: server.url,
      description: "Enter: edit this server's override entries · Esc: done",
      currentValue: `${Object.keys(server.overrides ?? {}).length} entries`,
      submenu: (_cv, closeEntries) =>
        new OverrideEntryListEditor(
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
