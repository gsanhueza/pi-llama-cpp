import { describe, expect, it } from "vitest";
import { FIELDS } from "../../../src/ui/strings";
import type { ModelOverride } from "../../../src/interfaces/settings";
import { IntField } from "../../../src/ui/editors/fields/intField";
import { parseNonNegative } from "../../../src/ui/editors/override/fields/base";
import { OverrideEntry } from "../../../src/ui/editors/override/entry";

describe("parseNonNegative", () => {
  it("parses valid non-negative numbers", () => {
    expect(parseNonNegative("0")).toBe(0);
    expect(parseNonNegative("42")).toBe(42);
    expect(parseNonNegative("3.14")).toBe(3.14);
    expect(parseNonNegative("  10  ")).toBe(10);
  });

  it("rejects negative numbers", () => {
    expect(parseNonNegative("-1")).toBeNull();
    expect(parseNonNegative("-100")).toBeNull();
  });

  it("rejects non-numeric strings", () => {
    expect(parseNonNegative("abc")).toBeNull();
    expect(parseNonNegative("")).toBe(0);
    expect(parseNonNegative("   ")).toBe(0);
  });

  it("rejects infinity", () => {
    expect(parseNonNegative("Infinity")).toBeNull();
    expect(parseNonNegative("-Infinity")).toBeNull();
  });
});

describe("IntField", () => {
  describe("contextSize", () => {
    const field = new IntField("contextSize", FIELDS.contextSize);

    it("defaults to 0 when contextSize is undefined", () => {
      const entry = new OverrideEntry("gpt-*", {});
      expect(field.displayValue(entry)).toBe("0");
    });

    it("displays the stored value", () => {
      const entry = new OverrideEntry("gpt-*", { contextSize: 8192 });
      expect(field.displayValue(entry)).toBe("8192");
    });

    it("passes validate through (no built-in validation)", () => {
      expect(field.validate("  128  ")).toBe("  128  ");
    });

    it("applies positive values", () => {
      const override: ModelOverride = {};
      field.apply(override, "32768");
      expect(override.contextSize).toBe(32768);
    });

    it("applies zero as a value (no delete-on-zero)", () => {
      const override: ModelOverride = { contextSize: 8192 };
      field.apply(override, "0");
      expect(override.contextSize).toBe(0);
    });

    it("removes the key and returns true when present", () => {
      const override: ModelOverride = { contextSize: 4096 };
      const removed = field.remove(override);
      expect(removed).toBe(true);
      expect(override.contextSize).toBeUndefined();
    });

    it("returns false when the key is absent", () => {
      const override: ModelOverride = {};
      const removed = field.remove(override);
      expect(removed).toBe(false);
    });

    it("includes the field in summary when set", () => {
      expect(field.summaryPart({ contextSize: 8192 })).toBe(
        "contextSize: 8192",
      );
    });

    it("returns null when the field is not set", () => {
      expect(field.summaryPart({})).toBeNull();
    });
  });

  describe("maxTokens", () => {
    const field = new IntField("maxTokens", FIELDS.maxTokens);

    it("defaults to 0 when maxTokens is undefined", () => {
      const entry = new OverrideEntry("gpt-*", {});
      expect(field.displayValue(entry)).toBe("0");
    });

    it("applies positive values", () => {
      const override: ModelOverride = {};
      field.apply(override, "4096");
      expect(override.maxTokens).toBe(4096);
    });

    it("applies zero as a value (no delete-on-zero)", () => {
      const override: ModelOverride = { maxTokens: 4096 };
      field.apply(override, "0");
      expect(override.maxTokens).toBe(0);
    });
  });
});
