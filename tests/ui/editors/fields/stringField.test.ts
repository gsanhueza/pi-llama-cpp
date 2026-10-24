import { describe, expect, it } from "vitest";
import { FIELDS } from "../../../../src/ui/strings";
import { StringField } from "../../../../src/ui/editors/fields/stringField";

// Concrete subclass to test the abstract base class
class TestStringField extends StringField {
  readonly id = "test";
  readonly field = FIELDS.pattern;
  displayValue(): string {
    return "test";
  }
}

describe("StringField", () => {
  const field = new TestStringField();

  it("rejects empty strings", () => {
    expect(field.validate("")).toBeNull();
  });

  it("rejects whitespace-only strings", () => {
    expect(field.validate("   ")).toBeNull();
  });

  it("trims and accepts non-empty values", () => {
    expect(field.validate("  hello  ")).toBe("hello");
  });

  it("accepts single-character strings", () => {
    expect(field.validate("a")).toBe("a");
  });

  it("accepts already-trimmed values", () => {
    expect(field.validate("hello")).toBe("hello");
  });
});
