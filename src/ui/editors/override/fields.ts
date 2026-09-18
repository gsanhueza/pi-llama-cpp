import type { ModelCost, ModelCostRates } from "@earendil-works/pi-ai";
import type { ModelOverride } from "../../../interfaces/settings";
import { FIELDS, type Field } from "../../strings";
import { SettingField } from "../settingField";
import { OverrideEntry } from "./entry";

/** Type of a field: "input" for free-text, "finite" for fixed options */
export type FieldType = "input" | "finite";

/** Validation function for input fields */
export type InputValidator = (raw: string) => string | null;

/**
 * Abstract base class for one editable field of a model override entry
 * (Template Method): each subclass owns its display format, validation
 * and apply logic in a single place, so the parse/format round-trips
 * can't drift. Extends the shared {@link SettingField} base (id, label,
 * description, placeholder from the FIELDS registry).
 */
export abstract class OverrideField extends SettingField<OverrideEntry> {
  /** Field type: "input" for free-text, "finite" for fixed options. */
  abstract readonly type: FieldType;

  /**
   * Canonical display label for this field — the single source of truth
   * for both the field rows' `currentValue` and the post-commit refresh
   * of an open field submenu, so the two can't drift.
   */
  abstract displayValue(entry: OverrideEntry): string;

  /** Current value shown in the row — same rendering as the post-commit
   * refresh of an open field submenu, so the two can't drift. */
  currentValue(entry: OverrideEntry): string {
    return this.displayValue(entry);
  }

  /** For "input" fields: validation function for committed values. */
  abstract readonly validate: InputValidator;

  /** For "finite" fields: the fixed options (undefined for "input"). */
  readonly options: readonly string[] | undefined = undefined;

  /** Applies a committed value to the override object. The pattern key
   * rename is handled separately by the mutator. */
  abstract apply(override: ModelOverride, value: string): void;

  /** One `term: value` part of the entry-row summary (see
   * {@link OverrideSummary.of}), or `null` when the field shouldn't
   * appear (unset/zero values — each field decides). The pattern is the
   * row label, so it never contributes a part; the default is `null`. */
  summaryPart(_override: ModelOverride): string | null {
    return null;
  }

  /** Parses a non-negative number; blank input means zero (unset fields
   * default to zero at read time). Returns `null` when invalid. Shared
   * by the cost and numeric fields so their validation can't drift. */
  protected static parseNonNegative(raw: string): number | null {
    const n = Number(raw.trim());
    return isFinite(n) && n >= 0 ? n : null;
  }
}

/**
 * The entry's pattern key. The rename itself is handled by the mutator
 * (`OverrideEntryMutator`); {@link apply} is a no-op.
 */
class PatternField extends OverrideField {
  readonly id = "pattern";
  readonly type = "input";
  readonly field = FIELDS.pattern;

  displayValue(entry: OverrideEntry): string {
    return entry.pattern;
  }

  readonly validate: InputValidator = (raw) => {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  apply(): void {
    // The pattern IS the map key — renames go through the mutator.
  }
}

/**
 * One `ModelCostRates` key of the override's `cost` object (absorbs the
 * former `CostFieldDefFactory` and the standalone `parseCostValue` /
 * `applyCostFieldValue` helpers): owns the cost parse and immutable
 * apply in the same place as its display format.
 */
class CostField extends OverrideField {
  readonly type = "input";
  override readonly field: Field;

  constructor(
    readonly id: string,
    private readonly key: keyof ModelCostRates,
    field: Field,
    /** Short term used in the entry-row summary (e.g. `cache read`). */
    private readonly summaryTerm: string,
  ) {
    super();
    this.field = field;
  }

  displayValue(entry: OverrideEntry): string {
    return String(entry.override.cost?.[this.key] ?? 0);
  }

  readonly validate: InputValidator = (raw) => {
    const parsed = OverrideField.parseNonNegative(raw);
    return parsed === null ? null : String(parsed);
  };

  apply(override: ModelOverride, value: string): void {
    const nextCost = this.applyCost(override.cost, Number(value));
    if (nextCost) override.cost = nextCost;
    else delete override.cost;
  }

  /** Returns a copy of `cost` with this field set to `value`. A `0` (or
   * non-finite) value removes the field — unset cost fields default to
   * zero at read time — and when no fields remain, returns `undefined`
   * so the whole `cost` object can be dropped. Immutable. */
  private applyCost(
    cost: ModelOverride["cost"],
    value: number,
  ): Partial<ModelCost> | undefined {
    const next = { ...cost };
    if (isFinite(value) && value > 0) next[this.key] = value;
    else delete next[this.key];
    return Object.keys(next).length > 0 ? next : undefined;
  }

