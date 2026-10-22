import { FIELDS } from "../../../../strings";
import { FloatField } from "../../../fields/floatField";
import { OverrideEntry } from "../../entry";

/** Temperature field: float, range [0, ∞), default 1.0. */
export class TemperatureField extends FloatField {
  readonly id = "samplingParams.temperature";
  readonly field = FIELDS.samplingParamsTemperature;

  constructor() {
    super("samplingParams", "temperature", FIELDS.samplingParamsTemperature);
  }

  readonly validate: (raw: string) => string | null = (raw) => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return isFinite(n) ? trimmed : null;
  };

  override displayValue(entry: OverrideEntry): string {
    const value = entry.override.samplingParams?.temperature;
    return value !== undefined && value !== null ? String(value) : "\u2014";
  }
}
