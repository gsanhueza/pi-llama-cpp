import { FIELDS } from "../../../../strings";
import { FloatField } from "../../../fields/floatField";
import { OverrideEntry } from "../../entry";

/** Frequency penalty field: float, default 0.0. */
export class FrequencyPenaltyField extends FloatField {
  readonly id = "samplingParams.frequency_penalty";
  readonly field = FIELDS.samplingParamsFrequencyPenalty;

  constructor() {
    super(
      "samplingParams",
      "frequency_penalty",
      FIELDS.samplingParamsFrequencyPenalty,
    );
  }

  readonly validate: (raw: string) => string | null = (raw) => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return isFinite(n) ? trimmed : null;
  };

  override displayValue(entry: OverrideEntry): string {
    const value = entry.override.samplingParams?.frequency_penalty;
    return value !== undefined && value !== null ? String(value) : "\u2014";
  }
}