  /** Appears in the summary only when a non-zero cost is set. */
  override summaryPart(override: ModelOverride): string | null {
    const value = override.cost?.[this.key];
    return value ? `${this.summaryTerm}: $${value}` : null;
  }
}

/**
 * Non-negative numeric field (`contextSize`, `maxTokens`): keeps the
 * display format, validator and apply logic in a single place so the
 * three can't drift (e.g. the validator accepting `0` while the apply
 * drops it — unset fields default to zero at read time, so all render
 * as `0`).
 */
class NumericField extends OverrideField {
  readonly type = "input";
  override readonly field: Field;

  constructor(
    readonly id: "maxTokens" | "contextSize",
    field: Field,
  ) {
    super();
    this.field = field;
  }

  displayValue(entry: OverrideEntry): string {
    return String(entry.override[this.id] ?? 0);
  }

  /** Accepts finite, non-negative numbers (blank means zero). */
  readonly validate: InputValidator = (raw) => {
    const n = OverrideField.parseNonNegative(raw);
    return n === null ? null : String(n);
  };

  /** Applies the committed value; non-positive values remove the key. */
  apply(override: ModelOverride, value: string): void {
    const n = Number(value);
    if (isFinite(n) && n > 0) override[this.id] = n;
    else delete override[this.id];
  }

  /** Appears in the summary only when set. */
  override summaryPart(override: ModelOverride): string | null {
    const value = override[this.id];
    return value === undefined ? null : `${this.id}: ${value}`;
  }
}

/** The override's `capabilities` list (finite: fixed label options). */
class CapabilitiesField extends OverrideField {
  readonly id = "capabilities";
  readonly type = "finite";
  readonly field = FIELDS.capabilities;
  override readonly options = ["text", "text | image"];

  displayValue(entry: OverrideEntry): string {
    return entry.override.capabilities?.join(" | ") ?? "text";
  }

  readonly validate: InputValidator = (raw) =>
    this.options?.includes(raw) ? raw : null;

  apply(override: ModelOverride, value: string): void {
    override.capabilities =
      value === "text | image"
        ? ["text", "image"]
        : value === "text"
          ? ["text"]
          : undefined;
  }

  /** Appears in the summary only when non-empty. */
  override summaryPart(override: ModelOverride): string | null {
    return override.capabilities?.length
      ? `capabilities: ${override.capabilities.join(",")}`
      : null;
  }
}

/** The override's `reasoning` flag (finite: true/false, default true). */
class ReasoningField extends OverrideField {
  readonly id = "reasoning";
  readonly type = "finite";
  readonly field = FIELDS.reasoning;
  override readonly options = ["true", "false"];

  displayValue(entry: OverrideEntry): string {
    return entry.override.reasoning === false ? "false" : "true";
  }

  readonly validate: InputValidator = (raw) =>
    this.options?.includes(raw) ? raw : null;

  apply(override: ModelOverride, value: string): void {
    if (value === "true") override.reasoning = true;
    else if (value === "false") override.reasoning = false;
    else delete override.reasoning;
  }

  /** Appears in the summary only when explicitly set. */
  override summaryPart(override: ModelOverride): string | null {
    return override.reasoning === undefined
      ? null
      : `reasoning: ${override.reasoning}`;
  }
}

/** Cost field specs: [ModelCostRates key, FIELDS entry, summary term] */
const COST_FIELDS: [keyof ModelCostRates, Field, string][] = [
  ["input", FIELDS.inputCost, "input"],
  ["output", FIELDS.outputCost, "output"],
  ["cacheRead", FIELDS.cacheReadCost, "cache read"],
  ["cacheWrite", FIELDS.cacheWriteCost, "cache write"],
];

/**
 * The field registry for model override entries: the complete list of
 * editable fields (order defines the row order in the settings list)
 * plus id-based lookup. Throws on an unknown id — the registry is
 * static, so a miss is a programming error.
 */
export class OverrideFields {
  static readonly all: OverrideField[] = [
    new PatternField(),
    ...COST_FIELDS.map(
      ([key, field, term]) => new CostField(`cost.${key}`, key, field, term),
    ),
    new CapabilitiesField(),
    new ReasoningField(),
    new NumericField("contextSize", FIELDS.contextSize),
    new NumericField("maxTokens", FIELDS.maxTokens),
  ];

  static byId(id: string): OverrideField {
    const field = this.all.find((f) => f.id === id);
    if (!field) throw new Error(`Unknown override field: ${id}`);
    return field;
  }
}

/**
 * Builds the entry-row summary shown in the override entry list
 * (`input: $0.2, output: $0.6, cache read: $0.01, …`), composed from the
 * {@link OverrideFields} registry — adding a field to the registry makes
 * it show up here too, so the summary can't lag the edit menu. Fields
 * with unset/zero values are omitted for brevity (each field decides via
 * {@link OverrideField.summaryPart}); `—` when nothing is set.
 */
export class OverrideSummary {
  static of(override: ModelOverride): string {
    const parts = OverrideFields.all
      .map((field) => field.summaryPart(override))
      .filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(", ") : "—";
  }
}
