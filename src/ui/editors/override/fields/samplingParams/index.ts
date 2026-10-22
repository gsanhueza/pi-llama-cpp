import type { OverrideField } from "../base";
import { FrequencyPenaltyField } from "./frequencyPenalty";
import { MinPField } from "./minP";
import { PresencePenaltyField } from "./presencePenalty";
import { RepeatPenaltyField } from "./repeatPenalty";
import { SeedField } from "./seed";
import { TemperatureField } from "./temperature";
import { TopKField } from "./topK";
import { TopPField } from "./topP";

/** All sampling param fields, in a logical grouping order. */
export const SAMPLING_PARAM_FIELDS: OverrideField[] = [
  new TemperatureField(),
  new TopKField(),
  new TopPField(),
  new MinPField(),
  new RepeatPenaltyField(),
  new PresencePenaltyField(),
  new FrequencyPenaltyField(),
  new SeedField(),
];

export {
  FrequencyPenaltyField,
  MinPField,
  PresencePenaltyField,
  RepeatPenaltyField,
  SeedField,
  TemperatureField,
  TopKField,
  TopPField,
};
