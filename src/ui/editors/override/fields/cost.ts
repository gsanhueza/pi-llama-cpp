import type { ModelCost, ModelCostRates } from "@earendil-works/pi-ai";
import type { ModelOverride } from "../../../../interfaces/settings";
import type { Field } from "../../../strings";
import { OverrideEntry } from "../entry";
import type { InputValidator } from "./base";
import { OverrideField } from "./base";
import { parseNonNegative } from "./numeric";

/**
 * One `ModelCostRates` key of the override's `cost` object (absorbs the
 * former `CostFieldDefFactory` and the standalone `parseCostValue` /
 * `applyCostFieldValue` helpers): owns the cost parse and immutable
 * apply in the same place as its display format.
 */
export class CostField extends OverrideField {
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
    const parsed = parseNonNegative(raw);
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
