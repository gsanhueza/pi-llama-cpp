import { describe, expect, it, vi } from "vitest";
import { OverrideItemBuilder } from "../../../../src/ui/editors/override/itemBuilder";
import { OverrideFields } from "../../../../src/ui/editors/override/fields";
import { SAMPLING_PARAM_FIELDS } from "../../../../src/ui/editors/override/fields/samplingParams";
import { OverrideEntry } from "../../../../src/ui/editors/override/entry";
import type { DialogFactory } from "../../../../src/ui/dialog/factory";

describe("OverrideItemBuilder", () => {
  const mockDialogs: DialogFactory = {
    inputSubmenu: vi.fn((_title, _message, _placeholder, _validate) => {
      return (_cv: string, done: (v?: string) => void) => {
        done(undefined);
        return {} as any;
      };
    }),
  } as unknown as DialogFactory;

  const builder = new OverrideItemBuilder(mockDialogs);

  it("returns all OverrideFields in order", () => {
    expect((builder as any).fields).toBe(OverrideFields.all);
    expect((builder as any).fields.length).toBeGreaterThan(0);
  });

  it("builds field items for an entry", () => {
    const entry = new OverrideEntry("gpt-*", {
      reasoning: false,
      contextSize: 8192,
    });
    const items = builder.buildFieldItems(entry);

    expect(items).toHaveLength(OverrideFields.all.length);
    // Check that each item has the expected structure
    items.forEach((item) => {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("label");
      expect(item).toHaveProperty("description");
      expect(item).toHaveProperty("currentValue");
    });
  });

  it("builds sampling params items", () => {
    const entry = new OverrideEntry("gpt-*", {
      samplingParams: { temperature: 0.7, top_p: 0.9 },
    });
    const items = builder.buildSamplingParamsItems(entry);

    expect(items).toHaveLength(SAMPLING_PARAM_FIELDS.length);
    items.forEach((item) => {
      expect(item.id).toMatch(/^samplingParams\./);
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("label");
      expect(item).toHaveProperty("description");
      expect(item).toHaveProperty("currentValue");
    });
  });

  it("uses inputSubmenu for input-type fields", () => {
    const entry = new OverrideEntry("gpt-*", {});
    builder.buildFieldItems(entry);

    expect(mockDialogs.inputSubmenu).toHaveBeenCalled();
  });

  it("uses inputSubmenu for sampling params input fields", () => {
    const entry = new OverrideEntry("gpt-*", { samplingParams: {} });
    builder.buildSamplingParamsItems(entry);

    expect(mockDialogs.inputSubmenu).toHaveBeenCalled();
  });
});
