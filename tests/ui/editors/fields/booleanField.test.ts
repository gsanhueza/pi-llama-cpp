import { describe, expect, it } from "vitest";
import type { ModelOverride } from "../../../../src/interfaces/settings";
import { BooleanField } from "../../../../src/ui/editors/fields/booleanField";
import { FIELDS } from "../../../../src/ui/strings";
import { OverrideEntry } from "../../../../src/ui/editors/override/entry";

describe("BooleanField", () => {
  const field = new BooleanField("reasoning", FIELDS.reasoning);

  it("has the correct id and type", () => {
    expect(field.id).toBe("reasoning");
    expect(field.type).toBe("finite");
  });

  it("defaults to 'true' when reasoning is undefined", () => {
    const entry = new OverrideEntry("gpt-*", {});
    expect(field.displayValue(entry)).toBe("true");
  });

  it("shows 'false' when reasoning is explicitly false", () => {
    const entry = new OverrideEntry("gpt-*", { reasoning: false });
    expect(field.displayValue(entry)).toBe("false");
  });

  it("shows 'true' when reasoning is explicitly true", () => {
    const entry = new OverrideEntry("gpt-*", { reasoning: true });
    expect(field.displayValue(entry)).toBe("true");
  });

  it("accepts only 'true' and 'false'", () => {
    expect(field.validate("true")).toBe("true");
    expect(field.validate("false")).toBe("false");
    expect(field.validate("yes")).toBeNull();
    expect(field.validate("")).toBeNull();
  });

  it("sets reasoning to true on 'true'", () => {
    const override: ModelOverride = {};
    field.apply(override, "true");
    expect(override.reasoning).toBe(true);
  });

  it("sets reasoning to false on 'false'", () => {
    const override: ModelOverride = { reasoning: true };
    field.apply(override, "false");
    expect(override.reasoning).toBe(false);
  });

  it("deletes reasoning on invalid value", () => {
    const override: ModelOverride = { reasoning: true };
    field.apply(override, "invalid");
    expect(override.reasoning).toBeUndefined();
  });

  it("removes the reasoning key and returns true when present", () => {
    const override: ModelOverride = { reasoning: false };
    const removed = field.remove(override);
    expect(removed).toBe(true);
    expect(override.reasoning).toBeUndefined();
  });

  it("returns false when reasoning is already absent", () => {
    const override: ModelOverride = {};
    const removed = field.remove(override);
    expect(removed).toBe(false);
  });

  it("includes reasoning in summary when set", () => {
    expect(field.summaryPart({ reasoning: true })).toBe("reasoning: true");
    expect(field.summaryPart({ reasoning: false })).toBe("reasoning: false");
  });

  it("returns null when reasoning is not set", () => {
    expect(field.summaryPart({})).toBeNull();
  });
});
