import { describe, expect, it } from "vitest";
import type { ModelOverride } from "../../../src/interfaces/settings";
import { OverrideEntry } from "../../../src/ui/editors/override/entry";
import {
  FrequencyPenaltyField,
  MinPField,
  PresencePenaltyField,
  RepeatPenaltyField,
  TopPField,
} from "../../../src/ui/editors/override/fields/samplingParams/index";

const frequencyPenaltyField = new FrequencyPenaltyField();
const minPField = new MinPField();
const presencePenaltyField = new PresencePenaltyField();
const repeatPenaltyField = new RepeatPenaltyField();
const topPField = new TopPField();

const describeFields = (
  field: {
    id: string;
    validate: (raw: string) => string | null;
    apply: (override: ModelOverride, value: string) => void;
    remove: (override: ModelOverride) => boolean;
    displayValue: (entry: OverrideEntry) => string;
  },
  defaultVal: number,
) => {
  describe(field.id, () => {
    it("displayValue returns the value when set", () => {
      const entry = new OverrideEntry("test", {
        samplingParams: { [field.id.split(".").pop()!]: defaultVal + 0.1 },
      });
      expect(field.displayValue(entry)).toBe(String(defaultVal + 0.1));
    });

    it("displayValue returns em dash when not set", () => {
      const entry = new OverrideEntry("test", {});
      expect(field.displayValue(entry)).toBe("\u2014");
    });

    it("validate accepts blank as null (triggers reset)", () => {
      expect(field.validate("")).toBeNull();
      expect(field.validate("  ")).toBeNull();
    });

    it("validate accepts finite numbers", () => {
      expect(field.validate("0.5")).toBe("0.5");
      expect(field.validate("-1")).toBe("-1");
      expect(field.validate("1")).toBe("1");
    });

    it("validate rejects non-numbers", () => {
      expect(field.validate("abc")).toBeNull();
      expect(field.validate("Infinity")).toBeNull();
      expect(field.validate("NaN")).toBeNull();
    });

    it("apply sets the value in samplingParams", () => {
      const override: ModelOverride = {};
      field.apply(override, "0.75");
      const key = field.id.split(".").pop()!;
      expect(override.samplingParams?.[key]).toBe(0.75);
    });

    it("apply creates samplingParams if absent", () => {
      const override: ModelOverride = {};
      field.apply(override, "0.5");
      expect(override.samplingParams).toBeDefined();
    });

    it("apply removes the key on non-finite value", () => {
      const override: ModelOverride = {
        samplingParams: { [field.id.split(".").pop()!]: 0.5 },
      };
      field.apply(override, "abc");
      const key = field.id.split(".").pop()!;
      expect(override.samplingParams?.[key]).toBeUndefined();
    });

    it("remove returns true and deletes the key when present", () => {
      const override: ModelOverride = {
        samplingParams: { [field.id.split(".").pop()!]: 0.5 },
      };
      expect(field.remove(override)).toBe(true);
      const key = field.id.split(".").pop()!;
      expect(override.samplingParams?.[key]).toBeUndefined();
    });

    it("remove returns false and does nothing when absent", () => {
      const override: ModelOverride = {};
      expect(field.remove(override)).toBe(false);
    });
  });
};

describeFields(frequencyPenaltyField, 0);
describeFields(minPField, 0);
describeFields(presencePenaltyField, 0);
describeFields(repeatPenaltyField, 0);
describeFields(topPField, 0.95);
