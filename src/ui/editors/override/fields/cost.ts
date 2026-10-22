import type { ModelCost, ModelCostRates } from "@earendil-works/pi-ai";
import type { ModelOverride } from "../../../../interfaces/settings";
import type { Field } from "../../../strings";
import { OverrideEntry } from "../entry";
import type { InputValidator } from "./base";
import { FloatField } from "../../fields/floatField";
import { parseNonNegative } from "./base";

/**
 * One `ModelCostRates` key of the override's `cost` object: extends
 * `FloatField` and overrides `apply` / `remove` / `summaryPart` to
 * handle the nested `cost` object instead of a flat property.
 */
export class CostField extends FloatField {
  readonly id: string;
  override readonly field: Field;

  constructor(
    id: string,
    private readonly key: keyof ModelCostRates,
    field: Field,
    /** Short term used in the entry-row summary (e.g. `cache read`). */
    private readonly summaryTerm: string,
  ) {
    super("cost", key, field);
    this.id = id;
    this.field = field;
  }

  displayValue(entry: OverrideEntry): string {
    return String(entry.override.cost?.[this.key] ?? 0);
  }

  override readonly validate: InputValidator = (raw) => {
    const parsed = parseNonNegative(raw);
    return parsed === null ? null : String(parsed);
  };

  /** Mutates the nested `cost` object instead of a flat property. */
  override apply(override: ModelOverride, value: string): void {
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

  /** Removes this cost key (and the whole `cost` object when it is left
   * empty). */
  override remove(override: ModelOverride): boolean {
    const had = override.cost?.[this.key] !== undefined;
    if (override.cost) {
      delete override.cost[this.key];
      if (Object.keys(override.cost).length === 0) delete override.cost;
    }
    return had;
  }

  /** Appears in the summary only when a non-zero cost is set. */
  override summaryPart(override: ModelOverride): string | null {
    const value = override.cost?.[this.key];
    return value ? `${this.summaryTerm}: $${value}` : null;
  }
}
