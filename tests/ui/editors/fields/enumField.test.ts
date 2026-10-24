import { describe, expect, it } from "vitest";
import { FIELDS } from "../../../../src/ui/strings";
import { EnumField } from "../../../../src/ui/editors/fields/enumField";
import { OverrideEntry } from "../../../../src/ui/editors/override/entry";

// Concrete subclass for testing
class TestEnumField extends EnumField {
  readonly id = "test";
  readonly field = FIELDS.pattern;
  override readonly options = ["alpha", "beta", "gamma"] as const;
  displayValue(_entry: OverrideEntry): string {
    return "beta";
  }
}

describe("EnumField", () => {
  const field = new TestEnumField();

  it("has the correct type", () => {
    expect(field.type).toBe("finite");
  });

  it("accepts values from options", () => {
    expect(field.validate("alpha")).toBe("alpha");
    expect(field.validate("beta")).toBe("beta");
    expect(field.validate("gamma")).toBe("gamma");
  });

  it("rejects values not in options", () => {
    expect(field.validate("delta")).toBeNull();
    expect(field.validate("")).toBeNull();
    expect(field.validate("  ")).toBeNull();
  });

  it("uses displayValue from subclass", () => {
    const entry = new OverrideEntry("gpt-*", {});
    expect(field.displayValue(entry)).toBe("beta");
  });
});
