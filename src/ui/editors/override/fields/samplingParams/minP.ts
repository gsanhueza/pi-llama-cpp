import { FIELDS } from "../../../../strings";
import { FloatField } from "../../../fields/floatField";
import { OverrideEntry } from "../../entry";

/** Min-p field: float, range [0, 1], default 0.05. */
export class MinPField extends FloatField {
  readonly id = "samplingParams.min_p";
  readonly field = FIELDS.samplingParamsMinP;

  constructor() {
    super("samplingParams", "min_p", FIELDS.samplingParamsMinP);
  }

  readonly validate: (raw: string) => string | null = (raw) => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return isFinite(n) ? trimmed : null;
  };

  override displayValue(entry: OverrideEntry): string {
    const value = entry.override.samplingParams?.min_p;
    return value !== undefined && value !== null ? String(value) : "\u2014";
  }
}
