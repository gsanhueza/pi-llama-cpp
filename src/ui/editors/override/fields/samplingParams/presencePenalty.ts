import { FIELDS } from "../../../../strings";
import { FloatField } from "../../../fields/floatField";
import { OverrideEntry } from "../../entry";

/** Presence penalty field: float, default 0.0. */
export class PresencePenaltyField extends FloatField {
  readonly id = "samplingParams.presence_penalty";
  readonly field = FIELDS.samplingParamsPresencePenalty;

  constructor() {
    super(
      "samplingParams",
      "presence_penalty",
      FIELDS.samplingParamsPresencePenalty,
    );
  }

  readonly validate: (raw: string) => string | null = (raw) => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return isFinite(n) ? trimmed : null;
  };

  override displayValue(entry: OverrideEntry): string {
    const value = entry.override.samplingParams?.presence_penalty;
    return value !== undefined && value !== null ? String(value) : "\u2014";
  }
}
