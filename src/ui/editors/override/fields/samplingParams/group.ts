import { FIELDS } from "../../../../strings";
import { OverrideField } from "../base";
import type { InputValidator } from "../base";
import { OverrideEntry } from "../../entry";
import type { ModelOverride } from "../../../../../interfaces/settings";

/**
 * Sampling params group field: a gateway that opens a nested
 * `SettingsList` with the 13 individual param fields.
 *
 * The group field itself doesn't store data — `remove` clears the entire
 * `samplingParams` object. `displayValue` shows a count when params are set.
 */
export class SamplingParamsGroupField extends OverrideField {
  readonly id = "samplingParams";
  readonly type = "input";
  readonly field = FIELDS.samplingParams;

  displayValue(entry: OverrideEntry): string {
    const params = entry.override.samplingParams;
    if (!params) return "—";
    const keys = Object.keys(params);
    return keys.length === 0 ? "—" : `${keys.length} params set`;
  }

  /** Group field is inert — no apply or validate needed. */
  readonly validate: InputValidator = () => null;

  /** Removes the entire `samplingParams` object. */
  override remove(override: ModelOverride): boolean {
    const had = override.samplingParams !== undefined;
    delete override.samplingParams;
    return had;
  }

  /** Shows the count in the entry summary. */
  summaryPart(override: ModelOverride): string | null {
    const params = override.samplingParams;
    if (!params || Object.keys(params).length === 0) return null;
    return `samplingParams: ${Object.keys(params).length} params`;
  }
}
