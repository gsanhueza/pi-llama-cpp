import { FIELDS } from "../../../../strings";
import { FloatField } from "../../../fields/floatField";
import { OverrideEntry } from "../../entry";

/** Repeat penalty field: float, default 1.0. */
export class RepeatPenaltyField extends FloatField {
  readonly id = "samplingParams.repeat_penalty";
  readonly field = FIELDS.samplingParamsRepeatPenalty;

  constructor() {
    super(
      "samplingParams",
      "repeat_penalty",
      FIELDS.samplingParamsRepeatPenalty,
    );
  }

  readonly validate: (raw: string) => string | null = (raw) => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return isFinite(n) ? trimmed : null;
  };

  override displayValue(entry: OverrideEntry): string {
    const value = entry.override.samplingParams?.repeat_penalty;
    return value !== undefined && value !== null ? String(value) : "\u2014";
  }
}
