import type { ModelCostRates } from "@earendil-works/pi-ai";
import type { ModelOverride } from "../../../../interfaces/settings";
import { FIELDS } from "../../../strings";
import { OverrideField } from "./base";
import { CapabilitiesField } from "./capabilities";
import { CostField } from "./cost";
import { NumericField } from "./numeric";
import { PatternField } from "./pattern";
import { ReasoningField } from "./reasoning";

/** Cost field specs: [ModelCostRates key, FIELDS entry, summary term] */
const COST_FIELDS: [
  keyof ModelCostRates,
  (
    | typeof FIELDS.inputCost
    | typeof FIELDS.outputCost
    | typeof FIELDS.cacheReadCost
    | typeof FIELDS.cacheWriteCost
  ),
  string,
][] = [
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
