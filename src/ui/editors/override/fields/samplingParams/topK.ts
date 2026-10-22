import { FIELDS } from "../../../../strings";
import { IntField } from "../../../fields/intField";
import { OverrideEntry } from "../../entry";

/** Top-k field: integer, range [1, ∞), default 40. */
export class TopKField extends IntField {
  readonly id = "samplingParams.top_k";
  readonly field = FIELDS.samplingParamsTopK;

  constructor() {
    super("samplingParams", "top_k", FIELDS.samplingParamsTopK);
  }

  override displayValue(entry: OverrideEntry): string {
    const value = entry.override.samplingParams?.top_k;
    return value !== undefined && value !== null ? String(value) : "\u2014";
  }
}
