import { describe, expect, it } from "vitest";
import { FIELDS } from "../../../../src/ui/strings";
import { SettingField } from "../../../../src/ui/editors/fields/settingField";

// Concrete subclass for testing
class TestField extends SettingField<{ name: string }> {
  readonly id = "test";
  readonly field = FIELDS.contextSize;

  currentValue(entry: { name: string }): string {
    return entry.name;
  }
}

describe("SettingField", () => {
  const field = new TestField();

  it("has the correct id", () => {
    expect(field.id).toBe("test");
  });

  it("returns label from the shared FIELDS registry", () => {
    expect(field.label).toBe(FIELDS.contextSize.label);
  });

  it("returns description from the shared FIELDS registry", () => {
    expect(field.description).toBe(FIELDS.contextSize.description);
  });

  it("returns placeholder from the shared FIELDS registry", () => {
    expect(field.placeholder).toBe(FIELDS.contextSize.placeholder);
  });
});
