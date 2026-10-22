import { describe, expect, it } from "vitest";
import { TemperatureField } from "../../../src/ui/editors/override/fields/samplingParams";
import { SamplingParamsGroupField } from "../../../src/ui/editors/override/fields/samplingParams/group";
import { OverrideEntry } from "../../../src/ui/editors/override/entry";

// ─── TemperatureField (NumericSamplingParamField) ──────────────────────────

describe("TemperatureField", () => {
  const field = new TemperatureField();

  describe("displayValue", () => {
    it("returns — when temperature is absent", () => {
      const entry = new OverrideEntry("gpt-*", {});
      expect(field.displayValue(entry)).toBe("—");
    });

    it("returns the stored value as string", () => {
      const entry = new OverrideEntry("gpt-*", {
        samplingParams: { temperature: 0.7 },
      });
      expect(field.displayValue(entry)).toBe("0.7");
    });

    it("returns — when temperature is null", () => {
      const entry = new OverrideEntry("gpt-*", {
        samplingParams: { temperature: null as unknown as number },
      });
      expect(field.displayValue(entry)).toBe("—");
    });
  });

  describe("validate", () => {
    it("accepts valid float strings", () => {
      expect(field.validate("0.5")).toBe("0.5");
      expect(field.validate("1.0")).toBe("1.0");
      expect(field.validate("  0.7  ")).toBe("0.7");
    });

    it("rejects non-numeric strings", () => {
      expect(field.validate("abc")).toBeNull();
      expect(field.validate("Infinity")).toBeNull();
      expect(field.validate("-Infinity")).toBeNull();
    });

    it("accepts empty string as null (no-op)", () => {
      expect(field.validate("")).toBeNull();
      expect(field.validate("  ")).toBeNull();
    });
  });

  describe("apply", () => {
    it("sets temperature on the override", () => {
      const override: Parameters<typeof field.apply>[0] = {};
      field.apply(override, "0.7");
      expect(override.samplingParams).toEqual({ temperature: 0.7 });
    });

    it("creates samplingParams when absent", () => {
      const override: Parameters<typeof field.apply>[0] = {};
      field.apply(override, "1.5");
      expect(override.samplingParams).toEqual({ temperature: 1.5 });
    });

    it("preserves other params when setting temperature", () => {
      const override: Parameters<typeof field.apply>[0] = {
        samplingParams: { top_p: 0.9 },
      };
      field.apply(override, "0.3");
      expect(override.samplingParams).toEqual({ top_p: 0.9, temperature: 0.3 });
    });

    it("stores the raw float value", () => {
      const override: Parameters<typeof field.apply>[0] = {};
      field.apply(override, "0.777");
      expect(override.samplingParams).toEqual({ temperature: 0.777 });
    });
  });

  describe("remove", () => {
    it("removes temperature and keeps samplingParams when present", () => {
      const override: Parameters<typeof field.remove>[0] = {
        samplingParams: { temperature: 0.7 },
      };
      expect(field.remove(override)).toBe(true);
      expect(override.samplingParams).toEqual({});
    });

    it("removes temperature but keeps other params", () => {
      const override: Parameters<typeof field.remove>[0] = {
        samplingParams: { temperature: 0.7, top_p: 0.9 },
      };
      field.remove(override);
      expect(override.samplingParams).toEqual({ top_p: 0.9 });
    });

    it("returns false when temperature is absent", () => {
      const override: Parameters<typeof field.remove>[0] = {};
      expect(field.remove(override)).toBe(false);
    });
  });

  describe("summaryPart", () => {
    it("returns the param line when set", () => {
      expect(field.summaryPart({ samplingParams: { temperature: 0.7 } })).toBe(
        "temperature: 0.7",
      );
    });

    it("returns null when not set", () => {
      expect(field.summaryPart({})).toBeNull();
    });
  });
});

// ─── SamplingParamsGroupField ─────────────────────────────────────────────

describe("SamplingParamsGroupField", () => {
  const field = new SamplingParamsGroupField();

  describe("displayValue", () => {
    it("returns — when samplingParams is absent", () => {
      const entry = new OverrideEntry("gpt-*", {});
      expect(field.displayValue(entry)).toBe("—");
    });

    it("returns — when samplingParams is empty", () => {
      const entry = new OverrideEntry("gpt-*", { samplingParams: {} });
      expect(field.displayValue(entry)).toBe("—");
    });

    it("returns a count when params are set", () => {
      const entry = new OverrideEntry("gpt-*", {
        samplingParams: { temperature: 0.7, top_p: 0.9 },
      });
      expect(field.displayValue(entry)).toBe("2 params set");
    });
  });

  describe("validate", () => {
    it("always returns null (inert field)", () => {
      expect(field.validate("anything")).toBeNull();
    });
  });

  describe("remove", () => {
    it("removes samplingParams and returns true when present", () => {
      const override: Parameters<typeof field.remove>[0] = {
        samplingParams: { temperature: 0.7 },
      };
      expect(field.remove(override)).toBe(true);
      expect(override.samplingParams).toBeUndefined();
    });

    it("returns false when samplingParams is absent", () => {
      const override: Parameters<typeof field.remove>[0] = {};
      expect(field.remove(override)).toBe(false);
    });
  });

  describe("summaryPart", () => {
    it("returns the param count when params are set", () => {
      expect(field.summaryPart({ samplingParams: { temperature: 0.7 } })).toBe(
        "samplingParams: 1 params",
      );
    });

    it("returns null when samplingParams is absent or empty", () => {
      expect(field.summaryPart({})).toBeNull();
      expect(field.summaryPart({ samplingParams: {} })).toBeNull();
    });
  });
});
