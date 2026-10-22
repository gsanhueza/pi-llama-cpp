import { FIELDS } from "../../../../strings";
import { FloatField } from "../../../fields/floatField";
import { OverrideEntry } from "../../entry";

/** Top-p field: float, range [0, 1], default 0.95. */
export class TopPField extends FloatField {
  readonly id = "samplingParams.top_p";
  readonly field = FIELDS.samplingParamsTopP;

  constructor() {
    super("samplingParams", "top_p", FIELDS.samplingParamsTopP);
  }

  readonly validate: (raw: string) => string | null = (raw) => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return isFinite(n) ? trimmed : null;
  };

  override displayValue(entry: OverrideEntry): string {
    const value = entry.override.samplingParams?.top_p;
    return value !== undefined && value !== null ? String(value) : "\u2014";
  }
}
