import type { ModelCost, ModelCostRates } from "@earendil-works/pi-ai";
import {
  Input,
  SettingsList,
  truncateToWidth,
  type Component,
  type KeybindingsManager,
  type SettingItem,
  type SettingsListTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import type { LlamaServer } from "../interfaces/settings";
import { errorMessage } from "../utils/errors";

/** The four numeric cost fields, in display order */
const COST_FIELDS = ["input", "output", "cacheRead", "cacheWrite"] as const;

type CostField = keyof ModelCostRates;

/** Labels for the numeric cost fields (also used in error messages) */
const COST_FIELD_LABELS: Record<CostField, string> = {
  input: "input",
  output: "output",
  cacheRead: "cacheRead",
  cacheWrite: "cacheWrite",
};

/** Pattern given to entries added with the `a` shortcut (uniquified) */
const DEFAULT_PATTERN = "new-pattern";

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
 * Options for the `/models costs` editor.
 */
export interface CostsEditorOptions {
  /** TUI instance, used to request re-renders after async persists */
  tui: TUI;
  /** App keybindings manager (injected by ctx.ui.custom) */
  keybindings: KeybindingsManager;
  /** Snapshot of the merged `llamaSettings.servers` to edit */
  servers: LlamaServer[];
  /** Theme for the SettingsList (from `getSettingsListTheme()`) */
  theme: SettingsListTheme;
  /** Styles the delete-confirmation prompt (e.g. `theme.fg("error", …)`) */
  alert: (text: string) => string;
  /** Persists a new server list; a rejection leaves the list unchanged */
  persist: (next: LlamaServer[]) => Promise<void>;
  /** Closes the editor (called on Esc in the server list) */
  done: () => void;
  /** Notifies about validation/persistence errors */
  onError: (message: string) => void;
  /** Called after a successful add/edit/delete (e.g. to remind about /reload) */
  onChanged: () => void;
}

/**
 * SettingsList variant used for the cost-entry list, adding `a` (add entry)
 * and `d` (delete entry) shortcuts — pi-tui's SettingsList has no dynamic
 * add/remove semantics on its own. The shortcuts only fire when no submenu
 * is open, so typing into an inline Input is unaffected. While a deletion
 * is pending, confirm mode takes over: only `y` confirms, Esc/n cancels and
 * every other key is ignored (same semantics as `/models servers`).
 */
class EntrySettingsList extends SettingsList {
  constructor(
    items: SettingItem[],
    maxVisible: number,
    theme: SettingsListTheme,
    onChange: (id: string, newValue: string) => void,
    onCancel: () => void,
    private readonly actions: {
      onAdd: () => void;
      onDelete: (entryIndex: number) => void;
      confirmDelete: () => void;
      isDeletePending: () => boolean;
      cancelDeletePending: () => void;
      isCancel: (data: string) => boolean;
    },
  ) {
    super(items, maxVisible, theme, onChange, onCancel);
  }

  handleInput(data: string): void {
    // pi-tui's SettingsList tracks `submenuComponent`, `selectedIndex` and
    // `items` as TS-private fields; they are plain properties at runtime
    // (the dependency version is pinned), and we need them to know whether
    // a submenu is open and which row the cursor is on.
    const state = this as unknown as {
      submenuComponent?: Component | null;
      selectedIndex?: number;
      items?: SettingItem[];
    };

    if (!state.submenuComponent) {
      if (data === "a") {
        this.actions.onAdd();
        return;
      }
      if (data === "d") {
        const index = state.selectedIndex ?? 0;
        if (index < (state.items?.length ?? 0)) {
          this.actions.onDelete(index);
        }
        return;
      }
      // Confirm mode: only `y` deletes the pending row; Esc/n aborts; every
      // other key — Enter and navigation included, so a stray keypress can't
      // confirm — is ignored (same semantics as /models servers)
      if (this.actions.isDeletePending()) {
        if (data === "y") {
          // Only reachable with a valid pending row: navigation and row
          // changes are impossible while the confirmation is open
          this.actions.confirmDelete();
          return;
        }
        if (data === "n" || this.actions.isCancel(data)) {
          this.actions.cancelDeletePending();
          return;
        }
        return;
      }
    }
    super.handleInput(data);
  }

  /**
   * Replaces pi-tui's generic "No settings available" empty state with a
   * message that points at the `a` shortcut — an empty entry list is a
   * normal state (a server without costs), not a dead end.
   */
  render(width: number): string[] {
    const lines = super.render(width);
    const state = this as unknown as {
      items?: SettingItem[];
      theme?: SettingsListTheme;
    };
    if ((state.items?.length ?? 0) > 0) return lines;
    const emptyIndex = lines.findIndex((line) =>
      line.includes("No settings available"),
    );
    const hint = truncateToWidth(
      // The base class always assigns its private `theme` in the constructor
      state.theme!.hint(
        "  No cost entries — press a to add one · Esc to go back",
      ),
      width,
    );
    if (emptyIndex >= 0) {
      lines[emptyIndex] = hint;
    } else {
      lines.push(hint);
    }
    return lines;
  }

  /** Whether a submenu (entry field editor) is currently open */
  get submenuOpen(): boolean {
    return (
      ((this as unknown as { submenuComponent?: Component | null })
        .submenuComponent ?? null) !== null
    );
  }

  /** The cursor's row index */
  get cursorIndex(): number {
    return (this as unknown as { selectedIndex?: number }).selectedIndex ?? 0;
  }

  set cursorIndex(index: number) {
    (this as unknown as { selectedIndex?: number }).selectedIndex = index;
  }
}

/**
 * Builds the `/models costs` editor: a SettingsList of servers whose rows
 * drill down into each server's cost entries, which in turn drill down into
 * the pattern + four numeric cost fields (each edited via an inline Input,
 * mirroring the `/tps` threshold picker's UX).
 *
 * Servers themselves are not managed here — use `/models servers`. Within a
 * server's entry list, `a` adds a new entry (default pattern, zeroed costs)
 * and `d` deletes the entry under the cursor — after an "Are you sure?"
 * confirmation on the row (only `y` confirms; Enter is ignored, Esc/n
 * cancels), mirroring `/models servers`.
 *
 * Each mutation is persisted immediately through `persist()` (which maps to
 * `LlamaSettingsManager.setLlamaSetting()`); the in-memory snapshot only
 * updates after the write succeeds, so a failed write leaves everything
 * unchanged and notifies via `onError`.
 */
export const createCostsEditor = (
  options: CostsEditorOptions,
): SettingsList => {
  let servers = options.servers;
  /** Items of the currently open entry list (mutated in place on changes) */
  let entryItems: SettingItem[] | null = null;
  let entryServerIndex = -1;
  /** Open entry list component, for cursor placement after mutations */
  let entryList: EntrySettingsList | null = null;
  /** Cursor placement for the next entry-list rebuild */
  let cursorAfterRebuild: "end" | "clamp" | null = null;
  /** Items of the top-level server list (refreshed in place on changes) */
  const serverItems: SettingItem[] = [];

  const entriesOf = (serverIndex: number): [string, Partial<ModelCost>][] =>
    Object.entries(servers[serverIndex]?.costs ?? {});

  /** Row pending deletion; `y` confirms, Esc/n cancels, other keys ignored */
  let pendingDeleteIndex: number | null = null;

  /** Refreshes the server rows' `N entries` summaries in place */
  const refreshServerItems = () => {
    servers.forEach((server, i) => {
      const item = serverItems[i];
      if (item) {
        item.currentValue = `${Object.keys(server.costs ?? {}).length} entries`;
      }
    });
  };

  /** Rebuilds the open entry list's rows in place from the snapshot */
  const rebuildEntryItems = () => {
    const items = entryItems;
    if (!items || entryServerIndex < 0) return;
    items.length = 0;
    entriesOf(entryServerIndex).forEach(([pattern, cost], j) => {
      const pending = j === pendingDeleteIndex;
      // Pending: the prompt goes in the description (rendered under the
      // row); the literal \n splits into two red lines via
      // wrapTextWithAnsi, mirroring /models servers
      items.push({
        id: String(j),
        label: pattern,
        description: pending
          ? options.alert(
              `About to delete "${pattern}"\nAre you sure? · y delete · Esc/n cancel`,
            )
          : "Enter: edit pattern and costs · a: add · d: delete",
        currentValue: formatCostSummary(cost),
        submenu: (_cv, closeEntry) =>
          createFieldList(entryServerIndex, j, closeEntry),
      });
    });
    if (entryList) {
      if (cursorAfterRebuild === "end") {
        entryList.cursorIndex = Math.max(0, items.length - 1);
      } else if (cursorAfterRebuild === "clamp") {
        entryList.cursorIndex = Math.min(
          entryList.cursorIndex,
          Math.max(0, items.length - 1),
        );
      }
    }
    cursorAfterRebuild = null;
  };

  /**
   * Persists `build(servers)`. On success, adopts the new snapshot, refreshes
   * the visible rows in place and re-renders; on failure, notifies via
   * `onError` and leaves the pre-mutation snapshot (and rows) unchanged.
   */
  const applySave = (build: (s: LlamaServer[]) => LlamaServer[]) => {
    const next = build(servers);
    return options.persist(next).then(
      () => {
        servers = next;
        refreshServerItems();
        rebuildEntryItems();
        options.onChanged();
        options.tui.requestRender();
      },
      (err) => {
        options.onError(errorMessage(err));
      },
    );
  };

  /**
   * Creates the entry-field list for one cost entry: the pattern plus the
   * four numeric fields, each edited through an inline Input (Enter saves,
   * Esc cancels — invalid input keeps the field open for correction).
   */
  const createFieldList = (
    serverIndex: number,
    entryIndex: number,
    close: () => void,
  ): SettingsList => {
    const entries = entriesOf(serverIndex);
    const currentPattern = entries[entryIndex]?.[0] ?? "";
    const currentCost = entries[entryIndex]?.[1] ?? {};

    /** Builds an inline Input submenu with validation */
    const inputSubmenu = (
      initial: string,
      validate: (raw: string) => string | null,
      name: string,
    ) => {
      return (_currentValue: string, done: (value?: string) => void) => {
        const input = new Input();
        input.setValue(initial);
        // Place the cursor at the end (the common edit: appending/changing
        // digits). Input has no "move to end" API; walk it right via the
        // standard arrow sequence, as ServerListEditor does.
        for (let i = 0; i < [...initial].length; i++) {
          input.handleInput("\x1b[C");
        }
        input.onEscape = () => done();
        input.onSubmit = (raw) => {
          const result = validate(raw);
          if (result === null) {
            options.onError(`Invalid ${name} "${raw}"`);
            return;
          }
          done(result);
        };
        return input;
      };
    };

    const items: SettingItem[] = [
      {
        id: "pattern",
        label: "pattern",
        description: "Model ID prefix filter — the longest match wins",
        currentValue: currentPattern,
        submenu: inputSubmenu(
          currentPattern,
          (raw) => {
            const trimmed = raw.trim();
            return trimmed.length > 0 ? trimmed : null;
          },
          "pattern",
        ),
      },
      ...COST_FIELDS.map((field) => {
        const initial = String(currentCost[field] ?? 0);
        return {
          id: field,
          label: COST_FIELD_LABELS[field],
          description: `Cost per million ${COST_FIELD_LABELS[field]} tokens — empty means zero`,
          currentValue: initial,
          submenu: inputSubmenu(
            initial,
            (raw) => {
              const parsed = parseCostValue(raw);
              return parsed === null ? null : String(parsed);
            },
            COST_FIELD_LABELS[field],
          ),
        };
      }),
    ];

    return new SettingsList(
      items,
      items.length + 2,
      options.theme,
      (id, newValue) => {
        // Read the entry fresh so consecutive edits don't clobber each other
        const [pattern, cost] = entriesOf(serverIndex)[entryIndex] ?? ["", {}];
        if (id === "pattern") {
          applySave((s) =>
            updateCostEntry(s, serverIndex, entryIndex, newValue, cost),
          );
        } else {
          applySave((s) =>
            updateCostEntry(s, serverIndex, entryIndex, pattern, {
              ...cost,
              [id]: Number(newValue),
            }),
          );
        }
      },
      close,
    );
  };

  /**
   * Creates the cost-entry list for one server: one row per entry plus `a`/`d`
   * shortcuts for adding and deleting entries.
   */
  const createEntryList = (
    serverIndex: number,
    close: () => void,
  ): EntrySettingsList => {
    const items: SettingItem[] = [];
    entryItems = items;
    entryServerIndex = serverIndex;
    pendingDeleteIndex = null;

    const list = new EntrySettingsList(
      items,
      Math.min(items.length + 2, 15),
      options.theme,
      () => {
        // Entry rows only open submenus; changes fire on the field lists
      },
      close,
      {
        onAdd: () => {
          // Pick a unique default pattern (new-pattern, new-pattern-2, …)
          const existing = new Set(
            Object.keys(servers[serverIndex]?.costs ?? {}),
          );
          let name = DEFAULT_PATTERN;
          let n = 2;
          while (existing.has(name)) name = `${DEFAULT_PATTERN}-${n++}`;
          cursorAfterRebuild = "end";
          applySave((s) => addCostEntry(s, serverIndex, name));
        },
        onDelete: (entryIndex) => {
          // First press enters confirm mode; deletion awaits an explicit y
          pendingDeleteIndex = entryIndex;
          rebuildEntryItems();
          options.tui.requestRender();
        },
        confirmDelete: () => {
          const entryIndex = pendingDeleteIndex;
          if (entryIndex === null) return;
          pendingDeleteIndex = null;
          cursorAfterRebuild = "clamp";
          applySave((s) => removeCostEntry(s, serverIndex, entryIndex));
        },
        isDeletePending: () => pendingDeleteIndex !== null,
        cancelDeletePending: () => {
          if (pendingDeleteIndex === null) return;
          pendingDeleteIndex = null;
          rebuildEntryItems();
          options.tui.requestRender();
        },
        isCancel: (data) =>
          options.keybindings.matches(data, "tui.select.cancel"),
      },
    );
    entryList = list;

    // Initial rows (also rebuilt in place after every successful persist)
    entriesOf(serverIndex).forEach(([pattern, cost], j) => {
      items.push({
        id: String(j),
        label: pattern,
        description: "Enter: edit pattern and costs · a: add · d: delete",
        currentValue: formatCostSummary(cost),
        submenu: (_cv, closeEntry) =>
          createFieldList(serverIndex, j, closeEntry),
      });
    });

    return list;
  };

  // Top level: one row per server; Enter drills into its cost entries
  servers.forEach((server, i) => {
    serverItems.push({
      id: String(i),
      label: server.url,
      description: "Enter: edit this server's cost entries · Esc: done",
      currentValue: `${Object.keys(server.costs ?? {}).length} entries`,
      submenu: (_cv, closeServer) => createEntryList(i, closeServer),
    });
  });

  return new SettingsList(
    serverItems,
    Math.min(serverItems.length + 2, 15),
    options.theme,
    () => {
      // Server rows only open submenus; nothing changes at this level
    },
    options.done,
  );
};
