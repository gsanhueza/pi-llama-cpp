import { FIELDS } from "../../../../strings";
import { IntField } from "../../../fields/intField";
import { OverrideEntry } from "../../entry";

/** Seed field: integer for reproducible sampling (-1 = random). */
export class SeedField extends IntField {
  readonly id = "samplingParams.seed";
  readonly field = FIELDS.samplingParamsSeed;

  constructor() {
    super("samplingParams", "seed", FIELDS.samplingParamsSeed);
  }

  override displayValue(entry: OverrideEntry): string {
    const value = entry.override.samplingParams?.seed;
    return value !== undefined && value !== null ? String(value) : "\u2014";
  }
}
